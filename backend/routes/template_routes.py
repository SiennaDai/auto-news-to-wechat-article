"""Template CRUD routes (require auth)."""

import json

from flask import Blueprint, request, jsonify, g
from pydantic import ValidationError

from backend.auth import require_auth
from backend.database import get_connection
from backend.models import TemplateSaveRequest, TemplateUpdateRequest

template_bp = Blueprint("templates", __name__, url_prefix="/api/templates")


@template_bp.route("/", methods=["GET"])
@require_auth
def list_templates():
    conn = get_connection()
    rows = conn.execute(
        "SELECT id, name, is_default, created_at, updated_at FROM templates WHERE user_id = ? ORDER BY updated_at DESC",
        (g.current_user["id"],),
    ).fetchall()
    conn.close()
    return jsonify({"templates": [dict(r) for r in rows]})


@template_bp.route("/<int:template_id>", methods=["GET"])
@require_auth
def get_template(template_id: int):
    conn = get_connection()
    row = conn.execute(
        "SELECT * FROM templates WHERE id = ? AND user_id = ?",
        (template_id, g.current_user["id"]),
    ).fetchone()
    conn.close()

    if not row:
        return jsonify({"error": "not_found", "detail": "模板不存在"}), 404

    d = dict(row)
    d["config"] = json.loads(d["config"])
    return jsonify({"template": d})


@template_bp.route("/", methods=["POST"])
@require_auth
def save_template():
    try:
        body = TemplateSaveRequest.model_validate(request.get_json(silent=True) or {})
    except ValidationError as e:
        return _validation_error(e)

    config_json = json.dumps(body.config, ensure_ascii=False)

    conn = get_connection()
    try:
        cursor = conn.execute(
            "INSERT INTO templates (user_id, name, config) VALUES (?, ?, ?)",
            (g.current_user["id"], body.name, config_json),
        )
        conn.commit()
        template_id = cursor.lastrowid
    except Exception:
        conn.close()
        return jsonify({"error": "conflict", "detail": "模板名称已存在"}), 409

    conn.close()
    return jsonify({"template_id": template_id, "name": body.name}), 201


@template_bp.route("/<int:template_id>", methods=["PUT"])
@require_auth
def update_template(template_id: int):
    try:
        body = TemplateUpdateRequest.model_validate(request.get_json(silent=True) or {})
    except ValidationError as e:
        return _validation_error(e)

    conn = get_connection()
    row = conn.execute(
        "SELECT * FROM templates WHERE id = ? AND user_id = ?",
        (template_id, g.current_user["id"]),
    ).fetchone()

    if not row:
        conn.close()
        return jsonify({"error": "not_found", "detail": "模板不存在"}), 404

    updates = {}
    if body.name is not None:
        updates["name"] = body.name
    if body.config is not None:
        updates["config"] = json.dumps(body.config, ensure_ascii=False)

    if updates:
        updates["updated_at"] = __import__("datetime").datetime.utcnow().isoformat()
        set_clause = ", ".join(f"{k} = ?" for k in updates)
        values = list(updates.values()) + [template_id, g.current_user["id"]]
        try:
            conn.execute(
                f"UPDATE templates SET {set_clause} WHERE id = ? AND user_id = ?",
                values,
            )
            conn.commit()
        except Exception:
            conn.close()
            return jsonify({"error": "conflict", "detail": "模板名称已存在"}), 409

    conn.close()
    return jsonify({"success": True})


@template_bp.route("/<int:template_id>", methods=["DELETE"])
@require_auth
def delete_template(template_id: int):
    conn = get_connection()
    row = conn.execute(
        "SELECT id FROM templates WHERE id = ? AND user_id = ?",
        (template_id, g.current_user["id"]),
    ).fetchone()

    if not row:
        conn.close()
        return jsonify({"error": "not_found", "detail": "模板不存在"}), 404

    conn.execute("DELETE FROM templates WHERE id = ?", (template_id,))
    conn.commit()
    conn.close()
    return jsonify({"success": True})


@template_bp.route("/<int:template_id>/default", methods=["PUT"])
@require_auth
def set_default(template_id: int):
    conn = get_connection()
    row = conn.execute(
        "SELECT id FROM templates WHERE id = ? AND user_id = ?",
        (template_id, g.current_user["id"]),
    ).fetchone()

    if not row:
        conn.close()
        return jsonify({"error": "not_found", "detail": "模板不存在"}), 404

    # Clear existing default for this user, then set new one
    conn.execute(
        "UPDATE templates SET is_default = 0 WHERE user_id = ?",
        (g.current_user["id"],),
    )
    conn.execute(
        "UPDATE templates SET is_default = 1, updated_at = ? WHERE id = ?",
        (__import__("datetime").datetime.utcnow().isoformat(), template_id),
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
