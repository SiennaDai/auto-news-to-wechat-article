"""Flask API 服务 - 微信公众号自动排版。"""

import base64
import json
import re
import queue
import shutil
import tempfile
import threading
import traceback
import os
from pathlib import Path

from flask import Flask, request, jsonify, g, send_from_directory, Response, stream_with_context
from flask_cors import CORS

from bs4 import BeautifulSoup
from PIL import Image
from langchain_openai import ChatOpenAI

from src.main import process_with_input
from src.utils import get_config_path
from src.wechat_api import (get_access_token, upload_body_image, upload_thumb,
                             create_draft, publish_draft, list_drafts,
                             delete_draft, get_draft_url)
from src.words_agents import AgentRejected
from src.agents.filter import run_filter

from backend.database import init_db, get_connection
from backend.auth import optional_auth
from backend.routes.auth_routes import auth_bp
from backend.routes.template_routes import template_bp
from backend.routes.knowledge_routes import knowledge_bp
from backend.routes.prompt_routes import prompt_bp

app = Flask(__name__)
app.config['MAX_CONTENT_LENGTH'] = 50 * 1024 * 1024  # 50MB，支持 base64 图片上传
CORS(app)

# Register blueprints
app.register_blueprint(auth_bp)
app.register_blueprint(template_bp)
app.register_blueprint(knowledge_bp)
app.register_blueprint(prompt_bp)

# Initialize database on startup
with app.app_context():
    init_db()


@app.route("/health", methods=["GET"])
def health():
    return jsonify({"status": "ok"})


@app.route("/api/default-config", methods=["GET"])
def default_config():
    return send_from_directory("config", "information.json")


@app.route("/prompts/<path:filename>", methods=["GET"])
def serve_prompt(filename):
    return send_from_directory("prompts", filename)


@app.route("/api/decoration-options", methods=["GET"])
def decoration_options():
    return send_from_directory("config", "decoration_base.json")


@app.route("/api/author-info", methods=["GET"])
def author_info():
    return send_from_directory("config", "author.json")


@app.route("/generate", methods=["POST"])
def generate():
    news_text = request.form.get("news_text")
    if not news_text:
        return jsonify({"success": False, "error": "缺少 news_text 参数"}), 400

    config = None
    config_str = request.form.get("config")
    if config_str:
        try:
            config = json.loads(config_str)
        except json.JSONDecodeError:
            return jsonify({"success": False, "error": "config 参数 JSON 解析失败"}), 400

    temp_dir = None
    try:
        temp_dir = tempfile.mkdtemp(prefix="el_")
        images_dir = Path(temp_dir) / "images"
        images_dir.mkdir()

        uploaded_files = request.files.getlist("images")
        for f in uploaded_files:
            if f.filename:
                f.save(str(images_dir / f.filename))

        html = process_with_input(news_text, temp_dir, config)

        return jsonify({"success": True, "html": html})

    except Exception as e:
        return jsonify({"success": False, "error": str(e)}), 500

    finally:
        if temp_dir and os.path.exists(temp_dir):
            shutil.rmtree(temp_dir, ignore_errors=True)


# ---- Knowledge Base helpers ----

_llm_instance = None
_checker_llm_instance = None


def _get_llm():
    global _llm_instance
    if _llm_instance is None:
        api_key = os.environ.get("DEEPSEEK_API_KEY", "")
        base_url = os.environ.get("DEEPSEEK_BASE_URL", "https://api.deepseek.com/v1")
        _llm_instance = ChatOpenAI(model="deepseek-v4-flash", api_key=api_key,
                                   base_url=base_url, temperature=0.3)
    return _llm_instance


def _get_checker_llm():
    """Filter Agent 专用 LLM 实例，temperature 0.1"""
    global _checker_llm_instance
    if _checker_llm_instance is None:
        api_key = os.environ.get("DEEPSEEK_API_KEY", "")
        base_url = os.environ.get("DEEPSEEK_BASE_URL", "https://api.deepseek.com/v1")
        _checker_llm_instance = ChatOpenAI(model="deepseek-v4-flash", api_key=api_key,
                                           base_url=base_url, temperature=0.1)
    return _checker_llm_instance


def _summarize_text(text: str, kb_name: str) -> str:
    """Compress a single knowledge base content to ~500 chars using DeepSeek."""
    content = text if len(text) <= 8000 else text[:8000] + "\n...(已截断)"
    prompt = f"请将以下知识库内容压缩为500字以内的要点摘要，保留关键事实和数据：\n\n知识库：{kb_name}\n\n{content}"
    try:
        resp = _get_llm().invoke(prompt)
        return f"【{kb_name}】（已压缩摘要）\n{resp.content}"
    except Exception:
        return f"【{kb_name}】\n{text[:1000]}...(压缩失败，已截断)"


