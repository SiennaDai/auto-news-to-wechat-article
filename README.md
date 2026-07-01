# 微信公众号全自动排版工具

将原始新闻稿自动转化为微信公众号格式化 HTML 文章。支持 Web 界面实时预览、可视化编辑、用户系统和一键发布到微信草稿箱。

## 快速开始

```bash
# 克隆仓库
git clone https://github.com/SiennaDai/auto-news-to-wechat-article.git
cd auto-news-to-wechat-article

# 安装依赖
pip install -r requirements.txt

# 创建 .env 文件并填入你的 API Key（参考下方环境变量说明）

# 启动服务
python app.py
# 浏览器打开 http://localhost:5000
```

## 环境变量

在项目根目录创建 `.env` 文件：

| 变量 | 说明 | 示例 |
|------|------|------|
| `DEEPSEEK_API_KEY` | DeepSeek API 密钥 | `sk-xxxxxxxx` |
| `DEEPSEEK_BASE_URL` | API 地址（可选） | `https://api.deepseek.com/v1` |
| `JWT_SECRET_KEY` | JWT 签名密钥 | 至少 32 字符的随机字符串 |
| `JWT_EXPIRES_DAYS` | Token 有效期（可选） | `7` |

## 功能概览

### 内容质量与审核
- **输入审核**：Filter Agent 在生成前审核输入内容的合规性和新闻体裁，分 ok/warn/no 三级响应
- **拒答检测**：CC1 Agent 检测 AI 平台是否拒绝生成，拒绝时直接反馈原因给用户
- **事实校验**：CC2 Agent 将生成内容与原始新闻稿交叉验证，自动修正人名、数字、日期等幻觉
- **格式校验**：Format Checker 独立检查 HTML 标签、层级、样式规范并自动修复

### AI 自动排版
- 五代理流水线（LangGraph）：Writer → CC1 → CC2 → ImgMatcher → Format Checker
- 三档温度配置：Writer 0.6（创作）、ImgMatcher 0.3（语义匹配）、Checker 0.1（稳定校验）
- 自动处理标题层级、段落缩进、重点标注、图片排版
- 支持自定义 AI 提示词和知识库参考

### 美编装饰系统
- 主题色、字体、字号、行距全局配置
- 6 种标题框样式、6 种文本框样式、6 种分隔线样式、6 种图片分隔样式
- 装饰样式可独立更换，修改主题色一键重渲

### 可视化编辑器
- 所见即所得编辑：单击段落/标题进入文字编辑
- 选中文字添加重点标注（主题色加粗）、取消标注或超链接
- 图片悬停显示删除/替换/裁剪按钮，支持自由裁剪和比例锁定
- 多图容器布局切换（单张 / 并排 / 轮播）
- 元素上移/下移/插入/删除

### 用户系统
- JWT 注册登录，7 天有效期
- 配置模板保存与加载（一键恢复排版设置）
- 自定义 AI 提示词管理（写作风格模板）
- 知识库管理（上传参考资料辅助 AI 生成）

### 一键发布
- 直接推送到微信公众号草稿箱
- 自动上传图片、裁剪适配、创建草稿
- 支持获取预览链接或直接发布

## 使用方式

### Web 界面（推荐）

1. 启动 `python app.py`，浏览器打开 `http://localhost:5000`
2. 粘贴新闻稿文本，上传配图
3. 配置文编（超链接、作者信息）和美编（主题色、装饰样式）
4. 点击「生成推文」，右侧实时预览生成过程
5. 开启「编辑模式」微调内容和样式
6. 点击「发布到公众号」或下载 HTML

### 命令行

```bash
python -m src.main
# 输入：data/input/news.txt + data/input/images/
# 输出：data/output/美编后的推文.html
```

## 处理流程

```
Filter → Writer → CC1 → CC2 → ImgMatcher → Format Checker → 文编处理 → 美编装饰 → Base64 嵌入
```

