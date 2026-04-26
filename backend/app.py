"""
app.py — FairLens Flask API v4
Adds:
  - /api/explain/*      → Gemini plain-language explanations
  - /api/firebase/*     → Firebase audit history + dataset storage
  - /api/auth/verify    → Firebase token check
All existing endpoints unchanged.
"""
import os, sys, json, traceback
import pandas as pd
import numpy as np
from pathlib import Path
from flask import Flask, request, jsonify
from flask_cors import CORS

sys.path.insert(0, str(Path(__file__).parent))

from engine       import FairLensEngine
from mitigator    import run_mitigation
from groq_explainer import (
    explain_metric, explain_full_report,
    explain_proxy_feature, explain_mitigation,
    explain_flagged_candidate,
)

# Firebase — optional, app still runs without credentials
_firebase_enabled = False
try:
    from firebase_store import (
        save_audit, get_audit_history, get_audit,
        save_user_settings, get_user_settings,
        save_explanation, get_cached_explanation,
        verify_token,
    )
    from auth import require_auth, optional_auth
    _firebase_enabled = True
except Exception as _fb_err:
    print(f"[WARN] Firebase not available: {_fb_err}")
    def require_auth(f): return f
    def optional_auth(f): return f

UPLOAD_DIR = Path(__file__).parent.parent / "data"
UPLOAD_DIR.mkdir(exist_ok=True)

app  = Flask(__name__)
CORS(app, supports_credentials=True,
     allow_headers=["Content-Type", "Authorization"],
     origins=["http://localhost:3000", "http://127.0.0.1:3000",
               "http://localhost:5050", "null"])
_eng = FairLensEngine()

def ok(d):  d["ok"] = True; return jsonify(d)
def err(m, code=400): return jsonify({"ok": False, "error": m}), code


# ── HEALTH ────────────────────────────────────────────────────────
@app.route("/api/health")
def health():
    return ok({
        "status":           "running",
        "version":          "4.0",
        "dataset_loaded":   _eng.df is not None,
        "model_trained":    _eng.model is not None,
        "firebase_enabled": _firebase_enabled,
        "gemini_enabled":   bool(os.environ.get("GROQ_API_KEY")),
    })


# ── UPLOAD ────────────────────────────────────────────────────────
@app.route("/api/upload", methods=["POST"])
@optional_auth
def upload():
    if "file" not in request.files:
        return err("No file in request")
    f = request.files["file"]
    if not f.filename.lower().endswith(".csv"):
        return err("Only CSV files are supported")

    path = UPLOAD_DIR / "uploaded.csv"
    f.save(str(path))

    # Note: Firebase Storage requires Blaze plan — using Firestore only

    overrides = {}
    if request.form.get("outcome_col"):
        overrides["outcome_col"] = request.form["outcome_col"]
    if request.form.get("sensitive_cols"):
        overrides["sensitive_cols"] = json.loads(request.form["sensitive_cols"])
    if request.form.get("numeric_cols"):
        overrides["numeric_cols"] = json.loads(request.form["numeric_cols"])

    result = _eng.load(str(path), overrides or None)
    if not result["ok"]:
        return jsonify(result), 400

    result["dataset_stats"]    = _eng.dataset_stats()
    result["firebase_enabled"] = _firebase_enabled
    return ok(result)


# ── CONFIGURE ─────────────────────────────────────────────────────
@app.route("/api/configure", methods=["POST"])
def configure():
    if _eng.df is None: return err("No dataset loaded", 404)
    body   = request.get_json(force=True) or {}
    path   = UPLOAD_DIR / "uploaded.csv"
    result = _eng.load(str(path), body)
    if not result["ok"]: return jsonify(result), 400
    result["dataset_stats"] = _eng.dataset_stats()
    return ok(result)


# ── STATS ─────────────────────────────────────────────────────────
@app.route("/api/stats")
def stats():
    if _eng.df is None: return err("No dataset", 404)
    return ok(_eng.dataset_stats())


# ── PREVIEW ───────────────────────────────────────────────────────
@app.route("/api/preview")
def preview():
    if _eng.df is None: return err("No dataset", 404)
    n    = int(request.args.get("n", 100))
    rows = _eng.df.head(n).fillna("").to_dict(orient="records")
    return ok({"rows": rows, "columns": list(_eng.df.columns),
               "total_rows": len(_eng.df), "col_config": _eng.col_config})


