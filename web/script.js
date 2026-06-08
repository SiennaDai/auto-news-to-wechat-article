// ==================== Editor State ====================

let editMode = false;
let originalHtml = null;

// ==================== 页面初始化 ====================

document.addEventListener('DOMContentLoaded', async () => {
  await loadDefaultConfig();
  bindEvents();
  bindEditorEvents();
  bindPostMessage();
  document.getElementById('editToggle').checked = false;

  // Init user system
  await window.EL.Auth.init();
  window.EL.UserUI.refresh();
  bindTemplateSection();
  refreshTemplateSelector();
  refreshKBSelector();
});

window.addEventListener('user-changed', function () {
  refreshTemplateSelector();
  refreshKBSelector();
});

async function loadDefaultConfig() {
  try {
    const [configRes, decoRes] = await Promise.all([
      fetch('/api/default-config'),
      fetch('/api/decoration-options')
    ]);
    const config = await configRes.json();
    const decorations = await decoRes.json();

    // 文编
    const wen = config.文编 || {};
    document.getElementById('hasLinks').checked = wen.是否需要超链接 || false;
    document.getElementById('linksTitle').value = wen.超链接部分标题 || '相关链接';
    document.getElementById('author').value = (wen.作者信息 || {}).作者 || '';
    document.getElementById('photographer').value = (wen.作者信息 || {}).摄影 || '';
    document.getElementById('editor').value = (wen.作者信息 || {}).责编 || '';
    toggleLinksOptions();

    if (wen.超链接列表) {
      const container = document.getElementById('linksList');
      container.innerHTML = '';
      wen.超链接列表.forEach(link => addLinkRow(link.标题, link.url));
    }

    // 美编
    const mei = config.美编 || {};
    document.getElementById('themeColor').value = mei.主题色 || '#003366';
    document.getElementById('textColor').value = mei.正文颜色 || '#3e3e3e';
    document.getElementById('fontFamily').value = mei.字体 || "system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif";
    document.getElementById('fontSize').value = mei.正文字号 || '15px';
    document.getElementById('lineHeight').value = mei.行距 || '1.8';
    const titleSizes = mei.标题字号列表 || {};
    document.getElementById('h1Size').value = titleSizes.h1 || '24px';
    document.getElementById('h2Size').value = titleSizes.h2 || '18px';
    document.getElementById('h3Size').value = titleSizes.h3 || '16px';
    populateSelect('titleBox', decorations.title_box || [], (mei.装饰套组 || {}).title_box);
    populateSelect('textBox', decorations.text_box || [], (mei.装饰套组 || {}).text_box);
    populateSelect('divider', decorations.divider || [], (mei.装饰套组 || {}).divider);
    populateSelect('imageSep', decorations.image_separator || [], (mei.装饰套组 || {}).image_separator);
    window._decoOptions = decorations;
  } catch (e) {
    console.error('加载默认配置失败:', e);
  }
}

function populateSelect(selectId, options, selectedId) {
  const select = document.getElementById(selectId);
  select.innerHTML = '';
  options.forEach(opt => {
    const el = document.createElement('option');
    el.value = opt.id;
    el.textContent = opt.name || opt.id;
    if (opt.id === selectedId) el.selected = true;
    select.appendChild(el);
  });
}

// ==================== 事件绑定 ====================

const NEWS_MAX_LEN = 50000;

function bindEvents() {
  document.getElementById('generateBtn').addEventListener('click', generateArticle);
  document.getElementById('copyBtn').addEventListener('click', copyHTML);
  document.getElementById('downloadBtn').addEventListener('click', downloadHTML);
  document.getElementById('clearBtn').addEventListener('click', clearForm);
  document.getElementById('publishBtn').addEventListener('click', openPublishDialog);
  document.getElementById('hasLinks').addEventListener('change', toggleLinksOptions);
  document.getElementById('addLink').addEventListener('click', () => addLinkRow('', ''));
  document.getElementById('imageUpload').addEventListener('change', updateImagePreview);

  const newsText = document.getElementById('newsText');
  newsText.addEventListener('input', function () {
    var len = newsText.value.length;
    var cc = document.getElementById('charCount');
    cc.textContent = len + ' / ' + NEWS_MAX_LEN;
    cc.style.color = len > NEWS_MAX_LEN * 0.9 ? '#e74c3c' : '#999';
  });

  document.querySelectorAll('.config-toggle').forEach(toggle => {
    toggle.addEventListener('click', () => {
      const target = document.getElementById(toggle.dataset.target);
      target.style.display = target.style.display === 'none' ? 'block' : 'none';
      toggle.textContent = toggle.textContent.replace('▾', target.style.display === 'none' ? '▸' : '▾');
    });
  });

}

function toggleLinksOptions() {
  document.getElementById('linksOptions').style.display =
    document.getElementById('hasLinks').checked ? 'block' : 'none';
}

// ==================== 图片预览 ====================

function updateImagePreview() {
  const input = document.getElementById('imageUpload');
  const list = document.getElementById('imageList');
  list.innerHTML = '';
  Array.from(input.files).forEach(f => {
    const li = document.createElement('li');
    li.textContent = f.name + ' (' + formatBytes(f.size) + ')';
    list.appendChild(li);
  });
}

function formatBytes(bytes) {
  if (bytes < 1024) return bytes + ' B';
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
  return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
}

// ==================== 链接管理 ====================

