"""
groq_explainer.py
Uses Groq API (free, no credit card) to generate plain-English
explanations of bias audit findings.
Model: llama-3.1-8b-instant (free tier)

Setup:
  pip install groq
  Get free key at: console.groq.com
  Add to .env: GROQ_API_KEY=your_key_here
"""
import os
from groq import Groq

GROQ_API_KEY = os.environ.get("GROQ_API_KEY")
_MODEL   = "llama-3.1-8b-instant"   # free, fast
_client  = None


def _get_client():
    global _client
    if _client:
        return _client
    if not GROQ_API_KEY:
        raise ValueError(
            "GROQ_API_KEY not set. "
            "Get a free key at https://console.groq.com "
            "then add to .env: GROQ_API_KEY=your_key"
        )
    _client = Groq(api_key=GROQ_API_KEY)
    return _client


def _call(prompt: str, max_tokens: int = 400) -> str:
    """Single Groq call. Returns text."""
    client   = _get_client()
    response = client.chat.completions.create(
        model      = _MODEL,
        messages   = [{"role": "user", "content": prompt}],
        max_tokens = max_tokens,
        temperature= 0.3,
    )
    return response.choices[0].message.content.strip()


# ── 1. EXPLAIN ONE FAIRNESS METRIC ───────────────────────────────
def explain_metric(metric_name: str, value: float,
                   threshold: float, attribute: str,
                   group_rates: dict) -> dict:
    rates_str = ", ".join(
        f"{g}: {r*100:.1f}%" for g, r in group_rates.items()
    ) or "not available"

    prompt = f"""You are a fairness expert explaining an AI hiring audit to an HR manager with no data science background.

Real numbers from the audit:
- Metric: {metric_name}
- Value: {value:.4f}
- Acceptable threshold: {threshold}
- Demographic attribute checked: {attribute}
- Actual selection rates by group: {rates_str}

Write exactly 3 short sentences:
1. What this number means in plain English (no jargon).
2. Whether it is a problem and why, using the actual numbers.
3. One concrete action HR should take.
Do not start your response with "Here is", "Here's", or any preamble. Write the sentences directly.
Do not use technical terms. Be direct. Use the real numbers provided."""

    try:
        return {
            "ok":          True,
            "metric":      metric_name,
            "value":       value,
            "explanation": _call(prompt, 180),
            "model":       _MODEL,
        }
    except Exception as e:
        return {"ok": False, "error": str(e)}


# ── 2. EXECUTIVE SUMMARY ─────────────────────────────────────────
def explain_full_report(bias_score: dict, findings: list,
                        dataset_stats: dict, outcome_col: str,
                        sensitive_cols: dict) -> dict:
    score     = bias_score.get("score", 0)
    level     = bias_score.get("level", "UNKNOWN")
    total     = dataset_stats.get("total", 0)
    hire_rate = dataset_stats.get("hire_rate", 0)
    attrs     = ", ".join(sensitive_cols.keys()) if sensitive_cols else "unknown"

    findings_str = "\n".join(
        f"- [{f['severity']}] {f['title']}: {f['detail']}"
        for f in findings
    ) or "- No critical findings detected"

    prompt = f"""Write an executive summary of an AI hiring bias audit for a board of directors.

Real audit data:
- Bias score: {score}/100 (severity: {level})
- Records analysed: {total:,}
- Overall selection rate: {hire_rate*100:.1f}%
- Outcome predicted: "{outcome_col}"
- Demographics audited: {attrs}

Findings:
{findings_str}

Write 3 paragraphs, no bullet points:
Paragraph 1 — What the audit found. Use the real numbers.
Paragraph 2 — Legal and business risks if this model is deployed as-is.
Paragraph 3 — Three immediate actions the organisation must take.
Do not start your response with "Here is", "Here's", or any preamble. Write the sentences directly.
Plain English only. Write for a CEO, not a data scientist."""

    try:
        return {
            "ok":      True,
            "summary": _call(prompt, 450),
            "model":   _MODEL,
        }
    except Exception as e:
        return {"ok": False, "error": str(e)}


