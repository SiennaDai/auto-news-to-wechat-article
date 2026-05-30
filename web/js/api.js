/**
 * API helper - fetch wrapper with automatic token injection and error handling.
 * Dependency-free, loaded first.
 */
(function () {
  'use strict';

  const TOKEN_KEY = 'el_access_token';

  window.EL = window.EL || {};

  function getToken() {
    return localStorage.getItem(TOKEN_KEY);
  }

  function setToken(token) {
    if (token) {
      localStorage.setItem(TOKEN_KEY, token);
    } else {
      localStorage.removeItem(TOKEN_KEY);
    }
  }

  async function apiFetch(url, options) {
    options = options || {};
    var headers = options.headers || {};

    if (!(options.body instanceof FormData)) {
      headers['Content-Type'] = 'application/json';
    }

    var token = getToken();
    if (token) {
      headers['Authorization'] = 'Bearer ' + token;
    }

    var response = await fetch(url, {
      method: options.method || 'GET',
      headers: headers,
      body: options.body,
    });

    var data;
    try {
      data = await response.json();
    } catch (e) {
      data = null;
    }

    if (!response.ok) {
      var err = new Error((data && data.detail) || ('请求失败 (' + response.status + ')'));
      err.status = response.status;
      err.data = data;
      throw err;
    }

    return data;
  }

  function apiGet(url) {
    return apiFetch(url, { method: 'GET' });
  }

  function apiPost(url, body) {
    return apiFetch(url, {
      method: 'POST',
      body: JSON.stringify(body),
    });
  }

  function apiPut(url, body) {
    return apiFetch(url, {
      method: 'PUT',
      body: JSON.stringify(body),
    });
  }

  function apiDelete(url) {
    return apiFetch(url, { method: 'DELETE' });
  }

  function apiPostFormData(url, formData) {
    return apiFetch(url, {
      method: 'POST',
      body: formData,
    });
  }

  window.EL.api = {
    get: apiGet,
    post: apiPost,
    put: apiPut,
    delete: apiDelete,
    postFormData: apiPostFormData,
    getToken: getToken,
    setToken: setToken,
  };
})();
