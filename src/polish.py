import json
import re
from pathlib import Path
from bs4 import BeautifulSoup
from typing import Dict, Any
import random

from src.utils import get_decoration_db_path


class DecorationPolisher:
    """应用美编装饰的处理器"""

    def __init__(self, decoration_db_path: str = None):
        if decoration_db_path is None:
            decoration_db_path = str(get_decoration_db_path())
        with open(decoration_db_path, 'r', encoding='utf-8') as f:
            self.decorations = json.load(f)

    def _hex_to_rgba(self, hex_color: str, alpha: float) -> str:
        """将十六进制颜色转换为 rgba"""
        hex_color = hex_color.lstrip('#')
        if len(hex_color) == 3:
            hex_color = ''.join([c*2 for c in hex_color])
        r = int(hex_color[0:2], 16)
        g = int(hex_color[2:4], 16)
        b = int(hex_color[4:6], 16)
        return f"rgba({r}, {g}, {b}, {alpha})"

    def _apply_theme_colors(self, text: str, primary_color: str) -> str:
        """将文本中的颜色变量替换为主题色"""
        replacements = {
            '{primary}': primary_color,
            '{primary}04': self._hex_to_rgba(primary_color, 0.04),
            '{primary}05': self._hex_to_rgba(primary_color, 0.05),
            '{primary}06': self._hex_to_rgba(primary_color, 0.06),
            '{primary}08': self._hex_to_rgba(primary_color, 0.08),
            '{primary}10': self._hex_to_rgba(primary_color, 0.10),
            '{primary}12': self._hex_to_rgba(primary_color, 0.12),
            '{primary}15': self._hex_to_rgba(primary_color, 0.15),
            '{primary}20': self._hex_to_rgba(primary_color, 0.20),
            '{primary}25': self._hex_to_rgba(primary_color, 0.25),
            '{primary}30': self._hex_to_rgba(primary_color, 0.30),
            '{primary}40': self._hex_to_rgba(primary_color, 0.40),
            '{primary}50': self._hex_to_rgba(primary_color, 0.50),
            '{white}': '#ffffff'
        }

        result = text
        for key, value in replacements.items():
            result = result.replace(key, value)

        return result

    def apply_strong_tags(self, soup: BeautifulSoup, primary_color: str) -> BeautifulSoup:
        """为所有 strong 标签应用主题色和加粗样式"""
        for strong in soup.find_all('strong'):
            current_style = strong.get('style', '')
            if 'font-weight' not in current_style:
                current_style = f"{current_style}; font-weight: 700"
            current_style = re.sub(
                r'color:\s*[^;]+;',
                f'color: {primary_color};',
                current_style
            )
            if 'color' not in current_style:
                current_style = f"{current_style}; color: {primary_color}"
            current_style = re.sub(r';+', ';', current_style)
            current_style = current_style.strip(';')
            strong['style'] = current_style

        return soup

    def apply_title_box(self, soup: BeautifulSoup, title_box_id: str, primary_color: str, title_font_sizes: dict) -> BeautifulSoup:
        """为所有标题应用标题框装饰"""
        title_box_config = next((item for item in self.decorations['title_box'] if item['id'] == title_box_id), None)
        if not title_box_config:
            return soup

        for h_tag in soup.find_all(['h1', 'h2', 'h3']):
            original_text = h_tag.get_text()
            tag_name = h_tag.name
            font_size = title_font_sizes.get(tag_name, '18px')

            existing_style = h_tag.get('style', '')
            color_match = re.search(r'color:\s*([^;]+)', existing_style)
            title_color = color_match.group(1) if color_match else primary_color

            box_style = self._apply_theme_colors(title_box_config['style'], primary_color)
            title_style = self._apply_theme_colors(title_box_config['title_style'], primary_color)
            title_style = title_style.replace('{title_color}', title_color)
            title_style = title_style.replace('font-size: inherit', f'font-size: {font_size}')
            box_style = re.sub(r';+', ';', box_style).strip(';')
            title_style = re.sub(r';+', ';', title_style).strip(';')

            new_html = f'<div style="{box_style}" data-el-type="title_box" data-el-id="{title_box_id}"><{tag_name} style="{title_style}">{original_text}</{tag_name}></div>'

            new_soup = BeautifulSoup(new_html, 'html.parser')
            h_tag.replace_with(new_soup)

        return soup

    def apply_text_box(self, soup: BeautifulSoup, text_box_id: str, primary_color: str) -> BeautifulSoup:
        """为段落应用文字框装饰，保留内部 HTML 结构（如 strong 标签）"""
        text_box_config = next((item for item in self.decorations['text_box'] if item['id'] == text_box_id), None)
        if not text_box_config:
            return soup

        for p in soup.find_all('p'):
            text_length = len(p.get_text(strip=True))
            if text_length < 100:
                continue

            if p.parent and p.parent.get('class') and 'text-box-applied' in p.parent.get('class'):
                continue

            existing_style = p.get('style', '')
            indent_match = re.search(r'text-indent:\s*([^;]+)', existing_style)
            text_indent = indent_match.group(0) if indent_match else 'text-indent: 2em'

            inner_html = ''.join(str(child) for child in p.children)

            box_style = self._apply_theme_colors(text_box_config['style'], primary_color)
            inner_style = self._apply_theme_colors(text_box_config['inner_style'], primary_color)
            inner_style = inner_style.replace('text-indent: 2em', text_indent)
            box_style = re.sub(r';+', ';', box_style).strip(';')
            inner_style = re.sub(r';+', ';', inner_style).strip(';')

            new_html = f'<div class="text-box-applied" style="{box_style}" data-el-type="text_box" data-el-id="{text_box_id}"><p style="{inner_style}">{inner_html}</p></div>'

            new_soup = BeautifulSoup(new_html, 'html.parser')
            p.replace_with(new_soup)

        return soup

    def apply_divider(self, soup: BeautifulSoup, divider_id: str, primary_color: str) -> BeautifulSoup:
        """在合适位置插入分隔符"""
        divider_config = next((item for item in self.decorations['divider'] if item['id'] == divider_id), None)
        if not divider_config:
            return soup

        html = self._apply_theme_colors(divider_config['html'], primary_color)
        html = html.replace('<div ', f'<div data-el-type="divider" data-el-id="{divider_id}" ')

        for h2 in soup.find_all('h2'):
            prev = h2.find_previous_sibling()
            if prev and prev.name == 'div' and 'divider' in str(prev.get('style', '')):
                continue
            h2.insert_before(BeautifulSoup(html, 'html.parser'))

        return soup

    def apply_image_separator(self, soup: BeautifulSoup, image_separator_id: str, primary_color: str) -> BeautifulSoup:
        """在图片上方和下方插入分隔符"""
        separator_config = next((item for item in self.decorations['image_separator'] if item['id'] == image_separator_id), None)
        if not separator_config:
            return soup

        html_top = self._apply_theme_colors(separator_config['html_top'], primary_color) if separator_config.get('html_top') else ''
        html_bottom = self._apply_theme_colors(separator_config['html_bottom'], primary_color) if separator_config.get('html_bottom') else ''
        if html_top:
            html_top = html_top.replace('<div ', f'<div data-el-type="image_separator" data-el-id="{image_separator_id}" ')
        if html_bottom:
            html_bottom = html_bottom.replace('<div ', f'<div data-el-type="image_separator" data-el-id="{image_separator_id}" ')

        for wrapper in soup.find_all('div', class_=re.compile(r'image-wrapper')):
            if 'single' in wrapper.get('class', []):
                if html_top:
                    wrapper.insert_before(BeautifulSoup(html_top, 'html.parser'))
                if html_bottom:
                    wrapper.insert_after(BeautifulSoup(html_bottom, 'html.parser'))

        return soup

    def apply_link_section_style(self, soup: BeautifulSoup, primary_color: str) -> BeautifulSoup:
        """应用超链接模块的主题色"""
        links_section = soup.find('div', class_='links-section')
        if links_section:
            style = links_section.get('style', '')
            style = re.sub(
                r'background-color:\s*[^;]+;',
                f'background-color: {self._hex_to_rgba(primary_color, 0.06)};',
                style
            )
            style = re.sub(r';+', ';', style).strip(';')
            links_section['style'] = style

            h3 = links_section.find('h3')
            if h3:
                h3_style = h3.get('style', '')
                h3_style = re.sub(
                    r'color:\s*[^;]+;',
                    f'color: {primary_color};',
                    h3_style
                )
                h3_style = re.sub(r';+', ';', h3_style).strip(';')
                h3['style'] = h3_style

            for a in links_section.find_all('a'):
                a_style = a.get('style', '')
                a_style = re.sub(
                    r'color:\s*[^;]+;',
                    f'color: {primary_color};',
                    a_style
                )
                a_style = re.sub(r';+', ';', a_style).strip(';')
                a['style'] = a_style

        return soup

    def apply_author_section_style(self, soup: BeautifulSoup, primary_color: str) -> BeautifulSoup:
        """应用作者信息模块的主题色"""
        author_section = soup.find('div', class_='author-section')
        if author_section:
            style = author_section.get('style', '')
            style = re.sub(
                r'border-top:\s*[^;]+;',
                f'border-top: 1px solid {self._hex_to_rgba(primary_color, 0.20)};',
                style
            )
            style = re.sub(r';+', ';', style).strip(';')
            author_section['style'] = style

        return soup

    def apply_global_styles(self, soup: BeautifulSoup, config: dict) -> BeautifulSoup:
        """应用全局样式"""
        outer_div = soup.find('div')
        if outer_div:
            current_style = outer_div.get('style', '')

            if '字体' in config and 'font-family' not in current_style:
                current_style = f"{current_style}; font-family: {config['字体']}"
            if '正文颜色' in config and 'color' not in current_style:
                current_style = f"{current_style}; color: {config['正文颜色']}"
            if '正文字号' in config and 'font-size' not in current_style:
                current_style = f"{current_style}; font-size: {config['正文字号']}"
            if '行距' in config and 'line-height' not in current_style:
                current_style = f"{current_style}; line-height: {config['行距']}"

            current_style = re.sub(r';+', ';', current_style).strip(';')
            outer_div['style'] = current_style

        return soup

    def apply_complete_style_set(self, soup: BeautifulSoup, style_set: Dict[str, str], primary_color: str, title_font_sizes: dict) -> BeautifulSoup:
        """应用完整的美编套组"""
        soup = self.apply_divider(soup, style_set['divider'], primary_color)
        soup = self.apply_strong_tags(soup, primary_color)
        soup = self.apply_title_box(soup, style_set['title_box'], primary_color, title_font_sizes)
        soup = self.apply_text_box(soup, style_set['text_box'], primary_color)
        soup = self.apply_image_separator(soup, style_set.get('image_separator', 'image_separator_004'), primary_color)
        soup = self.apply_link_section_style(soup, primary_color)
        soup = self.apply_author_section_style(soup, primary_color)
        return soup

    def get_random_decorations(self) -> Dict[str, str]:
        """随机获取一套装饰组合"""
        return {
            'title_box': random.choice(self.decorations['title_box'])['id'],
            'text_box': random.choice(self.decorations['text_box'])['id'],
            'divider': random.choice(self.decorations['divider'])['id'],
            'image_separator': random.choice(self.decorations['image_separator'])['id']
        }


def polish_article(html_content: str, config: Dict[str, Any]) -> str:
    """主函数：对文章应用装饰"""

    soup = BeautifulSoup(html_content, 'html.parser')

    polisher = DecorationPolisher()

    primary_color = config.get('主题色', '#003366')

    title_font_sizes = config.get('标题字号列表', {'h1': '24px', 'h2': '18px', 'h3': '16px'})

    if config.get('是否使用已有套组', False):
        style_set = config['装饰套组']
    else:
        style_set = polisher.get_random_decorations()

    soup = polisher.apply_global_styles(soup, config)
    soup = polisher.apply_complete_style_set(soup, style_set, primary_color, title_font_sizes)

    return str(soup)
