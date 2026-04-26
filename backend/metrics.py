"""
metrics.py — Real fairness metric computation
All values derived from actual model predictions and ground truth labels.
No synthetic/hardcoded numbers.
"""
import numpy as np


def demographic_parity_difference(y_pred: np.ndarray, groups: np.ndarray) -> dict:
    """
    DPD = P(Ŷ=1 | A=a) - P(Ŷ=1 | A=b)
    Measures if positive prediction rate differs across groups.
    Ideal = 0. Negative means group A is under-selected.
    """
    unique = np.unique(groups)
    rates = {}
    for g in unique:
        mask = groups == g
        if mask.sum() == 0:
            continue
        rates[g] = float(y_pred[mask].mean())

    if len(rates) < 2:
        return {"error": "Need at least 2 groups", "rates": rates}

    vals = list(rates.values())
    max_rate = max(vals)
    min_rate = min(vals)
    max_grp = [g for g, r in rates.items() if r == max_rate][0]
    min_grp = [g for g, r in rates.items() if r == min_rate][0]

    return {
        "rates": {k: round(v, 4) for k, v in rates.items()},
        "dpd": round(min_rate - max_rate, 4),
        "max_group": str(max_grp),
        "min_group": str(min_grp),
        "max_rate": round(max_rate, 4),
        "min_rate": round(min_rate, 4),
        "passes_threshold": abs(min_rate - max_rate) <= 0.05,
    }


def disparate_impact_ratio(y_pred: np.ndarray, groups: np.ndarray) -> dict:
    """
    DIR = P(Ŷ=1 | A=min) / P(Ŷ=1 | A=max)
    EEOC 80% rule: DIR must be >= 0.8 to pass.
    """
    unique = np.unique(groups)
    rates = {}
    for g in unique:
        mask = groups == g
        if mask.sum() == 0:
            continue
        rates[g] = float(y_pred[mask].mean())

    if len(rates) < 2:
        return {"error": "Need at least 2 groups"}

    vals = list(rates.values())
    max_rate = max(vals)
    min_rate = min(vals)
    dir_val = round(min_rate / max_rate, 4) if max_rate > 0 else 1.0

    return {
        "dir": dir_val,
        "passes_80_rule": dir_val >= 0.80,
        "legal_threshold": 0.80,
        "rates": {k: round(v, 4) for k, v in rates.items()},
    }


def equal_opportunity_difference(
    y_true: np.ndarray, y_pred: np.ndarray, groups: np.ndarray
) -> dict:
    """
    EOD = TPR(A=min) - TPR(A=max)
    True Positive Rate gap: are qualified candidates from all groups
    equally likely to be correctly selected?
    """
    unique = np.unique(groups)
    tprs = {}
    for g in unique:
        mask = groups == g
        yt = y_true[mask]
        yp = y_pred[mask]
        positives = yt == 1
        if positives.sum() == 0:
            continue
        tprs[g] = float(yp[positives].mean())

    if len(tprs) < 2:
        return {"error": "Not enough positive examples per group", "tprs": tprs}

    vals = list(tprs.values())
    max_tpr = max(vals)
    min_tpr = min(vals)

    return {
        "tprs": {k: round(v, 4) for k, v in tprs.items()},
        "eod": round(min_tpr - max_tpr, 4),
        "max_tpr": round(max_tpr, 4),
        "min_tpr": round(min_tpr, 4),
        "passes_threshold": abs(min_tpr - max_tpr) <= 0.05,
    }


def false_positive_rate_gap(
    y_true: np.ndarray, y_pred: np.ndarray, groups: np.ndarray
) -> dict:
    """
    FPR gap = FPR(A=max) - FPR(A=min)
    Are some groups falsely approved more often than others?
    """
    unique = np.unique(groups)
    fprs = {}
    for g in unique:
        mask = groups == g
        yt = y_true[mask]
        yp = y_pred[mask]
        negatives = yt == 0
        if negatives.sum() == 0:
            continue
        fprs[g] = float(yp[negatives].mean())

    if len(fprs) < 2:
        return {"error": "Not enough negative examples per group"}

    vals = list(fprs.values())
    max_fpr = max(vals)
    min_fpr = min(vals)

    return {
        "fprs": {k: round(v, 4) for k, v in fprs.items()},
        "fpr_gap": round(max_fpr - min_fpr, 4),
        "max_fpr": round(max_fpr, 4),
        "min_fpr": round(min_fpr, 4),
        "passes_threshold": abs(max_fpr - min_fpr) <= 0.05,
    }