function addLinkRow(title, url) {
  const container = document.getElementById('linksList');
  const row = document.createElement('div');
  row.className = 'link-row';
  row.innerHTML = `
    <input type="text" class="link-title" placeholder="标题" value="${escapeHtml(title)}">
    <input type="url" class="link-url" placeholder="URL" value="${escapeHtml(url)}">
    <button type="button" class="btn-remove-link" title="删除">×</button>
  `;
  row.querySelector('.btn-remove-link').addEventListener('click', () => {
    if (container.children.length > 1) row.remove();
  });
  container.appendChild(row);
}

function escapeHtml(str) {
  const el = document.createElement('span');
  el.textContent = str;
  return el.innerHTML;
}

// ==================== 构建配置 ====================

function buildConfig() {
  const config = {};

  const hasLinks = document.getElementById('hasLinks').checked;
  config.has_links = hasLinks;
  if (hasLinks) {
    config.links_title = document.getElementById('linksTitle').value;
    config.links = [];
    document.querySelectorAll('#linksList .link-row').forEach(row => {
      const title = row.querySelector('.link-title').value.trim();
      const url = row.querySelector('.link-url').value.trim();
      if (title && url) config.links.push({ '标题': title, url });
    });
  }
  config.author = document.getElementById('author').value;
  config.photographer = document.getElementById('photographer').value;
  config.editor = document.getElementById('editor').value;

  config.theme_color = document.getElementById('themeColor').value;
  config.text_color = document.getElementById('textColor').value;
  config.font_family = document.getElementById('fontFamily').value;
  config.font_size = document.getElementById('fontSize').value;
  config.line_height = document.getElementById('lineHeight').value;
  config.title_font_sizes = {
    h1: document.getElementById('h1Size').value,
    h2: document.getElementById('h2Size').value,
    h3: document.getElementById('h3Size').value
  };
  config.decoration_set = {
    title_box: document.getElementById('titleBox').value,
    text_box: document.getElementById('textBox').value,
    divider: document.getElementById('divider').value,
    image_separator: document.getElementById('imageSep').value
  };

  return config;
}

// ==================== 模板选择器 ====================

function refreshTemplateSelector() {
  var select = document.getElementById('elTemplateSelect');
  if (!select) return;

  if (!window.EL.Auth.isLoggedIn()) {
    select.innerHTML = '<option value="">登录后可选择模板</option>';
    return;
  }

  window.EL.Templates.list().then(function (templates) {
    var html = '<option value="">-- 选择模板 --</option>';
    templates.forEach(function (t) {
      var sel = t.id === window.AppState.currentTemplateId ? ' selected' : '';
      html += '<option value="' + t.id + '"' + sel + '>' + escapeHtml(t.name) + '</option>';
    });
    select.innerHTML = html;
  }).catch(function () {
    select.innerHTML = '<option value="">加载失败</option>';
  });
}

function bindTemplateSection() {
  var select = document.getElementById('elTemplateSelect');
  var loadBtn = document.getElementById('elTemplateLoad');
  var clearBtn = document.getElementById('elTemplateClear');

  if (!loadBtn || !clearBtn) return;

  loadBtn.addEventListener('click', async function () {
    var id = select.value;
    if (!id) { showToast('请先选择一个模板', 'error'); return; }
    try {
      var config = await window.EL.Templates.loadConfig(parseInt(id));
      window.EL.UserUI.fillFormFromConfig(config);
      window.AppState.currentTemplateId = parseInt(id);
      showToast('模板已加载', 'success');
    } catch (err) {
      showToast('加载模板失败', 'error');
    }
  });

  clearBtn.addEventListener('click', function () {
    window.AppState.currentTemplateId = null;
    select.value = '';
    showToast('已清除模板选择', 'success');
  });
}

// ==================== 知识库选择器 ====================

function refreshKBSelector() {
  var container = document.getElementById('elKBList');
  if (!container) return;

  if (!window.EL.Auth.isLoggedIn()) {
    container.innerHTML = '<span style="color:#999;font-size:13px">登录后可选择知识库</span>';
    return;
  }

  window.EL.Knowledge.listBases().then(function (bases) {
    if (bases.length === 0) {
      container.innerHTML = '<span style="color:#999;font-size:13px">暂无知识库，请先创建</span>';
      return;
    }

    var selected = window.AppState.selectedKBIds || [];
    var html = '';
    bases.forEach(function (kb) {
      var checked = selected.indexOf(kb.id) !== -1 ? ' checked' : '';
      var size = kb.total_chars ? (kb.total_chars / 1024).toFixed(1) + 'KB' : '0KB';
      html +=
        '<label class="el-kb-checkbox" style="display:flex;align-items:center;margin-bottom:4px;cursor:pointer;font-size:13px">' +
        '  <input type="checkbox" class="el-kb-cb" data-id="' + kb.id + '"' + checked + ' style="margin-right:6px">' +
        '  ' + escapeHtml(kb.name) + ' <span style="color:#999;margin-left:4px;font-size:11px">(' + size + ')</span>' +
        '</label>';
    });
    container.innerHTML = html;

    // Bind change events
    container.querySelectorAll('.el-kb-cb').forEach(function (cb) {
      cb.addEventListener('change', function () {
        var id = parseInt(this.dataset.id);
        if (this.checked) {
          if (window.AppState.selectedKBIds.length >= 5) {
            this.checked = false;
            showToast('最多选择5个知识库', 'error');
            return;
          }
          window.AppState.selectedKBIds.push(id);
        } else {
          var idx = window.AppState.selectedKBIds.indexOf(id);
          if (idx !== -1) window.AppState.selectedKBIds.splice(idx, 1);
        }
      });
    });
  }).catch(function () {
    container.innerHTML = '<span style="color:#999;font-size:13px">加载失败</span>';
  });
}

// ==================== SSE 流式生成 ====================

