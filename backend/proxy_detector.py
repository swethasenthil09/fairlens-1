"""
proxy_detector.py — Universal proxy detection.
Works with any dataset. Sensitive cols and non-sensitive cols
are passed in — no hardcoded column names.
"""
import numpy as np
import pandas as pd
from scipy.stats import chi2_contingency

CRAMERS_HIGH = 0.15
CRAMERS_MED  = 0.06


def cramers_v(x: pd.Series, y: pd.Series) -> float:
    try:
        ct = pd.crosstab(x, y)
        if ct.shape[0] < 2 or ct.shape[1] < 2:
            return 0.0
        chi2, _, _, _ = chi2_contingency(ct)
        n = ct.values.sum()
        k = min(ct.shape) - 1
        if n == 0 or k == 0:
            return 0.0
        return float(np.sqrt(chi2 / (n * k)))
    except Exception:
        return 0.0


def within_value_disparity(df: pd.DataFrame, feat: str, sens: str,
                            outcome_col: str = "hired") -> float:
    """
    For each value of feat, compute hire-rate gap across sens groups.
    Returns mean absolute gap — proves the model treats same feature
    value differently based on group membership.
    """
    if outcome_col not in df.columns:
        return 0.0
    gaps = []
    feat_is_cat = df[feat].dtype == object
    if feat_is_cat:
        for val in df[feat].dropna().unique():
            sub = df[df[feat] == val]
            if sub[sens].nunique() < 2:
                continue
            rates = sub.groupby(sens)[outcome_col].mean()
            if len(rates) >= 2:
                gaps.append(float(rates.max() - rates.min()))
    else:
        try:
            df2 = df.copy()
            df2["_bin"] = pd.qcut(df2[feat], q=5, duplicates="drop")
            for b in df2["_bin"].dropna().unique():
                sub = df2[df2["_bin"] == b]
                if sub[sens].nunique() < 2:
                    continue
                rates = sub.groupby(sens)[outcome_col].mean()
                if len(rates) >= 2:
                    gaps.append(float(rates.max() - rates.min()))
        except Exception:
            pass
    return float(np.mean(gaps)) if gaps else 0.0


def detect_proxies(df: pd.DataFrame,
                   sensitive_cols: list,
                   non_sensitive_cols: list,
                   outcome_col: str = "hired") -> dict:
    """
    Universal proxy detection.
    sensitive_cols: columns already identified as protected attributes
    non_sensitive_cols: feature columns to test for proxy risk
    """
    results = {}
    hired_df = df[df[outcome_col] == 1] if outcome_col in df.columns else df

    for feat in non_sensitive_cols:
        if feat not in df.columns:
            continue
        feat_risks = []
        feat_is_cat = df[feat].dtype == object

        for sens in sensitive_cols:
            if sens not in df.columns:
                continue
            sens_is_cat = df[sens].dtype == object
            scores = {}

            # Method 1: Structural Cramér's V
            if feat_is_cat and sens_is_cat:
                cv = cramers_v(df[feat].astype(str), df[sens].astype(str))
                scores["structural_cramers_v"] = cv

            elif not feat_is_cat and sens_is_cat:
                groups = df[sens].dropna().unique()
                gm = [df.loc[df[sens] == g, feat].dropna().mean()
                      for g in groups if (df[sens] == g).sum() >= 5]
                s = df[feat].dropna().std()
                if s > 0 and len(gm) >= 2:
                    scores["group_mean_dispersion"] = min(float(np.std(gm)/s), 1.0)

            # Method 2: Outcome-differential
            if feat_is_cat and len(hired_df) >= 20 and sens_is_cat:
                try:
                    ct = pd.crosstab(hired_df[feat].astype(str),
                                     hired_df[sens].astype(str))
                    if ct.shape[0] >= 2 and ct.shape[1] >= 2:
                        chi2, p, _, _ = chi2_contingency(ct)
                        n = ct.values.sum(); k = min(ct.shape) - 1
                        cv2 = float(np.sqrt(chi2/(n*k))) if n and k else 0
                        if p < 0.10:
                            scores["outcome_differential"] = cv2
                except Exception:
                    pass

            # Method 3: Within-value disparity (most sensitive)
            wvd = within_value_disparity(df, feat, sens, outcome_col)
            if wvd > 0:
                scores["within_value_disparity"] = wvd

            if scores:
                best_score  = max(scores.values())
                best_method = max(scores, key=scores.get)
                if best_score > CRAMERS_MED:
                    feat_risks.append({
                        "sensitive_attr": sens,
                        "score":          round(best_score, 3),
                        "method":         f"{best_method}={best_score:.3f}",
                        "risk":           "HIGH" if best_score >= CRAMERS_HIGH else "MEDIUM",
                        "all_scores":     {k: round(v, 3) for k, v in scores.items()},
                    })

        if feat_risks:
            max_score = max(r["score"] for r in feat_risks)
            results[feat] = {
                "max_proxy_score": round(max_score, 3),
                "risk_level":      "HIGH" if max_score >= CRAMERS_HIGH else "MEDIUM",
                "correlations":    feat_risks,
                "recommendation":  _rec(feat, max_score, feat_risks),
            }

    # Cross-correlations between sensitive attrs
    cross = {}
    for i, s1 in enumerate(sensitive_cols):
        for s2 in sensitive_cols[i+1:]:
            if s1 in df.columns and s2 in df.columns:
                v = cramers_v(df[s1].astype(str), df[s2].astype(str))
                if v > 0.08:
                    cross[f"{s1} ↔ {s2}"] = round(v, 3)

    return {
        "feature_proxy_risks":          results,
        "sensitive_cross_correlations": cross,
        "sensitive_attrs_found":        sensitive_cols,
        "high_risk_count":   sum(1 for r in results.values() if r["risk_level"] == "HIGH"),
        "medium_risk_count": sum(1 for r in results.values() if r["risk_level"] == "MEDIUM"),
    }


def _rec(feat, score, risks):
    attrs = list({r["sensitive_attr"] for r in risks})
    if score >= CRAMERS_HIGH:
        return (f"HIGH RISK: '{feat}' shows within-outcome disparity up to "
                f"{score*100:.0f}pp across {', '.join(attrs)} groups. "
                "Consider removing or transforming before training.")
    return (f"REVIEW '{feat}': moderate proxy association with "
            f"{', '.join(attrs)} (score={score:.3f}).")
