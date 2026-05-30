/**
 * Editor Core - injected into preview iframe.
 * All in-browser editing: click-to-edit, move, insert, crop, decoration switching.
 */
(function () {
  'use strict';

  let editMode = false;
  let themeColor = '#003366';
  let decoOptions = null;
  let cropState = null;

  // ==================== postMessage Listener ====================

  window.addEventListener('message', function (e) {
    var msg = e.data;
    if (!msg || !msg.type) return;

    switch (msg.type) {
      case 'editor:setMode':
        if (msg.mode === 'edit') enableEditMode();
        else disableEditMode();
        break;
      case 'editor:updateStyle':
        if (msg.key === 'themeColor') {
          onThemeColorChange(msg.value);
        } else {
          applyStyle(msg.key, msg.value);
        }
        break;
      case 'editor:imageInserted':
        insertImageAtCursor(msg.base64, msg.filename);
        break;
      case 'editor:imagesInserted':
        handleMultiImageInsert(msg.images, window._elInsertAfter);
        window._elInsertAfter = null;
        break;
      case 'editor:reset':
        resetDocument(msg.html);
        break;
      case 'editor:getHTML':
        sendHTML();
        break;
      case 'editor:setDecoOptions':
        decoOptions = msg.options;
        break;
      case 'editor:setThemeColor':
        themeColor = msg.color;
        break;
      case 'editor:reRenderTheme':
        reRenderTheme(msg.color);
        break;
    }
  });

  function sendHTML() {
    var clone = document.body.cloneNode(true);
    cleanupClone(clone);
    window.parent.postMessage({
      type: 'editor:html',
      html: '<!DOCTYPE html><html><head>' + (document.head.innerHTML || '') + '</head><body>' + clone.innerHTML + '</body></html>'
    }, '*');
  }

  function cleanupClone(clone) {
    clone.querySelectorAll('.el-controls, .el-selection-toolbar, .el-image-overlay,' +
      '.el-insert-menu, .el-deco-menu, .el-crop-overlay, .el-crop-dialog,' +
      '.el-crop-backdrop, .el-theme-confirm, .el-layout-btns, .el-carousel-wrap').forEach(function (el) { el.remove(); });
    clone.querySelectorAll('.el-editing, .el-hover, .el-moving-up, .el-moving-down').forEach(function (el) {
      el.classList.remove('el-editing', 'el-hover', 'el-moving-up', 'el-moving-down');
      el.removeAttribute('contenteditable');
    });
    clone.querySelectorAll('[data-el-original-src]').forEach(function (el) {
      el.removeAttribute('data-el-original-src');
    });
  }

  // ==================== Edit Mode Toggle ====================

  function enableEditMode() {
    if (editMode) return;
    editMode = true;
    document.body.classList.add('el-edit-mode');
    addAllControls();
  }

  function disableEditMode() {
    editMode = false;
    document.body.classList.remove('el-edit-mode');
    removeAllControls();
    hideSelectionToolbar();
    hideCropUI();
    exitAllEditing();
  }

  function exitAllEditing() {
    document.body.querySelectorAll('.el-editing').forEach(function (el) {
      el.classList.remove('el-editing');
      el.setAttribute('contenteditable', 'false');
    });
  }

  // ==================== Element Controls (↑ ↓ + e) ====================

  function addAllControls() {
    // First wrap all images
    wrapAllImages();
    // Normalize layout classes so CSS fixes apply to all groups
    normalizeImageGroups();
    // Then add controls to block-level elements
    var elements = getControllableElements();
    elements.forEach(function (el, i) {
      addElementControls(el, i, elements.length);
    });
  }

  function wrapAllImages() {
    document.body.querySelectorAll('img').forEach(function (img) {
      if (img.closest('.el-controls') || img.closest('.el-selection-toolbar') ||
          img.closest('.el-crop-dialog') || img.closest('.el-img-wrapper')) return;
      wrapImageForEdit(img);
    });
  }

  function getControllableElements() {
    // Select all potential controllable elements, then filter
    var all = document.body.querySelectorAll('h1, h2, h3, h4, h5, h6, p, figure, hr, blockquote, [data-el-type], .image-wrapper');
    var list = [];
    for (var i = 0; i < all.length; i++) {
      var el = all[i];
      // Skip if inside an editable element that's being controlled already
      // (e.g., p inside a text_box wrapper - the wrapper is controlled, not the p)
      var parent = el.parentElement;
      var skip = false;
      while (parent && parent !== document.body) {
        if (parent.hasAttribute && parent.hasAttribute('data-el-type') &&
            (parent.getAttribute('data-el-type') === 'text_box' || parent.getAttribute('data-el-type') === 'title_box')) {
          // This element is inside a decoration wrapper; skip it, wrapper is controlled
          skip = true;
          break;
        }
        parent = parent.parentElement;
      }
      // Also skip elements that are deep inside a figure (figcaption etc)
      if (el.closest('figure') && el.tagName !== 'FIGURE') continue;
      // Skip editor artifacts
      if (el.closest('.el-controls') || el.closest('.el-selection-toolbar') ||
          el.closest('.el-insert-menu') || el.closest('.el-deco-menu') ||
          el.closest('.el-crop-overlay') || el.closest('.el-crop-dialog')) continue;
      // Skip standalone image wrappers (they're inside figures which are controlled)
      if (el.classList.contains('el-img-wrapper')) continue;

      if (!skip) list.push(el);
    }
    return list;
  }

  function addElementControls(el, index, total) {
    if (el.querySelector('.el-controls') || (el.nextSibling && el.nextSibling.classList && el.nextSibling.classList.contains('el-controls'))) return;

    var ctrl = document.createElement('div');
    ctrl.className = 'el-controls';

    // Insert button
    var addBtn = document.createElement('button');
    addBtn.className = 'el-ctrl-btn el-ctrl-add';
    addBtn.textContent = '+';
    addBtn.title = '插入';
    addBtn.addEventListener('click', function (e) { e.stopPropagation(); showInsertMenu(addBtn, el); });

    // Up button
    var upBtn = document.createElement('button');
    upBtn.className = 'el-ctrl-btn el-ctrl-up';
    upBtn.textContent = '↑';
    upBtn.title = '上移';
    if (index === 0) upBtn.disabled = true;
    upBtn.addEventListener('click', function (e) { e.stopPropagation(); moveElementUp(el); });

    // Down button
    var downBtn = document.createElement('button');
    downBtn.className = 'el-ctrl-btn el-ctrl-down';
    downBtn.textContent = '↓';
    downBtn.title = '下移';
    if (index === total - 1) downBtn.disabled = true;
    downBtn.addEventListener('click', function (e) { e.stopPropagation(); moveElementDown(el); });

    // e button for decorated elements (click to show menu below)
    var eBtn = null;
    var decoType = el.getAttribute('data-el-type');
    if (decoType && decoOptions && decoOptions[decoType]) {
      eBtn = document.createElement('button');
      eBtn.className = 'el-ctrl-btn el-ctrl-style';
      eBtn.textContent = 'e';
      eBtn.title = '更换样式';
      eBtn.addEventListener('click', function (ev) {
        ev.stopPropagation();
        hideAllMenus();
        var menu = buildDecoStyleMenu(eBtn, el, decoType);
        if (!menu) return;
        setTimeout(function () {
          document.addEventListener('click', function closeDeco(e) {
            if (!menu.contains(e.target) && e.target !== eBtn) {
              menu.remove();
              document.removeEventListener('click', closeDeco);
            }
          });
        }, 0);
      });
    }

    // Delete button (far right)
    var delBtn = document.createElement('button');
    delBtn.className = 'el-ctrl-btn el-ctrl-del';
    delBtn.textContent = '✕';
    delBtn.title = '删除';
    delBtn.addEventListener('click', function (e) {
      e.stopPropagation();
      if (!confirm('确定删除此元素？')) return;
      hideAllMenus();
      el.remove();
      refreshControls();
    });

    ctrl.appendChild(addBtn);
    ctrl.appendChild(upBtn);
    ctrl.appendChild(downBtn);
    if (eBtn) ctrl.appendChild(eBtn);
    ctrl.appendChild(delBtn);

    // Carousel containers: wrap + position controls at upper-right outside container
    var isCarousel = /\bel-layout-carousel\b/.test(el.className) || /\bcarousel\b/.test(el.className);
    if (isCarousel) {
      var wrap = document.createElement('div');
      wrap.className = 'el-carousel-wrap';
      wrap.style.position = 'relative';
      wrap.style.display = el.style.display || 'block';
      el.parentNode.insertBefore(wrap, el);
      wrap.appendChild(el);
      ctrl.style.position = 'absolute';
      ctrl.style.top = '0';
      ctrl.style.right = '-90px';
      ctrl.style.marginTop = '0';
      wrap.appendChild(ctrl);
    } else {
      // Position relative on the element for absolute positioning of controls
      var origPos = el.style.position;
      if (!origPos || origPos === 'static') {
        el.style.position = 'relative';
      }
      el.appendChild(ctrl);
    }
  }

  function removeAllControls() {
    document.body.querySelectorAll('.el-controls').forEach(function (c) { c.remove(); });
    // Unwrap carousel wrappers
    document.body.querySelectorAll('.el-carousel-wrap').forEach(function (w) {
      var child = w.querySelector('.el-layout-carousel') || w.querySelector('[class*="carousel"]');
      if (!child) child = w.firstElementChild;
      if (child && w.parentNode) {
        w.parentNode.insertBefore(child, w);
        w.remove();
      }
    });
  }

  function refreshControls() {
    removeAllControls();
    addAllControls();
  }

  // ==================== Move Up / Down ====================

  function moveElementUp(el) {
    var prev = el.previousElementSibling;
    if (!prev) return;
    // skip control elements
    while (prev && (prev.classList.contains('el-controls') || prev.classList.contains('el-selection-toolbar'))) {
      prev = prev.previousElementSibling;
    }
    if (!prev) return;

    el.classList.add('el-moving-up');
    el.parentNode.insertBefore(el, prev);
    setTimeout(function () { el.classList.remove('el-moving-up'); }, 300);
    refreshControls();
  }

  function moveElementDown(el) {
    var next = el.nextElementSibling;
    if (!next) return;
    while (next && (next.classList.contains('el-controls') || next.classList.contains('el-selection-toolbar'))) {
      next = next.nextElementSibling;
    }
    if (!next) return;

    el.classList.add('el-moving-down');
    // Insert after next
    if (next.nextElementSibling) {
      el.parentNode.insertBefore(el, next.nextElementSibling);
    } else {
      el.parentNode.appendChild(el);
    }
    setTimeout(function () { el.classList.remove('el-moving-down'); }, 300);
    refreshControls();
  }

  // ==================== Click to Edit ====================

  document.body.addEventListener('click', function (e) {
    if (!editMode) return;
    // Ignore clicks on controls, buttons, links
    if (e.target.closest('.el-controls') || e.target.closest('.el-selection-toolbar') ||
        e.target.closest('.el-insert-menu') || e.target.closest('.el-deco-menu') ||
        e.target.closest('.el-image-overlay') || e.target.closest('.el-crop-overlay') ||
        e.target.closest('.el-crop-dialog') || e.target.closest('.el-theme-confirm') ||
        e.target.closest('a') || e.target.closest('button')) return;

    // Find editable element under cursor
    var target = findEditableElement(e.target);

    // If clicking outside any editing element, exit current editing
    var current = document.body.querySelector('.el-editing');
    if (current && (!target || target !== current)) {
      exitTextEdit(current);
    }

    // If clicked on an editable element, enter it
    if (target && !target.classList.contains('el-editing')) {
      enterTextEdit(target);
    }
  });

  function findEditableElement(el) {
    while (el && el !== document.body) {
      var tag = el.tagName;
      if (/^(P|H[1-6]|LI|BLOCKQUOTE|FIGCAPTION)$/i.test(tag) && !el.closest('.el-controls')) {
        return el;
      }
      // Don't go past decoration wrappers - they're not text-editable themselves
      if (el.hasAttribute && el.hasAttribute('data-el-type')) return null;
      el = el.parentElement;
    }
    return null;
  }

  function enterTextEdit(el) {
    exitAllEditing();
    el.classList.add('el-editing');
    el.setAttribute('contenteditable', 'true');
    el.focus();
  }

  function exitTextEdit(el) {
    el.classList.remove('el-editing');
    el.setAttribute('contenteditable', 'false');
    var sel = window.getSelection();
    if (sel) sel.removeAllRanges();
  }

  document.addEventListener('keydown', function (e) {
    if (!editMode) return;
    var editing = document.body.querySelector('.el-editing');
    if (!editing) return;
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      exitTextEdit(editing);
    }
    if (e.key === 'Escape') {
      e.preventDefault();
      exitTextEdit(editing);
    }
  });

  // ==================== Selection Toolbar (重点标注 / 链接) ====================

  var selectionToolbar = null;

  document.addEventListener('mouseup', function (e) {
    if (!editMode) return;
    if (e.target.closest('.el-selection-toolbar') || e.target.closest('.el-controls') ||
        e.target.closest('.el-image-overlay')) return;
    setTimeout(showSelectionToolbar, 10);
  });

  function showSelectionToolbar() {
    var sel = window.getSelection();
    if (!sel || sel.isCollapsed || !sel.rangeCount) {
      hideSelectionToolbar();
      return;
    }
    var range = sel.getRangeAt(0);
    if (!range || range.collapsed) { hideSelectionToolbar(); return; }

    var rect = range.getBoundingClientRect();
    if (!rect || rect.width === 0) { hideSelectionToolbar(); return; }

    if (!selectionToolbar) {
      selectionToolbar = buildSelectionToolbar();
      document.body.appendChild(selectionToolbar);
    }

    var top = rect.top + window.scrollY - selectionToolbar.offsetHeight - 8;
    var left = rect.left + window.scrollX + rect.width / 2 - selectionToolbar.offsetWidth / 2;
    selectionToolbar.style.top = Math.max(4, top) + 'px';
    selectionToolbar.style.left = Math.max(4, left) + 'px';
    selectionToolbar.style.display = 'flex';
  }

  function buildSelectionToolbar() {
    var tb = document.createElement('div');
    tb.className = 'el-selection-toolbar';
    tb.innerHTML =
      '<button data-action="highlight" title="重点标注">重点标注</button>' +
      '<button data-action="unhighlight" title="取消标注">取消标注</button>' +
      '<button data-action="link" title="添加链接">链接</button>';
    tb.addEventListener('mousedown', function (e) { e.preventDefault(); });
    tb.addEventListener('click', function (e) {
      e.preventDefault();
      var btn = e.target.closest('button');
      if (!btn) return;
      handleToolbarAction(btn.dataset.action);
    });
    return tb;
  }

  function hideSelectionToolbar() {
    if (selectionToolbar) selectionToolbar.style.display = 'none';
  }

  function handleToolbarAction(action) {
    var sel = window.getSelection();
    if (!sel || !sel.rangeCount) return;

    if (action === 'highlight') {
      // Wrap selection in <strong> with theme color background + bold
      var strong = document.createElement('strong');
      strong.style.cssText = 'color:' + themeColor + '; font-weight:700;';
      try {
        var range = sel.getRangeAt(0);
        range.surroundContents(strong);
      } catch (ex) {
        document.execCommand('bold', false, null);
        // Try to apply style to the new bold element
        var parent = sel.anchorNode;
        if (parent && parent.parentElement && parent.parentElement.tagName === 'STRONG') {
          parent.parentElement.style.cssText = 'color:' + themeColor + '; font-weight:700;';
        }
      }
    } else if (action === 'unhighlight') {
      // Unwrap strong and remove formatting
      var sel2 = window.getSelection();
      if (sel2.rangeCount) {
        var rng = sel2.getRangeAt(0);
        var container = rng.commonAncestorContainer;
        var strongEl = container.nodeType === 3 ? container.parentElement.closest('strong') : container.closest('strong');
        if (strongEl) {
          // Unwrap the strong element
          var parent2 = strongEl.parentNode;
          while (strongEl.firstChild) {
            parent2.insertBefore(strongEl.firstChild, strongEl);
          }
          parent2.removeChild(strongEl);
        }
      }
    } else if (action === 'link') {
      var url = prompt('输入链接 URL:');
      if (url) {
        if (!/^https?:\/\//i.test(url)) url = 'https://' + url;
        document.execCommand('createLink', false, url);
      }
    }
    hideSelectionToolbar();
  }

  function hexToRgba(hex, alpha) {
    hex = hex.replace('#', '');
    if (hex.length === 3) hex = hex.split('').map(function (c) { return c + c; }).join('');
    var r = parseInt(hex.substring(0, 2), 16);
    var g = parseInt(hex.substring(2, 4), 16);
    var b = parseInt(hex.substring(4, 6), 16);
    return 'rgba(' + r + ',' + g + ',' + b + ',' + alpha + ')';
  }

  document.addEventListener('selectionchange', function () {
    if (!selectionToolbar || selectionToolbar.style.display === 'none') return;
    var sel = window.getSelection();
    if (!sel || sel.isCollapsed) hideSelectionToolbar();
  });

  // ==================== Image Controls (overlay: ✕ ↻ layout crop) ====================

  function wrapImageForEdit(img) {
    if (img.parentElement && img.parentElement.classList.contains('el-img-wrapper')) return img.parentElement;

    var wrapper = document.createElement('span');
    wrapper.className = 'el-img-wrapper';
    wrapper.style.display = 'inline-block';
    wrapper.style.position = 'relative';

    img.parentNode.insertBefore(wrapper, img);
    wrapper.appendChild(img);

    // Overlay with controls
    var overlay = document.createElement('span');
    overlay.className = 'el-image-overlay';
    overlay.innerHTML =
      '<button class="el-img-btn el-delete-btn" title="删除">✕</button>' +
      '<button class="el-img-btn el-replace-btn" title="替换">↻</button>' +
      '<button class="el-img-btn el-crop-btn" title="裁剪">✂</button>';
    wrapper.appendChild(overlay);

    // Layout switch buttons for image groups - one set per group, top-left
    var groupContainer = wrapper.closest('figure') || wrapper.closest('.image-wrapper');
    if (groupContainer && !groupContainer.querySelector('.el-layout-btns')) {
      var allImgs = groupContainer.querySelectorAll('img');
      var realCount = 0;
      allImgs.forEach(function (im) {
        if (!im.closest('.el-controls') && !im.closest('.el-crop-dialog')) realCount++;
      });
      if (realCount >= 1) {
        var layoutBtns = document.createElement('span');
        layoutBtns.className = 'el-layout-btns';
        buildLayoutButtons(layoutBtns, groupContainer, realCount);
        layoutBtns.addEventListener('click', function (ev) {
          ev.stopPropagation();
          var b = ev.target.closest('button');
          if (!b || b.disabled) return;
          applyImageLayout(b.dataset.layout, groupContainer);
          updateLayoutButtons(groupContainer);
        });
        groupContainer.style.position = groupContainer.style.position || 'relative';
        groupContainer.appendChild(layoutBtns);
      }
    }

    return wrapper;
  }

  function getCurrentLayout(container) {
    var cls = container.className;
    if (/\bel-layout-single\b/.test(cls)) return 'single';
    if (/\bel-layout-side\b/.test(cls)) return 'side';
    if (/\bel-layout-carousel\b/.test(cls)) return 'carousel';
    // Also check for original classes from the generator
    if (/\bsingle\b/.test(cls)) return 'single';
    if (/\bside-by-side\b/.test(cls)) return 'side';
    if (/\bcarousel\b/.test(cls)) return 'carousel';
    return '';
  }

  function getDefaultLayout(count) {
    if (count === 1) return 'single';
    if (count === 2) return 'side';
    return 'carousel';
  }

  function normalizeImageGroups() {
    var groups = document.body.querySelectorAll('figure, .image-wrapper');
    groups.forEach(function (g) {
      var layout = getCurrentLayout(g);
      if (!layout) {
        var count = g.querySelectorAll('.el-img-wrapper').length;
        if (count === 0) count = g.querySelectorAll('img').length;
        layout = getDefaultLayout(count);
      }
      g.classList.remove('el-layout-single', 'el-layout-side', 'el-layout-carousel');
      g.classList.add('el-layout-' + layout);
    });
  }

  function buildLayoutButtons(btnsEl, container, imgCount) {
    var current = getCurrentLayout(container);
    var layouts = [
      { id: 'single', label: '单张' },
      { id: 'side', label: '并排' },
      { id: 'carousel', label: '轮播' }
    ];
    btnsEl.innerHTML = '';
    layouts.forEach(function (l) {
      var btn = document.createElement('button');
      btn.dataset.layout = l.id;
      btn.textContent = l.label;
      // Disable rules: single only for 1 image; others only for 2+
      if (imgCount === 1) {
        btn.disabled = l.id !== 'single';
      } else {
        btn.disabled = l.id === 'single';
      }
      if (l.id === current) btn.classList.add('el-layout-active');
      btnsEl.appendChild(btn);
    });
  }

  function updateLayoutButtons(container) {
    var btns = container.querySelector('.el-layout-btns');
    if (!btns) return;
    var count = container.querySelectorAll('.el-img-wrapper').length;
    buildLayoutButtons(btns, container, count);
  }

  function autoAdaptImageGroup(container) {
    if (!container) return;
    var count = container.querySelectorAll('.el-img-wrapper').length;
    if (count === 0) {
      container.remove();
      refreshControls();
      return;
    }
    var defaultLayout = getDefaultLayout(count);
    applyImageLayout(defaultLayout, container);
    updateLayoutButtons(container);
  }

  // Global click handler for image buttons
  document.body.addEventListener('click', function (e) {
    if (!editMode) return;

    if (e.target.classList.contains('el-delete-btn')) {
      e.stopPropagation();
      var wrapper = e.target.closest('.el-img-wrapper');
      if (wrapper) {
        var container = wrapper.closest('figure') || wrapper.closest('.image-wrapper');
        var parentEl = wrapper.parentElement;
        wrapper.remove();
        // Also remove the parent container (e.g. aspect-ratio div) if it's not the group itself
        if (parentEl && parentEl !== container && parentEl.tagName !== 'FIGURE') {
          parentEl.remove();
        }
        if (container) {
          autoAdaptImageGroup(container);
        }
        refreshControls();
      }
    }

    if (e.target.classList.contains('el-replace-btn')) {
      e.stopPropagation();
      window._elReplaceTarget = e.target.closest('.el-img-wrapper');
      window.parent.postMessage({ type: 'editor:requestImageUpload' }, '*');
    }

    if (e.target.classList.contains('el-crop-btn')) {
      e.stopPropagation();
      var w = e.target.closest('.el-img-wrapper');
      if (!w) return;
      var group = w.closest('figure') || w.closest('.image-wrapper');
      var allWrappers = group ? group.querySelectorAll('.el-img-wrapper') : null;
      if (allWrappers && allWrappers.length > 1) {
        showMultiCropDialog(group);
      } else if (w) {
        startSingleCrop(w);
      }
    }
  });

  // ==================== Image Layout ====================

  function applyImageLayout(layout, container) {
    container.classList.remove('el-layout-single', 'el-layout-side', 'el-layout-carousel');
    container.classList.add('el-layout-' + layout);

    // Reset all container inline styles that any layout may have set
    container.style.overflowX = '';
    container.style.overflowY = '';
    container.style.whiteSpace = '';
    container.style.WebkitOverflowScrolling = '';
    container.style.display = '';
    container.style.flexDirection = '';
    container.style.gap = '';
    container.style.justifyContent = '';
    container.style.fontSize = '';

    // Re-apply container inline styles for the target layout (works even without editor-core.css)
    if (layout === 'side') {
      container.style.display = 'flex';
      container.style.gap = '4px';
      container.style.justifyContent = 'center';
    } else if (layout === 'carousel') {
      container.style.display = 'block';
      container.style.overflowX = 'auto';
      container.style.overflowY = 'hidden';
      container.style.whiteSpace = 'nowrap';
      container.style.WebkitOverflowScrolling = 'touch';
      container.style.fontSize = '0';
    } else {
      // single: block layout, no special container styles needed
      container.style.display = 'block';
    }

    // Reset wrappers and imgs, then apply layout-specific styles
    var wrappers = container.querySelectorAll('.el-img-wrapper');
    wrappers.forEach(function (w) {
      w.style.display = '';
      w.style.marginBottom = '';
      w.style.marginRight = '';
      w.style.flex = '';
      w.style.minWidth = '';
      w.style.verticalAlign = '';
      w.style.width = '';
      w.style.height = '';
      var img = w.querySelector('img');
      if (img) {
        img.style.width = '';
        img.style.height = '';
        img.style.objectFit = '';
        img.style.maxWidth = '100%';
      }
      if (layout === 'side') {
        w.style.flex = '1';
        w.style.minWidth = '0';
        if (img) {
          img.style.width = '100%';
          img.style.height = '100%';
          img.style.objectFit = 'cover';
        }
      } else if (layout === 'carousel') {
        w.style.display = 'inline-block';
        w.style.verticalAlign = 'top';
        w.style.marginRight = '8px';
      } else if (layout === 'single') {
        w.style.display = 'block';
      }
    });

    // Reset inner children (AI-generated divs between container and .el-img-wrapper)
    var children = container.children;
    for (var ci = 0; ci < children.length; ci++) {
      var child = children[ci];
      if (child.classList.contains('el-img-wrapper') || child.classList.contains('el-controls') || child.classList.contains('el-layout-btns')) continue;
      child.style.display = '';
      child.style.verticalAlign = '';
      child.style.marginTop = '';
      child.style.marginBottom = '';
      child.style.marginRight = '';
      child.style.flex = '';
      child.style.minWidth = '';
      child.style.width = '';
      if (layout === 'carousel') {
        child.style.display = 'inline-block';
        child.style.verticalAlign = 'top';
        child.style.marginTop = '0';
        child.style.marginBottom = '0';
        child.style.marginRight = '10px';
      } else if (layout === 'side') {
        child.style.display = 'flex';
        child.style.flexDirection = 'column';
        child.style.flex = '1';
        child.style.minWidth = '0';
      } else if (layout === 'single') {
        child.style.display = 'block';
      }
    }
  }

  // ==================== Image Crop ====================

  function getTargetAspectRatio(img) {
    // Check if image is inside an aspect-ratio container (carousel/side-by-side)
    var container = img.closest('[style*="aspect-ratio"]');
    if (container) {
      var style = container.getAttribute('style') || '';
      var m = style.match(/aspect-ratio:\s*(\d+)\s*\/\s*(\d+)/);
      if (m) return parseInt(m[1]) / parseInt(m[2]);
    }
    // Also check for the el-layout classes
    var group = img.closest('.el-layout-side, .el-layout-carousel');
    if (group) return 16 / 9;
    return null;
  }

  function startSingleCrop(wrapper) {
    hideCropUI();
    var img = wrapper.querySelector('img');
    if (!img) return;

    // Only lock aspect ratio for side-by-side and carousel; single/stack use free crop
    var group = img.closest('.el-layout-side, .el-layout-carousel');
    var targetRatio = group ? 16 / 9 : null;
    cropState = { type: 'single', wrapper: wrapper, img: img, targetRatio: targetRatio };

    var overlay = document.createElement('div');
    overlay.className = 'el-crop-overlay';

    var mask = document.createElement('div');
    mask.className = 'el-crop-mask';
    overlay.appendChild(mask);

    var box = document.createElement('div');
    box.className = 'el-crop-box';
    box.style.position = 'absolute';
    var imgRect = img.getBoundingClientRect();

    var cropW, cropH, cropX, cropY;
    if (targetRatio) {
      cropW = imgRect.width * 0.8;
      cropH = cropW / targetRatio;
      if (cropH > imgRect.height * 0.9) {
        cropH = imgRect.height * 0.9;
        cropW = cropH * targetRatio;
      }
    } else {
      cropW = imgRect.width * 0.8;
      cropH = imgRect.height * 0.8;
    }
    cropX = (imgRect.width - cropW) / 2;
    cropY = (imgRect.height - cropH) / 2;
    box.style.left = cropX + 'px';
    box.style.top = cropY + 'px';
    box.style.width = cropW + 'px';
    box.style.height = cropH + 'px';
    overlay.appendChild(box);

    // Corner handles
    ['nw', 'ne', 'sw', 'se'].forEach(function (dir) {
      var handle = document.createElement('div');
      handle.className = 'el-crop-handle el-crop-' + dir;
      box.appendChild(handle);
    });

    // Confirm / Cancel
    var actions = document.createElement('div');
    actions.className = 'el-crop-actions';
    actions.innerHTML = '<button class="el-crop-confirm">确认裁剪</button><button class="el-crop-cancel">取消</button>';
    overlay.appendChild(actions);

    overlay.querySelector('.el-crop-cancel').addEventListener('click', hideCropUI);
    overlay.querySelector('.el-crop-confirm').addEventListener('click', executeCrop);

    wrapper.style.position = 'relative';
    wrapper.appendChild(overlay);

    // Drag to move crop box, handle to resize
    initCropDrag(box, overlay, img);
  }

  function showMultiCropDialog(groupContainer) {
    hideCropUI();
    var wrappers = groupContainer.querySelectorAll('.el-img-wrapper');
    var imgs = [];
    wrappers.forEach(function (w) { imgs.push(w.querySelector('img')); });
    if (!imgs.length) return;

    // Multi-crop always uses free ratio
    cropState = { type: 'multi', container: groupContainer, imgs: imgs, targetRatio: null };

    var backdrop = document.createElement('div');
    backdrop.className = 'el-crop-backdrop';
    backdrop.addEventListener('click', function (e) { if (e.target === backdrop) hideCropUI(); });

    var dialog = document.createElement('div');
    dialog.className = 'el-crop-dialog';

    var header = document.createElement('div');
    header.className = 'el-crop-dialog-header';
    header.innerHTML = '<span>裁剪图片（调整第一个，其余同步）</span>';
    dialog.appendChild(header);

    var body = document.createElement('div');
    body.className = 'el-crop-dialog-body';

    var firstCropW, firstCropH;
    imgs.forEach(function (img, i) {
      var container = document.createElement('div');
      container.className = 'el-crop-img-container';
      container.style.position = 'relative';

      var clone = document.createElement('img');
      clone.src = img.src;
      clone.style.width = '280px';
      clone.style.display = 'block';
      container.appendChild(clone);

      var imgW = 280;
      var natW = clone.naturalWidth || img.naturalWidth || 1;
      var natH = clone.naturalHeight || img.naturalHeight || 1;
      var imgH = imgW * (natH / natW);

      var box = document.createElement('div');
      box.className = 'el-crop-box';
      box.style.position = 'absolute';
      box.style.boxShadow = '0 0 0 9999px rgba(0,0,0,0.2)';
      var cropW, cropH;
      if (i === 0) {
        cropW = imgW * 0.75;
        cropH = imgH * 0.75;
        firstCropW = cropW;
        firstCropH = cropH;
      } else {
        cropW = firstCropW;
        cropH = firstCropH;
      }
      box.style.left = ((imgW - cropW) / 2) + 'px';
      box.style.top = ((imgH - cropH) / 2) + 'px';
      box.style.width = cropW + 'px';
      box.style.height = cropH + 'px';
      box.dataset.imgIndex = i;
      container.appendChild(box);

      container.style.minHeight = imgH + 'px';

      if (i === 0) {
        ['nw', 'ne', 'sw', 'se'].forEach(function (dir) {
          var handle = document.createElement('div');
          handle.className = 'el-crop-handle el-crop-' + dir;
          box.appendChild(handle);
        });
      }

      body.appendChild(container);
    });

    dialog.appendChild(body);

    var footer = document.createElement('div');
    footer.className = 'el-crop-dialog-footer';
    footer.innerHTML = '<button class="el-crop-confirm">确认裁剪</button><button class="el-crop-cancel">取消</button>';
    dialog.appendChild(footer);

    backdrop.appendChild(dialog);
    document.body.appendChild(backdrop);

    backdrop.querySelector('.el-crop-cancel').addEventListener('click', hideCropUI);
    backdrop.querySelector('.el-crop-confirm').addEventListener('click', function () {
      executeMultiCrop();
      hideCropUI();
    });

    // Setup drag: first box resizable+draggable, others draggable only
    var allBoxes = dialog.querySelectorAll('.el-crop-box');
    var allImgs = dialog.querySelectorAll('.el-crop-img-container img');
    if (allBoxes.length && allImgs.length) {
      initMultiCropDrag(allBoxes, allImgs, dialog);
    }
  }

  function initCropDrag(box, overlay, img) {
    var isDragging = false;
    var isResizing = false;
    var resizeDir = null;
    var startX, startY, startL, startT, startW, startH;
    var imgW, imgH;

    function getImgSize() {
      var r = img.getBoundingClientRect();
      imgW = r.width;
      imgH = r.height;
    }

    box.addEventListener('mousedown', function (e) {
      if (e.target.classList.contains('el-crop-handle')) {
        isResizing = true;
        resizeDir = e.target.className.replace('el-crop-handle el-crop-', '');
      } else {
        isDragging = true;
      }
      getImgSize();
      startX = e.clientX;
      startY = e.clientY;
      startL = parseFloat(box.style.left);
      startT = parseFloat(box.style.top);
      startW = parseFloat(box.style.width);
      startH = parseFloat(box.style.height);
      e.preventDefault();
    });

    document.addEventListener('mousemove', function (e) {
      if (!isDragging && !isResizing) return;
      var dx = e.clientX - startX;
      var dy = e.clientY - startY;
      getImgSize();

      if (isResizing) {
        var ratio = cropState && cropState.targetRatio ? cropState.targetRatio : null;
        var newL = startL, newT = startT, newW = startW, newH = startH;
        if (resizeDir.indexOf('e') !== -1) newW = Math.max(20, startW + dx);
        if (resizeDir.indexOf('w') !== -1) { newW = Math.max(20, startW - dx); newL = startL + (startW - newW); }
        if (resizeDir.indexOf('s') !== -1) newH = Math.max(20, startH + dy);
        if (resizeDir.indexOf('n') !== -1) { newH = Math.max(20, startH - dy); newT = startT + (startH - newH); }

        if (ratio) {
          // Lock aspect ratio: use the dimension that changed most
          var wChange = Math.abs(newW - startW);
          var hChange = Math.abs(newH - startH);
          if (wChange >= hChange) {
            newH = newW / ratio;
            if (resizeDir.indexOf('n') !== -1) newT = startT + startH - newH;
          } else {
            newW = newH * ratio;
            if (resizeDir.indexOf('w') !== -1) newL = startL + startW - newW;
          }
        }

        // Clamp
        newL = Math.max(0, newL);
        newT = Math.max(0, newT);
        if (newL + newW > imgW) { newW = imgW - newL; if (ratio) newH = newW / ratio; }
        if (newT + newH > imgH) { newH = imgH - newT; if (ratio) newW = newH * ratio; }
        box.style.left = newL + 'px';
        box.style.top = newT + 'px';
        box.style.width = newW + 'px';
        box.style.height = newH + 'px';
      }

      if (isDragging) {
        var nl = Math.max(0, Math.min(startL + dx, imgW - startW));
        var nt = Math.max(0, Math.min(startT + dy, imgH - startH));
        box.style.left = nl + 'px';
        box.style.top = nt + 'px';
      }
    });

    document.addEventListener('mouseup', function () {
      isDragging = false;
      isResizing = false;
    });
  }

  function initMultiCropDrag(allBoxes, allImgs, dialog) {
    var isDragging = false;
    var isResizing = false;
    var activeBox = null;
    var activeImg = null;
    var activeIndex = -1;
    var resizeDir = null;
    var startX, startY, startL, startT, startW, startH;
    var imgW, imgH;

    function getImgSize(img) {
      var r = img.getBoundingClientRect();
      return { w: r.width, h: r.height };
    }

    function syncSizesFromBox(srcBox) {
      allBoxes.forEach(function (b, i) {
        if (i === 0) return; // skip first box (source)
        b.style.width = srcBox.style.width;
        b.style.height = srcBox.style.height;
        // Clamp position so box stays within image
        var sz = getImgSize(allImgs[i]);
        var bl = parseFloat(b.style.left);
        var bt = parseFloat(b.style.top);
        var bw = parseFloat(b.style.width);
        var bh = parseFloat(b.style.height);
        if (bl + bw > sz.w) b.style.left = Math.max(0, sz.w - bw) + 'px';
        if (bt + bh > sz.h) b.style.top = Math.max(0, sz.h - bh) + 'px';
      });
    }

    allBoxes.forEach(function (box, i) {
      box.addEventListener('mousedown', function (e) {
        activeBox = box;
        activeImg = allImgs[i];
        activeIndex = i;
        if (i === 0 && e.target.classList.contains('el-crop-handle')) {
          isResizing = true;
          resizeDir = e.target.className.replace('el-crop-handle el-crop-', '');
        } else {
          isDragging = true;
        }
        var sz = getImgSize(activeImg);
        imgW = sz.w; imgH = sz.h;
        startX = e.clientX; startY = e.clientY;
        startL = parseFloat(box.style.left);
        startT = parseFloat(box.style.top);
        startW = parseFloat(box.style.width);
        startH = parseFloat(box.style.height);
        e.preventDefault();
      });
    });

    document.addEventListener('mousemove', function (e) {
      if (!isDragging && !isResizing) return;
      var dx = e.clientX - startX;
      var dy = e.clientY - startY;
      var sz = getImgSize(activeImg);
      imgW = sz.w; imgH = sz.h;

      if (isResizing && activeIndex === 0) {
        var newL = startL, newT = startT, newW = startW, newH = startH;
        if (resizeDir.indexOf('e') !== -1) newW = Math.max(20, startW + dx);
        if (resizeDir.indexOf('w') !== -1) { newW = Math.max(20, startW - dx); newL = startL + (startW - newW); }
        if (resizeDir.indexOf('s') !== -1) newH = Math.max(20, startH + dy);
        if (resizeDir.indexOf('n') !== -1) { newH = Math.max(20, startH - dy); newT = startT + (startH - newH); }
        newL = Math.max(0, newL); newT = Math.max(0, newT);
        if (newL + newW > imgW) { newW = imgW - newL; }
        if (newT + newH > imgH) { newH = imgH - newT; }
        activeBox.style.left = newL + 'px'; activeBox.style.top = newT + 'px';
        activeBox.style.width = newW + 'px'; activeBox.style.height = newH + 'px';
        syncSizesFromBox(activeBox);
      }

      if (isDragging) {
        var nl = Math.max(0, Math.min(startL + dx, imgW - startW));
        var nt = Math.max(0, Math.min(startT + dy, imgH - startH));
        activeBox.style.left = nl + 'px';
        activeBox.style.top = nt + 'px';
      }
    });

    document.addEventListener('mouseup', function () {
      isDragging = false;
      isResizing = false;
      activeBox = null;
      activeIndex = -1;
    });
  }

  function executeCrop() {
    if (!cropState || cropState.type !== 'single') return;
    var img = cropState.img;
    var box = cropState.wrapper.querySelector('.el-crop-box');
    if (!box) return;

    var imgRect = img.getBoundingClientRect();
    var boxLeft = parseFloat(box.style.left);
    var boxTop = parseFloat(box.style.top);
    var boxW = parseFloat(box.style.width);
    var boxH = parseFloat(box.style.height);

    var scaleX = img.naturalWidth / imgRect.width;
    var scaleY = img.naturalHeight / imgRect.height;

    var canvas = document.createElement('canvas');
    canvas.width = boxW * scaleX;
    canvas.height = boxH * scaleY;
    var ctx = canvas.getContext('2d');
    ctx.drawImage(img, boxLeft * scaleX, boxTop * scaleY, boxW * scaleX, boxH * scaleY, 0, 0, canvas.width, canvas.height);

    // Preserve existing CSS dimensions so layout doesn't break
    var oldW = img.style.width;
    var oldH = img.style.height;
    var oldMaxW = img.style.maxWidth;
    img.src = canvas.toDataURL('image/jpeg', 0.92);
    img.setAttribute('data-user-cropped', 'true');
    img.style.width = oldW;
    img.style.height = oldH;
    img.style.maxWidth = oldMaxW || '100%';

    // 更新容器 aspect-ratio 为裁剪后的实际比例
    var aspectContainer = img.closest('[style*="aspect-ratio"]');
    if (aspectContainer) {
      var newRatio = (boxW * scaleX) / (boxH * scaleY);
      aspectContainer.style.aspectRatio = newRatio.toFixed(4);
    }
    hideCropUI();
  }

  function executeMultiCrop() {
    if (!cropState || cropState.type !== 'multi') return;
    var dialog = document.querySelector('.el-crop-dialog');
    if (!dialog) return;
    var allBoxes = dialog.querySelectorAll('.el-crop-box');
    var allCloneImgs = dialog.querySelectorAll('.el-crop-img-container img');
    if (!allBoxes.length) return;

    // Use first box dimensions as the uniform crop size
    var firstBox = allBoxes[0];
    var firstClone = allCloneImgs[0];
    var firstCloneRect = firstClone.getBoundingClientRect();
    var firstScaleX = firstClone.naturalWidth / firstCloneRect.width;
    var firstScaleY = firstClone.naturalHeight / firstCloneRect.height;
    var uniformW = parseFloat(firstBox.style.width) * firstScaleX;
    var uniformH = parseFloat(firstBox.style.height) * firstScaleY;
    var newRatio = uniformW / uniformH;

    cropState.imgs.forEach(function (img, i) {
      var box = allBoxes[i];
      var cloneImg = allCloneImgs[i];
      if (!box || !cloneImg) return;

      var cloneRect = cloneImg.getBoundingClientRect();
      var scaleX = cloneImg.naturalWidth / cloneRect.width;
      var scaleY = cloneImg.naturalHeight / cloneRect.height;
      var sx = parseFloat(box.style.left) * scaleX;
      var sy = parseFloat(box.style.top) * scaleY;
      var sw = parseFloat(box.style.width) * scaleX;
      var sh = parseFloat(box.style.height) * scaleY;

      var canvas = document.createElement('canvas');
      canvas.width = uniformW;
      canvas.height = uniformH;
      var ctx = canvas.getContext('2d');
      ctx.drawImage(img, sx, sy, sw, sh, 0, 0, uniformW, uniformH);

      img.src = canvas.toDataURL('image/jpeg', 0.92);
      img.setAttribute('data-user-cropped', 'true');
      img.style.width = '';
      img.style.height = '';
      img.style.maxWidth = '100%';
      img.style.objectFit = '';

      // Adapt wrapper
      var wrapper = img.closest('.el-img-wrapper');
      if (wrapper) {
        wrapper.style.width = '';
        wrapper.style.maxWidth = '';
      }
      // Adapt aspect-ratio container to new uniform ratio
      var aspectContainer = img.closest('[style*="aspect-ratio"]');
      if (aspectContainer) {
        aspectContainer.style.aspectRatio = newRatio.toFixed(4);
        aspectContainer.style.width = '';
        aspectContainer.style.height = '';
        aspectContainer.style.maxWidth = '';
      }
    });
  }

  function hideCropUI() {
    document.body.querySelectorAll('.el-crop-overlay').forEach(function (el) { el.remove(); });
    document.body.querySelectorAll('.el-crop-backdrop').forEach(function (el) { el.remove(); });
    cropState = null;
  }

  // ==================== Insert Menu ====================

  function showInsertMenu(btn, afterEl) {
    hideAllMenus();

    var menu = document.createElement('div');
    menu.className = 'el-insert-menu';
    menu.innerHTML =
      '<button data-insert="h1">标题 H1</button>' +
      '<button data-insert="h2">标题 H2</button>' +
      '<button data-insert="h3">标题 H3</button>' +
      '<button data-insert="paragraph">文字段落</button>' +
      '<button data-insert="divider">分隔线</button>' +
      '<button data-insert="images">插入图片</button>';

    var rect = btn.getBoundingClientRect();
    menu.style.position = 'fixed';
    menu.style.top = rect.bottom + 4 + 'px';
    menu.style.left = rect.left + 'px';
    menu.style.zIndex = '99999';

    menu.addEventListener('click', function (e) {
      var action = e.target.closest('button');
      if (!action) return;
      e.stopPropagation();
      handleInsert(action.dataset.insert, afterEl);
      menu.remove();
    });

    document.body.appendChild(menu);

    setTimeout(function () {
      document.addEventListener('click', function closeMenu(e) {
        if (!menu.contains(e.target) && e.target !== btn) {
          menu.remove();
          document.removeEventListener('click', closeMenu);
        }
      });
    }, 0);
  }

  function handleInsert(type, afterEl) {
    var newEl = null;
    switch (type) {
      case 'h1':
      case 'h2':
      case 'h3':
        newEl = document.createElement(type);
        newEl.textContent = type === 'h1' ? '新标题' : '新副标题';
        newEl.style.color = themeColor;
        break;
      case 'paragraph':
        newEl = document.createElement('p');
        newEl.textContent = '新段落（单击编辑）';
        newEl.style.textIndent = '2em';
        break;
      case 'divider':
        newEl = document.createElement('hr');
        break;
      case 'images':
        window._elInsertAfter = afterEl;
        window.parent.postMessage({ type: 'editor:requestImageUpload', multi: true }, '*');
        return;
    }
    if (newEl && afterEl && afterEl.parentNode) {
      afterEl.parentNode.insertBefore(newEl, afterEl.nextSibling);
      refreshControls();
    }
  }

  function handleMultiImageInsert(images, afterEl) {
    if (!images || !images.length) return;

    // Check if afterEl is an image container → append images into it
    var isImageContainer = afterEl && (
      afterEl.tagName === 'FIGURE' ||
      (afterEl.classList && afterEl.classList.contains('image-wrapper'))
    );

    if (isImageContainer) {
      // Detect if container has inner wrapper divs (AI-generated style) around images
      var existingWrappers = afterEl.querySelectorAll('.el-img-wrapper');
      var hasInnerDivs = false;
      if (existingWrappers.length > 0) {
        var firstParent = existingWrappers[0].parentElement;
        hasInnerDivs = firstParent && firstParent !== afterEl && firstParent.tagName !== 'FIGURE';
      }

      images.forEach(function (imgData) {
        var wrapper = document.createElement('span');
        wrapper.className = 'el-img-wrapper';
        wrapper.style.display = 'inline-block';
        wrapper.style.position = 'relative';
        var img = document.createElement('img');
        img.src = imgData.base64;
        img.style.maxWidth = '100%';
        img.setAttribute('data-filename', imgData.filename);
        wrapper.appendChild(img);
        var overlay = document.createElement('span');
        overlay.className = 'el-image-overlay';
        overlay.innerHTML =
          '<button class="el-img-btn el-delete-btn" title="删除">✕</button>' +
          '<button class="el-img-btn el-replace-btn" title="替换">↻</button>' +
          '<button class="el-img-btn el-crop-btn" title="裁剪">✂</button>';
        wrapper.appendChild(overlay);

        if (hasInnerDivs) {
          // Wrap in a matching inner div like the AI-generated structure
          var inner = document.createElement('div');
          inner.style.display = 'flex';
          inner.style.flexDirection = 'column';
          inner.style.flex = '1';
          inner.style.minWidth = '0';
          inner.style.aspectRatio = '16 / 9';
          inner.appendChild(wrapper);
          afterEl.appendChild(inner);
        } else {
          afterEl.appendChild(wrapper);
        }
      });
      autoAdaptImageGroup(afterEl);
      refreshControls();
      return;
    }

    var count = images.length;
    var figure = document.createElement('figure');
    figure.style.textAlign = 'center';

    if (count === 1) figure.classList.add('el-layout-single');
    else if (count === 2) figure.classList.add('el-layout-side');
    else figure.classList.add('el-layout-carousel');

    images.forEach(function (imgData) {
      var wrapper = document.createElement('span');
      wrapper.className = 'el-img-wrapper';
      wrapper.style.display = 'inline-block';
      wrapper.style.position = 'relative';
      var img = document.createElement('img');
      img.src = imgData.base64;
      img.style.maxWidth = '100%';
      img.setAttribute('data-filename', imgData.filename);
      wrapper.appendChild(img);
      // Add image overlay (delete/replace/crop buttons)
      var overlay = document.createElement('span');
      overlay.className = 'el-image-overlay';
      overlay.innerHTML =
        '<button class="el-img-btn el-delete-btn" title="删除">✕</button>' +
        '<button class="el-img-btn el-replace-btn" title="替换">↻</button>' +
        '<button class="el-img-btn el-crop-btn" title="裁剪">✂</button>';
      wrapper.appendChild(overlay);
      figure.appendChild(wrapper);
    });

    // Add layout switch buttons
    var layoutBtns = document.createElement('span');
    layoutBtns.className = 'el-layout-btns';
    buildLayoutButtons(layoutBtns, figure, count);
    layoutBtns.addEventListener('click', function (ev) {
      ev.stopPropagation();
      var b = ev.target.closest('button');
      if (!b || b.disabled) return;
      applyImageLayout(b.dataset.layout, figure);
      updateLayoutButtons(figure);
    });
    figure.style.position = 'relative';
    figure.appendChild(layoutBtns);

    if (afterEl && afterEl.parentNode) {
      afterEl.parentNode.insertBefore(figure, afterEl.nextSibling);
    } else {
      document.body.appendChild(figure);
    }
    autoAdaptImageGroup(figure);
    refreshControls();
  }

  function insertImageAtCursor(base64, filename) {
    if (window._elReplaceTarget) {
      var imgEl = window._elReplaceTarget.querySelector('img');
      if (imgEl) {
        imgEl.src = base64;
        imgEl.setAttribute('data-filename', filename);
      }
      window._elReplaceTarget = null;
      return;
    }
    hideAllMenus();
  }

  function hideAllMenus() {
    document.body.querySelectorAll('.el-insert-menu, .el-deco-menu').forEach(function (m) { m.remove(); });
  }

  // ==================== Decoration Style Switch (e button) ====================

  function buildDecoStyleMenu(btn, el, decoType) {
    if (!decoOptions || !decoOptions[decoType]) return null;

    var options = decoOptions[decoType];
    var currentId = el.getAttribute('data-el-id');

    var menu = document.createElement('div');
    menu.className = 'el-deco-menu';

    options.forEach(function (opt) {
      var item = document.createElement('button');
      item.textContent = opt.name || opt.id;
      if (opt.id === currentId) item.style.fontWeight = 'bold';
      item.addEventListener('click', function (ev) {
        ev.stopPropagation();
        applyDecoStyle(el, decoType, opt);
        menu.remove();
      });
      menu.appendChild(item);
    });

    var rect = btn.getBoundingClientRect();
    menu.style.position = 'fixed';
    menu.style.top = rect.bottom + 2 + 'px';
    menu.style.left = rect.left + 'px';
    menu.style.zIndex = '99999';

    document.body.appendChild(menu);
    return menu;
  }

  function applyDecoStyle(el, decoType, opt) {
    el.setAttribute('data-el-id', opt.id);

    switch (decoType) {
      case 'title_box':
        rebuildTitleBox(el, opt);
        break;
      case 'text_box':
        rebuildTextBox(el, opt);
        break;
      case 'divider':
        rebuildDivider(el, opt);
        break;
      case 'image_separator':
        rebuildImageSeparator(el, opt);
        break;
    }
  }

  function applyTemplateColors(text) {
    return text.replace(/\{primary\}/g, themeColor)
      .replace(/\{primary\}04/g, hexToRgba(themeColor, 0.04))
      .replace(/\{primary\}05/g, hexToRgba(themeColor, 0.05))
      .replace(/\{primary\}06/g, hexToRgba(themeColor, 0.06))
      .replace(/\{primary\}08/g, hexToRgba(themeColor, 0.08))
      .replace(/\{primary\}10/g, hexToRgba(themeColor, 0.10))
      .replace(/\{primary\}12/g, hexToRgba(themeColor, 0.12))
      .replace(/\{primary\}15/g, hexToRgba(themeColor, 0.15))
      .replace(/\{primary\}20/g, hexToRgba(themeColor, 0.20))
      .replace(/\{primary\}25/g, hexToRgba(themeColor, 0.25))
      .replace(/\{primary\}30/g, hexToRgba(themeColor, 0.30))
      .replace(/\{primary\}40/g, hexToRgba(themeColor, 0.40))
      .replace(/\{primary\}50/g, hexToRgba(themeColor, 0.50))
      .replace(/\{white\}/g, '#ffffff');
  }

  function rebuildTitleBox(el, opt) {
    var hTag = el.querySelector('h1, h2, h3');
    if (!hTag) return;
    var text = hTag.textContent;
    var tag = hTag.tagName.toLowerCase();
    var boxStyle = applyTemplateColors(opt.style);
    var titleStyle = applyTemplateColors(opt.title_style);
    titleStyle = titleStyle.replace('{title_color}', themeColor);

    var wrapper = document.createElement('div');
    wrapper.style.cssText = boxStyle;
    wrapper.setAttribute('data-el-type', 'title_box');
    wrapper.setAttribute('data-el-id', opt.id);
    var newH = document.createElement(tag);
    newH.style.cssText = titleStyle;
    // Preserve font sizing from the original heading so deco switch doesn't shrink text
    if (hTag.style.fontSize) newH.style.fontSize = hTag.style.fontSize;
    if (hTag.style.fontFamily) newH.style.fontFamily = hTag.style.fontFamily;
    if (hTag.style.lineHeight) newH.style.lineHeight = hTag.style.lineHeight;
    newH.textContent = text;
    wrapper.appendChild(newH);
    el.parentNode.replaceChild(wrapper, el);
    refreshControls();
  }

  function rebuildTextBox(el, opt) {
    var p = el.querySelector('p');
    var innerHTML = p ? p.innerHTML : el.innerHTML;
    var boxStyle = applyTemplateColors(opt.style);
    var innerStyle = applyTemplateColors(opt.inner_style);

    var wrapper = document.createElement('div');
    wrapper.className = 'text-box-applied';
    wrapper.style.cssText = boxStyle;
    wrapper.setAttribute('data-el-type', 'text_box');
    wrapper.setAttribute('data-el-id', opt.id);
    var newP = document.createElement('p');
    newP.style.cssText = innerStyle;
    newP.innerHTML = innerHTML;
    wrapper.appendChild(newP);
    el.parentNode.replaceChild(wrapper, el);
    refreshControls();
  }

  function rebuildDivider(el, opt) {
    var html = applyTemplateColors(opt.html);
    html = html.replace('<div ', '<div data-el-type="divider" data-el-id="' + opt.id + '" ');
    var temp = document.createElement('div');
    temp.innerHTML = html;
    var newDiv = temp.firstChild;
    el.parentNode.replaceChild(newDiv, el);
    refreshControls();
  }

  function rebuildImageSeparator(el, opt) {
    var html = '';
    if (el.previousElementSibling && el.previousElementSibling.querySelector('img')) {
      html = opt.html_bottom || '';
    } else {
      html = opt.html_top || '';
    }
    html = applyTemplateColors(html);
    if (html) {
      html = html.replace('<div ', '<div data-el-type="image_separator" data-el-id="' + opt.id + '" ');
      var temp = document.createElement('div');
      temp.innerHTML = html;
      var newDiv = temp.firstChild;
      el.parentNode.replaceChild(newDiv, el);
      refreshControls();
    } else {
      el.remove();
      refreshControls();
    }
  }

  // ==================== Theme Color Re-render ====================

  function onThemeColorChange(newColor) {
    // Show confirmation dialog in iframe
    var existing = document.querySelector('.el-theme-confirm');
    if (existing) existing.remove();

    var confirm = document.createElement('div');
    confirm.className = 'el-theme-confirm';
    confirm.innerHTML =
      '<div class="el-theme-confirm-inner">' +
      '<p>修改主题色将重新渲染所有装饰，是否继续？</p>' +
      '<div class="el-theme-confirm-actions">' +
      '<button class="el-theme-confirm-yes">确定</button>' +
      '<button class="el-theme-confirm-no">取消</button>' +
      '</div></div>';

    confirm.querySelector('.el-theme-confirm-yes').addEventListener('click', function () {
      confirm.remove();
      themeColor = newColor;
      reRenderTheme(newColor);
    });
    confirm.querySelector('.el-theme-confirm-no').addEventListener('click', function () {
      confirm.remove();
      // Notify parent to revert color picker
      window.parent.postMessage({ type: 'editor:themeReverted', color: themeColor }, '*');
    });
    confirm.addEventListener('click', function (e) {
      if (e.target === confirm) confirm.remove();
    });
    document.body.appendChild(confirm);
  }

  function reRenderTheme(newColor) {
    themeColor = newColor;
    // Update all strong tags
    document.body.querySelectorAll('strong').forEach(function (s) {
      s.style.color = newColor;
    });
    // Update all headings
    document.body.querySelectorAll('h1, h2, h3, h4').forEach(function (h) {
      h.style.color = newColor;
    });
    // Update links section
    var linksSection = document.body.querySelector('.links-section');
    if (linksSection) {
      linksSection.style.backgroundColor = hexToRgba(newColor, 0.06);
      var h3 = linksSection.querySelector('h3');
      if (h3) h3.style.color = newColor;
      linksSection.querySelectorAll('a').forEach(function (a) { a.style.color = newColor; });
    }
    // Update author section border
    var authorSec = document.body.querySelector('.author-section');
    if (authorSec) {
      authorSec.style.borderTop = '1px solid ' + hexToRgba(newColor, 0.20);
    }
    // Re-render all decorated elements with their current data-el-id
    document.body.querySelectorAll('[data-el-type]').forEach(function (el) {
      var decoType = el.getAttribute('data-el-type');
      var decoId = el.getAttribute('data-el-id');
      if (decoType && decoId && decoOptions && decoOptions[decoType]) {
        var opt = decoOptions[decoType].find(function (o) { return o.id === decoId; });
        if (opt) applyDecoStyle(el, decoType, opt);
      }
    });
    refreshControls();
    window.parent.postMessage({ type: 'editor:themeApplied', color: newColor }, '*');
  }

  // ==================== Style Updates ====================

  function applyStyle(key, value) {
    switch (key) {
      case 'fontSize':
        document.body.querySelectorAll('p, li, blockquote, figcaption').forEach(function (el) {
          el.style.fontSize = value;
        });
        break;
      case 'lineHeight':
        document.body.querySelectorAll('p, li, blockquote, div').forEach(function (el) {
          el.style.lineHeight = value;
        });
        break;
    }
  }

  // ==================== Reset ====================

  function resetDocument(html) {
    document.open();
    document.write(html);
    document.close();
    editMode = false;
    selectionToolbar = null;
    cropState = null;
  }

  // ==================== Init ====================

  // Request initial theme color and deco options from parent
  window.parent.postMessage({ type: 'editor:ready' }, '*');

})();