# ── 3. EXPLAIN A PROXY FEATURE ────────────────────────────────────
def explain_proxy_feature(feature: str, score: float,
                           sensitive_attrs: list,
                           recommendation: str) -> dict:
    attrs = ", ".join(sensitive_attrs) or "protected attributes"

    prompt = f"""Explain a hiring AI bias risk to an HR recruiter in plain English.

Finding: The data column "{feature}" is acting as a hidden stand-in for: {attrs}
Risk score: {score:.3f} out of 1.0 (higher = riskier)

Write exactly 2 sentences:
1. What this means using this specific example — no jargon.
2. Why this creates a legal and fairness problem for the company.
Do not start your response with "Here is", "Here's", or any preamble. Write the sentences directly.
Do not use technical terms. Write for someone who has never heard of machine learning."""

    try:
        return {
            "ok":          True,
            "feature":     feature,
            "explanation": _call(prompt, 140),
            "model":       _MODEL,
        }
    except Exception as e:
        return {"ok": False, "error": str(e)}


# ── 4. EXPLAIN MITIGATION ────────────────────────────────────────
def explain_mitigation(before: dict, after: dict,
                       strategies: list,
                       sensitive_col: str) -> dict:
    strats = " + ".join(strategies) or "bias reduction"

    prompt = f"""Explain bias reduction results to an HR manager making a deployment decision.

Technique applied: {strats}
Demographic attribute: {sensitive_col}

Before:
- Selection rate gap between groups: {abs(before.get('dpd') or 0)*100:.1f} percentage points
- Lowest-to-highest group ratio: {before.get('dir', 'N/A')} (legal minimum is 0.80)
- Model accuracy: {(before.get('accuracy') or 0)*100:.1f}%
- Passes legal standard: {before.get('passes_80_rule', False)}

After:
- Selection rate gap between groups: {abs(after.get('dpd') or 0)*100:.1f} percentage points
- Lowest-to-highest group ratio: {after.get('dir', 'N/A')}
- Model accuracy: {(after.get('accuracy') or 0)*100:.1f}%
- Passes legal standard: {after.get('passes_80_rule', False)}

Write exactly 3 sentences:
1. What the technique did in plain English.
2. Whether it worked — use the real numbers.
3. Whether the model is now safe to deploy and what risk remains.
Do not start your response with "Here is", "Here's", or any preamble. Write the sentences directly.
No jargon. The reader needs to approve or reject deployment."""

    try:
        return {
            "ok":          True,
            "explanation": _call(prompt, 220),
            "model":       _MODEL,
        }
    except Exception as e:
        return {"ok": False, "error": str(e)}


# ── 5. EXPLAIN A FLAGGED CANDIDATE ───────────────────────────────
def explain_flagged_candidate(candidate: dict,
                               score_cols: list,
                               outcome_col: str) -> dict:
    scores = {c: candidate.get(c) for c in score_cols if c in candidate}
    scores_str = ", ".join(
        f"{k}: {v}" for k, v in scores.items() if v is not None
    ) or "scores not available"

    demo = {
        k: v for k, v in candidate.items()
        if k in ["gender", "race_ethnicity", "age_band",
                 "disability_status", "nationality",
                 "sex", "ethnicity", "age_group", "first_gen"]
        and v not in [None, "", "—"]
    }

    model_score = candidate.get("model_score")
    score_note  = f"AI model confidence score: {model_score}" if model_score else ""

    prompt = f"""Review a hiring decision that has been flagged as potentially unfair.

Candidate qualification scores: {scores_str}
Outcome: NOT SELECTED
Demographic profile: {demo}
{score_note}

Write exactly 2 sentences:
1. Why this rejection looks suspicious — use the actual scores.
2. What the hiring manager should check manually.
Do not start your response with "Here is", "Here's", or any preamble. Write the sentences directly.
Be specific. Use the numbers."""

    try:
        return {
            "ok":          True,
            "explanation": _call(prompt, 140),
            "model":       _MODEL,
        }
    except Exception as e:
        return {"ok": False, "error": str(e)}