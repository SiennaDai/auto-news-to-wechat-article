"""统一路径管理，所有路径基于项目根目录计算。"""

from pathlib import Path


def get_project_root() -> Path:
    """返回项目根目录（src/ 的父目录）"""
    return Path(__file__).resolve().parent.parent


def ensure_dirs() -> None:
    """确保必要的目录存在"""
    root = get_project_root()
    (root / "data" / "output").mkdir(parents=True, exist_ok=True)
    (root / "data" / "input").mkdir(parents=True, exist_ok=True)


def get_news_path() -> Path:
    return get_project_root() / "data" / "input" / "news.txt"


def get_images_input_dir() -> Path:
    return get_project_root() / "data" / "input" / "images"


def get_description_path() -> Path:
    return get_project_root() / "data" / "output" / "description.txt"


def get_output_path() -> Path:
    return get_project_root() / "data" / "output" / "output.html"


def get_config_path() -> Path:
    return get_project_root() / "config" / "information.json"


def get_decoration_db_path() -> Path:
    return get_project_root() / "config" / "decoration_base.json"


def get_prompt_path(name: str) -> Path:
    return get_project_root() / "prompts" / f"{name}.txt"


def load_prompt(name: str) -> str:
    """加载 prompts 目录下的 prompt 模板"""
    prompt_file = get_prompt_path(name)
    if not prompt_file.exists():
        raise FileNotFoundError(f"Prompt 文件不存在: {prompt_file}")
    with open(prompt_file, "r", encoding="utf-8") as f:
        return f.read()
