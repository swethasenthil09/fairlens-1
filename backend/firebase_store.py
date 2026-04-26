"""
firebase_store.py — Firestore only (no Firebase Storage)
Works on the free Spark plan.
Saves: audit history, user settings, Gemini explanation cache.
"""
import os
import datetime
from pathlib import Path

import firebase_admin
from firebase_admin import credentials, firestore, auth

_CRED_PATH = os.environ.get(
    "FIREBASE_CREDENTIALS",
    str(Path(__file__).parent / "firebase_credentials.json")
)

_app = None


def _init():
    global _app
    if _app is not None:
        return
    if not Path(_CRED_PATH).exists():
        raise FileNotFoundError(
            f"Firebase credentials not found at {_CRED_PATH}. "
            "Download from Firebase Console → Project Settings → "
            "Service accounts → Generate new private key"
        )
    cred = credentials.Certificate(_CRED_PATH)
    _app = firebase_admin.initialize_app(cred)


def _db():
    _init()
    return firestore.client()


# ── AUTH ──────────────────────────────────────────────────────────
def verify_token(id_token: str) -> dict:
    _init()
    return auth.verify_id_token(id_token)


# ── AUDIT STORAGE ─────────────────────────────────────────────────
def save_audit(user_id: str, audit_data: dict) -> str:
    """Save a complete audit run to Firestore. Returns document ID."""
    db  = _db()
    doc = {
        "user_id":         user_id,
        "timestamp":       datetime.datetime.utcnow().isoformat(),
        "bias_score":      audit_data.get("bias_score", {}),
        "findings":        audit_data.get("findings", []),
        "dataset_stats":   _serialise(audit_data.get("dataset_stats", {})),
        "outcome_col":     audit_data.get("outcome_col", ""),
        "sensitive_cols":  list(audit_data.get("sensitive_cols", {}).keys()),
        "n_rows":          audit_data.get("n_rows", 0),
        "proxy_summary":   audit_data.get("proxy_summary", {}),
        "flagged_summary": audit_data.get("flagged_summary", {}),
    }
    ref = db.collection("audits").add(doc)
    return ref[1].id


def get_audit_history(user_id: str, limit: int = 20) -> list:
    """Get last N audit runs for a user, newest first."""
    db   = _db()
    docs = (
        db.collection("audits")
          .where("user_id", "==", user_id)
          .order_by("timestamp", direction=firestore.Query.DESCENDING)
          .limit(limit)
          .stream()
    )
    return [{"id": d.id, **d.to_dict()} for d in docs]


def get_audit(audit_id: str) -> dict | None:
    """Fetch a single audit by document ID."""
    db  = _db()
    doc = db.collection("audits").document(audit_id).get()
    if doc.exists:
        return {"id": doc.id, **doc.to_dict()}
    return None


# ── USER SETTINGS ─────────────────────────────────────────────────
def save_user_settings(user_id: str, settings: dict) -> None:
    db = _db()
    db.collection("users").document(user_id).set(
        {"settings": settings,
         "updated": datetime.datetime.utcnow().isoformat()},
        merge=True
    )


def get_user_settings(user_id: str) -> dict:
    db      = _db()
    doc     = db.collection("users").document(user_id).get()
    defaults = {
        "org_name":      "My Organisation",
        "auditor_name":  "FairLens Auto-Audit",
        "dir_threshold": 0.80,
        "dpd_threshold": -0.05,
        "eod_threshold": -0.05,
    }
    if doc.exists:
        return {**defaults, **doc.to_dict().get("settings", {})}
    return defaults


# ── GEMINI EXPLANATION CACHE ──────────────────────────────────────
def save_explanation(user_id: str, audit_id: str,
                     explanation_type: str, content: str) -> None:
    """Cache a Gemini explanation to avoid re-calling the API."""
    db  = _db()
    key = f"{user_id}_{audit_id}_{explanation_type}"
    db.collection("explanations").document(key).set({
        "user_id":   user_id,
        "audit_id":  audit_id,
        "type":      explanation_type,
        "content":   content,
        "cached_at": datetime.datetime.utcnow().isoformat(),
    })


def get_cached_explanation(user_id: str, audit_id: str,
                            explanation_type: str) -> str | None:
    """Return cached Gemini explanation or None if not found."""
    db  = _db()
    key = f"{user_id}_{audit_id}_{explanation_type}"
    doc = db.collection("explanations").document(key).get()
    if doc.exists:
        return doc.to_dict().get("content")
    return None


# ── UTIL ──────────────────────────────────────────────────────────
def _serialise(obj):
    """Convert numpy/pandas types to plain Python for Firestore."""
    if isinstance(obj, dict):
        return {k: _serialise(v) for k, v in obj.items()}
    if isinstance(obj, list):
        return [_serialise(v) for v in obj]
    if hasattr(obj, "item"):
        return obj.item()
    if hasattr(obj, "tolist"):
        return obj.tolist()
    return obj
