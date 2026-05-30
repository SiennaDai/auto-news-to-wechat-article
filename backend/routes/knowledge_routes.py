"""Knowledge base routes — plain-text storage, full-content injection."""

import os
from datetime import datetime, timezone

from flask import Blueprint, request, jsonify, g
from pydantic import ValidationError

from backend.auth import require_auth
from backend.database import get_connection
from backend.models import KnowledgeBaseCreateRequest

knowledge_bp = Blueprint("knowledge", __name__, url_prefix="/api/knowledge")

KNOWLEDGE_ROOT = os.path.join(os.path.dirname(__file__), "..", "..", "data", "knowledge")


def _user_dir():
    d = os.path.join(KNOWLEDGE_ROOT, str(g.current_user["id"]))
    os.makedirs(d, exist_ok=True)
    return d


# ---- Knowledge Bases ----

@knowledge_bp.route("/bases", methods=["GET"])
@require_auth
def list_bases():
    conn = get_connection()
    rows = conn.execute(
        "SELECT * FROM knowledge_bases WHERE user_id = ? ORDER BY updated_at DESC",
        (g.current_user["id"],),
    ).fetchall()
    conn.close()
    return jsonify({"knowledge_bases": [dict(r) for r in rows]})


@knowledge_bp.route("/bases", methods=["POST"])
@require_auth
def create_base():
    try:
        body = KnowledgeBaseCreateRequest.model_validate(request.get_json(silent=True) or {})
    except ValidationError as e:
        return _validation_error(e)

    conn = get_connection()
    now = datetime.now(timezone.utc).isoformat()
    cursor = conn.execute(
        "INSERT INTO knowledge_bases (user_id, name, description) VALUES (?, ?, ?)",
        (g.current_user["id"], body.name, body.content[:200] if body.content else ""),
    )
    kb_id = cursor.lastrowid

    if body.content:
        char_count = len(body.content)
        conn.execute(
            "INSERT INTO knowledge_documents (knowledge_base_id, filename, chunk_index, content, char_count) VALUES (?, ?, ?, ?, ?)",
            (kb_id, body.name + ".txt", 0, body.content, char_count),
        )
        conn.execute(
            "UPDATE knowledge_bases SET file_count = 1, total_chars = ?, updated_at = ? WHERE id = ?",
            (char_count, now, kb_id),
        )

    conn.commit()
    conn.close()
    return jsonify({"knowledge_base_id": kb_id, "name": body.name}), 201


@knowledge_bp.route("/bases/<int:kb_id>", methods=["DELETE"])
@require_auth
def delete_base(kb_id: int):
    conn = get_connection()
    row = conn.execute(
        "SELECT id FROM knowledge_bases WHERE id = ? AND user_id = ?",
        (kb_id, g.current_user["id"]),
    ).fetchone()
    if not row:
        conn.close()
        return jsonify({"error": "not_found", "detail": "知识库不存在"}), 404

    # Clean up document files from disk
    docs = conn.execute(
        "SELECT filename FROM knowledge_documents WHERE knowledge_base_id = ?",
        (kb_id,),
    ).fetchall()
    user_dir = _user_dir()
    for doc in docs:
        file_path = os.path.join(user_dir, doc["filename"])
        if os.path.exists(file_path):
            os.remove(file_path)

    conn.execute("DELETE FROM knowledge_documents WHERE knowledge_base_id = ?", (kb_id,))
    conn.execute("DELETE FROM knowledge_bases WHERE id = ?", (kb_id,))
    conn.commit()
    conn.close()
    return jsonify({"success": True})


# ---- Content retrieval ----

@knowledge_bp.route("/bases/<int:kb_id>/content", methods=["GET"])
@require_auth
def get_content(kb_id: int):
    """Return the full concatenated text of all documents in this knowledge base."""
    conn = get_connection()
    kb = conn.execute(
        "SELECT id, name FROM knowledge_bases WHERE id = ? AND user_id = ?",
        (kb_id, g.current_user["id"]),
    ).fetchone()
    if not kb:
        conn.close()
        return jsonify({"error": "not_found", "detail": "知识库不存在"}), 404

    docs = conn.execute(
        "SELECT content, char_count FROM knowledge_documents WHERE knowledge_base_id = ? ORDER BY chunk_index",
        (kb_id,),
    ).fetchall()
    conn.close()

    parts = [d["content"] for d in docs if d["content"]]
    full_text = "\n\n".join(parts)
    return jsonify({
        "knowledge_base_id": kb_id,
        "name": kb["name"],
        "content": full_text,
        "char_count": len(full_text),
    })


# ---- Documents ----