# ── TRAIN ─────────────────────────────────────────────────────────
@app.route("/api/train", methods=["POST"])
def train():
    if _eng.df is None: return err("No dataset", 404)
    result = _eng.train()
    if not result["ok"]: return err(result["error"])
    return ok(result)


# ── FAIRNESS ──────────────────────────────────────────────────────
@app.route("/api/fairness/<attribute>")
def fairness_single(attribute):
    if _eng.model is None: return err("Model not trained", 400)
    result = _eng.fairness_metrics(attribute)
    if not result.get("ok"): return err(result.get("error", "Error"), 400)
    return ok(result)

@app.route("/api/fairness")
def fairness_all():
    if _eng.model is None: return err("Model not trained", 400)
    return ok(_eng.all_fairness_metrics())


# ── PROXY ─────────────────────────────────────────────────────────
@app.route("/api/proxy")
def proxy():
    if _eng.df is None: return err("No dataset", 404)
    return ok(_eng.proxy_analysis())


# ── CANDIDATES ────────────────────────────────────────────────────
@app.route("/api/candidates")
def candidates():
    if _eng.df is None: return err("No dataset", 404)
    df = _eng.df.copy()
    for col in df.columns:
        val = request.args.get(col)
        if val and col in df.columns:
            df = df[df[col].astype(str) == val]
    if request.args.get("outcome") in ["0", "1"]:
        df = df[_eng.df.loc[df.index, "__outcome__"] == int(request.args["outcome"])]
    if _eng.model is not None and len(df):
        enc = _eng.df_encoded.loc[df.index, _eng.feature_cols]
        try:
            df = df.copy()
            df["model_score"] = _eng.model.predict_proba(
                enc.fillna(enc.mean()).values)[:, 1].round(3)
        except Exception:
            pass
    page  = int(request.args.get("page", 1))
    limit = int(request.args.get("limit", 50))
    total = len(df)
    rows  = df.iloc[(page-1)*limit:page*limit].fillna("").to_dict(orient="records")
    return ok({"rows": rows, "total": total, "page": page,
               "limit": limit, "columns": list(df.columns)})


# ── FLAGGED ───────────────────────────────────────────────────────
@app.route("/api/flagged")
def flagged():
    if _eng.df is None: return err("No dataset", 404)
    return ok(_eng.flag_candidates(float(request.args.get("threshold", 0.65))))


# ── BIAS SCORE ────────────────────────────────────────────────────
@app.route("/api/bias-score")
def bias_score():
    if _eng.model is None: return err("Model not trained", 400)
    return ok(_eng.bias_score())


# ── MITIGATE ─────────────────────────────────────────────────────
@app.route("/api/mitigate", methods=["POST"])
def mitigate():
    if _eng.df is None:    return err("No dataset", 404)
    if _eng.model is None: return err("Train model first", 400)
    body          = request.get_json(force=True) or {}
    strategies    = body.get("strategies", ["reweight"])
    sensitive_col = body.get("sensitive_col") or (
        list(_eng.sensitive_cols.keys())[0] if _eng.sensitive_cols else None)
    if not sensitive_col:
        return err("No sensitive attribute available")
    if sensitive_col not in _eng.df.columns:
        return err(f"Column '{sensitive_col}' not in dataset")
    try:
        result = run_mitigation(
            df=_eng.df_encoded, feature_cols=_eng.feature_cols,
            label_col="__outcome__", sensitive_col=sensitive_col,
            strategies=strategies)
        return ok({"mitigation_results": result,
                   "strategies": strategies,
                   "sensitive_col": sensitive_col})
    except Exception:
        return err(f"Mitigation failed: {traceback.format_exc()}")


