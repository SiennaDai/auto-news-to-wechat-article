"""主入口：串接全流程，从新闻稿生成公众号文章 HTML。"""

import base64
import json
import re
from pathlib import Path
from typing import Optional, Callable

from bs4 import BeautifulSoup

from src.utils import (
    ensure_dirs,
    get_news_path,
    get_config_path,
    get_output_path,
    get_project_root,
)
from src.img_process import process_images, process_images_in_dir
from src.words_agents import run_pipeline
from src.edit import process_article
from src.polish import polish_article


def main():
    print("=" * 50)
    print("微信公众号自动排版工具")
    print("=" * 50)

    # 1. 确保目录存在
    ensure_dirs()

    # 2. 图片预处理：压缩 + 生成 description.txt
    print("\n[Stage 1/4] 图片预处理...")
    compressed = process_images()
    if compressed:
        print(f"  压缩了 {len(compressed)} 张图片")
    print("  description.txt 已生成")

    # 3. AI 流水线：生成带图片的 HTML
    print("\n[Stage 2/4] AI 流水线（Writer → ImgMatcher → Checker）...")
    news_path = get_news_path()
    if not news_path.exists():
        raise FileNotFoundError(f"新闻稿不存在: {news_path}")

    with open(news_path, "r", encoding="utf-8") as f:
        news_text = f.read()

    raw_html = run_pipeline(news_text)
    print(f"  原始 HTML 生成完成，{len(raw_html)} 字符")

    # 4. 加载配置
    print("\n[Stage 3/4] 文编处理（排版 + 超链接 + 作者信息）...")
    config_path = get_config_path()
    with open(config_path, "r", encoding="utf-8") as f:
        full_config = json.load(f)

    wen_config = full_config.get("文编", {})
    middle_html = process_article(raw_html, wen_config)
    print(f"  文编处理完成，{len(middle_html)} 字符")

    # 5. 美编处理
    print("\n[Stage 4/4] 美编处理（装饰样式）...")
    mei_config = full_config.get("美编", {})
    final_html = polish_article(middle_html, mei_config)
    print(f"  美编处理完成，{len(final_html)} 字符")

    # 6. 修正图片路径（HTML 在 data/output/，图片在 data/input/images/）
    final_html = final_html.replace('src="images/', 'src="../input/images/')

    # 7. 保存最终输出
    output_path = get_output_path()
    with open(output_path, "w", encoding="utf-8") as f:
        f.write(final_html)

    print(f"\n{'=' * 50}")
    print(f"完成！输出文件: {output_path}")
    print(f"{'=' * 50}")


