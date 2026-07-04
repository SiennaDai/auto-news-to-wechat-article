import re
import json
from bs4 import BeautifulSoup


def clean_llm_output(html_content: str) -> str:
    """清洗 LLM 输出中的代码块标记和多余空白"""
    html_content = re.sub(r'^```(?:html)?\s*\n?', '', html_content, flags=re.IGNORECASE)
    html_content = re.sub(r'\n?```\s*$', '', html_content)
    html_content = html_content.strip()
    return html_content


def apply_inline_styles_to_element(tag, styles: dict):
    """将样式字典应用到标签的内联 style 属性，保留已有样式"""
    existing = tag.get('style', '')
    new_styles = '; '.join([f"{k}: {v}" for k, v in styles.items()])
    if existing:
        tag['style'] = f"{existing}; {new_styles}"
    else:
        tag['style'] = new_styles


def process_article(html_content: str, config: dict) -> str:
    """处理HTML文章，只做基础排版、插入超链接和作者信息（不包含美编装饰）"""

    html_content = clean_llm_output(html_content)
    soup = BeautifulSoup(html_content, 'html.parser')

    # ========== 0. 清理 Writer 残留的 image-placeholder 空占位符 ==========
    for placeholder in soup.find_all('div', class_='image-placeholder'):
        placeholder.decompose()

    # ========== 1. 基础容器样式 ==========
    outer_div = soup.find('div')
    if outer_div:
        apply_inline_styles_to_element(outer_div, {
            'max-width': '677px',
            'margin': '0 auto',
            'padding': '20px'
        })

    # ========== 2. 识别尾图位置 ==========
    tail_img = None
    for img_wrapper in soup.find_all('div', class_=re.compile(r'image-wrapper')):
        img = img_wrapper.find('img')
        if img and ('尾图' in img.get('alt', '') or '尾图' in img.get('src', '')):
            tail_img = img_wrapper
            break

    # ========== 3. 插入超链接 ==========
    if config.get('是否需要超链接', False):
        title = config.get('超链接部分标题', '相关链接')
        links = config.get('超链接列表', [])

        if links:
            links_html = soup.new_tag('div', **{'class': 'links-section'})
            apply_inline_styles_to_element(links_html, {
                'margin': '30px 0 20px 0',
                'padding': '16px 20px',
                'background-color': '#f5f7fa',
                'border-radius': '12px'
            })

            h3_tag = soup.new_tag('h3')
            apply_inline_styles_to_element(h3_tag, {
                'color': '#333',
                'font-size': '16px',
                'margin': '0 0 12px 0',
                'font-weight': '600'
            })
            h3_tag.string = f"\U0001f4ce {title}"
            links_html.append(h3_tag)

            ul_tag = soup.new_tag('ul')
            apply_inline_styles_to_element(ul_tag, {
                'margin': '0',
                'padding-left': '20px',
                'list-style-type': 'none'
            })

            for link in links:
                li_tag = soup.new_tag('li')
                apply_inline_styles_to_element(li_tag, {'margin-bottom': '8px'})
                a_tag = soup.new_tag('a', href=link['url'], target='_blank')
                apply_inline_styles_to_element(a_tag, {
                    'color': '#0066cc',
                    'text-decoration': 'none',
                    'border-bottom': '1px solid #ddd'
                })
                a_tag.string = f"\U0001f517 {link['标题']}"
                li_tag.append(a_tag)
                ul_tag.append(li_tag)

            links_html.append(ul_tag)

            if tail_img:
                tail_img.insert_before(links_html)
            else:
                last_img_wrapper = soup.find_all('div', class_=re.compile(r'image-wrapper'))[-1] if soup.find_all('div', class_=re.compile(r'image-wrapper')) else None
                if last_img_wrapper:
                    last_img_wrapper.insert_after(links_html)
                else:
                    soup.append(links_html)

    # ========== 4. 插入作者信息 ==========
    author_info = config.get('作者信息', {})
    if author_info:
        author_parts = []
        if author_info.get('作者'):
            author_parts.append(f"✍️ 作者：{author_info['作者']}")
        if author_info.get('摄影'):
            author_parts.append(f"\U0001f4f7 摄影：{author_info['摄影']}")
        if author_info.get('责编'):
            author_parts.append(f"\U0001f4cb 责编：{author_info['责编']}")

        if author_parts:
            authors_div = soup.new_tag('div', **{'class': 'author-section'})
            apply_inline_styles_to_element(authors_div, {
                'margin': '20px 0 10px 0',
                'padding-top': '16px',
                'border-top': '1px solid #e0e0e0',
                'text-align': 'center'
            })

            p_tag = soup.new_tag('p')
            apply_inline_styles_to_element(p_tag, {
                'color': '#888',
                'font-size': '12px',
                'margin': '0',
                'line-height': '1.6'
            })
            p_tag.string = " | ".join(author_parts)
            authors_div.append(p_tag)

            if tail_img:
                tail_img.insert_after(authors_div)
            else:
                soup.append(authors_div)

    # ========== 5. 统一图片最大宽度 ==========
    for wrapper in soup.find_all('div', class_=re.compile(r'image-wrapper')):
        style = wrapper.get('style', '') or ''
        style = re.sub(r'max-width:\s*600px', 'max-width: 450px', style)
        style = re.sub(r'width:\s*600px', 'width: 450px', style)
        if style:
            wrapper['style'] = style

    return str(soup)
