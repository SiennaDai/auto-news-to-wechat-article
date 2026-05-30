/**
 * User UI module - renders user menu, login modal, prompt section, template/prompt managers.
 * Depends on: auth.js, templates.js, prompts.js
 */
(function () {
  'use strict';

  var Auth = window.EL.Auth;
  var Templates = window.EL.Templates;
  var Prompts = window.EL.Prompts;

  // ============ User menu (avatar dropdown) ============

  function renderUserMenu() {
    var container = document.getElementById('elUserMenu');
    if (!container) return;

    if (Auth.isLoggedIn()) {
      var user = window.AppState.user;
      container.innerHTML =
        '<span class="el-user-name">' + escapeHtml(user.username) + '</span>' +
        '<div class="el-user-menu-wrap">' +
        '  <span class="el-user-avatar">' + (user.username || '?').charAt(0).toUpperCase() + '</span>' +
        '  <div class="el-user-dropdown">' +
        '    <div class="el-user-dropdown-inner">' +
        '      <button id="elManagePrompts" class="el-dropdown-item">提示词管理</button>' +
        '      <button id="elManageTemplates" class="el-dropdown-item">模板管理</button>' +
        '      <button id="elManageKB" class="el-dropdown-item">知识库管理</button>' +
        '      <button id="elHelpDoc" class="el-dropdown-item">帮助文档</button>' +
        '      <button id="elLogoutBtn" class="el-dropdown-item">登出</button>' +
        '    </div>' +
        '  </div>' +
        '</div>';

      container.querySelector('#elManagePrompts').addEventListener('click', openPromptManager);
      container.querySelector('#elManageTemplates').addEventListener('click', openTemplateManager);
      container.querySelector('#elManageKB').addEventListener('click', openKBManager);
      container.querySelector('#elHelpDoc').addEventListener('click', openHelpDoc);
      container.querySelector('#elLogoutBtn').addEventListener('click', handleLogout);
    } else {
      container.innerHTML = '<button id="elLoginBtn" class="btn-secondary">登录</button>';
      container.querySelector('#elLoginBtn').addEventListener('click', openLoginModal);
    }
  }

  // ============ Prompt section (in 文编) ============

  function renderPromptSection() {
    var editBtn = document.getElementById('elPromptEditBtn');
    var body = document.getElementById('elPromptBody');
    var textarea = document.getElementById('elPromptTextarea');
    var select = document.getElementById('elPromptSelect');

    if (!editBtn) return;

    // Load default prompt content on first render
    if (!window._promptDefaultLoaded) {
      window._promptDefaultLoaded = true;
      loadDefaultPromptContent();
    }

    // Edit button toggle
    editBtn.addEventListener('click', function () {
      var visible = body.style.display !== 'none';
      if (visible) {
        body.style.display = 'none';
        editBtn.textContent = '修改';
      } else {
        body.style.display = '';
        editBtn.textContent = '收起';
        // Ensure textarea has current content
        if (!textarea.value && window.AppState.promptContent) {
          textarea.value = window.AppState.promptContent;
        }
      }
    });

    // Prompt selector change → fill textarea
    select.addEventListener('change', function () {
      var id = this.value;
      if (!id) {
        // User selected placeholder, do nothing
        return;
      }
      Prompts.loadContent(parseInt(id)).then(function (content) {
        textarea.value = content;
        window.AppState.currentPromptId = parseInt(id);
        window.AppState.promptContent = content;
      }).catch(function (err) {
        showToast('加载提示词失败: ' + err.message, 'error');
      });
    });

    // Save current prompt content
    var saveBtn = document.getElementById('elPromptSave');
    if (saveBtn) {
      saveBtn.addEventListener('click', function () {
        if (!Auth.isLoggedIn()) {
          showToast('请先登录', 'error');
          openLoginModal();
          return;
        }
        openSavePromptModal();
      });
    }

    // Reset to default
    var resetBtn = document.getElementById('elPromptReset');
    if (resetBtn) {
      resetBtn.addEventListener('click', function () {
        window.AppState.currentPromptId = null;
        window.AppState.promptContent = null;
        textarea.value = window._promptDefaultText || '';
        select.value = '';
        showToast('已恢复默认提示词', 'success');
      });
    }

    // Refresh selector options
    refreshPromptSelector();
  }

  function loadDefaultPromptContent() {
    fetch('/prompts/writer.txt')
      .then(function (r) { return r.text(); })
      .then(function (text) {
        window._promptDefaultText = text;
        var textarea = document.getElementById('elPromptTextarea');
        if (textarea && !textarea.value) {
          textarea.value = text;
        }
      })
      .catch(function () {
        window._promptDefaultText = '';
      });
  }

  function refreshPromptSelector() {
    var select = document.getElementById('elPromptSelect');
    if (!select) return;

    if (!Auth.isLoggedIn()) {
      select.innerHTML = '<option value="">登录后可选择提示词</option>';
      return;
    }

    Prompts.list().then(function (prompts) {
      var html = '<option value="">-- 选择已保存的提示词 --</option>';
      prompts.forEach(function (p) {
        var marker = p.is_default ? ' ★' : '';
        html += '<option value="' + p.id + '">' + escapeHtml(p.name) + marker + '</option>';
      });
      select.innerHTML = html;
      if (window.AppState.currentPromptId) {
        select.value = String(window.AppState.currentPromptId);
      }
    }).catch(function () {
      select.innerHTML = '<option value="">加载失败</option>';
    });
  }

  // ============ Prompt Manager modal ============

  function openPromptManager() {
    Prompts.list().then(function (prompts) {
      var rows = '';
      if (prompts.length === 0) {
        rows = '<div class="el-empty-hint">暂无保存的提示词</div>';
      } else {
        prompts.forEach(function (p) {
          rows +=
            '<div class="el-tmpl-row">' +
            '  <span class="el-tmpl-name">' + escapeHtml(p.name) + (p.is_default ? ' <em>默认</em>' : '') + '</span>' +
            '  <span class="el-tmpl-date">' + (p.updated_at || p.created_at || '').replace('T', ' ').substring(0, 19) + '</span>' +
            '  <div class="el-tmpl-actions">' +
            '    <button class="btn-small el-prompt-load" data-id="' + p.id + '">加载</button>' +
            (p.is_default ? '' : '    <button class="btn-small el-prompt-default" data-id="' + p.id + '">设为默认</button>') +
            '    <button class="btn-small el-prompt-delete" data-id="' + p.id + '">删除</button>' +
            '  </div>' +
            '</div>';
        });
      }

      var modal = document.createElement('div');
      modal.className = 'modal-overlay';
      modal.id = 'elPromptManagerOverlay';
      modal.innerHTML =
        '<div class="modal-dialog el-manage-dialog">' +
        '  <div class="modal-header">提示词管理</div>' +
        '  <div class="publish-body" style="max-height:50vh;overflow-y:auto">' + rows + '</div>' +
        '  <div class="modal-footer">' +
        '    <button id="elPMClose" class="btn-secondary">关闭</button>' +
        '  </div>' +
        '</div>';

      document.body.appendChild(modal);

      modal.addEventListener('click', function (e) { if (e.target === modal) modal.remove(); });
      modal.querySelector('#elPMClose').addEventListener('click', function () { modal.remove(); });

      // Load prompt
      modal.querySelectorAll('.el-prompt-load').forEach(function (btn) {
        btn.addEventListener('click', async function () {
          var id = parseInt(this.dataset.id);
          try {
            var content = await Prompts.loadContent(id);
            var textarea = document.getElementById('elPromptTextarea');
            textarea.value = content;
            window.AppState.currentPromptId = id;
            window.AppState.promptContent = content;
            modal.remove();
            refreshPromptSelector();
            // Show the prompt body if hidden
            var body = document.getElementById('elPromptBody');
            if (body && body.style.display === 'none') {
              body.style.display = '';
              document.getElementById('elPromptEditBtn').textContent = '收起';
            }
            showToast('提示词已加载', 'success');
          } catch (err) {
            showToast('加载失败: ' + err.message, 'error');
          }
        });
      });

      // Set default
      modal.querySelectorAll('.el-prompt-default').forEach(function (btn) {
        btn.addEventListener('click', async function () {
          var id = parseInt(this.dataset.id);
          try {
            await Prompts.setDefault(id);
            modal.remove();
            showToast('已设为默认提示词', 'success');
            refreshPromptSelector();
          } catch (err) {
            showToast('操作失败', 'error');
          }
        });
      });

      // Delete
      modal.querySelectorAll('.el-prompt-delete').forEach(function (btn) {
        btn.addEventListener('click', async function () {
          var id = parseInt(this.dataset.id);
          if (!confirm('确定删除此提示词？')) return;
          try {
            await Prompts.remove(id);
            if (window.AppState.currentPromptId === id) {
              window.AppState.currentPromptId = null;
              window.AppState.promptContent = null;
              document.getElementById('elPromptTextarea').value = window._promptDefaultText || '';
            }
            modal.remove();
            showToast('提示词已删除', 'success');
            refreshPromptSelector();
          } catch (err) {
            showToast('删除失败', 'error');
          }
        });
      });
    }).catch(function (err) {
      showToast('加载提示词列表失败: ' + err.message, 'error');
    });
  }

  // ============ Template Manager modal ============

  function openTemplateManager() {
    var templates = window.AppState.templates || [];

    Templates.list().then(function (templates) {
      window.AppState.templates = templates;

      var rows = '';
      if (templates.length === 0) {
        rows = '<div class="el-empty-hint">暂无模板，请先在左侧面板保存</div>';
      } else {
        templates.forEach(function (t) {
          rows +=
            '<div class="el-tmpl-row">' +
            '  <span class="el-tmpl-name">' + escapeHtml(t.name) + (t.is_default ? ' <em>默认</em>' : '') + '</span>' +
            '  <span class="el-tmpl-date">' + (t.updated_at || t.created_at || '').replace('T', ' ').substring(0, 19) + '</span>' +
            '  <div class="el-tmpl-actions">' +
            '    <button class="btn-small el-tmpl-load" data-id="' + t.id + '">加载</button>' +
            (t.is_default ? '' : '    <button class="btn-small el-tmpl-default" data-id="' + t.id + '">设为默认</button>') +
            '    <button class="btn-small el-tmpl-delete" data-id="' + t.id + '">删除</button>' +
            '  </div>' +
            '</div>';
        });
      }

      var modal = document.createElement('div');
      modal.className = 'modal-overlay';
      modal.id = 'elTemplateManagerOverlay';
      modal.innerHTML =
        '<div class="modal-dialog el-manage-dialog">' +
        '  <div class="modal-header">模板管理</div>' +
        '  <div class="publish-body" style="max-height:50vh;overflow-y:auto">' + rows + '</div>' +
        '  <div class="modal-footer">' +
        '    <button id="elTMClose" class="btn-secondary">关闭</button>' +
        '  </div>' +
        '</div>';

      document.body.appendChild(modal);

      modal.addEventListener('click', function (e) { if (e.target === modal) modal.remove(); });
      modal.querySelector('#elTMClose').addEventListener('click', function () { modal.remove(); });

      modal.querySelectorAll('.el-tmpl-load').forEach(function (btn) {
        btn.addEventListener('click', async function () {
          var id = parseInt(this.dataset.id);
          try {
            var config = await Templates.loadConfig(id);
            fillFormFromConfig(config);
            if (typeof refreshTemplateSelector === 'function') refreshTemplateSelector();
            modal.remove();
            showToast('模板已加载', 'success');
          } catch (err) {
            showToast('加载失败', 'error');
          }
        });
      });

      modal.querySelectorAll('.el-tmpl-default').forEach(function (btn) {
        btn.addEventListener('click', async function () {
          var id = parseInt(this.dataset.id);
          try {
            await Templates.setDefault(id);
            modal.remove();
            showToast('已设为默认模板', 'success');
          } catch (err) {
            showToast('操作失败', 'error');
          }
        });
      });

      modal.querySelectorAll('.el-tmpl-delete').forEach(function (btn) {
        btn.addEventListener('click', async function () {
          var id = parseInt(this.dataset.id);
          if (!confirm('确定删除此模板？')) return;
          try {
            await Templates.remove(id);
            if (typeof refreshTemplateSelector === 'function') refreshTemplateSelector();
            modal.remove();
            showToast('模板已删除', 'success');
          } catch (err) {
            showToast('删除失败', 'error');
          }
        });
      });
    }).catch(function (err) {
      showToast('加载模板列表失败: ' + err.message, 'error');
    });
  }

  // ============ Save prompt (left panel button) ============

  function openSavePromptModal() {
    var content = document.getElementById('elPromptTextarea').value;
    if (!content.trim()) {
      showToast('提示词内容为空', 'error');
      return;
    }

    var modal = document.createElement('div');
    modal.className = 'modal-overlay';
    modal.id = 'elSavePromptOverlay';
    modal.innerHTML =
      '<div class="modal-dialog el-save-dialog">' +
      '  <div class="modal-header">保存提示词</div>' +
      '  <div class="publish-body">' +
      '    <div class="form-group">' +
      '      <label for="elPromptName">提示词名称</label>' +
      '      <input type="text" id="elPromptName" placeholder="例如：学术风格" maxlength="100">' +
      '    </div>' +
      '    <div id="elSavePromptError" class="el-auth-error"></div>' +
      '  </div>' +
      '  <div class="modal-footer">' +
      '    <button id="elSavePCancel" class="btn-secondary">取消</button>' +
      '    <button id="elSavePConfirm" class="btn-publish">保存</button>' +
      '  </div>' +
      '</div>';

    document.body.appendChild(modal);

    modal.addEventListener('click', function (e) { if (e.target === modal) modal.remove(); });
    modal.querySelector('#elSavePCancel').addEventListener('click', function () { modal.remove(); });
    modal.querySelector('#elSavePConfirm').addEventListener('click', async function () {
      var name = modal.querySelector('#elPromptName').value.trim();
      var errEl = modal.querySelector('#elSavePromptError');
      if (!name) { errEl.textContent = '请输入提示词名称'; return; }
      try {
        await Prompts.save(name, content);
        modal.remove();
        showToast('提示词已保存', 'success');
        refreshPromptSelector();
      } catch (err) {
        errEl.textContent = (err.data && err.data.detail) || '保存失败';
      }
    });
  }

  // ============ Save template (left panel button) ============

  function bindSaveTemplateBtn() {
    var btn = document.getElementById('elSaveTemplateBtn');
    if (!btn) return;
    btn.addEventListener('click', openSaveTemplateModal);
  }

  function openSaveTemplateModal() {
    if (!Auth.isLoggedIn()) {
      showToast('请先登录', 'error');
      openLoginModal();
      return;
    }
    var config = buildConfig();

    var modal = document.createElement('div');
    modal.className = 'modal-overlay';
    modal.id = 'elSaveTemplateOverlay';
    modal.innerHTML =
      '<div class="modal-dialog el-save-dialog">' +
      '  <div class="modal-header">保存为模板</div>' +
      '  <div class="publish-body">' +
      '    <div class="form-group">' +
      '      <label for="elTemplateName">模板名称</label>' +
      '      <input type="text" id="elTemplateName" placeholder="例如：学术风-默认" maxlength="100">' +
      '    </div>' +
      '    <div id="elSaveTempError" class="el-auth-error"></div>' +
      '  </div>' +
      '  <div class="modal-footer">' +
      '    <button id="elSaveCancel" class="btn-secondary">取消</button>' +
      '    <button id="elSaveConfirm" class="btn-publish">保存</button>' +
      '  </div>' +
      '</div>';

    document.body.appendChild(modal);

    modal.addEventListener('click', function (e) { if (e.target === modal) modal.remove(); });
    modal.querySelector('#elSaveCancel').addEventListener('click', function () { modal.remove(); });
    modal.querySelector('#elSaveConfirm').addEventListener('click', async function () {
      var name = modal.querySelector('#elTemplateName').value.trim();
      var errEl = modal.querySelector('#elSaveTempError');
      if (!name) { errEl.textContent = '请输入模板名称'; return; }
      try {
        await Templates.save(name, config);
        if (typeof refreshTemplateSelector === 'function') refreshTemplateSelector();
        modal.remove();
        showToast('模板已保存', 'success');
      } catch (err) {
        errEl.textContent = (err.data && err.data.detail) || '保存失败';
      }
    });
  }

  // ============ Knowledge Base Manager modal ============

  function openKBManager() {
    var Knowledge = window.EL.Knowledge;

    Knowledge.listBases().then(function (bases) {
      var rows = '';
      if (bases.length === 0) {
        rows = '<div class="el-empty-hint">暂无知识库，请在下方创建</div>';
      } else {
        bases.forEach(function (kb) {
          var size = kb.total_chars ? (kb.total_chars / 1024).toFixed(1) + 'KB' : '0KB';
          rows +=
            '<div class="el-tmpl-row">' +
            '  <span class="el-tmpl-name">' + escapeHtml(kb.name) + ' <em>' + size + '</em></span>' +
            '  <span class="el-tmpl-date">' + (kb.updated_at || kb.created_at || '').replace('T', ' ').substring(0, 19) + '</span>' +
            '  <div class="el-tmpl-actions">' +
            '    <button class="btn-small el-kb-delete" data-id="' + kb.id + '">删除</button>' +
            '  </div>' +
            '</div>';
        });
      }

      var modal = document.createElement('div');
      modal.className = 'modal-overlay';
      modal.id = 'elKBManagerOverlay';
      modal.innerHTML =
        '<div class="modal-dialog el-manage-dialog">' +
        '  <div class="modal-header">知识库管理</div>' +
        '  <div class="publish-body" style="max-height:50vh;overflow-y:auto">' +
        '    <div style="margin-bottom:16px;padding:12px;background:#f9f9f9;border-radius:6px">' +
        '      <div class="form-group">' +
        '        <label>知识库名称</label>' +
        '        <input type="text" id="elKBName" placeholder="例如：NJU基本信息" maxlength="100" style="width:100%">' +
        '      </div>' +
        '      <div class="form-group">' +
        '        <label>内容（粘贴纯文本或Markdown）</label>' +
        '        <textarea id="elKBContent" rows="6" placeholder="粘贴知识库文本内容..." style="width:100%;resize:vertical"></textarea>' +
        '      </div>' +
        '      <button id="elKBCreate" class="btn-primary" style="width:100%">创建知识库</button>' +
        '      <div id="elKBError" class="el-auth-error"></div>' +
        '    </div>' +
        '    <div style="font-weight:600;margin-bottom:8px">我的知识库</div>' +
        rows +
        '  </div>' +
        '  <div class="modal-footer">' +
        '    <button id="elKBClose" class="btn-secondary">关闭</button>' +
        '  </div>' +
        '</div>';

      document.body.appendChild(modal);

      modal.addEventListener('click', function (e) { if (e.target === modal) modal.remove(); });
      modal.querySelector('#elKBClose').addEventListener('click', function () { modal.remove(); });

      // Create KB
      modal.querySelector('#elKBCreate').addEventListener('click', async function () {
        var name = modal.querySelector('#elKBName').value.trim();
        var content = modal.querySelector('#elKBContent').value;
        var errEl = modal.querySelector('#elKBError');
        if (!name) { errEl.textContent = '请输入知识库名称'; return; }
        if (!content.trim()) { errEl.textContent = '请输入知识库内容'; return; }
        try {
          await Knowledge.createBaseWithContent(name, content);
          modal.remove();
          showToast('知识库已创建', 'success');
          refreshKBSelector();
        } catch (err) {
          errEl.textContent = (err.data && err.data.detail) || '创建失败';
        }
      });

      // Delete KB
      modal.querySelectorAll('.el-kb-delete').forEach(function (btn) {
        btn.addEventListener('click', async function () {
          var id = parseInt(this.dataset.id);
          if (!confirm('确定删除此知识库？')) return;
          try {
            await Knowledge.deleteBase(id);
            modal.remove();
            showToast('知识库已删除', 'success');
            refreshKBSelector();
          } catch (err) {
            showToast('删除失败', 'error');
          }
        });
      });
    }).catch(function (err) {
      showToast('加载知识库列表失败: ' + err.message, 'error');
    });
  }

  // ============ Help Document ============

  function openHelpDoc() {
    var modal = document.createElement('div');
    modal.className = 'modal-overlay';
    modal.id = 'elHelpOverlay';
    modal.innerHTML =
      '<div class="modal-dialog el-help-dialog">' +
      '  <div class="modal-header">帮助文档</div>' +
      '  <div class="publish-body el-help-body">' +
      '    <div class="el-help-section">' +
      '      <h3>工具简介</h3>' +
      '      <p>微信公众号自动排版工具，将新闻稿文本自动转换为精美排版的公众号推文。支持AI生成文章、可视化编辑、模板管理和一键发布。</p>' +
      '    </div>' +
      '    <div class="el-help-section">' +
      '      <h3>使用流程</h3>' +
      '      <ol>' +
      '        <li><strong>输入内容</strong>：在左侧面板粘贴新闻稿文本，上传图片（JPG格式，支持多选）</li>' +
      '        <li><strong>配置文编</strong>：设置是否添加超链接、作者/摄影/责编信息，可自定义AI写手提示词</li>' +
      '        <li><strong>配置美编</strong>：选择主题色、字体、字号、行距，搭配标题框/文本框/分隔线/图片分隔的装饰样式</li>' +
      '        <li><strong>选择知识库</strong>：勾选参考知识库（最多5个），AI生成时会参考其中的内容</li>' +
      '        <li><strong>生成推文</strong>：点击"生成推文"按钮，AI将自动排版并流式输出到右侧预览区</li>' +
      '        <li><strong>编辑优化</strong>：打开编辑模式，对文章进行微调和美化</li>' +
      '        <li><strong>发布</strong>：确认无误后，点击"发布到公众号"推送到微信公众平台</li>' +
      '      </ol>' +
      '    </div>' +
      '    <div class="el-help-section">' +
      '      <h3>编辑模式</h3>' +
      '      <p>勾选预览区右上角"编辑模式"进入可视化编辑：</p>' +
      '      <ul>' +
      '        <li><strong>编辑文本</strong>：单击段落或标题直接修改内容，按 Enter 或 Esc 退出编辑</li>' +
      '        <li><strong>移动元素</strong>：点击元素右侧的 ↑ ↓ 按钮上下调整顺序</li>' +
      '        <li><strong>插入元素</strong>：点击 + 按钮，可插入标题、段落、分隔线或新图片</li>' +
      '        <li><strong>删除元素</strong>：点击 ✕ 按钮删除当前元素（含确认提示）</li>' +
      '        <li><strong>更换装饰样式</strong>：装饰元素显示 e 按钮，点击可选择同组其他样式</li>' +
      '        <li><strong>图片操作</strong>：鼠标悬停图片显示删除/替换/裁剪按钮；多图容器左上角可切换布局（单张/并排/轮播）</li>' +
      '        <li><strong>图片裁剪</strong>：单图支持拖拽裁剪框自由裁剪；多图批量裁剪时所有图片统一尺寸</li>' +
      '        <li><strong>文本标注</strong>：选中文字后弹出工具栏，可重点标注（加粗+主题色）或添加超链接</li>' +
      '        <li><strong>主题色切换</strong>：修改右侧主题色色盘，确认后将重新渲染所有装饰元素</li>' +
      '        <li><strong>退出编辑</strong>：取消勾选"编辑模式"回到预览状态，修改会保留</li>' +
      '      </ul>' +
      '    </div>' +
      '    <div class="el-help-section">' +
      '      <h3>模板管理</h3>' +
      '      <p>登录后可将当前的文编+美编配置保存为模板，方便下次直接加载使用。</p>' +
      '      <ul>' +
      '        <li><strong>保存模板</strong>：点击"生成推文"下方的"保存为模板"按钮，输入名称保存</li>' +
      '        <li><strong>加载模板</strong>：在顶部模板下拉框中选择模板，点击"加载"自动填入配置</li>' +
      '        <li><strong>管理模板</strong>：点击头像→模板管理，可加载/删除/设为默认</li>' +
      '      </ul>' +
      '    </div>' +
      '    <div class="el-help-section">' +
      '      <h3>提示词管理</h3>' +
      '      <p>登录后可保存自定义AI写手提示词，控制文章生成的风格和格式。</p>' +
      '      <ul>' +
      '        <li><strong>修改提示词</strong>：在文编配置→AI写手提示词区域，展开后编辑文本</li>' +
      '        <li><strong>保存提示词</strong>：点击"保存"，输入名称保存（需登录）</li>' +
      '        <li><strong>加载提示词</strong>：在下拉框中选择已保存的提示词自动填入</li>' +
      '        <li><strong>恢复默认</strong>：点击"恢复默认"使用系统自带提示词</li>' +
      '        <li><strong>管理提示词</strong>：点击头像→提示词管理，可加载/删除/设为默认</li>' +
      '      </ul>' +
      '    </div>' +
      '    <div class="el-help-section">' +
      '      <h3>知识库</h3>' +
      '      <p>知识库为AI提供参考素材，让生成的文章更符合特定领域或机构风格。</p>' +
      '      <ul>' +
      '        <li><strong>创建知识库</strong>：点击头像→知识库管理，输入名称并粘贴文本/Markdown内容</li>' +
      '        <li><strong>选择知识库</strong>：在左侧面板底部勾选要参考的知识库（最多5个）</li>' +
      '        <li><strong>生成时生效</strong>：勾选的知识库内容会在生成推文时送入AI作为参考</li>' +
      '        <li><strong>删除知识库</strong>：在知识库管理弹窗中点击删除</li>' +
      '      </ul>' +
      '    </div>' +
      '    <div class="el-help-section">' +
      '      <h3>发布到公众号</h3>' +
      '      <p>生成并编辑满意后，可将文章直接发布到微信公众号。</p>' +
      '      <ol>' +
      '        <li>点击底部"发布到公众号"按钮打开发布弹窗</li>' +
      '        <li>在<strong>文章信息</strong>页填写标题和作者（标题默认提取H1）</li>' +
      '        <li>在<strong>封面图</strong>页上传封面，支持拖拽裁剪为900×500尺寸</li>' +
      '        <li>在<strong>微信配置</strong>页填写公众号APPID和APPSECRET（在公众号后台"开发→基本配置"中获取）</li>' +
      '        <li>在<strong>发布选项</strong>页选择"仅存草稿"（推荐，可在公众号后台二次确认）或"存草稿并发布"</li>' +
      '        <li>点击"发布草稿"执行推送，进度条实时显示上传/创建状态</li>' +
      '        <li>发布完成后可复制预览链接，在微信中打开查看效果</li>' +
      '      </ol>' +
      '      <p style="color:#e67e22;font-size:12px">注意：图片会自动裁剪以适配公众号容器比例（用户手动裁剪过的图片除外）。APPSECRET请妥善保管，仅用于本次发布。</p>' +
      '    </div>' +
      '    <div class="el-help-section">' +
      '      <h3>快捷操作</h3>' +
      '      <ul>' +
      '        <li><strong>复制HTML</strong>：将当前文章HTML复制到剪贴板，可粘贴到其他编辑器</li>' +
      '        <li><strong>下载文件</strong>：下载为HTML文件，包含所有图片（Base64内嵌），可离线查看</li>' +
      '        <li><strong>重新生成</strong>：用当前配置重新让AI生成文章</li>' +
      '        <li><strong>清空</strong>：清空预览区和输入区，重新开始</li>' +
      '      </ul>' +
      '    </div>' +
      '  </div>' +
      '  <div class="modal-footer">' +
      '    <button id="elHelpClose" class="btn-secondary">关闭</button>' +
      '  </div>' +
      '</div>';

    document.body.appendChild(modal);

    modal.addEventListener('click', function (e) { if (e.target === modal) modal.remove(); });
    modal.querySelector('#elHelpClose').addEventListener('click', function () { modal.remove(); });
  }

  // ============ Logout handler ============

  async function handleLogout() {
    await Auth.logout();
    showToast('已登出', 'success');
    renderUserMenu();
    refreshSaveTemplateBtn();
    refreshPromptSelector();
    resetPromptSection();
  }

  function resetPromptSection() {
    window.AppState.currentPromptId = null;
    window.AppState.promptContent = null;
    var textarea = document.getElementById('elPromptTextarea');
    if (textarea) {
      textarea.value = window._promptDefaultText || '';
    }
    var select = document.getElementById('elPromptSelect');
    if (select) select.value = '';
  }

  // ============ Form fill from template config ============

  function fillFormFromConfig(config) {
    if (!config) return;

    document.getElementById('hasLinks').checked = config.has_links || false;
    document.getElementById('linksTitle').value = config.links_title || '相关链接';
    document.getElementById('author').value = config.author || '';
    document.getElementById('photographer').value = config.photographer || '';
    document.getElementById('editor').value = config.editor || '';
    if (typeof toggleLinksOptions === 'function') toggleLinksOptions();

    var linksContainer = document.getElementById('linksList');
    linksContainer.innerHTML = '';
    if (config.links && config.links.length > 0) {
      config.links.forEach(function (link) {
        if (typeof addLinkRow === 'function') addLinkRow(link.标题, link.url);
      });
    } else {
      if (typeof addLinkRow === 'function') addLinkRow('', '');
    }

    document.getElementById('themeColor').value = config.theme_color || '#003366';
    document.getElementById('textColor').value = config.text_color || '#3e3e3e';
    document.getElementById('fontFamily').value = config.font_family || "system-ui, -apple-system, 'Segoe UI', Roboto";
    document.getElementById('fontSize').value = config.font_size || '15px';
    document.getElementById('lineHeight').value = config.line_height || '1.8';
    var titleSizes = config.title_font_sizes || {};
    document.getElementById('h1Size').value = titleSizes.h1 || '24px';
    document.getElementById('h2Size').value = titleSizes.h2 || '18px';
    document.getElementById('h3Size').value = titleSizes.h3 || '16px';

    var decoSet = config.decoration_set || {};
    setSelectValue('titleBox', decoSet.title_box);
    setSelectValue('textBox', decoSet.text_box);
    setSelectValue('divider', decoSet.divider);
    setSelectValue('imageSep', decoSet.image_separator);
  }

  function setSelectValue(selectId, value) {
    if (!value) return;
    var select = document.getElementById(selectId);
    for (var i = 0; i < select.options.length; i++) {
      if (select.options[i].value === value) {
        select.options[i].selected = true;
        return;
      }
    }
  }

  // ============ Login modal ============

  function openLoginModal() {
    var modal = createLoginModal();
    document.body.appendChild(modal);
    bindLoginModalEvents(modal);
  }

  function createLoginModal() {
    var div = document.createElement('div');
    div.className = 'modal-overlay';
    div.id = 'elLoginOverlay';
    div.innerHTML =
      '<div class="modal-dialog el-login-dialog">' +
      '  <div class="modal-header">' +
      '    <span id="elLoginTab" class="el-auth-tab active">登录</span>' +
      '    <span id="elRegisterTab" class="el-auth-tab">注册</span>' +
      '  </div>' +
      '  <div class="el-auth-body">' +
      '    <form id="elLoginForm" class="el-auth-form">' +
      '      <div class="form-group">' +
      '        <label>邮箱</label>' +
      '        <input type="email" id="elLoginEmail" placeholder="请输入邮箱" required>' +
      '      </div>' +
      '      <div class="form-group">' +
      '        <label>密码</label>' +
      '        <input type="password" id="elLoginPassword" placeholder="请输入密码" required>' +
      '      </div>' +
      '      <div id="elLoginError" class="el-auth-error"></div>' +
      '      <button type="submit" class="btn-primary">登录</button>' +
      '    </form>' +
      '    <form id="elRegisterForm" class="el-auth-form" style="display:none">' +
      '      <div class="form-group">' +
      '        <label>用户名</label>' +
      '        <input type="text" id="elRegUsername" placeholder="请输入用户名" required maxlength="50">' +
      '      </div>' +
      '      <div class="form-group">' +
      '        <label>邮箱</label>' +
      '        <input type="email" id="elRegEmail" placeholder="请输入邮箱" required>' +
      '      </div>' +
      '      <div class="form-group">' +
      '        <label>密码（至少6位）</label>' +
      '        <input type="password" id="elRegPassword" placeholder="请输入密码" required minlength="6">' +
      '      </div>' +
      '      <div class="form-group">' +
      '        <label>确认密码</label>' +
      '        <input type="password" id="elRegPassword2" placeholder="请再次输入密码" required>' +
      '      </div>' +
      '      <div id="elRegisterError" class="el-auth-error"></div>' +
      '      <button type="submit" class="btn-primary">注册</button>' +
      '    </form>' +
      '  </div>' +
      '</div>';
    return div;
  }

  function bindLoginModalEvents(modal) {
    modal.querySelector('#elLoginTab').addEventListener('click', function () {
      this.classList.add('active');
      modal.querySelector('#elRegisterTab').classList.remove('active');
      modal.querySelector('#elLoginForm').style.display = '';
      modal.querySelector('#elRegisterForm').style.display = 'none';
    });
    modal.querySelector('#elRegisterTab').addEventListener('click', function () {
      this.classList.add('active');
      modal.querySelector('#elLoginTab').classList.remove('active');
      modal.querySelector('#elLoginForm').style.display = 'none';
      modal.querySelector('#elRegisterForm').style.display = '';
    });

    modal.addEventListener('click', function (e) {
      if (e.target === modal) closeLoginModal();
    });

    modal.querySelector('#elLoginForm').addEventListener('submit', async function (e) {
      e.preventDefault();
      var email = modal.querySelector('#elLoginEmail').value.trim();
      var password = modal.querySelector('#elLoginPassword').value;
      var errEl = modal.querySelector('#elLoginError');

      if (!email || !password) { errEl.textContent = '请填写邮箱和密码'; return; }

      try {
        await Auth.login(email, password);
        closeLoginModal();
        showToast('登录成功', 'success');
        refreshAll();
      } catch (err) {
        errEl.textContent = (err.data && err.data.detail) || '登录失败';
      }
    });

    modal.querySelector('#elRegisterForm').addEventListener('submit', async function (e) {
      e.preventDefault();
      var username = modal.querySelector('#elRegUsername').value.trim();
      var email = modal.querySelector('#elRegEmail').value.trim();
      var password = modal.querySelector('#elRegPassword').value;
      var password2 = modal.querySelector('#elRegPassword2').value;
      var errEl = modal.querySelector('#elRegisterError');

      if (!username || !email || !password) { errEl.textContent = '请填写所有必填字段'; return; }
      if (password.length < 6) { errEl.textContent = '密码至少6个字符'; return; }
      if (password !== password2) { errEl.textContent = '两次密码不一致'; return; }

      try {
        await Auth.register(username, email, password);
        await Auth.login(email, password);
        closeLoginModal();
        showToast('注册成功', 'success');
        refreshAll();
      } catch (err) {
        errEl.textContent = (err.data && err.data.detail) || '注册失败';
      }
    });
  }

  function closeLoginModal() {
    var modal = document.getElementById('elLoginOverlay');
    if (modal) modal.remove();
  }

  // ============ Save template visibility ============

  function refreshSaveTemplateBtn() {
    var btn = document.getElementById('elSaveTemplateBtn');
    if (!btn) return;
    btn.style.display = Auth.isLoggedIn() ? '' : 'none';
  }

  // ============ Public refresh ============

  async function refreshAll() {
    renderUserMenu();
    refreshSaveTemplateBtn();
    refreshPromptSelector();
    if (Auth.isLoggedIn()) {
      try {
        var templates = await Templates.list();
        var defaultTmpl = templates.find(function (t) { return t.is_default; });
        if (defaultTmpl) {
          var config = await Templates.loadConfig(defaultTmpl.id);
          fillFormFromConfig(config);
        }
      } catch (e) {
        console.error('[user-ui] 加载模板列表失败:', e);
      }
    }
  }

  window.addEventListener('user-changed', function () {
    renderUserMenu();
    refreshSaveTemplateBtn();
    refreshPromptSelector();
  });

  window.addEventListener('templates-changed', function () {
    // no persistent bar to update; managed via modals
  });

  // Init on DOM ready
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', function () {
      renderPromptSection();
      bindSaveTemplateBtn();
    });
  } else {
    renderPromptSection();
    bindSaveTemplateBtn();
  }

  window.EL.UserUI = {
    refresh: refreshAll,
    renderUserMenu: renderUserMenu,
    refreshPromptSelector: refreshPromptSelector,
    fillFormFromConfig: fillFormFromConfig,
  };
})();