def predictive_parity(
    y_true: np.ndarray, y_pred: np.ndarray, groups: np.ndarray
) -> dict:
    """
    Precision gap: P(Y=1 | Ŷ=1, A=a) vs P(Y=1 | Ŷ=1, A=b)
    When the model says 'hire', is it equally right across groups?
    """
    unique = np.unique(groups)
    precisions = {}
    for g in unique:
        mask = groups == g
        yt = y_true[mask]
        yp = y_pred[mask]
        predicted_pos = yp == 1
        if predicted_pos.sum() == 0:
            continue
        precisions[g] = float(yt[predicted_pos].mean())

    if len(precisions) < 2:
        return {"error": "Not enough predicted positives per group"}

    vals = list(precisions.values())
    return {
        "precisions": {k: round(v, 4) for k, v in precisions.items()},
        "pp_diff": round(min(vals) - max(vals), 4),
        "passes_threshold": abs(min(vals) - max(vals)) <= 0.05,
    }


def calibration_by_group(
    y_true: np.ndarray, y_prob: np.ndarray, groups: np.ndarray, bins: int = 5
) -> dict:
    """
    Check if predicted probabilities match actual outcomes equally across groups.
    Well-calibrated model: predicted 70% → actually hired ~70% of the time.
    """
    unique = np.unique(groups)
    calibration = {}
    bin_edges = np.linspace(0, 1, bins + 1)

    for g in unique:
        mask = groups == g
        yt = y_true[mask]
        yp = y_prob[mask]
        bin_data = []
        for i in range(bins):
            lo, hi = bin_edges[i], bin_edges[i + 1]
            in_bin = (yp >= lo) & (yp < hi)
            if in_bin.sum() < 3:
                continue
            bin_data.append({
                "range": f"{lo:.1f}-{hi:.1f}",
                "predicted_mean": round(float(yp[in_bin].mean()), 3),
                "actual_rate": round(float(yt[in_bin].mean()), 3),
                "n": int(in_bin.sum()),
            })
        calibration[g] = bin_data

    return {"calibration": calibration}


def score_distribution_stats(y_prob: np.ndarray, groups: np.ndarray) -> dict:
    """
    Distribution of predicted scores per group.
    Reveals if model systematically scores one group lower.
    """
    unique = np.unique(groups)
    stats = {}
    for g in unique:
        mask = groups == g
        scores = y_prob[mask]
        if len(scores) == 0:
            continue
        stats[g] = {
            "mean":   round(float(scores.mean()), 4),
            "median": round(float(np.median(scores)), 4),
            "std":    round(float(scores.std()), 4),
            "p25":    round(float(np.percentile(scores, 25)), 4),
            "p75":    round(float(np.percentile(scores, 75)), 4),
            "n":      int(len(scores)),
        }
    return {"score_distributions": stats}


def compute_all_metrics(
    y_true: np.ndarray,
    y_pred: np.ndarray,
    y_prob: np.ndarray,
    groups: np.ndarray,
    attr_name: str,
) -> dict:
    """Run all metrics for a given sensitive attribute. Returns a clean dict."""
    return {
        "attribute": attr_name,
        "demographic_parity": demographic_parity_difference(y_pred, groups),
        "disparate_impact": disparate_impact_ratio(y_pred, groups),
        "equal_opportunity": equal_opportunity_difference(y_true, y_pred, groups),
        "fpr_gap": false_positive_rate_gap(y_true, y_pred, groups),
        "predictive_parity": predictive_parity(y_true, y_pred, groups),
        "score_distributions": score_distribution_stats(y_prob, groups),
        "calibration": calibration_by_group(y_true, y_prob, groups),
    }
