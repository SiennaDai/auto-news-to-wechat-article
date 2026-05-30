"""
img_process.py - 图片处理 Agent
职责：
1. 压缩超大图片（>2MB）
2. 提取 images 文件夹内的所有 .jpg 文件名，生成 description.txt
"""

from pathlib import Path
from typing import List, Optional
from PIL import Image

from src.utils import get_images_input_dir, get_description_path


class ImageProcessAgent:
    """图片处理 Agent - 压缩与文件名提取"""

    _supported_formats = {'.jpg', '.jpeg'}

    def __init__(self, max_size_mb: int = 2, images_dir: str = None, description_path: str = None):
        """
        初始化图片处理 Agent

        Args:
            max_size_mb: 压缩阈值（MB），超过此大小的图片将被压缩
            images_dir: 图片目录路径，默认使用 data/input/images/
            description_path: description.txt 输出路径，默认使用 data/output/description.txt
        """
        self.images_dir = Path(images_dir) if images_dir else get_images_input_dir()
        self.description_path = Path(description_path) if description_path else get_description_path()
        self.max_size_bytes = max_size_mb * 1024 * 1024

    def _is_supported_image(self, filepath: Path) -> bool:
        """检查是否为支持的图片格式（仅 .jpg）"""
        return filepath.suffix.lower() in self._supported_formats

    def _get_file_size_mb(self, filepath: Path) -> float:
        """获取文件大小（MB）"""
        return filepath.stat().st_size / (1024 * 1024)

    def _compress_image(self, filepath: Path, target_long_edge: int = 1280, quality: int = 85) -> Optional[Path]:
        """
        压缩单张图片

        Args:
            filepath: 原图路径
            target_long_edge: 压缩后长边像素（微信建议 1280px）
            quality: JPEG 压缩质量（1-100）

        Returns:
            压缩后的文件路径，如果无需压缩或压缩失败返回 None
        """
        try:
            img = Image.open(filepath)

            width, height = img.size
            if width > target_long_edge or height > target_long_edge:
                if width >= height:
                    new_width = target_long_edge
                    new_height = int(height * target_long_edge / width)
                else:
                    new_height = target_long_edge
                    new_width = int(width * target_long_edge / height)
                img = img.resize((new_width, new_height), Image.Resampling.LANCZOS)

            img.save(filepath, 'JPEG', quality=quality, optimize=True)
            return filepath

        except Exception:
            return None

    def _compress_images_in_dir(self) -> List[Path]:
        """
        压缩目录中所有超大图片

        Returns:
            被压缩的图片路径列表
        """
        compressed = []

        for filepath in self.images_dir.iterdir():
            if not filepath.is_file():
                continue
            if not self._is_supported_image(filepath):
                continue

            if self._get_file_size_mb(filepath) > self.max_size_bytes:
                if self._compress_image(filepath):
                    compressed.append(filepath)

        return compressed

    def _extract_filenames_to_txt(self) -> Path:
        """
        提取所有 .jpg 文件名到 description.txt

        Returns:
            生成的 txt 文件路径
        """
        output_file = self.description_path
        filenames = []

        for filepath in sorted(self.images_dir.iterdir()):
            if not filepath.is_file():
                continue
            if not self._is_supported_image(filepath):
                continue
            filenames.append(filepath.name)

        with open(output_file, 'w', encoding='utf-8') as f:
            for name in filenames:
                f.write(name + '\n')

        return output_file

    # ==================== 公共方法 ====================

    def compress_overlarge_images(self) -> List[Path]:
        """压缩超大图片，返回被压缩的文件列表"""
        if not self.images_dir.exists():
            return []
        return self._compress_images_in_dir()

    def generate_description_file(self) -> Path:
        """
        生成文件名描述文件

        Returns:
            生成的 txt 文件路径
        """
        if not self.images_dir.exists():
            raise FileNotFoundError(f"images 目录不存在: {self.images_dir}")

        return self._extract_filenames_to_txt()


def process_images() -> List[Path]:
    """
    便捷函数：压缩超大图片并生成 description.txt（使用默认路径）

    Returns:
        被压缩的图片路径列表
    """
    agent = ImageProcessAgent(max_size_mb=2)
    compressed = agent.compress_overlarge_images()
    agent.generate_description_file()
    return compressed


def process_images_in_dir(images_dir: str, description_path: str) -> List[Path]:
    """
    便捷函数：处理指定目录中的图片

    Args:
        images_dir: 图片所在目录路径
        description_path: description.txt 输出路径

    Returns:
        被压缩的图片路径列表
    """
    agent = ImageProcessAgent(max_size_mb=2, images_dir=images_dir, description_path=description_path)
    compressed = agent.compress_overlarge_images()
    agent.generate_description_file()
    return compressed
