"""
全自动美编 - CoT Agents Flow
基于 LangGraph 实现
模型: deepseek-v4-flash
"""

import os
import re
from typing import TypedDict, Optional, Callable
from pathlib import Path

import httpx
from langgraph.graph import StateGraph, END
from langchain_openai import ChatOpenAI

from src.utils import load_prompt, get_description_path
from src.agents.cc1 import cc1_check
from src.agents.cc2 import cc2_check

os.environ.pop("SSL_CERT_FILE", None)


# ============================================================
# 配置
# ============================================================


class Config:
    """全局配置"""
    MODEL_NAME = "deepseek-v4-flash"
    TEMPERATURE_WRITER = 0.6   # Writer: 创作多样性
    TEMPERATURE_IMG = 0.3      # ImgMatcher: 语义匹配
    TEMPERATURE_CHECKER = 0.1  # 全部 Checker: 稳定一致


# ============================================================
# 异常
# ============================================================


class AgentRejected(Exception):
    """Agent 判定不可继续，由 SSE 线程捕获后发送 context_result 事件。"""
    def __init__(self, source: str, reason: str):
        self.source = source  # 'cc1' | 'cc2'
        self.reason = reason
        super().__init__(f"[{source}] {reason}")


# ============================================================
# 状态定义
# ============================================================


