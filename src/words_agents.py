"""
全自动美编 - CoT Agents Flow
基于 LangGraph 实现
使用模型: deepseek-v4-flash, temperature=0.6
"""

import os
from typing import TypedDict, Optional, Callable
from pathlib import Path

import httpx
from langgraph.graph import StateGraph, END
from langchain_openai import ChatOpenAI

from src.utils import load_prompt, get_description_path

os.environ.pop("SSL_CERT_FILE", None)


# ============================================================
# 配置
# ============================================================


class Config:
    """全局配置"""
    MODEL_NAME = "deepseek-v4-flash"
    TEMPERATURE = 0.6
    API_KEY = os.environ.get("DEEPSEEK_API_KEY", "")
    BASE_URL = os.environ.get("DEEPSEEK_BASE_URL", "https://api.deepseek.com/v1")


# ============================================================
# 状态定义
# ============================================================


class ArticleState(TypedDict):
    """Agent 间传递的状态"""
    original_news: str
    knowledge_base: str
    draft_html: str
    final_html: str


# ============================================================
# 图片列表加载
# ============================================================


def load_image_list(desc_path: Optional[str] = None) -> str:
    """从 description.txt 加载图片列表"""
    desc_file = Path(desc_path) if desc_path else get_description_path()

    if not desc_file.exists():
        raise FileNotFoundError(f"description.txt 不存在，请先运行 img_process.py")

    with open(desc_file, "r", encoding="utf-8") as f:
        images = [line.strip() for line in f if line.strip()]

    return "\n".join(images)


# ============================================================
# Agent 节点函数
# ============================================================


