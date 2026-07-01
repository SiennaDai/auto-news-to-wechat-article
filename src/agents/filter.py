"""Filter Agent — 输入内容安全与新闻体裁审核。"""

from langchain_openai import ChatOpenAI
from src.utils import load_prompt


def run_filter(news_text: str, llm: ChatOpenAI) -> dict:
    """审核输入文本的内容安全与新闻体裁。

    Returns:
        {'result': 'ok'} | {'result': 'warn', 'reason': str} | {'result': 'no', 'reason': str}
    """
    prompt = load_prompt("filter").format(news_text=news_text)
    response = llm.invoke(prompt)
    text = response.content.strip()
    lines = text.split("\n")
    first = lines[0].strip().lower() if lines else "no"

    if first not in ("ok", "warn", "no"):
        reason = lines[0][:50] if lines[0].strip() else "审核服务返回异常"
        return {"result": "no", "reason": reason}

    if first == "ok":
        return {"result": "ok"}

    reason = lines[1].strip() if len(lines) > 1 else "审核未通过"
    return {"result": first, "reason": reason}
