# 微信公众号自动排版工具

将原始新闻稿自动转化为微信公众号格式化 HTML 文章。支持 Web 界面实时预览、可视化编辑、用户系统和一键发布。

## 快速开始

```bash
pip install -r requirements.txt

# 配置 .env 文件
# DEEPSEEK_API_KEY=your-key
# JWT_SECRET_KEY=your-secret-min-32-chars

python app.py
# 浏览器打开 http://localhost:5000
```

## 功能概览

- **AI 自动排版**：新闻稿 → 结构化 HTML（LangGraph 三代理流水线：Writer → ImgMatcher → Checker）
- **可视化编辑**：所见即所得编辑器，支持文字编辑、元素排序、图片裁剪/布局切换、装饰样式更换
- **美编系统**：主题色、字体字号、标题框/文本框/分隔线/图片分隔共 24 种装饰样式
- **用户系统**：注册登录、配置模板管理、AI 提示词管理、知识库管理
- **一键发布**：直接推送到微信公众号草稿箱

## 完整技术文档

项目架构、技术栈、文件说明详见 [HELP.md](HELP.md)。

## 使用方式

### Web 界面

1. 启动 `python app.py`，打开浏览器
2. 粘贴新闻稿，上传图片
3. 配置文编（超链接/作者信息）和美编（主题色/装饰样式）
4. 点击「生成推文」，右侧实时预览
5. 开启「编辑模式」进行微调
6. 点击「发布到公众号」或下载 HTML

### 命令行

```bash
python -m src.main
# 输入：data/input/news.txt + data/input/images/
# 输出：data/output/美编后的推文.html
```

## 处理流程

```
图片预处理 → Writer → ImgMatcher → Checker → 文编处理 → 美编装饰 → Base64嵌入
```

| 阶段 | 文件 | 说明 |
|------|------|------|
| 图片预处理 | `img_process.py` | 压缩大图，生成图片清单 |
| AI 流水线 | `words_agents.py` | LangGraph 三代理：Writer 生成 HTML、ImgMatcher 匹配图片、Checker 校验修复 |
| 文编 | `edit.py` | 超链接、作者署名 |
| 美编 | `polish.py` | 主题色装饰（标题框/文本框/分隔线/图片分隔） |

## 编辑器功能

- 单击段落/标题进入文字编辑
- 选中文字添加重点标注（主题色加粗）或超链接
- 图片悬停显示删除/替换/裁剪按钮
- 多图容器可切换布局（单张/并排/轮播）
- 装饰元素可独立更换样式（e 按钮）
- 修改主题色一键重渲所有装饰
- 元素上移/下移/插入/删除

## 项目结构

```
EL/
├── app.py                  # Flask 服务入口
├── backend/                # 用户系统（auth/templates/prompts/knowledge）
├── web/                    # 前端（vanilla JS + CSS）
│   ├── index.html          # 主页面
│   ├── script.js           # 页面编排器
│   ├── editor-core.js      # WYSIWYG 编辑器
│   └── js/                 # 用户系统模块
├── src/                    # 后端流水线
│   ├── main.py             # 入口 + 配置合并
│   ├── words_agents.py     # AI 代理流水线
│   ├── edit.py             # 文编处理
│   ├── polish.py           # 美编装饰
│   └── wechat_api.py       # 微信 API
├── config/                 # 默认配置 + 装饰库
├── prompts/                # AI 提示词模板
└── data/                   # 输入/输出/知识库/数据库
```

## 环境变量

| 变量 | 说明 |
|------|------|
| `DEEPSEEK_API_KEY` | DeepSeek API 密钥 |
| `DEEPSEEK_BASE_URL` | API 地址（默认 `https://api.deepseek.com/v1`） |
| `JWT_SECRET_KEY` | JWT 签名密钥（至少 32 字符） |
| `JWT_EXPIRES_DAYS` | Token 有效期天数（默认 7） |
