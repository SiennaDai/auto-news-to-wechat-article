"""JWT generation/verification, password hashing, and auth decorators."""

import os
import functools
from datetime import datetime, timedelta, timezone
from typing import Optional

import bcrypt
from jose import jwt, JWTError
from flask import request, g

from backend.database import get_connection

JWT_SECRET_KEY = os.getenv("JWT_SECRET_KEY", "dev-secret-change-in-production-min-32-chars")
JWT_EXPIRES_DAYS = int(os.getenv("JWT_EXPIRES_DAYS", "7"))
JWT_ALGORITHM = "HS256"


# ---------------------------------------------------------------------------
# Password helpers
# ---------------------------------------------------------------------------

def hash_password(password: str) -> str:
    return bcrypt.hashpw(password.encode("utf-8"), bcrypt.gensalt()).decode("utf-8")


def verify_password(password: str, password_hash: str) -> bool:
    return bcrypt.checkpw(password.encode("utf-8"), password_hash.encode("utf-8"))


# ---------------------------------------------------------------------------
# JWT helpers
# ---------------------------------------------------------------------------

def create_access_token(user_id: int) -> str:
    expire = datetime.now(timezone.utc) + timedelta(days=JWT_EXPIRES_DAYS)
    payload = {"sub": str(user_id), "exp": expire}
    return jwt.encode(payload, JWT_SECRET_KEY, algorithm=JWT_ALGORITHM)


def decode_token(token: str) -> Optional[dict]:
    try:
        payload = jwt.decode(token, JWT_SECRET_KEY, algorithms=[JWT_ALGORITHM])
        return payload
    except JWTError:
        return None


def is_token_blacklisted(token: str) -> bool:
    conn = get_connection()
    row = conn.execute("SELECT 1 FROM tokens WHERE token = ?", (token,)).fetchone()
    conn.close()
    return row is not None


# ---------------------------------------------------------------------------
# Decorators
# ---------------------------------------------------------------------------

def require_auth(f):
    """强制认证：无有效 token 返回 401。"""

    @functools.wraps(f)
    def wrapper(*args, **kwargs):
        token = _extract_token()
        if not token:
            return {"error": "missing_token", "detail": "请先登录"}, 401

        payload = decode_token(token)
        if not payload:
            return {"error": "invalid_token", "detail": "Token 无效或已过期"}, 401

        if is_token_blacklisted(token):
            return {"error": "invalid_token", "detail": "Token 已失效，请重新登录"}, 401

        user = _load_user(payload)
        if not user:
            return {"error": "invalid_token", "detail": "用户不存在"}, 401

        g.current_user = user
        return f(*args, **kwargs)

    return wrapper


def optional_auth(f):
    """可选认证：有 token 则解析，无则 g.current_user = None。但有 token 时必须有效。"""

    @functools.wraps(f)
    def wrapper(*args, **kwargs):
        token = _extract_token()
        if not token:
            g.current_user = None
            return f(*args, **kwargs)

        payload = decode_token(token)
        if not payload:
            return {"error": "invalid_token", "detail": "Token 无效或已过期"}, 401

        if is_token_blacklisted(token):
            return {"error": "invalid_token", "detail": "Token 已失效，请重新登录"}, 401

        user = _load_user(payload)
        if not user:
            return {"error": "invalid_token", "detail": "用户不存在"}, 401

        g.current_user = user
        return f(*args, **kwargs)

    return wrapper


# ---------------------------------------------------------------------------
# Internal helpers
# ---------------------------------------------------------------------------

def _extract_token() -> Optional[str]:
    header = request.headers.get("Authorization", "")
    if header.startswith("Bearer "):
        return header[7:]
    return None


def _load_user(payload: dict) -> Optional[dict]:
    user_id = payload.get("sub")
    if not user_id:
        return None
    conn = get_connection()
    row = conn.execute(
        "SELECT id, username, email, created_at FROM users WHERE id = ?",
        (int(user_id),),
    ).fetchone()
    conn.close()
    if not row:
        return None
    return dict(row)