async function generateArticle() {
  const newsText = document.getElementById('newsText').value.trim();
  if (!newsText) {
    showToast('请输入新闻稿文本', 'error');
    return;
  }
  if (newsText.length > NEWS_MAX_LEN) {
    showToast('新闻稿文本超过字数上限（' + NEWS_MAX_LEN + '字）', 'error');
    return;
  }

  const formData = new FormData();
  formData.append('news_text', newsText);
  formData.append('config', JSON.stringify(buildConfig()));

  // Pass template_id if a template is loaded
  if (window.AppState && window.AppState.currentTemplateId) {
    formData.append('template_id', window.AppState.currentTemplateId);
  }

  // Pass prompt_id or custom prompt content
  if (window.AppState && window.AppState.currentPromptId) {
    formData.append('prompt_id', window.AppState.currentPromptId);
  } else if (window.AppState && window.AppState.promptContent) {
    formData.append('prompt_content', window.AppState.promptContent);
  }

  // Pass selected knowledge base IDs
  if (window.AppState && window.AppState.selectedKBIds && window.AppState.selectedKBIds.length > 0) {
    formData.append('knowledge_base_ids', window.AppState.selectedKBIds.join(','));
  }

  const imageInput = document.getElementById('imageUpload');
  Array.from(imageInput.files).forEach(f => formData.append('images', f));

  const statusBar = document.getElementById('statusBar');
  statusBar.style.display = 'block';
  statusBar.className = 'status-bar';
  statusBar.innerHTML = '<span class="status-icon running"></span> 准备中...';

  document.getElementById('generateBtn').disabled = true;

  try {
    // Use AbortController for timeout (6 minutes covers LLM request_timeout=300 + retries)
    const controller = new AbortController();
    const timeoutId = setTimeout(function () { controller.abort(); }, 360000);

    const headers = {};
    if (window.EL && window.EL.api && window.EL.api.getToken) {
      var token = window.EL.api.getToken();
      if (token) headers['Authorization'] = 'Bearer ' + token;
    }

    const response = await fetch('/generate-stream', {
      method: 'POST',
      body: formData,
      signal: controller.signal,
      headers: headers
    });

    if (!response.ok) {
      let errMsg = '服务器错误 (' + response.status + ')';
      try {
        const errData = await response.json();
        errMsg = errData.detail || errData.error || errMsg;
      } catch (e) { /* ignore */ }
      throw new Error(errMsg);
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    let hasEvents = false;

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() || '';

      for (const line of lines) {
        if (!line.startsWith('data: ')) continue;
        try {
          const event = JSON.parse(line.slice(6));
          hasEvents = true;
          handleSSEEvent(event, statusBar);
        } catch (e) { /* skip malformed/heartbeat */ }
      }
    }

    if (!hasEvents) {
      throw new Error('服务器未返回任何事件，请查看终端日志');
    }
  } catch (e) {
    statusBar.className = 'status-bar status-error';
    if (e.name === 'AbortError') {
      statusBar.innerHTML = '<span class="status-icon error"></span> 生成超时，请减少内容后重试';
    } else {
      statusBar.innerHTML = '<span class="status-icon error"></span> ' + (e.message || '连接错误，请检查网络');
    }
  } finally {
    clearTimeout(timeoutId);
    document.getElementById('generateBtn').disabled = false;
  }
}

function handleSSEEvent(event, statusBar) {
  switch (event.type) {
    case 'progress':
      if (event.status === 'running') {
        statusBar.className = 'status-bar';
        statusBar.innerHTML = '<span class="status-icon running"></span> ' + event.stage;
      } else {
        statusBar.className = 'status-bar';
        statusBar.innerHTML = '<span class="status-icon done"></span> ' + event.stage;
      }
      break;

    case 'complete':
      statusBar.className = 'status-bar status-success';
      statusBar.innerHTML = '<span class="status-icon done"></span> 生成成功';
      document.getElementById('preview').srcdoc = event.html;
      document.getElementById('timestamp').textContent =
        '生成时间: ' + new Date().toLocaleString();
      document.getElementById('copyBtn').disabled = false;
      document.getElementById('downloadBtn').disabled = false;
      document.getElementById('resetBtn').disabled = false;
      document.getElementById('publishBtn').disabled = false;
      window._lastHtml = event.html;
      originalHtml = event.html;
      // If edit mode was on, reset
      if (editMode) {
        document.getElementById('editToggle').checked = false;
        editMode = false;
        document.body.classList.remove('editing');
        document.getElementById('styleControls').style.display = 'none';
        document.getElementById('mainContainer').classList.remove('fullscreen-edit');
      }
      break;

    case 'error':
      statusBar.className = 'status-bar status-error';
      statusBar.innerHTML = '<span class="status-icon error"></span> ' + event.message;
      break;
  }
}

// ==================== 操作按钮 ====================

function copyHTML() {
  getCurrentHTML().then(html => {
    if (!html) return;
    navigator.clipboard.writeText(html).then(
      () => showToast('已复制到剪贴板', 'success'),
      () => showToast('复制失败，请手动选择', 'error')
    );
  });
}

