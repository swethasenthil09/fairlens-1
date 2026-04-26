"""
column_detector.py — Auto-detect column roles from ANY CSV.
No hardcoded column names. Works with pandas 1.x and 2.x StringDtype.
"""
import re
import numpy as np
import pandas as pd
from pandas.api.types import is_string_dtype, is_numeric_dtype
from difflib import SequenceMatcher


OUTCOME_PATTERNS = [
    r"hired", r"hire", r"selected", r"selection", r"approved", r"approval",
    r"accepted", r"accept", r"outcome", r"label", r"target", r"result",
    r"decision", r"pass", r"success", r"offer", r"recruited", r"shortlist",
    r"admit", r"admitted", r"granted", r"promoted", r"passed",
]

SENSITIVE_PATTERNS = {
    "gender":        [r"gender", r"sex\b", r"\bsex$", r"male", r"female"],
    "race":          [r"race", r"ethnic", r"ethnicity", r"racial"],
    "age":           [r"\bage\b", r"age_band", r"age_group", r"agegroup", r"age_category"],
    "disability":    [r"disab", r"disability"],
    "region":        [r"region", r"location", r"city", r"state\b", r"area", r"zone"],
    "education":     [r"edu", r"degree", r"qualification", r"school",
                      r"college", r"university", r"tier"],
    "experience":    [r"experience_level", r"seniority", r"exp_level"],
    "nationality":   [r"nation", r"citizenship", r"origin", r"country_of"],
    "language":      [r"language", r"lang", r"accent", r"lingual"],
    "religion":      [r"religion", r"faith", r"belief"],
    "source":        [r"application_source", r"app_source", r"how.*apply"],
    "gap":           [r"employment_gap", r"career_break", r"gap"],
    "first_gen":     [r"first.gen", r"first_gen", r"firstgen"],
}

ID_PATTERNS = [
    r"_id$", r"^id$", r"^id_", r"identifier", r"uuid", r"index$",
    r"applicant.*id", r"candidate.*id", r"student.*id", r"emp.*id", r"user.*id",
]

SCORE_PATTERNS = [
    r"score", r"rating", r"rank", r"grade", r"gpa", r"iq",
    r"skill", r"test", r"assess", r"interview", r"resume", r"cv",
    r"aptitude", r"cert", r"sat", r"gre", r"essay",
]


def _is_cat(series: pd.Series) -> bool:
    """True if series holds string/categorical data (pandas 1.x and 2.x)."""
    return is_string_dtype(series) or str(series.dtype) in ("object", "category", "string")


def _is_num(series: pd.Series) -> bool:
    return is_numeric_dtype(series)


def _match(col: str, patterns: list) -> float:
    col_l = col.lower().replace("-", "_").replace(" ", "_")
    for p in patterns:
        if re.search(p, col_l):
            return 1.0
    best = 0.0
    for p in patterns:
        clean = re.sub(r'[\\^$.|?*+(){}]', '', p)
        s = SequenceMatcher(None, col_l, clean).ratio()
        best = max(best, s)
    return best if best > 0.65 else 0.0


