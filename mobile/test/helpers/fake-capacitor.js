// A stand-in for the app's native side in a normal browser (tests only). Runs before the page's scripts, like the
// app's injected bridge. It records every call in window.__calls and answers from window.__answers, which the
// test sets up front: { "Plugin.method": value | { reject: "message" } | { resolve: value, emit: { event, data } } }.
(function () {
  'use strict';
  var answers = window.__answers || {};
  window.__calls = [];
  window.__listeners = {};

  function emit(plugin, event, data) {
    (window.__listeners[plugin + ':' + event] || []).forEach(function (cb) { cb(data); });
  }
  window.__emit = emit;

  function plugin(name, methods) {
    var p = {};
    methods.forEach(function (m) {
      p[m] = function (options) {
        window.__calls.push({ plugin: name, method: m, options: JSON.parse(JSON.stringify(options || {})) });
        var a = answers[name + '.' + m];
        if (a && typeof a === 'object' && 'reject' in a) return Promise.reject(new Error(a.reject));
        if (a && typeof a === 'object' && 'emit' in a) {
          setTimeout(function () { emit(name, a.emit.event, a.emit.data); }, 20);
          return Promise.resolve(a.resolve);
        }
        return Promise.resolve(a);
      };
    });
    p.addListener = function (event, cb) {
      var key = name + ':' + event;
      (window.__listeners[key] = window.__listeners[key] || []).push(cb);
      return { remove: function () {} };
    };
    return p;
  }

  window.Capacitor = {
    isNativePlatform: function () { return true; },
    Plugins: {
      Ebda3Shell: plugin('Ebda3Shell', ['getInfo', 'open', 'print', 'saveFile', 'setRemoteConfig', 'signIn']),
      Share: plugin('Share', ['share', 'canShare']),
      PushNotifications: plugin('PushNotifications', ['checkPermissions', 'requestPermissions', 'register']),
      AppUpdate: plugin('AppUpdate', ['getAppUpdateInfo', 'performImmediateUpdate', 'openAppStore'])
    }
  };
})();
