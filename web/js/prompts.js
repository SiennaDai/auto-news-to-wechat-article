/**
 * Prompts module - save, load, delete, set default for writer prompts.
 * Exposes window.EL.Prompts object.
 * Depends on: api.js
 */
(function () {
  'use strict';

  var api = window.EL.api;

  var Prompts = {
    list: list,
    get: get,
    save: save,
    update: update,
    remove: remove,
    setDefault: setDefault,
    loadContent: loadContent,
  };

  window.EL.Prompts = Prompts;

  async function list() {
    var data = await api.get('/api/prompts/');
    return data.prompts || [];
  }

  async function get(id) {
    var data = await api.get('/api/prompts/' + id);
    return data.prompt;
  }

  async function save(name, content) {
    var data = await api.post('/api/prompts/', { name: name, content: content });
    return data;
  }

  async function update(id, name, content) {
    var data = await api.put('/api/prompts/' + id, { name: name, content: content });
    return data;
  }

  async function remove(id) {
    await api.delete('/api/prompts/' + id);
  }

  async function setDefault(id) {
    await api.put('/api/prompts/' + id + '/default', {});
  }

  async function loadContent(id) {
    var data = await api.get('/api/prompts/' + id);
    return data.prompt.content;
  }
})();