def _build_knowledge_text(kb_ids_str: str) -> str:
    """Fetch and concatenate knowledge base contents. Compress if total > 10000 chars."""
    kb_ids = [int(x.strip()) for x in kb_ids_str.split(",") if x.strip()]
    if not kb_ids:
        return ""

    conn = get_connection()
    entries = []
    total = 0

    for kb_id in kb_ids:
        kb = conn.execute(
            "SELECT name FROM knowledge_bases WHERE id = ? AND user_id = ?",
            (kb_id, g.current_user["id"]),
        ).fetchone()
        if not kb:
            continue
        docs = conn.execute(
            "SELECT content FROM knowledge_documents WHERE knowledge_base_id = ? ORDER BY chunk_index",
            (kb_id,),
        ).fetchall()
        text = "\n".join(d["content"] for d in docs if d["content"])
        if text:
            entries.append((kb["name"], text))
            total += len(text)

    conn.close()

    if total <= 10000:
        return "\n\n".join(f"【{name}】\n{text}" for name, text in entries)

    # Compress: summarize each KB > 3000 chars
    parts = []
    for name, text in entries:
        if len(text) > 3000:
            parts.append(_summarize_text(text, name))
        else:
            parts.append(f"【{name}】\n{text}")
    return "\n\n".join(parts)


@app.route("/generate-stream", methods=["POST"])
@optional_auth
def generate_stream():
    """SSE 流式生成端点：实时推送进度，最后推送完整 HTML。"""
    news_text = request.form.get("news_text")
    if not news_text:
        return jsonify({"success": False, "error": "缺少 news_text 参数"}), 400

    config = None
    config_str = request.form.get("config")
    if config_str:
        try:
            config = json.loads(config_str)
        except json.JSONDecodeError:
            return jsonify({"success": False, "error": "config 参数 JSON 解析失败"}), 400

    # Resolve writer prompt (optional)
    writer_prompt = None
    prompt_id = request.form.get("prompt_id")
    prompt_content = request.form.get("prompt_content")
    if prompt_id:
        if g.current_user is None:
            return jsonify({"error": "auth_required", "detail": "使用自定义提示词需要登录"}), 400
        conn = get_connection()
        row = conn.execute(
            "SELECT content FROM prompts WHERE id = ? AND user_id = ?",
            (int(prompt_id), g.current_user["id"]),
        ).fetchone()
        conn.close()
        if not row:
            return jsonify({"error": "prompt_not_found", "detail": "提示词不存在"}), 404
        writer_prompt = row["content"]
    elif prompt_content:
        # User typed custom content directly in textarea
        writer_prompt = prompt_content

    # Resolve knowledge base content (requires auth)
    knowledge_base = ""
    kb_ids_str = request.form.get("knowledge_base_ids", "")
    if kb_ids_str:
        if g.current_user is None:
            return jsonify({"error": "auth_required", "detail": "使用知识库需要登录"}), 400
        knowledge_base = _build_knowledge_text(kb_ids_str)

    # ===== Filter 预检（同步，SSE 之前） =====
    filter_confirmed = request.form.get("filter_confirmed", "") == "true"
    if not filter_confirmed:
        filter_result = run_filter(news_text, _get_checker_llm())
        if filter_result["result"] in ("no", "warn"):
            return jsonify({
                "filter_result": filter_result["result"],
                "reason": filter_result.get("reason", "")
            }), 200

    # 在主线程中提取请求数据（线程中无 request 上下文）
    uploaded_files_data = []
    for f in request.files.getlist("images"):
        if f.filename:
            uploaded_files_data.append((f.filename, f.read()))

    def generate_events():
        q = queue.Queue()

        def on_progress(stage: str, status: str):
            q.put(json.dumps({"type": "progress", "stage": stage, "status": status},
                             ensure_ascii=False))

        def do_work():
            temp_dir = None
            try:
                temp_dir = tempfile.mkdtemp(prefix="el_")
                images_dir = Path(temp_dir) / "images"
                images_dir.mkdir()

                for filename, data in uploaded_files_data:
                    with open(str(images_dir / filename), 'wb') as f:
                        f.write(data)

                html = process_with_input(news_text, temp_dir, config,
                                          progress_callback=on_progress,
                                          writer_prompt=writer_prompt,
                                          knowledge_base=knowledge_base)
                q.put(json.dumps({"type": "complete", "html": html}, ensure_ascii=False))

            except AgentRejected as e:
                q.put(json.dumps({
                    "type": "context_result",
                    "result": "no",
                    "checker": e.source,
                    "reason": e.reason
                }, ensure_ascii=False))

            except Exception as e:
                traceback.print_exc()
                q.put(json.dumps({"type": "error", "message": str(e)}, ensure_ascii=False))

            finally:
                if temp_dir and os.path.exists(temp_dir):
                    shutil.rmtree(temp_dir, ignore_errors=True)

        t = threading.Thread(target=do_work)
        t.start()

        while True:
            try:
                data = q.get(timeout=0.3)
                yield f"data: {data}\n\n"
                parsed = json.loads(data)
                if parsed["type"] in ("complete", "error", "context_result"):
                    break
            except queue.Empty:
                yield ": heartbeat\n\n"

        t.join()

    return Response(
        stream_with_context(generate_events()),
        mimetype="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"}
    )