@knowledge_bp.route("/bases/<int:kb_id>/documents", methods=["GET"])
@require_auth
def list_documents(kb_id: int):
    conn = get_connection()
    kb = conn.execute(
        "SELECT id FROM knowledge_bases WHERE id = ? AND user_id = ?",
        (kb_id, g.current_user["id"]),
    ).fetchone()
    if not kb:
        conn.close()
        return jsonify({"error": "not_found", "detail": "知识库不存在"}), 404

    rows = conn.execute(
        "SELECT id, filename, chunk_index, char_count, created_at FROM knowledge_documents WHERE knowledge_base_id = ? ORDER BY chunk_index",
        (kb_id,),
    ).fetchall()
    conn.close()
    return jsonify({"documents": [dict(r) for r in rows]})


@knowledge_bp.route("/bases/<int:kb_id>/upload", methods=["POST"])
@require_auth
def upload_document(kb_id: int):
    conn = get_connection()
    kb = conn.execute(
        "SELECT id FROM knowledge_bases WHERE id = ? AND user_id = ?",
        (kb_id, g.current_user["id"]),
    ).fetchone()
    if not kb:
        conn.close()
        return jsonify({"error": "not_found", "detail": "知识库不存在"}), 404

    files = request.files.getlist("files")
    if not files:
        conn.close()
        return jsonify({"error": "validation_error", "detail": "请上传至少一个文件"}), 400

    user_dir = _user_dir()
    total_chars = 0
    doc_count = 0
    now = datetime.now(timezone.utc).isoformat()

    for f in files:
        if not f.filename:
            continue
        content = f.read()
        text = content.decode("utf-8", errors="replace")
        char_count = len(text)

        file_path = os.path.join(user_dir, f.filename)
        with open(file_path, "wb") as fh:
            fh.write(content)

        conn.execute(
            "INSERT INTO knowledge_documents (knowledge_base_id, filename, chunk_index, content, char_count) VALUES (?, ?, ?, ?, ?)",
            (kb_id, f.filename, doc_count, text, char_count),
        )
        total_chars += char_count
        doc_count += 1

    conn.execute(
        "UPDATE knowledge_bases SET file_count = file_count + ?, total_chars = total_chars + ?, updated_at = ? WHERE id = ?",
        (doc_count, total_chars, now, kb_id),
    )
    conn.commit()
    conn.close()

    return jsonify({"uploaded": doc_count, "total_chars": total_chars}), 201


@knowledge_bp.route("/documents/<int:doc_id>", methods=["DELETE"])
@require_auth
def delete_document(doc_id: int):
    conn = get_connection()
    row = conn.execute(
        """SELECT d.id, d.knowledge_base_id, d.filename, d.char_count
           FROM knowledge_documents d
           JOIN knowledge_bases kb ON d.knowledge_base_id = kb.id
           WHERE d.id = ? AND kb.user_id = ?""",
        (doc_id, g.current_user["id"]),
    ).fetchone()

    if not row:
        conn.close()
        return jsonify({"error": "not_found", "detail": "文档不存在"}), 404

    conn.execute("DELETE FROM knowledge_documents WHERE id = ?", (doc_id,))
    conn.execute(
        "UPDATE knowledge_bases SET file_count = MAX(0, file_count - 1), total_chars = MAX(0, total_chars - ?), updated_at = ? WHERE id = ?",
        (row["char_count"] or 0, datetime.now(timezone.utc).isoformat(), row["knowledge_base_id"]),
    )
    conn.commit()
    conn.close()

    user_dir = _user_dir()
    file_path = os.path.join(user_dir, row["filename"])
    if os.path.exists(file_path):
        os.remove(file_path)

    return jsonify({"success": True})


# ---- Search (returns full content — no embedding) ----

@knowledge_bp.route("/bases/<int:kb_id>/search", methods=["POST"])
@require_auth
def search(kb_id: int):
    """Return full knowledge base content — direct injection, no RAG retrieval."""
    conn = get_connection()
    kb = conn.execute(
        "SELECT id, name FROM knowledge_bases WHERE id = ? AND user_id = ?",
        (kb_id, g.current_user["id"]),
    ).fetchone()
    if not kb:
        conn.close()
        return jsonify({"error": "not_found", "detail": "知识库不存在"}), 404

    docs = conn.execute(
        "SELECT content FROM knowledge_documents WHERE knowledge_base_id = ? ORDER BY chunk_index",
        (kb_id,),
    ).fetchall()
    conn.close()

    parts = [d["content"] for d in docs if d["content"]]
    full_text = "\n\n".join(parts)
    return jsonify({"results": [{"content": full_text}], "total_chars": len(full_text)})


def _validation_error(e: ValidationError) -> tuple:
    messages = []
    for err in e.errors():
        field = ".".join(str(loc) for loc in err["loc"])
        messages.append(f"{field}: {err['msg']}")
    return jsonify({"error": "validation_error", "detail": "; ".join(messages)}), 400
