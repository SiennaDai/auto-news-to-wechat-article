"""Auth routes: register, login, logout, me."""

from datetime import datetime

from flask import Blueprint, request, jsonify, g
from pydantic import ValidationError

from backend.auth import hash_password, verify_password, create_access_token, require_auth
from backend.database import get_connection
from backend.models import RegisterRequest, LoginRequest

auth_bp = Blueprint("auth", __name__, url_prefix="/api/auth")


@auth_bp.route("/register", methods=["POST"])
def register():
    try:
        body = RegisterRequest.model_validate(request.get_json(silent=True) or {})
    except ValidationError as e:
        return _validation_error(e)

    conn = get_connection()

    existing = conn.execute(
        "SELECT id FROM users WHERE email = ? OR username = ?",
        (body.email, body.username),
    ).fetchone()
    if existing:
        conn.close()
        return jsonify({"error": "conflict", "detail": "用户名或邮箱已存在"}), 409

    password_hash = hash_password(body.password)
    cursor = conn.execute(
        "INSERT INTO users (username, email, password_hash) VALUES (?, ?, ?)",
        (body.username, body.email, password_hash),
    )
    conn.commit()
    user_id = cursor.lastrowid
    conn.close()

    return jsonify({"user_id": user_id, "username": body.username, "email": body.email}), 201


@auth_bp.route("/login", methods=["POST"])
def login():
    try:
        body = LoginRequest.model_validate(request.get_json(silent=True) or {})
    except ValidationError as e:
        return _validation_error(e)

    conn = get_connection()
    row = conn.execute("SELECT * FROM users WHERE email = ?", (body.email,)).fetchone()

    if not row or not verify_password(body.password, row["password_hash"]):
        conn.close()
        return jsonify({"error": "invalid_credentials", "detail": "邮箱或密码错误"}), 401

    conn.execute("UPDATE users SET last_login_at = ? WHERE id = ?",
                 (datetime.utcnow().isoformat(), row["id"]))
    conn.commit()
    conn.close()

    token = create_access_token(row["id"])
    return jsonify({
        "access_token": token,
        "user": {"id": row["id"], "username": row["username"], "email": row["email"]},
    })


@auth_bp.route("/logout", methods=["POST"])
@require_auth
def logout():
    token = request.headers.get("Authorization", "")[7:]
    payload = __import__("backend.auth", fromlist=["decode_token"]).decode_token(token)
    if payload:
        exp = payload.get("exp")
        expires_at = datetime.fromtimestamp(exp).isoformat() if exp else None
        conn = get_connection()
        conn.execute(
            "INSERT OR IGNORE INTO tokens (user_id, token, expires_at) VALUES (?, ?, ?)",
            (g.current_user["id"], token, expires_at),
        )
        conn.commit()
        conn.close()
    return jsonify({"success": True})


@auth_bp.route("/me", methods=["GET"])
@require_auth
def me():
    return jsonify({"user": g.current_user})


def _validation_error(e: ValidationError) -> tuple:
    messages = []
    for err in e.errors():
        field = ".".join(str(loc) for loc in err["loc"])
        messages.append(f"{field}: {err['msg']}")
    return jsonify({"error": "validation_error", "detail": "; ".join(messages)}), 400