def _crop_image_to_container(img_tag, filepath):
    """根据 HTML 中图片容器的 aspect-ratio 对图片做中心裁剪。
    如果 img 带有 data-user-cropped="true"，说明用户已自定义裁剪，跳过。"""
    if img_tag.get('data-user-cropped') == 'true':
        print(f"[publish] skip crop: user-cropped img, src={img_tag.get('src','')[:60]}")
        return

    parent = img_tag.parent
    if parent and parent.name == 'span' and 'el-img-wrapper' in (parent.get('class') or []):
        parent = parent.parent

    if not parent or parent.name != 'div':
        return

    style = parent.get('style') or ''
    m = re.search(r'aspect-ratio:\s*(\d+(?:\.\d+)?)\s*/\s*(\d+(?:\.\d+)?)', style)
    if not m:
        return

    target_ratio = float(m.group(1)) / float(m.group(2))
    try:
        im = Image.open(filepath)
        w, h = im.size
        current = w / h
        if abs(current - target_ratio) < 0.02:
            return  # 比例已匹配

        print(f"[publish] crop: {w}x{h} (ratio={current:.3f}) -> target={target_ratio:.3f}")
        if current > target_ratio:
            new_w = int(h * target_ratio)
            im = im.crop(((w - new_w) // 2, 0, (w + new_w) // 2, h))
        else:
            new_h = int(w / target_ratio)
            im = im.crop((0, (h - new_h) // 2, w, (h + new_h) // 2))

        im.save(filepath, quality=92)
    except Exception:
        pass  # 裁剪失败不阻塞发布流程


@app.route("/api/publish-stream", methods=["POST"])
@optional_auth
def publish_stream():
    """SSE 流式发布端点：接收 HTML → 上传图片 → 清空草稿箱 → 创建草稿 → 获取预览链接 → 可选发布。"""
    html = request.form.get("html", "").strip()
    if not html:
        return jsonify({"success": False, "error": "缺少 html 参数"}), 400

    appid = request.form.get("appid", "").strip()
    secret = request.form.get("secret", "").strip()
    author = request.form.get("author", "").strip()
    action = request.form.get("action", "draft")
    title_override = request.form.get("title", "").strip()

    if not appid or not secret:
        return jsonify({"success": False, "error": "缺少微信 APPID/APPSECRET"}), 400

    cover_data = None
    cover_file = request.files.get("cover_image")
    if cover_file and cover_file.filename:
        cover_data = cover_file.read()

    if not cover_data:
        return jsonify({"success": False, "error": "缺少封面图"}), 400

    # 收集前端提取的 body 图片二进制文件，按文件名中的序号索引
    body_image_files = {}
    for f in request.files.getlist("body_images"):
        if f.filename:
            body_image_files[f.filename] = f.read()

    def generate_events():
        q = queue.Queue()

        def emit(stage: str, status: str = "running"):
            q.put(json.dumps({"type": "progress", "stage": stage, "status": status},
                             ensure_ascii=False))

        def do_work():
            temp_dir = None
            try:
                temp_dir = tempfile.mkdtemp(prefix="el_pub_")
                images_dir = Path(temp_dir) / "images"
                images_dir.mkdir()

                soup = BeautifulSoup(html, "html.parser")

                # 1. 提取标题
                title = title_override
                if not title:
                    title_tag = soup.find("h1")
                    title = title_tag.get_text(strip=True) if title_tag else "无标题"

                # 2. 获取 access_token
                emit("正在连接微信...")
                access_token = get_access_token(appid, secret)
                emit("微信连接成功", "done")

                # 3. 遍历正文图片，上传并补属性
                img_tags = soup.find_all("img")
                total_imgs = len(img_tags)

                # 构建 标记 → 文件数据 的精确映射，不依赖顺序
                _marker_map = {}
                for fname, fdata in body_image_files.items():
                    m = re.search(r'body_(\d+)', fname)
                    if m:
                        _marker_map[f'{{{{EL_BODY_IMG_{m.group(1)}}}}}'] = (fdata, fname)

                for i, img in enumerate(img_tags):
                    src = img.get("src", "")

                    # 微信图片补上渲染所需的 class 和 style
                    if "mmbiz.qpic.cn" in src or "wx_fmt=" in src:
                        img["class"] = "rich_pages wxw-img"
                        img["data-type"] = "jpeg"
                        img["style"] = "visibility:visible!important;width:100%!important;height:auto!important;"
                        continue

                    # 精确标记匹配
                    img_data = None
                    ext = ".jpg"
                    if src in _marker_map:
                        fdata, fname = _marker_map[src]
                        ext = ".png" if fname.endswith(".png") else ".jpg"
                        img_data = fdata

                    if img_data:
                        temp_path = images_dir / f"_body_{i}{ext}"
                        with open(temp_path, "wb") as f:
                            f.write(img_data)
                    elif src.startswith("data:"):
                        # 兼容旧的 base64 方式
                        header, b64data = src.split(",", 1)
                        mime = header.split(":")[1].split(";")[0] if ":" in header else "image/jpeg"
                        ext = ".jpg" if "jpeg" in mime or "jpg" in mime else ".png"
                        temp_path = images_dir / f"_body_fb{i}{ext}"
                        with open(temp_path, "wb") as f:
                            f.write(base64.b64decode(b64data))
                    else:
                        continue

                    # 根据 HTML 容器 aspect-ratio 对图片做真实裁剪（用户已裁剪的跳过）
                    _crop_image_to_container(img, str(temp_path))

                    # 用户裁剪过的图片：去掉容器固定宽高比，让容器自适应图片实际比例
                    if img.get('data-user-cropped') == 'true':
                        _parent = img.parent
                        if _parent and _parent.name == 'span' and 'el-img-wrapper' in (_parent.get('class') or []):
                            _parent = _parent.parent
                        if _parent and _parent.name == 'div':
                            _style = _parent.get('style') or ''
                            _style = re.sub(r'aspect-ratio:\s*\d+(?:\.\d+)?\s*/\s*\d+(?:\.\d+)?\s*;?', '', _style)
                            _parent['style'] = _style.strip().rstrip(';') or None

                    emit(f"正在上传图片 ({i + 1}/{total_imgs})...")
                    url = upload_body_image(str(temp_path), access_token)
                    img["src"] = url
                    img["class"] = "rich_pages wxw-img"
                    img["data-type"] = ext.lstrip(".")
                    img["style"] = "visibility:visible!important;width:100%!important;height:auto!important;"

                emit("图片上传完成", "done")
                html_out = str(soup)

                # 4. 上传封面图
                emit("正在上传封面图...")
                cover_path = images_dir / "_cover.jpg"
                with open(cover_path, "wb") as f:
                    f.write(cover_data)
                thumb_media_id = upload_thumb(str(cover_path), access_token)
                emit("封面上传完成", "done")

                # 5. 清空已有草稿
                emit("正在清空草稿箱...")
                items = list_drafts(access_token)
                for item in items:
                    delete_draft(access_token, item["media_id"])
                emit("草稿箱已清空", "done")

                # 6. 创建草稿
                emit("正在创建草稿...")
                draft_media_id = create_draft(
                    access_token,
                    title=title,
                    author=author,
                    content=html_out,
                    thumb_media_id=thumb_media_id,
                )
                emit("草稿创建完成", "done")

                # 7. 获取预览链接
                emit("正在获取预览链接...")
                preview_url = get_draft_url(access_token, draft_media_id)
                emit("预览链接已生成", "done")

                # 8. 可选发布
                publish_id = ""
                if action == "publish":
                    emit("正在发布...")
                    publish_id = publish_draft(access_token, draft_media_id)
                    emit("发布完成", "done")

                q.put(json.dumps({
                    "type": "complete",
                    "media_id": draft_media_id,
                    "publish_id": publish_id,
                    "title": title,
                    "preview_url": preview_url,
                }, ensure_ascii=False))

            except Exception as e:
                q.put(json.dumps({"type": "error", "message": str(e)}, ensure_ascii=False))

            finally:
                if temp_dir and os.path.exists(temp_dir):
                    shutil.rmtree(temp_dir, ignore_errors=True)

        t = threading.Thread(target=do_work)
        t.start()

        while True:
            try:
                data = q.get(timeout=0.3)
                yield f"data: {data}\n\n"
                parsed = json.loads(data)
                if parsed["type"] in ("complete", "error"):
                    break
            except queue.Empty:
                yield ": heartbeat\n\n"

        t.join()

    return Response(
        stream_with_context(generate_events()),
        mimetype="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"}
    )


@app.route("/")
def index():
    return send_from_directory("web", "index.html")


@app.route("/<path:filename>")
def static_files(filename):
    return send_from_directory("web", filename)


if __name__ == "__main__":
    app.run(debug=False, host="0.0.0.0", port=5000, threaded=True)