function downloadHTML() {
  getCurrentHTML().then(html => {
    if (!html) return;
    const blob = new Blob([html], { type: 'text/html;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'article_' + Date.now() + '.html';
    a.click();
    URL.revokeObjectURL(url);
  });
}

function getCurrentHTML() {
  return new Promise((resolve) => {
    var iframe = document.getElementById('preview');
    // 始终优先从 iframe 取最新 HTML（包含编辑器修改）
    var handler = function (e) {
      if (e.data && e.data.type === 'editor:html') {
        window.removeEventListener('message', handler);
        window._lastHtml = e.data.html;
        resolve(e.data.html);
      }
    };
    window.addEventListener('message', handler);
    iframe.contentWindow.postMessage({ type: 'editor:getHTML' }, '*');
    // 如果编辑器没注入（非编辑模式），postMessage 不会有回复，直接读 iframe DOM
    setTimeout(function () {
      window.removeEventListener('message', handler);
      try {
        var doc = iframe.contentDocument || iframe.contentWindow.document;
        if (doc && doc.body) {
          var html = '<!DOCTYPE html><html>' + doc.documentElement.innerHTML + '</html>';
          window._lastHtml = html;
          resolve(html);
          return;
        }
      } catch (e) { /* cross-origin fallback */ }
      resolve(window._lastHtml || null);
    }, 500);
  });
}

function clearForm() {
  document.getElementById('newsText').value = '';
  document.getElementById('charCount').textContent = '0 / ' + NEWS_MAX_LEN;
  document.getElementById('charCount').style.color = '#999';
  document.getElementById('imageUpload').value = '';
  document.getElementById('imageList').innerHTML = '';
  document.getElementById('preview').srcdoc = '';
  document.getElementById('timestamp').textContent = '';
  document.getElementById('statusBar').style.display = 'none';
  document.getElementById('copyBtn').disabled = true;
  document.getElementById('downloadBtn').disabled = true;
  document.getElementById('resetBtn').disabled = true;
  document.getElementById('publishBtn').disabled = true;
  window._lastHtml = null;
  originalHtml = null;
  if (editMode) {
    document.getElementById('editToggle').checked = false;
    editMode = false;
    document.body.classList.remove('editing');
    document.getElementById('styleControls').style.display = 'none';
    document.getElementById('mainContainer').classList.remove('fullscreen-edit');
  }
  const linksContainer = document.getElementById('linksList');
  linksContainer.innerHTML = '';
  addLinkRow('', '');
}

// ==================== Toast ====================

function showToast(msg, type) {
  const toast = document.getElementById('toast');
  toast.textContent = msg;
  toast.className = 'toast ' + type;
  toast.style.display = 'block';
  clearTimeout(toast._timeout);
  toast._timeout = setTimeout(() => { toast.style.display = 'none'; }, 3000);
}

// ==================== Editor: Mode Toggle & Events ====================

function bindEditorEvents() {
  document.getElementById('editToggle').addEventListener('change', function () {
    if (this.checked) {
      enableEditMode();
    } else {
      disableEditMode();
    }
  });

  document.getElementById('resetBtn').addEventListener('click', resetArticle);

  // Style controls
  document.getElementById('editThemeColor').addEventListener('input', function () {
    sendStyleToIframe('themeColor', this.value);
  });
  document.getElementById('editFontSize').addEventListener('input', function () {
    document.getElementById('fontSizeVal').textContent = this.value + 'px';
    sendStyleToIframe('fontSize', this.value + 'px');
  });
  document.getElementById('editLineHeight').addEventListener('input', function () {
    document.getElementById('lineHeightVal').textContent = this.value;
    sendStyleToIframe('lineHeight', this.value);
  });

  // Editor image upload
  document.getElementById('editorImageInput').addEventListener('change', function () {
    handleEditorImageUpload(this.files);
    this.value = '';
  });
}

function enableEditMode() {
  const iframe = document.getElementById('preview');
  if (!iframe.contentWindow) {
    showToast('预览未加载，先生成推文', 'error');
    document.getElementById('editToggle').checked = false;
    return;
  }
  editMode = true;
  document.body.classList.add('editing');
  document.getElementById('mainContainer').classList.add('fullscreen-edit');
  document.getElementById('styleControls').style.display = 'flex';
  injectEditor(iframe);
}

function disableEditMode() {
  editMode = false;
  document.body.classList.remove('editing');
  document.getElementById('mainContainer').classList.remove('fullscreen-edit');
  document.getElementById('styleControls').style.display = 'none';
  const iframe = document.getElementById('preview');
  if (iframe.contentWindow) {
    iframe.contentWindow.postMessage({ type: 'editor:setMode', mode: 'view' }, '*');
  }
}

function injectEditor(iframe) {
  const win = iframe.contentWindow;
  const doc = win.document;
  if (doc.querySelector('#el-editor-script')) {
    win.postMessage({ type: 'editor:setMode', mode: 'edit' }, '*');
    // Resend theme color & deco options
    sendDecoOptionsToIframe(iframe);
    sendThemeColorToIframe(iframe);
    return;
  }
  const script = doc.createElement('script');
  script.id = 'el-editor-script';
  script.src = 'editor-core.js';
  doc.head.appendChild(script);

  const link = doc.createElement('link');
  link.rel = 'stylesheet';
  link.href = 'editor-core.css';
  doc.head.appendChild(link);

  script.onload = function () {
    sendDecoOptionsToIframe(iframe);
    sendThemeColorToIframe(iframe);
    win.postMessage({ type: 'editor:setMode', mode: 'edit' }, '*');
  };
}

function sendDecoOptionsToIframe(iframe) {
  if (!window._decoOptions) return;
  iframe.contentWindow.postMessage({
    type: 'editor:setDecoOptions',
    options: window._decoOptions
  }, '*');
}

function sendThemeColorToIframe(iframe) {
  // Sync from the user's actual config before sending, so editor always starts with the real theme color
  const configColor = document.getElementById('themeColor').value;
  document.getElementById('editThemeColor').value = configColor;
  iframe.contentWindow.postMessage({
    type: 'editor:setThemeColor',
    color: configColor
  }, '*');
}

function sendStyleToIframe(key, value) {
  const iframe = document.getElementById('preview');
  if (iframe.contentWindow) {
    iframe.contentWindow.postMessage({ type: 'editor:updateStyle', key, value }, '*');
  }
}

// ==================== Editor: postMessage Bridge ====================

function bindPostMessage() {
  window.addEventListener('message', function (e) {
    var msg = e.data;
    if (!msg || !msg.type) return;

    switch (msg.type) {
      case 'editor:ready':
        // Editor loaded in iframe, send deco options if available
        var iframe = document.getElementById('preview');
        if (iframe && iframe.contentWindow && window._decoOptions) {
          sendDecoOptionsToIframe(iframe);
          sendThemeColorToIframe(iframe);
        }
        break;
      case 'editor:requestImageUpload':
        if (msg.multi) {
          window._elMultiMode = true;
        } else {
          window._elMultiMode = false;
        }
        document.getElementById('editorImageInput').click();
        break;
      case 'editor:html':
        // HTML response from iframe - handled by getCurrentHTML promise
        break;
      case 'editor:themeReverted':
        // User cancelled theme change in iframe, revert the picker
        document.getElementById('editThemeColor').value = msg.color;
        break;
      case 'editor:themeApplied':
        // Theme was applied in iframe, sync the picker
        document.getElementById('editThemeColor').value = msg.color;
        break;
    }
  });
}

// ==================== Editor: Image Upload Bridge ====================

function handleEditorImageUpload(files) {
  const iframe = document.getElementById('preview');
  if (!iframe.contentWindow || !files.length) return;

  const promises = Array.from(files).map(fileToBase64);
  Promise.all(promises).then(images => {
    if (window._elMultiMode) {
      iframe.contentWindow.postMessage({
        type: 'editor:imagesInserted',
        images: images
      }, '*');
    } else {
      // single image - send as base64 directly for replace
      if (images.length > 0) {
        iframe.contentWindow.postMessage({
          type: 'editor:imageInserted',
          base64: images[0].base64,
          filename: images[0].filename
        }, '*');
      }
    }
    window._elMultiMode = false;
  });
}

function fileToBase64(file) {
  return new Promise((resolve) => {
    const reader = new FileReader();
    reader.onload = function () {
      resolve({ base64: reader.result, filename: file.name });
    };
    reader.readAsDataURL(file);
  });
}

// ==================== Editor: Reset ====================

function resetArticle() {
  if (!originalHtml) {
    showToast('没有可恢复的原始版本', 'error');
    return;
  }
  const iframe = document.getElementById('preview');
  iframe.srcdoc = originalHtml;
  window._lastHtml = originalHtml;

  if (editMode) {
    // re-inject editor after iframe reload
    const checkReady = setInterval(function () {
      if (iframe.contentWindow && iframe.contentWindow.document.readyState === 'complete') {
        clearInterval(checkReady);
        injectEditor(iframe);
      }
    }, 100);
  }
  showToast('已恢复原始版本', 'success');
}

// ==================== 发布到公众号 ====================

const PUB_STEPS = [
  '正在连接微信...',
  '正在上传图片...',
  '正在上传封面图...',
  '正在清空草稿箱...',
  '正在创建草稿...',
  '正在获取预览链接...',
  '正在发布...',
];

let _coverBlob = null;
let _coverOriginalFile = null;

function openPublishDialog() {
  if (!window._lastHtml) { showToast('请先生成文章', 'error'); return; }

  const parser = new DOMParser();
  const doc = parser.parseFromString(window._lastHtml, 'text/html');
  const h1 = doc.querySelector('h1');
  document.getElementById('pubTitle').value = h1 ? h1.textContent.trim() : '';

  const saved = loadPublishConfig();
  document.getElementById('pubAuthor').value = saved.author || '';
  document.getElementById('pubAppid').value = saved.appid || '';
  document.getElementById('pubSecret').value = saved.secret || '';

  resetCoverUI();
  document.getElementById('coverInput').value = '';

  document.getElementById('pubProgress').style.display = 'none';
  document.getElementById('pubProgress').innerHTML = '';
  document.getElementById('pubResult').style.display = 'none';
  document.querySelectorAll('.publish-tab-content').forEach(el => el.classList.remove('active'));
  document.getElementById('tabInfo').classList.add('active');
  document.querySelectorAll('.publish-tab').forEach((el, i) => el.classList.toggle('active', i === 0));
  document.getElementById('publishSubmit').disabled = false;
  document.getElementById('publishSubmit').textContent =
    document.querySelector('input[name="pubAction"]:checked').value === 'publish' ? '发布' : '发布草稿';

  document.getElementById('publishOverlay').style.display = 'flex';
}

function closePublishDialog() {
  document.getElementById('publishOverlay').style.display = 'none';
  document.getElementById('pubResult').style.display = 'none';
  document.getElementById('pubProgress').style.display = 'none';
}

// ---- 选项卡 ----
document.addEventListener('click', function (e) {
  const tab = e.target.closest('.publish-tab');
  if (tab) {
    const target = tab.dataset.tab;
    document.querySelectorAll('.publish-tab').forEach(t => t.classList.remove('active'));
    tab.classList.add('active');
    document.querySelectorAll('.publish-tab-content').forEach(c => c.classList.remove('active'));
    document.getElementById(target).classList.add('active');
  }
});

document.addEventListener('change', function (e) {
  if (e.target.name === 'pubAction') {
    document.getElementById('publishSubmit').textContent =
      e.target.value === 'publish' ? '发布' : '发布草稿';
  }
});

document.getElementById('publishCancel').addEventListener('click', closePublishDialog);
document.getElementById('publishOverlay').addEventListener('click', function (e) {
  if (e.target === this) closePublishDialog();
});

// ---- localStorage ----
function loadPublishConfig() {
  try { return JSON.parse(localStorage.getItem('el_publish') || '{}'); } catch (e) { return {}; }
}
function savePublishConfig() {
  localStorage.setItem('el_publish', JSON.stringify({
    author: document.getElementById('pubAuthor').value.trim(),
    appid: document.getElementById('pubAppid').value.trim(),
    secret: document.getElementById('pubSecret').value.trim(),
  }));
}

// ---- 封面图 ----
function resetCoverUI() {
  document.getElementById('coverPlaceholder').style.display = 'block';
  document.getElementById('coverCanvas').style.display = 'none';
  document.getElementById('coverPreview').style.display = 'none';
  document.getElementById('coverInfo').style.display = 'none';
  _coverBlob = null;
  _coverOriginalFile = null;
}

document.getElementById('coverDropZone').addEventListener('click', function () {
  if (_coverBlob && !this.querySelector('.el-cover-crop-ui')) {
    return;
  }
  document.getElementById('coverInput').click();
});
document.getElementById('coverDropZone').addEventListener('dragover', function (e) { e.preventDefault(); this.style.borderColor = '#1aad19'; });
document.getElementById('coverDropZone').addEventListener('dragleave', function () { this.style.borderColor = '#ddd'; });
document.getElementById('coverDropZone').addEventListener('drop', function (e) {
  e.preventDefault(); this.style.borderColor = '#ddd';
  const file = e.dataTransfer.files[0];
  if (file) { _coverOriginalFile = file; processCoverImage(file); }
});
document.getElementById('coverInput').addEventListener('change', function () {
  const file = this.files[0];
  if (file) { _coverOriginalFile = file; processCoverImage(file); }
});
document.getElementById('coverRecrop').addEventListener('click', function (e) {
  e.stopPropagation();
  if (!_coverOriginalFile) return;
  enterCoverCropMode();
});

function processCoverImage(file, cropData) {
  if (!file.type.match(/image\//)) { showToast('请上传图片文件', 'error'); return; }
  const img = new Image();
  img.onload = function () {
    const canvas = document.getElementById('coverCanvas');
    const ctx = canvas.getContext('2d');
    const tw = 900, th = 500, ratio = tw / th;
    let sx = 0, sy = 0, sw = img.width, sh = img.height;

    if (cropData) {
      sx = cropData.sx; sy = cropData.sy; sw = cropData.sw; sh = cropData.sh;
    } else {
      const imgRatio = img.width / img.height;
      if (imgRatio > ratio) { sw = img.height * ratio; sx = (img.width - sw) / 2; }
      else { sh = img.width / ratio; sy = (img.height - sh) / 2; }
    }

    canvas.width = tw; canvas.height = th;
    ctx.drawImage(img, sx, sy, sw, sh, 0, 0, tw, th);
    canvas.toBlob(function (blob) {
      if (!blob) { showToast('图片处理失败', 'error'); return; }
      if (blob.size > 64 * 1024 && file.type.match(/jpeg|jpg/)) {
        canvas.toBlob(function (b) {
          if (b) { _coverBlob = b; showCoverPreview(canvas, b); }
        }, 'image/jpeg', 0.6);
      } else {
        _coverBlob = blob;
        showCoverPreview(canvas, blob);
      }
    }, file.type.match(/png/) ? 'image/png' : 'image/jpeg', 0.85);
  };
  img.src = URL.createObjectURL(file);
}

function showCoverPreview(canvas, blob) {
  const url = URL.createObjectURL(blob);
  document.getElementById('coverPreview').src = url;
  document.getElementById('coverPreview').style.display = 'block';
  document.getElementById('coverPlaceholder').style.display = 'none';
  document.getElementById('coverCanvas').style.display = 'none';
  document.getElementById('coverInfo').style.display = 'flex';
  document.getElementById('coverSize').textContent =
    canvas.width + '×' + canvas.height + '  ' + (blob.size / 1024).toFixed(1) + 'KB';
}

// ---- 裁剪模式（拖拽裁剪框） ----
let _cropState = null;

function enterCoverCropMode() {
  if (!_coverOriginalFile) return;
  const img = new Image();
  img.onload = function () {
    _cropState = { img: img, x: 0, y: 0, dragging: false };
    openCropDialog(img);
  };
  img.src = URL.createObjectURL(_coverOriginalFile);
}

function openCropDialog(img) {
  const overlay = document.getElementById('cropOverlay');
  const canvas = document.getElementById('cropCanvas');
  const cropBox = document.getElementById('cropBox');
  const container = document.getElementById('cropContainer');

  overlay.style.display = 'flex';

  // 容器最大宽度 700px，等比缩放图片
  const maxW = 700;
  const scale = Math.min(1, maxW / img.width);
  const cw = Math.round(img.width * scale);
  const ch = Math.round(img.height * scale);

  canvas.width = cw;
  canvas.height = ch;
  const ctx = canvas.getContext('2d');
  ctx.drawImage(img, 0, 0, cw, ch);

  // 裁剪框 900:500 = 9:5
  const boxRatio = 9 / 5;
  let boxW, boxH;
  if (cw / ch > boxRatio) {
    boxH = ch;
    boxW = Math.round(boxH * boxRatio);
  } else {
    boxW = cw;
    boxH = Math.round(boxW / boxRatio);
  }
  // 如果裁剪框比 canvas 大，缩小裁剪框
  if (boxW > cw) { boxW = cw; boxH = Math.round(boxW / boxRatio); }
  if (boxH > ch) { boxH = ch; boxW = Math.round(boxH * boxRatio); }

  const initX = Math.round((cw - boxW) / 2);
  const initY = Math.round((ch - boxH) / 2);

  _cropState.cw = cw;
  _cropState.ch = ch;
  _cropState.boxW = boxW;
  _cropState.boxH = boxH;
  _cropState.x = initX;
  _cropState.y = initY;

  cropBox.style.width = boxW + 'px';
  cropBox.style.height = boxH + 'px';
  cropBox.style.left = initX + 'px';
  cropBox.style.top = initY + 'px';
}

function updateCropBox() {
  const s = _cropState;
  const box = document.getElementById('cropBox');
  box.style.left = s.x + 'px';
  box.style.top = s.y + 'px';
}

// 裁剪框拖拽事件（DOM已加载，直接绑定）
(function bindCropEvents() {
  var box = document.getElementById('cropBox');
  if (!box) return;

  box.addEventListener('mousedown', function (e) {
    if (!_cropState) return;
    e.preventDefault();
    _cropState.dragging = true;
    _cropState.dragStartX = e.clientX;
    _cropState.dragStartY = e.clientY;
    _cropState.origX = _cropState.x;
    _cropState.origY = _cropState.y;
  });

  window.addEventListener('mousemove', function (e) {
    if (!_cropState || !_cropState.dragging) return;
    var dx = e.clientX - _cropState.dragStartX;
    var dy = e.clientY - _cropState.dragStartY;
    _cropState.x = Math.max(0, Math.min(_cropState.cw - _cropState.boxW, _cropState.origX + dx));
    _cropState.y = Math.max(0, Math.min(_cropState.ch - _cropState.boxH, _cropState.origY + dy));
    updateCropBox();
  });

  window.addEventListener('mouseup', function () {
    if (_cropState) _cropState.dragging = false;
  });

  // 裁剪确认
  document.getElementById('cropConfirm').addEventListener('click', function () {
    if (!_cropState) return;
    var s = _cropState;
    var scaleX = s.img.width / s.cw;
    var cropData = {
      sx: Math.round(s.x * scaleX),
      sy: Math.round(s.y * scaleX),
      sw: Math.round(s.boxW * scaleX),
      sh: Math.round(s.boxH * scaleX),
    };
    document.getElementById('cropOverlay').style.display = 'none';
    _cropState = null;
    processCoverImage(_coverOriginalFile, cropData);
  });

  // 裁剪取消
  document.getElementById('cropCancel').addEventListener('click', function () {
    document.getElementById('cropOverlay').style.display = 'none';
    _cropState = null;
  });
  document.getElementById('cropOverlay').addEventListener('click', function (e) {
    if (e.target === this) {
      document.getElementById('cropOverlay').style.display = 'none';
      _cropState = null;
    }
  });
})();

// ---- 发布提交 ----
document.getElementById('publishSubmit').addEventListener('click', async function () {
  const author = document.getElementById('pubAuthor').value.trim();
  const appid = document.getElementById('pubAppid').value.trim();
  const secret = document.getElementById('pubSecret').value.trim();
  const action = document.querySelector('input[name="pubAction"]:checked').value;

  if (!author) { showToast('请填写作者', 'error'); return; }
  if (!appid || !secret) { showToast('请填写微信 APPID 和 APPSECRET', 'error'); return; }
  if (!_coverBlob) { showToast('请上传封面图', 'error'); return; }

  const html = await getCurrentHTML();
  if (!html) { showToast('请先生成推文', 'error'); return; }

  const title = document.getElementById('pubTitle').value.trim();
  savePublishConfig();

  document.querySelectorAll('.publish-tab').forEach(t => t.style.display = 'none');
  document.querySelectorAll('.publish-tab-content').forEach(c => c.classList.remove('active'));
  document.getElementById('pubProgress').style.display = 'block';
  document.getElementById('pubProgress').innerHTML = PUB_STEPS.map((s, i) =>
    '<div class="pub-step" id="pubStep' + i + '"><span class="step-icon">○</span><span class="step-label">' + s + '</span></div>'
  ).join('');
  document.getElementById('publishSubmit').disabled = true;

  const formData = new FormData();

  // 从 HTML 中提取 base64 图片，转为二进制 Blob 分别发送
  const parser = new DOMParser();
  const pubDoc = parser.parseFromString(html, 'text/html');
  const bodyImgs = [];
  var bodyIdx = 0;
  pubDoc.querySelectorAll('img').forEach(function (img) {
    const src = img.getAttribute('src') || '';
    if (src.startsWith('data:')) {
      const commaIdx = src.indexOf(',');
      const header = src.substring(0, commaIdx);
      const b64 = src.substring(commaIdx + 1);
      const mimeMatch = header.match(/data:(image\/\w+)/);
      const mime = mimeMatch ? mimeMatch[1] : 'image/jpeg';
      const ext = mime.includes('png') ? 'png' : 'jpg';
      try {
        const binaryStr = atob(b64);
        const bytes = new Uint8Array(binaryStr.length);
        for (var j = 0; j < binaryStr.length; j++) { bytes[j] = binaryStr.charCodeAt(j); }
        const blob = new Blob([bytes], { type: mime });
        var curIdx = bodyIdx;
        bodyIdx++;
        const marker = '{{EL_BODY_IMG_' + curIdx + '}}';
        img.setAttribute('src', marker);
        img.removeAttribute('srcset');
        bodyImgs.push({ blob: blob, filename: 'body_' + curIdx + '.' + ext });
      } catch (e) { console.log('[publish] skip image', curIdx, e); }
    }
  });
  const lightHtml = '<!DOCTYPE html>\n' + pubDoc.documentElement.outerHTML;
  const croppedCount = pubDoc.querySelectorAll('img[data-user-cropped]').length;
  console.log('[publish] body images extracted:', bodyImgs.length, ', HTML size:', lightHtml.length,
    ', total blob size:', bodyImgs.reduce(function (s, x) { return s + x.blob.size; }, 0),
    ', user-cropped:', croppedCount);

  formData.append('html', lightHtml);
  bodyImgs.forEach(function (item) { formData.append('body_images', item.blob, item.filename); });
  if (title) formData.append('title', title);
  formData.append('appid', appid);
  formData.append('secret', secret);
  formData.append('author', author);
  formData.append('action', action);
  formData.append('cover_image', _coverBlob, 'cover.jpg');

  // step 索引映射：通过 stage 名称匹配到 PUB_STEPS 中的步骤
  const STEP_MAP = [
    { idx: 0, run: '正在连接微信', done: '微信连接成功' },
    { idx: 1, run: '正在上传图片', done: '图片上传完成' },
    { idx: 2, run: '正在上传封面图', done: '封面上传完成' },
    { idx: 3, run: '正在清空草稿箱', done: '草稿箱已清空' },
    { idx: 4, run: '正在创建草稿', done: '草稿创建完成' },
    { idx: 5, run: '正在获取预览链接', done: '预览链接已生成' },
    { idx: 6, run: '正在发布', done: '发布完成' },
  ];

  function applyProgress(stage, status) {
    const match = STEP_MAP.find(m => {
      if (status === 'running') return stage.startsWith(m.run);
      return stage === m.done;
    });
    if (!match) { console.log('[publish] unmatched stage:', stage, status); return; }

    const stepEl = document.getElementById('pubStep' + match.idx);
    if (!stepEl) return;

    if (status === 'running') {
      stepEl.querySelector('.step-icon').textContent = '⟳';
      stepEl.classList.add('running');
    } else {
      stepEl.querySelector('.step-icon').textContent = '✓';
      stepEl.classList.remove('running');
      stepEl.classList.add('done');
    }
  }

  try {
    const response = await fetch('/api/publish-stream', { method: 'POST', body: formData });
    console.log('[publish] response status:', response.status);
    if (!response.ok) {
      let errMsg = '服务器错误 (' + response.status + ')';
      try {
        const errData = await response.json();
        if (errData.error) errMsg = errData.error;
      } catch (e) { /* ignore */ }
      showToast('发布失败: ' + errMsg, 'error');
      document.querySelectorAll('.publish-tab').forEach(t => t.style.display = '');
      document.getElementById('publishSubmit').disabled = false;
      return;
    }
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';

    while (true) {
      const { done, value } = await reader.read();
      if (done) { console.log('[publish] stream done'); break; }
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop();

      for (const line of lines) {
        if (!line.startsWith('data: ')) continue;
        try {
          const data = JSON.parse(line.slice(6));
          console.log('[publish] SSE:', data.type, data.stage || '', data.status || '');
          if (data.type === 'progress') {
            applyProgress(data.stage, data.status);
          } else if (data.type === 'complete') {
            // 标记所有步骤完成
            for (let i = 0; i < PUB_STEPS.length; i++) {
              const el = document.getElementById('pubStep' + i);
              if (el && !el.classList.contains('done')) {
                el.querySelector('.step-icon').textContent = '✓';
                el.classList.add('done');
              }
            }

            const resultEl = document.getElementById('pubResult');
            const contentEl = document.getElementById('pubResultContent');
            const previewUrl = data.preview_url || '';
            const resultTitle = data.title || '';

            let resultHtml = '<div class="pub-result-status">' +
              (action === 'publish' ? '✅ 发布成功！' : '✅ 草稿已保存！') + '</div>';
            if (resultTitle) {
              resultHtml += '<div class="pub-result-field"><span class="pub-result-label">标题</span>' + escapeHtml(resultTitle) + '</div>';
            }
            if (previewUrl) {
              resultHtml += '<div class="pub-result-field"><span class="pub-result-label">预览链接</span><a href="' + previewUrl + '" target="_blank" rel="noopener">' + previewUrl + '</a></div>';
              resultHtml += '<div class="pub-result-guide"><span class="pub-result-label">操作指引</span><ul><li>点击上方链接在浏览器中预览文章</li><li>确认无误后在公众号后台 → 草稿箱 → 发布</li><li>手机预览可在微信中打开链接</li></ul></div>';
            }
            contentEl.innerHTML = resultHtml;
            document.getElementById('pubProgress').style.display = 'none';
            resultEl.style.display = 'block';
            resultEl._previewUrl = previewUrl;

          } else if (data.type === 'error') {
            showToast('发布失败: ' + data.message, 'error');
            const progEl = document.getElementById('pubProgress');
            if (progEl) {
              progEl.innerHTML += '<div class="pub-step" style="color:#e74c3c;">✗ ' + escapeHtml(data.message) + '</div>';
            }
          }
        } catch (e) { console.log('[publish] parse error:', e, line); }
      }
    }
  } catch (err) {
    console.error('[publish] fetch error:', err);
    showToast('网络错误: ' + err.message, 'error');
  } finally {
    document.querySelectorAll('.publish-tab').forEach(t => t.style.display = '');
    document.getElementById('publishSubmit').disabled = false;
  }
});

// ---- 结果面板按钮 ----
document.getElementById('pubCopyLink').addEventListener('click', function () {
  const url = document.getElementById('pubResult')._previewUrl || '';
  if (url) {
    navigator.clipboard.writeText(url).then(
      () => showToast('预览链接已复制到剪贴板', 'success'),
      () => showToast('复制失败', 'error')
    );
  }
});
document.getElementById('pubCloseResult').addEventListener('click', closePublishDialog);

function escapeHtml(s) {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}