class WechatArticleGenerator:
    """公众号文章生成器 - CoT Agents Flow（无重试，线性执行）"""

    def __init__(self, description_path: Optional[str] = None,
                 progress_callback: Optional[Callable[[str, str], None]] = None,
                 writer_prompt: Optional[str] = None):
        """初始化 LLM 和构建工作流"""
        api_key = self._load_api_key()
        base_url = os.environ.get("DEEPSEEK_BASE_URL", "https://api.deepseek.com/v1")

        if not api_key:
            raise RuntimeError(
                "未找到 DeepSeek API Key。已尝试以下来源：\n"
                "  1. 环境变量 DEEPSEEK_API_KEY\n"
                "  2. 项目根目录 .env 文件 (DEEPSEEK_API_KEY=xxx)\n"
                "请设置后重启: python app.py"
            )

        os.environ["OPENAI_API_KEY"] = api_key

        _http_client = httpx.Client(
            timeout=httpx.Timeout(300.0, connect=30.0),
            limits=httpx.Limits(max_keepalive_connections=5, max_connections=10),
        )
        self.llm = ChatOpenAI(
            api_key=api_key,
            base_url=base_url,
            model=Config.MODEL_NAME,
            temperature=Config.TEMPERATURE,
            http_client=_http_client,
            max_retries=0,
        )
        self._description_path = description_path
        self._progress = progress_callback
        self._writer_prompt = writer_prompt
        self._build_graph()

    @staticmethod
    def _load_api_key() -> str:
        """从环境变量或 .env 文件加载 API Key"""
        key = os.environ.get("DEEPSEEK_API_KEY", "")
        if key:
            return key

        env_file = Path(__file__).resolve().parent.parent / ".env"
        if env_file.exists():
            with open(env_file, "r", encoding="utf-8") as f:
                for line in f:
                    line = line.strip()
                    if line.startswith("DEEPSEEK_API_KEY="):
                        key = line.split("=", 1)[1].strip().strip('"').strip("'")
                        if key:
                            os.environ["DEEPSEEK_API_KEY"] = key
                            return key

        if not key:
            import sys
            print(f"[DEBUG _load_api_key] DEEPSEEK_API_KEY={key!r}", file=sys.stderr)
            print(f"[DEBUG _load_api_key] .env exists={env_file.exists()}", file=sys.stderr)
            print(f"[DEBUG _load_api_key] PID={os.getpid()}", file=sys.stderr)
        return ""

    def _emit(self, stage: str, status: str):
        if self._progress:
            self._progress(stage, status)

    def _build_graph(self):
        """构建 LangGraph 工作流（线性，无重试循环）"""
        workflow = StateGraph(ArticleState)

        workflow.add_node("writer", self._writer_node)
        workflow.add_node("img_matcher", self._img_matcher_node)
        workflow.add_node("checker", self._checker_node)

        workflow.set_entry_point("writer")

        workflow.add_edge("writer", "img_matcher")
        workflow.add_edge("img_matcher", "checker")
        workflow.add_edge("checker", END)

        self.graph = workflow.compile()

    def _writer_node(self, state: ArticleState) -> ArticleState:
        """Agent 1: 写作 Agent"""
        print("[Writer] 开始生成文编稿...")
        self._emit("正在分析新闻稿，生成文章结构...", "running")

        if self._writer_prompt:
            prompt_template = self._writer_prompt
        else:
            prompt_template = load_prompt("writer")

        kb_content = state.get("knowledge_base", "") or ""

        # Escape curly braces in user-provided text for str.format()
        safe_news = state["original_news"].replace("{", "{{").replace("}", "}}")
        safe_kb = kb_content.replace("{", "{{").replace("}", "}}")

        prompt = prompt_template.format(
            original_news=safe_news,
            knowledge_base=safe_kb
        )

        response = self.llm.invoke(prompt)
        state["draft_html"] = response.content

        self._emit("文章结构生成完成", "done")
        print(f"[Writer] 完成，生成 {len(state['draft_html'])} 字符")
        return state

    def _img_matcher_node(self, state: ArticleState) -> ArticleState:
        """Agent 2: 图片匹配 Agent"""
        print("[ImgMatcher] 开始匹配图片...")
        self._emit("正在匹配图片到对应段落...", "running")

        prompt_template = load_prompt("imgmatcher")

        image_list = load_image_list(self._description_path)

        prompt = prompt_template.format(
            draft_html=state["draft_html"],
            image_list=image_list
        )

        response = self.llm.invoke(prompt)
        state["draft_html"] = response.content

        self._emit("图片匹配完成", "done")
        print(f"[ImgMatcher] 完成，生成 {len(state['draft_html'])} 字符")
        return state

    def _checker_node(self, state: ArticleState) -> ArticleState:
        """Agent 3: 质检 Agent"""
        print("[Checker] 开始质检...")
        self._emit("正在检查和修复 HTML 规范...", "running")

        prompt_template = load_prompt("checker")

        prompt = prompt_template.format(
            html_input=state["draft_html"]
        )

        response = self.llm.invoke(prompt)
        state["final_html"] = response.content

        self._emit("HTML 质检完成", "done")
        print(f"[Checker] 完成，输出 {len(state['final_html'])} 字符")
        return state

    def generate(self, original_news: str, knowledge_base: str = "") -> str:
        """生成最终文章，返回 HTML 字符串"""
        initial_state: ArticleState = {
            "original_news": original_news,
            "knowledge_base": knowledge_base if knowledge_base else "",
            "draft_html": "",
            "final_html": ""
        }

        config = {"recursion_limit": 100}
        final_state = self.graph.invoke(initial_state, config=config)

        if not final_state["final_html"]:
            raise RuntimeError("生成失败：质检未通过")

        return final_state["final_html"]


# ============================================================
# 便捷函数
# ============================================================


def run_pipeline(news_text: str, knowledge_base: str = "",
                 description_path: Optional[str] = None,
                 progress_callback: Optional[Callable[[str, str], None]] = None,
                 writer_prompt: Optional[str] = None) -> str:
    """
    便捷函数：生成微信公众号文章，返回 HTML 字符串。

    Args:
        news_text: 新闻稿文本
        knowledge_base: 背景知识库（可选）
        description_path: description.txt 路径，默认使用 data/output/description.txt
        progress_callback: 进度回调函数 (stage_name, status)，status 为 "running" 或 "done"
        writer_prompt: 自定义 writer prompt 模板（可选，不传则使用默认 prompts/writer.txt）
    """
    generator = WechatArticleGenerator(
        description_path=description_path,
        progress_callback=progress_callback,
        writer_prompt=writer_prompt,
    )
    return generator.generate(news_text, knowledge_base)
