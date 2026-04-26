"""
auth.py
Flask middleware for Firebase Authentication.
Verifies ID tokens sent from the frontend on every protected request.
Usage: add @require_auth decorator to any Flask route.
"""
from functools import wraps
from flask import request, jsonify
from firebase_store import verify_token


def require_auth(f):
    """
    Decorator that checks for a valid Firebase ID token
    in the Authorization: Bearer <token> header.

    On success  → sets request.uid and request.user_email
    On failure  → returns 401 JSON error

    Usage:
        @app.route("/api/upload", methods=["POST"])
        @require_auth
        def upload():
            print(request.uid)   # Firebase user ID
            ...
    """
    @wraps(f)
    def wrapper(*args, **kwargs):
        auth_header = request.headers.get("Authorization", "")

        if not auth_header.startswith("Bearer "):
            return jsonify({
                "ok":    False,
                "error": "Missing Authorization header. "
                         "Send: Authorization: Bearer <firebase_id_token>"
            }), 401

        token = auth_header.replace("Bearer ", "").strip()

        try:
            decoded = verify_token(token)
            # Attach to request context so route handlers can use them
            request.uid        = decoded["uid"]
            request.user_email = decoded.get("email", "anonymous")
        except Exception as e:
            return jsonify({
                "ok":    False,
                "error": f"Invalid or expired token: {str(e)}"
            }), 401

        return f(*args, **kwargs)
    return wrapper


def optional_auth(f):
    """
    Decorator that tries to verify the token but does NOT block
    the request if missing. Sets request.uid = "anonymous" if no token.
    Use for endpoints that work both logged-in and logged-out.
    """
    @wraps(f)
    def wrapper(*args, **kwargs):
        auth_header = request.headers.get("Authorization", "")
        request.uid        = "anonymous"
        request.user_email = "anonymous"

        if auth_header.startswith("Bearer "):
            token = auth_header.replace("Bearer ", "").strip()
            try:
                decoded            = verify_token(token)
                request.uid        = decoded["uid"]
                request.user_email = decoded.get("email", "anonymous")
            except Exception:
                pass   # silently fall back to anonymous

        return f(*args, **kwargs)
    return wrapper
