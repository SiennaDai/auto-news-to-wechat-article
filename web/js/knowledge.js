/**
 * Knowledge base module (reserved for future RAG).
 * Placeholder functions, UI not implemented yet.
 * Depends on: api.js
 */
(function () {
  'use strict';

  var api = window.EL.api;

  var Knowledge = {
    listBases: listBases,
    createBase: createBase,
    createBaseWithContent: createBaseWithContent,
    deleteBase: deleteBase,
    getContent: getContent,
    listDocuments: listDocuments,
    uploadDocuments: uploadDocuments,
    deleteDocument: deleteDocument,
    search: search,
  };

  window.EL.Knowledge = Knowledge;

  async function listBases() {
    var data = await api.get('/api/knowledge/bases');
    return data.knowledge_bases || [];
  }

  async function createBase(name, content) {
    var data = await api.post('/api/knowledge/bases', { name: name, content: content || '' });
    return data;
  }

  async function createBaseWithContent(name, content) {
    return createBase(name, content);
  }

  async function deleteBase(id) {
    await api.delete('/api/knowledge/bases/' + id);
  }

  async function getContent(kbId) {
    var data = await api.get('/api/knowledge/bases/' + kbId + '/content');
    return data;
  }

  async function listDocuments(kbId) {
    var data = await api.get('/api/knowledge/bases/' + kbId + '/documents');
    return data.documents || [];
  }

  async function uploadDocuments(kbId, files) {
    var formData = new FormData();
    for (var i = 0; i < files.length; i++) {
      formData.append('files', files[i]);
    }
    var data = await api.postFormData('/api/knowledge/bases/' + kbId + '/upload', formData);
    return data;
  }

  async function deleteDocument(docId) {
    await api.delete('/api/knowledge/documents/' + docId);
  }

  /**
   * Full-text search (returns entire KB content).
   */
  async function search(kbId, query) {
    var data = await api.post('/api/knowledge/bases/' + kbId + '/search', { query: query || '' });
    return data;
  }
})();