| 阶段 | 模块 | 说明 |
|------|------|------|
| Filter | `src/agents/filter.py` | 输入审核：内容安全 + 新闻体裁判断（ok/warn/no） |
| Writer | `src/words_agents.py` | 新闻稿 → 结构化 HTML 纪实文章 |
| CC1 | `src/agents/cc1.py` | API 拒答检测：判断 Writer 输出是否为 AI 拒绝消息 |
| CC2 | `src/agents/cc2.py` | 事实交叉验证：修正人名、数字、日期等幻觉 |
| ImgMatcher | `src/words_agents.py` | 语义匹配图片到对应段落，自动选择布局 |
| Format Checker | `src/words_agents.py` | HTML 标签、层级、样式规范校验与修复 |
| 文编 | `src/edit.py` | 超链接替换、作者署名 |
| 美编 | `src/polish.py` | 主题色装饰应用（标题框/文本框/分隔线/图片分隔） |
| 图片预处理 | `src/img_process.py` | 压缩大图（长边 1280px），生成图片清单 |
| 发布 | `src/wechat_api.py` | 图片上传、草稿创建、发布 |

## 项目结构

```
├── app.py                    # Flask 服务入口（SSE 流式响应、REST API、Filter 预检）
├── backend/                  # 用户系统
│   ├── auth.py               # JWT + bcrypt 认证装饰器
│   ├── database.py           # SQLite 数据库初始化
│   ├── models.py             # Pydantic 请求验证
│   └── routes/               # API 路由（auth/templates/prompts/knowledge）
├── web/                      # 前端（vanilla JS）
│   ├── index.html            # 主页面
│   ├── style.css             # 页面样式
│   ├── script.js             # 页面编排器（SSE、postMessage 桥接、审核弹窗）
│   ├── editor-core.js        # WYSIWYG 编辑器
│   ├── editor-core.css       # 编辑器样式
│   └── js/                   # 用户系统模块（api/auth/templates/prompts/knowledge）
├── src/                      # 后端流水线
│   ├── main.py               # 入口 + 前后端配置合并
│   ├── words_agents.py       # LangGraph AI 代理流水线（5 代理 + 3 温度配置）
│   ├── agents/               # 内容审核代理
│   │   ├── filter.py         # Filter Agent：输入合规 + 新闻体裁审核
│   │   ├── cc1.py            # CC1 Agent：API 拒答消息检测
│   │   └── cc2.py            # CC2 Agent：事实交叉验证，修正幻觉
│   ├── edit.py               # 文编后处理
│   ├── polish.py             # 美编装饰应用
│   ├── img_process.py        # 图片压缩处理
│   ├── wechat_api.py         # 微信公众号 API 封装
│   └── utils.py              # 路径工具
├── config/                   # 配置文件
│   ├── information.json      # 默认文编/美编配置
│   └── decoration_base.json  # 装饰模板库（4 类 × 各 6 种样式）
├── prompts/                  # AI 代理系统提示词
│   ├── filter.txt            # Filter Agent 提示词
│   ├── writer.txt            # Writer Agent 提示词（格式规则层，系统锁定）
│   ├── user_preferences.txt  # 用户风格偏好（默认，可编辑）
│   ├── cc1.txt               # CC1 Agent 提示词
│   ├── cc2.txt               # CC2 Agent 提示词
│   ├── imgmatcher.txt        # ImgMatcher Agent 提示词
│   └── checker.txt           # Format Checker 提示词（纯格式校验）
└── data/                     # 运行时数据
    ├── input/                # CLI 模式输入
    └── output/               # 生成输出（gitignored）
```

## 技术栈

- **后端**：Python 3.10+ / Flask / LangGraph / LangChain
- **AI 模型**：DeepSeek（可配置其他 OpenAI 兼容模型）
- **前端**：Vanilla JavaScript / CSS（零框架依赖）
- **数据库**：SQLite
- **认证**：JWT + bcrypt

## License

MIT
