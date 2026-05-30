/**
 * Templates module - save, load, delete, set default.
 * Exposes window.EL.Templates object.
 * Depends on: api.js, auth.js
 */
(function () {
  'use strict';

  var api = window.EL.api;

  var Templates = {
    list: list,
    get: get,
    save: save,
    update: update,
    remove: remove,
    setDefault: setDefault,
    loadConfig: loadConfig,
  };

  window.EL.Templates = Templates;

  async function list() {
    var data = await api.get('/api/templates/');
    window.AppState.templates = data.templates || [];
    window.dispatchEvent(new CustomEvent('templates-changed'));
    return window.AppState.templates;
  }

  async function get(id) {
    var data = await api.get('/api/templates/' + id);
    return data.template;
  }

  async function save(name, config) {
    var data = await api.post('/api/templates/', { name: name, config: config });
    await list();
    return data;
  }

  async function update(id, name, config) {
    var data = await api.put('/api/templates/' + id, { name: name, config: config });
    await list();
    return data;
  }

  async function remove(id) {
    await api.delete('/api/templates/' + id);
    if (window.AppState.currentTemplateId === id) {
      window.AppState.currentTemplateId = null;
    }
    await list();
  }

  async function setDefault(id) {
    await api.put('/api/templates/' + id + '/default', {});
    await list();
  }

  /**
   * Load a template's config and fill the form.
   * Falls back to default config if no template specified.
   */
  async function loadConfig(templateId) {
    if (!templateId) return null;

    try {
      var data = await api.get('/api/templates/' + templateId);
      window.AppState.currentTemplateId = templateId;
      return data.template.config;
    } catch (e) {
      console.error('[templates] 加载模板失败:', e.message);
      throw e;
    }
  }
})();
