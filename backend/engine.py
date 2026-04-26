"""
engine.py — Universal ML + fairness engine.
Works with ANY CSV dataset.
Never assumes column names. Never hardcodes values.
Everything inferred from column_detector.py + actual data.
"""
import numpy as np
import pandas as pd
from sklearn.ensemble import GradientBoostingClassifier
from sklearn.linear_model import LogisticRegression
from sklearn.model_selection import train_test_split, cross_val_score
from sklearn.metrics import (accuracy_score, roc_auc_score,
                              confusion_matrix, f1_score)
from sklearn.preprocessing import LabelEncoder
import warnings
warnings.filterwarnings("ignore")

from column_detector import detect_columns, encode_outcome, user_column_config
from metrics import compute_all_metrics
from proxy_detector import detect_proxies


class FairLensEngine:
    def __init__(self):
        self.df            = None       # raw dataframe
        self.df_encoded    = None       # encoded version for modelling
        self.col_config    = None       # output of detect_columns()
        self.model         = None
        self.label_encoders = {}        # col -> LabelEncoder for cat features
        self.outcome_col   = None
        self.sensitive_cols = {}        # {col: type}
        self.numeric_cols  = []
        self.feature_cols  = []         # cols actually fed to model
        self.y_pred        = None
        self.y_prob        = None
        self.y_test        = None
        self.df_test       = None       # test-set rows with original values
        self.idx_test      = None

    # ── LOAD & AUTO-DETECT ────────────────────────────────────────
    def load(self, path: str, user_overrides: dict = None) -> dict:
        try:
            self.df = pd.read_csv(path)
        except Exception as e:
            return {"ok": False, "error": f"Could not read CSV: {e}"}

        if len(self.df) < 20:
            return {"ok": False, "error": "Dataset too small (need at least 20 rows)"}

        # Auto-detect
        auto = detect_columns(self.df)

        # Apply user overrides if provided
        if user_overrides:
            self.col_config = user_column_config(self.df, auto, user_overrides)
        else:
            self.col_config = auto

        self.outcome_col   = self.col_config["outcome_col"]
        self.sensitive_cols = self.col_config["sensitive_cols"]
        self.numeric_cols  = self.col_config["numeric_cols"]

        if not self.outcome_col:
            return {
                "ok": False,
                "error": "No outcome/label column detected.",
                "detected": self.col_config,
                "hint": "Pass {'outcome_col': 'your_column_name'} in user_overrides."
            }

        if not self.sensitive_cols:
            return {
                "ok": False,
                "error": "No sensitive attribute columns detected.",
                "detected": self.col_config,
                "hint": "Pass {'sensitive_cols': ['col1','col2']} in user_overrides."
            }

        # Encode outcome → 0/1
        try:
            self.df["__outcome__"] = encode_outcome(self.df, self.outcome_col)
        except Exception as e:
            return {"ok": False, "error": f"Could not encode outcome column: {e}"}

        # Build feature set: numeric + encoded categoricals (non-sensitive, non-id)
        self.feature_cols = list(self.numeric_cols)

        # Encode categorical feature cols for model
        self.df_encoded = self.df.copy()
        for col in self.col_config["categorical_cols"]:
            if col in self.df.columns:
                le = LabelEncoder()
                self.df_encoded[col + "__enc"] = le.fit_transform(
                    self.df[col].astype(str).fillna("__missing__"))
                self.label_encoders[col] = le
                self.feature_cols.append(col + "__enc")

        if not self.feature_cols:
            return {
                "ok": False,
                "error": "No usable feature columns found (need at least one numeric or categorical feature).",
                "detected": self.col_config,
            }

        return {
            "ok":               True,
            "n_rows":           len(self.df),
            "n_cols":           len(self.df.columns),
            "columns":          list(self.df.columns),
            "outcome_col":      self.outcome_col,
            "outcome_confidence": self.col_config["outcome_confidence"],
            "sensitive_cols":   self.sensitive_cols,
            "numeric_cols":     self.numeric_cols,
            "categorical_cols": self.col_config["categorical_cols"],
            "feature_cols_model": self.feature_cols,
            "id_cols":          self.col_config["id_cols"],
            "warnings":         self.col_config["warnings"],
            "ready":            self.col_config["summary"]["ready_to_analyse"],
        }

    # ── RECONFIGURE (user corrects auto-detection) ────────────────
    def reconfigure(self, user_overrides: dict) -> dict:
        if self.df is None:
            return {"ok": False, "error": "No dataset loaded"}
        return self.load.__func__(self, None, user_overrides)  # re-run with overrides

    # ── DATASET STATISTICS ─────────────────────────────────────────
    def dataset_stats(self) -> dict:
        df = self.df
        oc = "__outcome__"
        total      = len(df)
        hired_n    = int(df[oc].sum())

        stats = {
            "total":       total,
            "hired":       hired_n,
            "not_hired":   total - hired_n,
            "hire_rate":   round(hired_n / total, 4),
            "outcome_col": self.outcome_col,
            "missing_by_col": {
                c: int(df[c].isna().sum())
                for c in df.columns if df[c].isna().sum() > 0
            },
            "group_stats": {},
            "column_types": {
                "outcome":     self.outcome_col,
                "sensitive":   self.sensitive_cols,
                "numeric":     self.numeric_cols,
                "categorical": self.col_config["categorical_cols"],
                "id":          self.col_config["id_cols"],
            },
        }

        for col in self.sensitive_cols:
            if col not in df.columns:
                continue
            grp = (
                df.groupby(col)[oc]
                .agg(["sum","count","mean"])
                .reset_index()
            )
            grp.columns = [col, "hired_n", "total_n", "hire_rate"]
            stats["group_stats"][col] = {
                str(row[col]): {
                    "hired":       int(row["hired_n"]),
                    "total":       int(row["total_n"]),
                    "hire_rate":   round(float(row["hire_rate"]), 4),
                    "pct_dataset": round(float(row["total_n"] / total), 4),
                }
                for _, row in grp.iterrows()
            }

        # Numeric summary (mean per group for each sensitive attr)
        stats["numeric_by_group"] = {}
        for sens in list(self.sensitive_cols.keys())[:3]:
            for num in self.numeric_cols[:4]:
                if num not in df.columns or sens not in df.columns:
                    continue
                key = f"{num}_by_{sens}"
                stats["numeric_by_group"][key] = (
                    df.groupby(sens)[num].mean().round(4).to_dict()
                )

        return stats

    # ── TRAIN MODEL ───────────────────────────────────────────────
    def train(self) -> dict:
        df = self.df_encoded.dropna(
            subset=self.feature_cols + ["__outcome__"])

        X = df[self.feature_cols].values
        y = df["__outcome__"].values

        if len(X) < 30:
            return {"ok": False, "error": "Not enough complete rows to train"}

        # Keep original index for test-set lookups
        orig_idx = df.index.tolist()
        X_tr, X_te, y_tr, y_te, idx_tr, idx_te = train_test_split(
            X, y, orig_idx,
            test_size=0.30, random_state=42,
            stratify=y if y.mean() > 0.05 else None
        )
        self.idx_test = idx_te
        self.df_test  = self.df.loc[idx_te].reset_index(drop=True)
        self.y_test   = y_te

        # Train
        self.model = GradientBoostingClassifier(
            n_estimators=120, max_depth=4,
            learning_rate=0.08, random_state=42)
        self.model.fit(X_tr, y_tr)

        self.y_pred = self.model.predict(X_te)
        self.y_prob = self.model.predict_proba(X_te)[:, 1]

        # Cross-validation
        cv_scores = cross_val_score(
            GradientBoostingClassifier(n_estimators=100, random_state=42),
            X_tr, y_tr, cv=min(5, int(y_tr.sum())),
            scoring="roc_auc"
        )

        cm = confusion_matrix(y_te, self.y_pred)

        # Feature importance mapped back to original col names
        raw_fi = dict(zip(self.feature_cols, self.model.feature_importances_))
        # Strip __enc suffix for display
        fi_display = {}
        for col, imp in raw_fi.items():
            display = col.replace("__enc", "")
            fi_display[display] = round(float(imp), 4)
        fi_display = dict(sorted(fi_display.items(), key=lambda x: -x[1]))

        return {
            "ok":           True,
            "accuracy":     round(accuracy_score(y_te, self.y_pred), 4),
            "auc":          round(roc_auc_score(y_te, self.y_prob), 4),
            "f1":           round(f1_score(y_te, self.y_pred), 4),
            "cv_auc_mean":  round(float(cv_scores.mean()), 4),
            "cv_auc_std":   round(float(cv_scores.std()), 4),
            "confusion_matrix": cm.tolist(),
            "train_size":   len(X_tr),
            "test_size":    len(X_te),
            "feature_importance": fi_display,
            "model_type":   "GradientBoostingClassifier",
            "outcome_col":  self.outcome_col,
            "feature_cols": [c.replace("__enc","") for c in self.feature_cols],
        }

    # ── FAIRNESS METRICS FOR ONE ATTRIBUTE ────────────────────────
    def fairness_metrics(self, attribute: str) -> dict:
        if self.model is None:
            return {"ok": False, "error": "Model not trained yet"}
        if attribute not in self.df_test.columns:
            return {"ok": False, "error": f"Column '{attribute}' not in dataset"}

        groups = self.df_test[attribute].astype(str).values
        valid  = groups != "nan"
        if valid.sum() < 10:
            return {"ok": False, "error": f"Too few non-null values in '{attribute}'"}

        result = compute_all_metrics(
            y_true=self.y_test[valid],
            y_pred=self.y_pred[valid],
            y_prob=self.y_prob[valid],
            groups=groups[valid],
            attr_name=attribute,
        )
        result["ok"] = True
        return result

    # ── ALL SENSITIVE ATTRIBUTES ───────────────────────────────────
    def all_fairness_metrics(self) -> dict:
        if self.model is None:
            return {"ok": False, "error": "Model not trained"}
        out = {"ok": True, "by_attribute": {}}
        for attr in self.sensitive_cols:
            try:
                out["by_attribute"][attr] = self.fairness_metrics(attr)
            except Exception as e:
                out["by_attribute"][attr] = {"ok": False, "error": str(e)}
        return out

    # ── PROXY DETECTION ───────────────────────────────────────────
    def proxy_analysis(self) -> dict:
        if self.df is None:
            return {"ok": False, "error": "No dataset"}
        # Inject outcome for within-value disparity method
        df_proxy = self.df.copy()
        df_proxy["hired"] = df_proxy["__outcome__"]
        try:
            result = detect_proxies(
                df_proxy,
                sensitive_cols=list(self.sensitive_cols.keys()),
                non_sensitive_cols=(
                    self.numeric_cols +
                    self.col_config["categorical_cols"]
                )
            )
            result["ok"] = True
            return result
        except Exception as e:
            return {"ok": False, "error": str(e)}

    # ── CANDIDATE FLAGGING ────────────────────────────────────────
    def flag_candidates(self, score_threshold: float = 0.65) -> dict:
        """
        Flag candidates who scored above threshold on ALL available
        numeric score columns but were not selected.
        Works with any dataset — uses whatever numeric cols exist.
        """
        df = self.df.copy()
        df["__outcome__"] = self.df["__outcome__"]

        score_cols = [c for c in self.numeric_cols if c in df.columns]
        if not score_cols:
            return {"ok": False, "error": "No numeric score columns available for flagging"}

        # Convert to numeric safely
        for c in score_cols:
            df[c] = pd.to_numeric(df[c], errors="coerce")

        # Normalise each score col to [0,1] if not already
        norm_masks = []
        for c in score_cols:
            mn, mx = df[c].min(), df[c].max()
            if mx > mn:
                norm = (df[c] - mn) / (mx - mn)
            else:
                norm = df[c]
            norm_masks.append(norm >= score_threshold)

        qualified = norm_masks[0]
        for m in norm_masks[1:]:
            qualified = qualified & m

        flagged = df[qualified & (df["__outcome__"] == 0)].copy()

        # Add model score if available
        if self.model is not None and len(flagged) > 0:
            enc_df = self.df_encoded.loc[flagged.index, self.feature_cols]
            enc_clean = enc_df.fillna(enc_df.mean())
            if len(enc_clean):
                flagged = flagged.copy()
                flagged["model_score"] = (
                    self.model.predict_proba(enc_clean.values)[:, 1].round(3))

        # Group breakdown
        breakdown = {}
        for col in self.sensitive_cols:
            if col in flagged.columns:
                breakdown[col] = {
                    str(k): int(v)
                    for k, v in flagged[col].value_counts().items()
                }

        return {
            "ok":              True,
            "n_flagged":       len(flagged),
            "n_qualified":     int(qualified.sum()),
            "score_cols_used": score_cols,
            "threshold":       score_threshold,
            "flagged_records": flagged.head(200).fillna("").to_dict(orient="records"),
            "group_breakdown": breakdown,
        }

    # ── BIAS SCORE ─────────────────────────────────────────────────
    def bias_score(self) -> dict:
        if self.model is None:
            return {"score": None, "error": "Model not trained"}

        penalties, details = [], []
        for attr in list(self.sensitive_cols.keys())[:5]:
            try:
                m   = self.fairness_metrics(attr)
                dpd = m.get("demographic_parity", {}).get("dpd") or 0
                dir_ = m.get("disparate_impact",  {}).get("dir") or 1
                eod = m.get("equal_opportunity",  {}).get("eod") or 0

                p_dpd = min(100, abs(dpd) * 300)
                p_dir = min(100, max(0, (0.8 - dir_) * 250)) if dir_ < 0.8 else 0
                p_eod = min(100, abs(eod) * 200)
                penalty = p_dpd * 0.4 + p_dir * 0.4 + p_eod * 0.2
                penalties.append(penalty)
                details.append({
                    "attribute": attr,
                    "dpd":       round(dpd, 4),
                    "dir":       round(dir_, 4),
                    "eod":       round(eod, 4),
                    "penalty":   round(penalty, 1),
                })
            except Exception:
                continue

        if not penalties:
            return {"score": 0, "level": "LOW", "details": []}

        score = round(min(99, sum(penalties) / len(penalties)), 1)
        level = ("CRITICAL" if score > 65 else "HIGH" if score > 40
                 else "MEDIUM" if score > 20 else "LOW")
        return {"score": score, "level": level, "details": details,
                "passes_overall": score < 20}