def process_with_input(news_text: str, images_dir: str, config: Optional[dict] = None,
                       progress_callback: Optional[Callable[[str, str], None]] = None,
                       embed_base64: bool = True,
                       writer_prompt: Optional[str] = None,
                       knowledge_base: str = "") -> str:
    """
    API 可调用的处理函数：接收新闻文本和图片目录，返回生成 HTML。

    Args:
        news_text: 新闻稿文本内容
        images_dir: 临时图片目录路径（该目录下已有 images/ 子目录和图片文件）
        config: 可选配置字典，覆盖 config/information.json 的默认值
        progress_callback: 进度回调 (stage_name, status)
        embed_base64: 是否将图片转为 Base64 内嵌
        writer_prompt: 自定义 writer prompt 模板（可选）
        knowledge_base: 参考知识库全文（可选）

    Returns:
        生成的完整 HTML 字符串
    """
    images_subdir = Path(images_dir) / "images"
    description_file = Path(images_dir) / "description.txt"

    def emit(stage: str, status: str = "running"):
        if progress_callback:
            progress_callback(stage, status)

    # 1. 图片预处理
    emit("正在预处理图片...")
    process_images_in_dir(str(images_subdir), str(description_file))
    emit("图片预处理完成", "done")

    # 2. AI 流水线
    raw_html = run_pipeline(news_text, description_path=str(description_file),
                            progress_callback=progress_callback,
                            writer_prompt=writer_prompt,
                            knowledge_base=knowledge_base)

    # 安全过滤：移除 AI 输出中可能存在风险的 HTML
    raw_html = sanitize_html(raw_html)

    # 3. 加载并合并配置
    config_path = get_config_path()
    with open(config_path, "r", encoding="utf-8") as f:
        full_config = json.load(f)

    # 深拷贝避免污染原始配置
    merged = {"文编": dict(full_config.get("文编", {})),
              "美编": dict(full_config.get("美编", {}))}

    if config:
        mei_key_map = {
            "theme_color": "主题色",
            "font_family": "字体",
            "text_color": "正文颜色",
            "font_size": "正文字号",
            "line_height": "行距",
            "title_font_sizes": "标题字号列表",
            "use_preset": "是否使用已有套组",
            "decoration_set": "装饰套组",
        }
        wen_key_map = {
            "has_links": "是否需要超链接",
            "links_title": "超链接部分标题",
            "links": "超链接列表",
        }

        if "文编" in config:
            merged["文编"].update(config["文编"])
        if "美编" in config:
            merged["美编"].update(config["美编"])

        for key, value in config.items():
            if key in ("文编", "美编"):
                continue
            if key in mei_key_map:
                merged["美编"][mei_key_map[key]] = value
            elif key in wen_key_map:
                merged["文编"][wen_key_map[key]] = value
            elif key in ("author", "photographer", "editor"):
                merged["文编"].setdefault("作者信息", {})
                cn = {"author": "作者", "photographer": "摄影", "editor": "责编"}[key]
                merged["文编"]["作者信息"][cn] = value
            else:
                merged["美编"][key] = value

    # 4. 文编 + 美编
    emit("正在应用排版和装饰样式...")
    wen_config = merged.get("文编", {})
    mei_config = merged.get("美编", {})

    middle_html = process_article(raw_html, wen_config)
    final_html = polish_article(middle_html, mei_config)
    emit("排版装饰完成", "done")

    # 5. 安全过滤（防御纵深）
    final_html = sanitize_html(final_html)

    # 6. 图片转 Base64 内嵌（发布流程跳过）
    if embed_base64:
        final_html = _embed_images_as_base64(final_html, images_subdir)

    return final_html


def sanitize_html(html_content: str) -> str:
    """移除 AI 输出中可能存在风险的 HTML 标签和属性。"""
    soup = BeautifulSoup(html_content, 'html.parser')

    # 移除危险标签
    for tag_name in ('script', 'iframe', 'object', 'embed', 'style', 'link', 'meta', 'form', 'input'):
        for tag in soup.find_all(tag_name):
            tag.decompose()

    # 移除所有事件处理器属性和 javascript: 协议
    event_attrs = [a for a in
        ('onclick', 'onload', 'onerror', 'onmouseover', 'onmouseout', 'onfocus', 'onblur',
         'onchange', 'onsubmit', 'onkeydown', 'onkeyup', 'onkeypress', 'ondblclick',
         'oncontextmenu', 'oncopy', 'oncut', 'onpaste', 'ondrag', 'ondrop', 'onscroll',
         'onwheel', 'onanimationend', 'ontransitionend', 'onresize', 'ontoggle')]

    for tag in soup.find_all(True):
        for attr in event_attrs:
            if attr in tag.attrs:
                del tag[attr]
        # 移除 javascript: 协议
        for attr in ('href', 'src', 'action', 'formaction'):
            val = tag.get(attr)
            if val and isinstance(val, str) and val.strip().lower().startswith('javascript:'):
                del tag[attr]

    return str(soup)


def _embed_images_as_base64(html_content: str, images_dir: Path) -> str:
    """将 HTML 中的 `src="images/xxx.jpg"` 替换为 Base64 data URI。"""
    soup = BeautifulSoup(html_content, 'html.parser')

    for img in soup.find_all('img'):
        src = img.get('src', '')
        if src.startswith('images/') or src.startswith('../input/images/'):
            filename = Path(src).name
            filepath = images_dir / filename
            if filepath.exists():
                try:
                    with open(filepath, 'rb') as f:
                        data = base64.b64encode(f.read()).decode('utf-8')
                    ext = filepath.suffix.lower()
                    mime = 'image/jpeg' if ext in ('.jpg', '.jpeg') else 'image/png'
                    img['src'] = f'data:{mime};base64,{data}'
                except Exception:
                    pass

    return str(soup)


if __name__ == "__main__":
    main()