# ── REPORT ────────────────────────────────────────────────────────
@app.route("/api/report")
@optional_auth
def report():
    if _eng.df is None:    return err("No dataset", 404)
    if _eng.model is None: return err("Model not trained", 400)
    try:
        stats    = _eng.dataset_stats()
        fairness = _eng.all_fairness_metrics()
        bias     = _eng.bias_score()
        proxy    = _eng.proxy_analysis()
        fl       = _eng.flag_candidates()
        findings = []

        for attr, m in fairness.get("by_attribute", {}).items():
            if not m.get("ok"): continue
            dpd  = m.get("demographic_parity", {}).get("dpd") or 0
            dir_ = m.get("disparate_impact",   {}).get("dir") or 1
            rates= m.get("demographic_parity", {}).get("rates", {})
            if abs(dpd) > 0.05:
                rate_str = ", ".join(f"{g}: {r*100:.1f}%" for g,r in rates.items())
                findings.append({
                    "severity": "CRITICAL" if abs(dpd)>0.15 else "HIGH",
                    "attribute": attr,
                    "title": f"{attr.replace('_',' ').title()} hire rate disparity",
                    "detail": f"DPD={dpd:.3f} DIR={dir_:.3f} "
                              f"({'FAILS' if dir_<0.8 else 'PASSES'} 80% rule). "
                              f"Rates: {rate_str}",
                })

        h = proxy.get("high_risk_count", 0)
        if h:
            feats = [k for k,v in proxy.get("feature_proxy_risks",{}).items()
                     if v["risk_level"]=="HIGH"]
            findings.append({"severity":"HIGH","attribute":"features",
                "title":f"Proxy feature contamination ({h} high-risk)",
                "detail":f"Features acting as proxies: {', '.join(feats)}."})

        nf = fl.get("n_flagged", 0)
        if nf:
            findings.append({"severity":"MEDIUM","attribute":"candidates",
                "title":f"{nf} qualified applicants rejected",
                "detail":f"{nf} of {fl.get('n_qualified',0)} qualified rejected."})

        report_data = {
            "bias_score": bias, "findings": findings,
            "dataset_stats": stats,
            "proxy_summary": {"high_risk_count": proxy.get("high_risk_count",0),
                              "medium_risk_count": proxy.get("medium_risk_count",0)},
            "flagged_summary": {"n_flagged": fl.get("n_flagged",0),
                                "n_qualified": fl.get("n_qualified",0)},
            "outcome_col": _eng.outcome_col,
            "sensitive_cols": _eng.sensitive_cols,
            "n_rows": len(_eng.df),
        }

        # Save to Firebase if logged in
        uid = getattr(request, "uid", "anonymous")
        if _firebase_enabled and uid != "anonymous":
            try:
                audit_id = save_audit(uid, report_data)
                report_data["audit_id"] = audit_id
            except Exception as e:
                print(f"[WARN] Firebase save: {e}")

        return ok(report_data)
    except Exception:
        return err(f"Report failed: {traceback.format_exc()}")


# ════════════════════════════════════════════════════════════════
# GEMINI EXPLANATION ENDPOINTS
# ════════════════════════════════════════════════════════════════

@app.route("/api/explain/metric", methods=["POST"])
def explain_metric_ep():
    """POST {metric_name, value, threshold, attribute}"""
    if _eng.model is None: return err("Model not trained", 400)
    body        = request.get_json(force=True) or {}
    attribute   = body.get("attribute", "")
    fm          = _eng.fairness_metrics(attribute) if attribute else {}
    group_rates = fm.get("demographic_parity", {}).get("rates", {})
    result = explain_metric(
        metric_name = body.get("metric_name", ""),
        value       = float(body.get("value", 0)),
        threshold   = float(body.get("threshold", 0)),
        attribute   = attribute,
        group_rates = group_rates,
    )
    return ok(result) if result["ok"] else (jsonify(result), 500)


@app.route("/api/explain/report", methods=["POST"])
@optional_auth
def explain_report_ep():
    """POST {} — executive summary of full audit"""
    if _eng.model is None: return err("Model not trained", 400)

    body     = request.get_json(force=True, silent=True) or {}
    audit_id = body.get("audit_id", "")
    uid      = getattr(request, "uid", "anonymous")

    # Check cache
    if _firebase_enabled and audit_id and uid != "anonymous":
        cached = get_cached_explanation(uid, audit_id, "report_summary")
        if cached:
            return ok({"summary": cached, "source": "cache"})

    findings = []
    for attr, m in _eng.all_fairness_metrics().get("by_attribute", {}).items():
        if not m.get("ok"): continue
        dpd = m.get("demographic_parity", {}).get("dpd") or 0
        if abs(dpd) > 0.05:
            findings.append({"severity":"HIGH","title":f"{attr} disparity",
                             "detail":f"DPD={dpd:.3f}"})

    result = explain_full_report(
        bias_score    = _eng.bias_score(),
        findings      = findings,
        dataset_stats = _eng.dataset_stats(),
        outcome_col   = _eng.outcome_col,
        sensitive_cols= _eng.sensitive_cols,
    )

    if result["ok"] and _firebase_enabled and audit_id and uid != "anonymous":
        try:
            save_explanation(uid, audit_id, "report_summary", result["summary"])
        except Exception:
            pass

    return ok(result) if result["ok"] else (jsonify(result), 500)


