"""
mitigator.py — Universal mitigation. Works with any dataset.
feature_cols, label_col, sensitive_col are all passed in — no hardcoding.
"""
import numpy as np
import pandas as pd
from sklearn.ensemble import GradientBoostingClassifier
from sklearn.model_selection import train_test_split
from sklearn.metrics import accuracy_score, roc_auc_score
import warnings
warnings.filterwarnings("ignore")


def compute_reweighing_weights(df, label_col, sensitive_col):
    weights = pd.Series(1.0, index=df.index)
    for g in df[sensitive_col].dropna().unique():
        for y in df[label_col].dropna().unique():
            m_g = df[sensitive_col] == g
            m_y = df[label_col] == y
            m_gy = m_g & m_y
            p_g, p_y, p_gy = m_g.mean(), m_y.mean(), m_gy.mean()
            if p_gy > 0:
                weights[m_gy] = (p_g * p_y) / p_gy
    return weights


def equalize_ppr_thresholds(y_true, y_prob, groups):
    overall_ppr = y_true.mean()
    thresholds = {}
    for g in np.unique(groups):
        mask = groups == g
        yp   = y_prob[mask]
        best_t, best_gap = 0.50, 9999.0
        for t in np.arange(0.10, 0.91, 0.01):
            gap = abs((yp >= t).mean() - overall_ppr)
            if gap < best_gap:
                best_gap, best_t = gap, float(t)
        thresholds[str(g)] = round(best_t, 2)
    y_adj = np.zeros(len(y_true), dtype=int)
    for g in np.unique(groups):
        mask = groups == g
        y_adj[mask] = (y_prob[mask] >= thresholds[str(g)]).astype(int)
    return {"thresholds": thresholds, "y_pred_adjusted": y_adj.tolist(),
            "target_ppr": round(float(overall_ppr), 4)}


def run_mitigation(df, feature_cols, label_col, sensitive_col, strategies):
    from metrics import (demographic_parity_difference, disparate_impact_ratio,
                         equal_opportunity_difference, false_positive_rate_gap)

    df_c = df.dropna(subset=feature_cols + [label_col, sensitive_col]).copy()
    X      = df_c[feature_cols].values
    y      = df_c[label_col].values.astype(int)
    groups = df_c[sensitive_col].astype(str).values

    X_tr, X_te, y_tr, y_te, g_tr, g_te = train_test_split(
        X, y, groups, test_size=0.30, random_state=42,
        stratify=y if y.mean() > 0.05 else None)

    results = {}

    base = GradientBoostingClassifier(n_estimators=100, random_state=42)
    base.fit(X_tr, y_tr)
    yp_b = base.predict(X_te)
    yprob_b = base.predict_proba(X_te)[:, 1]
    results["baseline"] = _snap(y_te, yp_b, yprob_b, g_te)

    if "reweight" in strategies:
        df_tr = pd.DataFrame(X_tr, columns=feature_cols)
        df_tr[label_col]     = y_tr
        df_tr[sensitive_col] = g_tr
        w = compute_reweighing_weights(df_tr, label_col, sensitive_col)
        rw = GradientBoostingClassifier(n_estimators=100, random_state=42)
        rw.fit(X_tr, y_tr, sample_weight=w.values)
        yp_rw = rw.predict(X_te); yprob_rw = rw.predict_proba(X_te)[:,1]
        results["after_reweighing"] = _snap(y_te, yp_rw, yprob_rw, g_te)

    if "threshold" in strategies:
        th = equalize_ppr_thresholds(y_te, yprob_b, g_te)
        yp_th = np.array(th["y_pred_adjusted"])
        results["after_threshold_adjustment"] = _snap(y_te, yp_th, yprob_b, g_te)
        results["thresholds_used"] = th["thresholds"]
        results["target_ppr"]      = th["target_ppr"]

    if "reweight" in strategies and "threshold" in strategies:
        df_tr2 = pd.DataFrame(X_tr, columns=feature_cols)
        df_tr2[label_col]     = y_tr
        df_tr2[sensitive_col] = g_tr
        w2 = compute_reweighing_weights(df_tr2, label_col, sensitive_col)
        rw2 = GradientBoostingClassifier(n_estimators=100, random_state=42)
        rw2.fit(X_tr, y_tr, sample_weight=w2.values)
        yprob_c = rw2.predict_proba(X_te)[:,1]
        th2 = equalize_ppr_thresholds(y_te, yprob_c, g_te)
        yp_c = np.array(th2["y_pred_adjusted"])
        results["after_combined"] = _snap(y_te, yp_c, yprob_c, g_te)
        results["combined_thresholds"] = th2["thresholds"]

    return results


def _snap(y_true, y_pred, y_prob, groups):
    from metrics import (demographic_parity_difference, disparate_impact_ratio,
                         equal_opportunity_difference, false_positive_rate_gap)
    try:    auc = round(roc_auc_score(y_true, y_prob), 4)
    except: auc = None
    dpd  = demographic_parity_difference(y_pred, groups)
    dir_ = disparate_impact_ratio(y_pred, groups)
    eod  = equal_opportunity_difference(y_true, y_pred, groups)
    fpr  = false_positive_rate_gap(y_true, y_pred, groups)
    return {
        "accuracy":       round(accuracy_score(y_true, y_pred), 4),
        "auc":            auc,
        "dpd":            dpd.get("dpd"),
        "dir":            dir_.get("dir"),
        "eod":            eod.get("eod"),
        "fpr_gap":        fpr.get("fpr_gap"),
        "group_rates":    dpd.get("rates", {}),
        "passes_80_rule": dir_.get("passes_80_rule", False),
    }
