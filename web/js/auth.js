/**
 * Auth module - login, register, logout, token management.
 * Exposes window.EL.Auth object.
 * Depends on: api.js
 */
(function () {
  'use strict';

  var api = window.EL.api;

  var Auth = {
    init: init,
    login: login,
    register: register,
    logout: logout,
    fetchMe: fetchMe,
    isLoggedIn: isLoggedIn,
  };

  window.EL.Auth = Auth;

  function isLoggedIn() {
    return !!api.getToken() && !!window.AppState && !!window.AppState.user;
  }

  async function init() {
    var token = api.getToken();
    if (!token) {
      window.AppState.user = null;
      return false;
    }
    try {
      var data = await api.get('/api/auth/me');
      window.AppState.user = data.user;
      window.dispatchEvent(new CustomEvent('user-changed'));
      return true;
    } catch (e) {
      api.setToken(null);
      window.AppState.user = null;
      if (e.status === 401) {
        console.log('[auth] Token 已过期，请重新登录');
      }
      return false;
    }
  }

  async function login(email, password) {
    var data = await api.post('/api/auth/login', { email: email, password: password });
    api.setToken(data.access_token);
    window.AppState.user = data.user;
    window.dispatchEvent(new CustomEvent('user-changed'));
    return data;
  }

  async function register(username, email, password) {
    var data = await api.post('/api/auth/register', { username: username, email: email, password: password });
    return data;
  }

  async function logout() {
    try {
      await api.post('/api/auth/logout', {});
    } catch (e) {
      // Logout best-effort
    }
    api.setToken(null);
    window.AppState.user = null;
    window.AppState.templates = [];
    window.AppState.currentTemplateId = null;
    window.dispatchEvent(new CustomEvent('user-changed'));
  }

  async function fetchMe() {
    try {
      var data = await api.get('/api/auth/me');
      window.AppState.user = data.user;
      window.dispatchEvent(new CustomEvent('user-changed'));
      return data.user;
    } catch (e) {
      return null;
    }
  }
})();
