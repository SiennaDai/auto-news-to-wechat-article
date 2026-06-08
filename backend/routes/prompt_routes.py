"""Prompt routes (require auth) - CRUD + set_default."""

from datetime import datetime
from typing import Optional

from flask import Blueprint, request, jsonify, g
from pydantic import ValidationError, BaseModel, Field

from backend.auth import require_auth
from backend.database import get_connection

prompt_bp = Blueprint("prompts", __name__, url_prefix="/api/prompts")

class PromptSaveRequest(BaseModel):
    name: str = Field(..., min_length=1, max_length=100)
    content: str = Field(..., min_length=1)


class PromptUpdateRequest(BaseModel):
    name: Optional[str] = Field(None, min_length=1, max_length=100)
    content: Optional[str] = Field(None, min_length=1)


@prompt_bp.route("/", methods=["GET"])
@require_auth
def list_prompts():
    conn = get_connection()
    rows = conn.execute(
        "SELECT id, name, is_default, created_at, updated_at FROM prompts WHERE user_id = ? ORDER BY updated_at DESC",
        (g.current_user["id"],),
    ).fetchall()
    conn.close()
    return jsonify({"prompts": [dict(r) for r in rows]})


@prompt_bp.route("/<int:prompt_id>", methods=["GET"])
@require_auth
def get_prompt(prompt_id: int):
    conn = get_connection()
    row = conn.execute(
        "SELECT * FROM prompts WHERE id = ? AND user_id = ?",
        (prompt_id, g.current_user["id"]),
    ).fetchone()
    conn.close()
    if not row:
        return jsonify({"error": "not_found", "detail": "提示词不存在"}), 404
    return jsonify({"prompt": dict(row)})


@prompt_bp.route("/", methods=["POST"])
@require_auth
def save_prompt():
    try:
        body = PromptSaveRequest.model_validate(request.get_json(silent=True) or {})
    except ValidationError as e:
        return _validation_error(e)

    conn = get_connection()
    try:
        cursor = conn.execute(
            "INSERT INTO prompts (user_id, name, content) VALUES (?, ?, ?)",
            (g.current_user["id"], body.name, body.content),
        )
        conn.commit()
        prompt_id = cursor.lastrowid
    except Exception:
        conn.close()
        return jsonify({"error": "conflict", "detail": "提示词名称已存在"}), 409

    conn.close()
    return jsonify({"prompt_id": prompt_id, "name": body.name}), 201


@prompt_bp.route("/<int:prompt_id>", methods=["PUT"])
@require_auth
def update_prompt(prompt_id: int):
    try:
        body = PromptUpdateRequest.model_validate(request.get_json(silent=True) or {})
    except ValidationError as e:
        return _validation_error(e)

    conn = get_connection()
    row = conn.execute(
        "SELECT * FROM prompts WHERE id = ? AND user_id = ?",
        (prompt_id, g.current_user["id"]),
    ).fetchone()
    if not row:
        conn.close()
        return jsonify({"error": "not_found", "detail": "提示词不存在"}), 404

    updates = {}
    if body.name is not None:
        updates["name"] = body.name
    if body.content is not None:
        updates["content"] = body.content

    if updates:
        updates["updated_at"] = datetime.utcnow().isoformat()
        set_clause = ", ".join(f"{k} = ?" for k in updates)
        values = list(updates.values()) + [prompt_id, g.current_user["id"]]
        try:
            conn.execute(
                f"UPDATE prompts SET {set_clause} WHERE id = ? AND user_id = ?",
                values,
            )
            conn.commit()
        except Exception:
            conn.close()
            return jsonify({"error": "conflict", "detail": "提示词名称已存在"}), 409

    conn.close()
    return jsonify({"success": True})


@prompt_bp.route("/<int:prompt_id>", methods=["DELETE"])
@require_auth
def delete_prompt(prompt_id: int):
    conn = get_connection()
    row = conn.execute(
        "SELECT id FROM prompts WHERE id = ? AND user_id = ?",
        (prompt_id, g.current_user["id"]),
    ).fetchone()
    if not row:
        conn.close()
        return jsonify({"error": "not_found", "detail": "提示词不存在"}), 404

    conn.execute("DELETE FROM prompts WHERE id = ?", (prompt_id,))
    conn.commit()
    conn.close()
    return jsonify({"success": True})


@prompt_bp.route("/<int:prompt_id>/default", methods=["PUT"])
@require_auth
def set_default(prompt_id: int):
    conn = get_connection()
    row = conn.execute(
        "SELECT id FROM prompts WHERE id = ? AND user_id = ?",
        (prompt_id, g.current_user["id"]),
    ).fetchone()
    if not row:
        conn.close()
        return jsonify({"error": "not_found", "detail": "提示词不存在"}), 404

    conn.execute("UPDATE prompts SET is_default = 0 WHERE user_id = ?", (g.current_user["id"],))
    conn.execute(
        "UPDATE prompts SET is_default = 1, updated_at = ? WHERE id = ?",
        (datetime.utcnow().isoformat(), prompt_id),
    )
    conn.commit()
    conn.close()
    return jsonify({"success": True})


def _validation_error(e: ValidationError) -> tuple:
    messages = []
    for err in e.errors():
        field = ".".join(str(loc) for loc in err["loc"])
        messages.append(f"{field}: {err['msg']}")
    return jsonify({"error": "validation_error", "detail": "; ".join(messages)}), 400
