"""CC2 Agent — 事实交叉验证，修正生成稿中与原文不一致的实体。"""

import re
from langchain_openai import ChatOpenAI
from src.utils import load_prompt


def cc2_check(original_news: str, generated_html: str, llm: ChatOpenAI) -> dict:
    """校验事实并修正幻觉。

    Returns:
        {'result': 'ok', 'html': str} | {'result': 'fixed', 'html': str}
        | {'result': 'error', 'reason': str} | {'result': 'skip', 'html': str}
    """
    prompt = load_prompt("cc2").format(
        original_news=original_news,
        generated_html=generated_html
    )
    response = llm.invoke(prompt)
    text = response.content.strip()
    lines = text.split("\n")
    first = lines[0].strip().lower() if lines else "error"

    if first not in ("ok", "fixed", "error"):
        # 格式不符合，降级跳过
        return {"result": "skip", "html": generated_html}

    if first == "error":
        reason = lines[1].strip() if len(lines) > 1 else "事实校验异常"
        return {"result": "error", "reason": reason}

    # ok 或 fixed：提取 HTML
    html = "\n".join(lines[1:]).strip()
    html = re.sub(r'^```(?:html)?\s*\n?', '', html)
    html = re.sub(r'\n?```\s*$', '', html)
    if not html.strip():
        return {"result": "skip", "html": generated_html}

    return {"result": first, "html": html}