def detect_columns(df: pd.DataFrame) -> dict:
    result = {
        "outcome_col":        None,
        "outcome_confidence": 0.0,
        "sensitive_cols":     {},
        "numeric_cols":       [],
        "categorical_cols":   [],
        "id_cols":            [],
        "text_cols":          [],
        "all_cols":           list(df.columns),
        "n_rows":             len(df),
        "warnings":           [],
    }

    outcome_candidates = []

    for col in df.columns:
        series   = df[col].dropna()
        n_unique = series.nunique()
        cat      = _is_cat(series)
        num      = _is_num(series)

        # ── ID column? ──────────────────────────────────────────
        id_score = _match(col, ID_PATTERNS)
        if id_score > 0.8 or (cat and n_unique == len(df) and len(df) > 100):
            result["id_cols"].append(col)
            continue

        # ── Outcome candidate? ───────────────────────────────────
        out_name_score = _match(col, OUTCOME_PATTERNS)
        if n_unique <= 3:
            val_strs = set(str(v).lower().strip() for v in series.unique()) - {"nan",""}
            binary_val_sets = [
                {"0","1"}, {"yes","no"}, {"true","false"},
                {"hired","not hired"}, {"selected","rejected"},
                {"pass","fail"}, {"accept","reject"},
                {"approved","rejected"}, {"admitted","not admitted"},
                {"success","failure"}, {"granted","denied"},
            ]
            binary_vals = any(val_strs <= s for s in binary_val_sets)
            out_score = out_name_score * 0.6 + (0.4 if binary_vals else 0.15)
            outcome_candidates.append((col, out_score, binary_vals))

        # ── Sensitive attribute? ─────────────────────────────────
        if cat and 2 <= n_unique <= 60:
            for sens_type, patterns in SENSITIVE_PATTERNS.items():
                s = _match(col, patterns)
                if s > 0.5:
                    result["sensitive_cols"][col] = sens_type
                    break

        # ── Numeric feature? ────────────────────────────────────
        if num and col not in result["id_cols"]:
            result["numeric_cols"].append(col)

        # ── Categorical feature? ─────────────────────────────────
        elif cat and col not in result["sensitive_cols"] and col not in result["id_cols"]:
            if n_unique <= 50:
                result["categorical_cols"].append(col)
            else:
                result["text_cols"].append(col)

    # ── Best outcome column ─────────────────────────────────────
    if outcome_candidates:
        outcome_candidates.sort(key=lambda x: -x[1])
        best_col, best_score, binary_vals = outcome_candidates[0]
        result["outcome_col"]        = best_col
        result["outcome_confidence"] = round(best_score, 3)
        if best_score < 0.4:
            result["warnings"].append(
                f"Outcome column '{best_col}' detected with low confidence "
                f"({best_score:.0%}). Please confirm before running analysis.")
    else:
        result["warnings"].append(
            "No binary outcome column detected automatically. "
            "Please select one using the column configuration panel.")

    # ── Clean up — remove outcome from other lists ──────────────
    oc = result["outcome_col"]
    sens_set = set(result["sensitive_cols"].keys())
    if oc:
        result["numeric_cols"]      = [c for c in result["numeric_cols"]     if c != oc]
        result["categorical_cols"]  = [c for c in result["categorical_cols"] if c != oc]
        result["sensitive_cols"].pop(oc, None)

    result["numeric_cols"]     = [c for c in result["numeric_cols"]     if c not in sens_set]
    result["categorical_cols"] = [c for c in result["categorical_cols"] if c not in sens_set]

    result["summary"] = {
        "outcome":       oc,
        "n_sensitive":   len(result["sensitive_cols"]),
        "n_numeric":     len(result["numeric_cols"]),
        "n_categorical": len(result["categorical_cols"]),
        "n_id":          len(result["id_cols"]),
        "ready_to_analyse": (oc is not None and
                             len(result["sensitive_cols"]) >= 1 and
                             (len(result["numeric_cols"]) >= 1 or
                              len(result["categorical_cols"]) >= 1)),
    }
    return result


def encode_outcome(df: pd.DataFrame, col: str) -> pd.Series:
    """Convert any binary outcome to 0/1. Never assumes which value is positive."""
    series = df[col].copy()

    # Try numeric first
    try:
        numeric = pd.to_numeric(series, errors="raise")
        vals = set(numeric.dropna().astype(int).unique())
        if vals <= {0, 1}:
            return numeric.fillna(0).astype(int)
    except Exception:
        pass

    POSITIVE_WORDS = {
        "yes","1","true","hired","selected","accepted","approved",
        "pass","passed","success","offer","admitted","granted",
        "promoted","shortlisted","positive","y","admit",
    }
    str_s = series.astype(str).str.lower().str.strip()
    unique_str = set(str_s.dropna().unique()) - {"nan","none",""}

    pos_val = None
    for v in unique_str:
        if v in POSITIVE_WORDS:
            pos_val = v
            break
    if pos_val is None:
        pos_val = sorted(unique_str)[-1]  # alphabetically last

    return (str_s == pos_val).astype(int)


def user_column_config(df: pd.DataFrame, auto: dict, overrides: dict) -> dict:
    result = dict(auto)
    if overrides.get("outcome_col"):
        result["outcome_col"] = overrides["outcome_col"]
        result["outcome_confidence"] = 1.0
    if overrides.get("sensitive_cols"):
        result["sensitive_cols"] = {
            c: auto["sensitive_cols"].get(c, "other")
            for c in overrides["sensitive_cols"]
        }
    if overrides.get("numeric_cols"):
        result["numeric_cols"] = overrides["numeric_cols"]
    if overrides.get("categorical_cols"):
        result["categorical_cols"] = overrides["categorical_cols"]
    return result
