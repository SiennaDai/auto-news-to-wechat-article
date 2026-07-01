"""CC1 Agent — 检测 Writer 输出是否为 API 拒答消息。"""

import re
from langchain_openai import ChatOpenAI
from src.utils import load_prompt


def cc1_check(writer_output: str, llm: ChatOpenAI) -> dict:
    """判断 Writer 输出是否为 AI 拒答消息。

    Returns:
        {'result': 'ok'} | {'result': 'no', 'reason': str}
    """
    # 确定性预检：包含 HTML 标签的正常文章直接放行
    has_html = bool(re.search(r'<\s*(div|h[1-6]|p|img|a|span|strong|em)\b', writer_output, re.IGNORECASE))
    if has_html:
        return {"result": "ok"}

    # 无 HTML 结构，可能是拒答消息，交给 LLM 判断
    prompt = load_prompt("cc1").format(writer_output=writer_output)
    response = llm.invoke(prompt)
    text = response.content.strip()
    lines = text.split("\n")
    first = lines[0].strip().lower() if lines else "ok"

    if first not in ("ok", "no"):
        return {"result": "ok"}

    if first == "ok":
        return {"result": "ok"}

    # LLM 判定为拒答 → 把原始输出作为理由展示给用户
    reason = writer_output.strip()[:400]
    return {"result": "no", "reason": reason}