class ArticleState(TypedDict):
    """Agent 间传递的状态"""
    original_news: str
    knowledge_base: str
    draft_html: str
    cc2_html: str
    img_html: str
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
    """公众号文章生成器 - CoT Agents Flow（Writer→CC1→CC2→ImgMatcher→FormatChecker）"""

    def __init__(self, description_path: Optional[str] = None,
                 progress_callback: Optional[Callable[[str, str], None]] = None,
                 writer_prompt: Optional[str] = None):
        """初始化三个 LLM 实例并构建工作流"""
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

        def _make_http_client():
            return httpx.Client(
                timeout=httpx.Timeout(300.0, connect=30.0),
                limits=httpx.Limits(max_keepalive_connections=5, max_connections=10),
            )

        # Checker 共用（temp 0.1）：Filter / CC1 / CC2 / Format Checker
        self.llm_checker = ChatOpenAI(
            api_key=api_key, base_url=base_url,
            model=Config.MODEL_NAME, temperature=Config.TEMPERATURE_CHECKER,
            http_client=_make_http_client(), max_retries=0,
        )
        # Writer（temp 0.6）
        self.llm_writer = ChatOpenAI(
            api_key=api_key, base_url=base_url,
            model=Config.MODEL_NAME, temperature=Config.TEMPERATURE_WRITER,
            http_client=_make_http_client(), max_retries=0,
        )
        # ImgMatcher（temp 0.3）
        self.llm_img = ChatOpenAI(
            api_key=api_key, base_url=base_url,
            model=Config.MODEL_NAME, temperature=Config.TEMPERATURE_IMG,
            http_client=_make_http_client(), max_retries=0,
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

        return ""

    def _emit(self, stage: str, status: str):
        if self._progress:
            self._progress(stage, status)

    def _build_graph(self):
        """构建 LangGraph 工作流（Writer→CC1→CC2→ImgMatcher→FormatChecker）"""
        workflow = StateGraph(ArticleState)

        workflow.add_node("writer", self._writer_node)
        workflow.add_node("cc1", self._cc1_node)
        workflow.add_node("cc2", self._cc2_node)
        workflow.add_node("img_matcher", self._img_matcher_node)
        workflow.add_node("format_checker", self._format_checker_node)

        workflow.set_entry_point("writer")

        workflow.add_edge("writer", "cc1")
        workflow.add_edge("cc1", "cc2")
        workflow.add_edge("cc2", "img_matcher")
        workflow.add_edge("img_matcher", "format_checker")
        workflow.add_edge("format_checker", END)

        self.graph = workflow.compile()

    # ---- Writer ----

    def _writer_node(self, state: ArticleState) -> ArticleState:
        """Agent 1: 写作 Agent"""
        print("[Writer] 开始生成文编稿...")
        self._emit("正在分析新闻稿，生成文章结构...", "running")

        prompt_template = load_prompt("writer")

        if self._writer_prompt:
            user_prefs = self._writer_prompt
        else:
            user_prefs = load_prompt("user_preferences")

        kb_content = state.get("knowledge_base", "") or ""

        prompt = prompt_template.replace("{user_preferences}", user_prefs)
        prompt = prompt.replace("{original_news}", state["original_news"])
        prompt = prompt.replace("{knowledge_base}", kb_content)

        response = self.llm_writer.invoke(prompt)
        state["draft_html"] = response.content

        self._emit("文章结构生成完成", "done")
        print(f"[Writer] 完成，生成 {len(state['draft_html'])} 字符")
        return state

    # ---- CC1: API 拒答检测 ----

    def _cc1_node(self, state: ArticleState) -> ArticleState:
        """Agent 2: 检测 Writer 输出是否为 API 拒答消息"""
        print("[CC1] 检测输出合规性...")

        result = cc1_check(state["draft_html"], self.llm_checker)

        if result["result"] == "no":
            raise AgentRejected("cc1", result["reason"])

        print("[CC1] 通过")
        return state

    # ---- CC2: 事实交叉验证 ----

    def _cc2_node(self, state: ArticleState) -> ArticleState:
        """Agent 3: 事实交叉验证，修正幻觉"""
        print("[CC2] 开始事实校验...")
        self._emit("正在校验事实数据...", "running")

        result = cc2_check(
            state["original_news"],
            state["draft_html"],
            self.llm_checker
        )

        if result["result"] == "error":
            raise AgentRejected("cc2", result["reason"])

        # ok / fixed / skip → 都是用返回的 HTML
        state["cc2_html"] = result["html"]

        self._emit("事实校验完成", "done")
        verb = {"ok": "无错误", "fixed": "已修正", "skip": "已跳过"}.get(result["result"], result["result"])
        print(f"[CC2] 完成（{verb}），{len(state['cc2_html'])} 字符")
        return state

    # ---- ImgMatcher ----

    def _img_matcher_node(self, state: ArticleState) -> ArticleState:
        """Agent 4: 图片匹配 Agent"""
        print("[ImgMatcher] 开始匹配图片...")
        self._emit("正在匹配图片到对应段落...", "running")

        prompt_template = load_prompt("imgmatcher")
        image_list = load_image_list(self._description_path)

        prompt = prompt_template.format(
            draft_html=state["cc2_html"],
            image_list=image_list
        )

        response = self.llm_img.invoke(prompt)
        state["img_html"] = response.content

        self._emit("图片匹配完成", "done")
        print(f"[ImgMatcher] 完成，{len(state['img_html'])} 字符")
        return state

    # ---- Format Checker ----

    def _format_checker_node(self, state: ArticleState) -> ArticleState:
        """Agent 5: 格式质检"""
        print("[FormatChecker] 开始格式校验...")
        self._emit("正在检查 HTML 格式规范...", "running")

        prompt_template = load_prompt("checker")
        prompt = prompt_template.format(html_input=state["img_html"])

        response = self.llm_checker.invoke(prompt)
        text = response.content.strip()
        lines = text.split("\n")
        first = lines[0].strip().lower() if lines else "ok"

        if first == "ok":
            html = "\n".join(lines[1:]).strip()
            html = re.sub(r'^```(?:html)?\s*\n?', '', html)
            html = re.sub(r'\n?```\s*$', '', html)
            if html:
                state["final_html"] = html
            else:
                state["final_html"] = state["img_html"]
        else:
            # 格式不符合，降级跳过
            state["final_html"] = state["img_html"]

        self._emit("格式校验完成", "done")
        print(f"[FormatChecker] 完成，输出 {len(state['final_html'])} 字符")
        return state

    # ---- 入口 ----

    def generate(self, original_news: str, knowledge_base: str = "") -> str:
        """生成最终文章，返回 HTML 字符串。

        Raises:
            AgentRejected: CC1/CC2 判定不可继续
        """
        initial_state: ArticleState = {
            "original_news": original_news,
            "knowledge_base": knowledge_base if knowledge_base else "",
            "draft_html": "",
            "cc2_html": "",
            "img_html": "",
            "final_html": ""
        }

        config = {"recursion_limit": 100}
        final_state = self.graph.invoke(initial_state, config=config)

        if not final_state.get("final_html"):
            raise RuntimeError("生成失败：管线未产出有效HTML")

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
        description_path: description.txt 路径
        progress_callback: 进度回调 (stage_name, status)，status 为 "running" 或 "done"
        writer_prompt: 自定义 writer prompt 模板

    Raises:
        AgentRejected: CC1/CC2 判定不可继续
    """
    generator = WechatArticleGenerator(
        description_path=description_path,
        progress_callback=progress_callback,
        writer_prompt=writer_prompt,
    )
    return generator.generate(news_text, knowledge_base)