@app.route("/api/explain/proxy/<feature>")
def explain_proxy_ep(feature):
    """GET /api/explain/proxy/<feature_name>"""
    if _eng.df is None: return err("No dataset", 404)
    risks = _eng.proxy_analysis().get("feature_proxy_risks", {})
    if feature not in risks:
        return err(f"Feature '{feature}' not in proxy analysis")
    fd    = risks[feature]
    attrs = [c["sensitive_attr"] for c in fd.get("correlations", [])]
    result = explain_proxy_feature(feature, fd["max_proxy_score"],
                                   attrs, fd.get("recommendation",""))
    return ok(result) if result["ok"] else (jsonify(result), 500)


@app.route("/api/explain/mitigation", methods=["POST"])
def explain_mitigation_ep():
    """POST {before, after, strategies, sensitive_col}"""
    body = request.get_json(force=True) or {}
    if not body.get("before") or not body.get("after"):
        return err("Need 'before' and 'after' metric snapshots")
    result = explain_mitigation(
        body["before"], body["after"],
        body.get("strategies",[]), body.get("sensitive_col",""))
    return ok(result) if result["ok"] else (jsonify(result), 500)


@app.route("/api/explain/candidate", methods=["POST"])
def explain_candidate_ep():
    """POST {candidate: {...row...}}"""
    if _eng.df is None: return err("No dataset", 404)
    body = request.get_json(force=True) or {}
    if not body.get("candidate"):
        return err("No candidate data provided")
    result = explain_flagged_candidate(
        body["candidate"], _eng.numeric_cols, _eng.outcome_col)
    return ok(result) if result["ok"] else (jsonify(result), 500)


# ════════════════════════════════════════════════════════════════
# FIREBASE ENDPOINTS
# ════════════════════════════════════════════════════════════════

@app.route("/api/auth/verify", methods=["POST"])
def auth_verify():
    if not _firebase_enabled: return err("Firebase not configured", 503)
    token = (request.get_json(force=True) or {}).get("token","")
    if not token: return err("No token provided")
    try:
        decoded = verify_token(token)
        return ok({"uid": decoded["uid"],
                   "email": decoded.get("email",""), "valid": True})
    except Exception as e:
        return err(f"Token invalid: {e}", 401)


@app.route("/api/firebase/history")
@optional_auth
def audit_history():
    if not _firebase_enabled:
        return err("Firebase not configured", 503)
    uid = getattr(request, "uid", "anonymous")
    if uid == "anonymous":
        return err("Not logged in", 401)
    try:
        history = get_audit_history(uid, int(request.args.get("limit", 20)))
        return ok({"history": history, "user": uid})
    except Exception as e:
        return err(f"Failed to load history: {str(e)}")


@app.route("/api/firebase/audit/<audit_id>")
@optional_auth
def get_audit_ep(audit_id):
    if not _firebase_enabled: return err("Firebase not configured", 503)
    uid = getattr(request, "uid", "anonymous")
    if uid == "anonymous": return err("Not logged in", 401)
    audit = get_audit(audit_id)
    if not audit: return err(f"Audit '{audit_id}' not found", 404)
    return ok({"audit": audit})





@app.route("/api/firebase/settings", methods=["GET", "POST"])
@require_auth
def user_settings_ep():
    if not _firebase_enabled: return err("Firebase not configured", 503)
    if request.method == "POST":
        save_user_settings(request.uid, request.get_json(force=True) or {})
        return ok({"saved": True})
    return ok({"settings": get_user_settings(request.uid)})


if __name__ == "__main__":
    print("=" * 52)
    print("  FairLens API v4.0")
    print(f"  Groq AI:  {'✓' if os.environ.get('GROQ_API_KEY') else '✗ set GROQ_API_KEY'}")
    print(f"  Firebase: {'✓' if _firebase_enabled else '✗ set FIREBASE_CREDENTIALS'}")
    print("  http://localhost:5050")
    print("=" * 52)
    app.run(host="0.0.0.0", port=5050, debug=True)