/*
 * إبداع app glue: the phone features inside the shop's own pages.
 *
 * The apps show the live shop (https://ebda3.me) in a web view. Before any of the page's scripts run, the app
 * injects `window.__ebda3AppConfig` (platform, version, build, …) followed by this file (Android: ShellPlugin,
 * iOS: ShellViewController). It is never served by the website.
 *
 * Rules for this file:
 * - The site changes without app updates, so everything here feature-detects and fails quietly: a missing
 *   element, plugin or endpoint means "do nothing", never an error on the page.
 * - Plain ES2017 (Android web views from Chrome 60), no dependencies, no build step.
 * - It only acts on the shop's own origin (iOS injects scripts into every page the web view shows).
 * - Its own storage keys start with "ebda3-app:"; it never changes the site's data.
 *
 * What it does:
 *  1. Marks the page (<html class="in-app in-app-android|ios">) and hides web-only bits (the "install the app" link).
 *  2. Turns off the site's service worker (the app has its own "no connection" page).
 *  3. Gives the page navigator.share (the phone's share sheet) where the web view has none (Android).
 *  4. Links: same-site links meant for a new tab stay in the app; other sites open in an in-app browser tab or
 *     their own app (WhatsApp…), decided by the app.
 *  5. Saving files the page makes (e.g. "Save image" in the preview): to Photos/Downloads (Android) or the share
 *     sheet (iPhone, which offers "Save Image" / "Save to Files").
 *  6. window.print (the invoice's "Print / Save as PDF") prints with the phone's print screen.
 *  7. Google/Facebook sign-in: hidden in the app until the site supports signing in through the phone's browser
 *     (remote config), then done safely in the system browser and handed back to the app.
 *  8. Notifications: asks at the right moment (right after an order), registers the phone with the shop,
 *     opens the right page when a notification is tapped.
 *  9. Updates: reads /app/config.json from the shop; asks to update when this version is too old.
 */
(function () {
  'use strict';

  var cfg = window.__ebda3AppConfig;
  if (!cfg || typeof cfg !== 'object' || window.ebda3App) return;
  if (location.origin !== cfg.siteOrigin) return;

  var PLATFORM = cfg.platform === 'ios' ? 'ios' : 'android';
  var BUILD = Number(cfg.build) || 0;
  var KEY = 'ebda3-app:';
  var CONFIG_PATH = '/app/config.json';
  var DEVICES_PATH = '/api/app/devices';
  var CONFIG_MAX_AGE = 6 * 3600 * 1000;
  var noop = function () {};
  var configDone = false;
  var configWaiters = [];

  // Runs fn once the shop's config has been read (or failed to load) for this page.
  function onConfig(fn) {
    if (configDone) safe(fn)();
    else configWaiters.push(fn);
  }
  function configFinished() {
    configDone = true;
    configWaiters.splice(0).forEach(function (fn) { safe(fn)(); });
  }

  // ---------- small helpers ----------

  function safe(fn) {
    return function () {
      try {
        return fn.apply(this, arguments);
      } catch (e) {
        report(e);
      }
    };
  }
  function report(e) {
    try {
      if (window.console && console.warn) console.warn('[ebda3 app]', e && e.message ? e.message : e);
    } catch (_) { /* nothing */ }
  }
  function store(name, value) {
    try {
      if (value === undefined) return JSON.parse(localStorage.getItem(KEY + name) || 'null');
      if (value === null) localStorage.removeItem(KEY + name);
      else localStorage.setItem(KEY + name, JSON.stringify(value));
    } catch (e) { return null; }
    return value;
  }
  function parseUrl(u) {
    try {
      return new URL(String(u), location.href);
    } catch (e) {
      return null;
    }
  }
  function plugin(name) {
    var C = window.Capacitor;
    return C && C.Plugins && C.Plugins[name] ? C.Plugins[name] : null;
  }
  function call(name, method, options) {
    var p = plugin(name);
    if (!p || typeof p[method] !== 'function') return Promise.reject(new Error(name + '.' + method + ' is not available'));
    try {
      return Promise.resolve(p[method](options || {}));
    } catch (e) {
      return Promise.reject(e);
    }
  }
  function listen(name, event, fn) {
    var p = plugin(name);
    if (!p || typeof p.addListener !== 'function') return;
    try {
      Promise.resolve(p.addListener(event, safe(fn))).catch(report);
    } catch (e) { report(e); }
  }
  function errText(e) {
    return String((e && (e.message || e.errorMessage)) || e || '');
  }
  function isCancel(e) {
    return /cancel/i.test(errText(e));
  }
  function define(obj, name, value) {
    try {
      Object.defineProperty(obj, name, { value: value, configurable: true, writable: true });
    } catch (e) {
      try { obj[name] = value; } catch (_) { report(_); }
    }
  }
  function whenReady(fn) {
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', safe(fn), { once: true });
    else safe(fn)();
  }
  function whenRoot(fn) {
    if (document.documentElement) return safe(fn)();
    var mo = new MutationObserver(function () {
      if (!document.documentElement) return;
      mo.disconnect();
      safe(fn)();
    });
    mo.observe(document, { childList: true });
  }
  function lang() {
    try {
      return localStorage.getItem('pod-lang') === 'en' ? 'en' : 'ar';
    } catch (e) {
      return 'ar';
    }
  }

  var TEXT = {
    ar: {
      updateTitle: 'نسخة جديدة من التطبيق',
      updateBody: 'فيه نسخة أحدث من تطبيق إبداع. حدّثه عشان تاخد آخر المزايا.',
      updateRequiredTitle: 'لازم تحدّث التطبيق',
      updateRequiredBody: 'النسخة دي قديمة ومش هتشتغل كويس مع المتجر. حدّث التطبيق عشان تكمل.',
      updateNow: 'حدّث دلوقتي',
      later: 'بعدين',
      pushTitle: 'تابع طلبك من التطبيق',
      pushBody: 'هنبعتلك إشعار لما البروفة تبقى جاهزة للموافقة ولما الطلب يتشحن.',
      pushOn: 'شغّل الإشعارات',
      notNow: 'مش دلوقتي',
      pushOff: 'الإشعارات مقفولة. تقدر تشغّلها من إعدادات الموبايل.',
      savedPhotos: 'اتحفظت الصورة في الصور',
      savedDownloads: 'اتحفظ الملف في التنزيلات',
      saveFailed: 'معرفناش نحفظ الملف. جرّب تاني.',
      socialOff: 'في التطبيق، سجّل دخولك برقم الموبايل أو الإيميل وكلمة السر.',
      openFailed: 'معرفناش نفتح الرابط.'
    },
    en: {
      updateTitle: 'A new version of the app',
      updateBody: 'A newer version of the ebda3 app is available. Update to get the latest features.',
      updateRequiredTitle: 'Please update the app',
      updateRequiredBody: 'This version is too old to work well with the shop. Update the app to continue.',
      updateNow: 'Update now',
      later: 'Later',
      pushTitle: 'Follow your order in the app',
      pushBody: "We'll let you know when your proof is ready to approve and when your order ships.",
      pushOn: 'Turn on notifications',
      notNow: 'Not now',
      pushOff: 'Notifications are off. You can turn them on in your phone settings.',
      savedPhotos: 'Image saved to Photos',
      savedDownloads: 'File saved to Downloads',
      saveFailed: "Couldn't save the file. Please try again.",
      socialOff: 'In the app, sign in with your phone number or email and password.',
      openFailed: "Couldn't open the link."
    }
  };
  function t(key) {
    var l = lang();
    return (TEXT[l] && TEXT[l][key]) || TEXT.en[key] || key;
  }

  // ---------- 1. page marks and styles ----------

  var CSS = [
    // Web-only: the footer's "Install the app" link (the shop is already an app here).
    'html.in-app [data-install-wrap]{display:none!important}',
    // Google/Facebook sign-in, while the app can't use it (see socialEnabled()).
    'html.in-app.app-social-off #acct-social,html.in-app.app-social-off .btn-social{display:none!important}',
    // The app's own small UI: toast, banner, sheet. Prefixed "e3a-" so the site's CSS never meets it.
    '.e3a-toast{position:fixed;left:16px;right:16px;bottom:20px;z-index:2147483646;margin:0 auto;max-width:420px;',
    'padding:12px 16px;border-radius:12px;background:#16181d;color:#fff;font:600 15px/1.5 Cairo,system-ui,sans-serif;',
    'text-align:center;box-shadow:0 6px 24px rgba(0,0,0,.25);opacity:0;transform:translateY(8px);',
    'transition:opacity .2s,transform .2s;pointer-events:none}',
    '.e3a-toast.e3a-on{opacity:1;transform:none}',
    '.e3a-veil{position:fixed;inset:0;z-index:2147483645;background:rgba(22,24,29,.45);display:flex;align-items:flex-end;',
    'justify-content:center;font-family:Cairo,system-ui,sans-serif}',
    '.e3a-veil.e3a-block{align-items:center;background:#FAFAF7}',
    '.e3a-sheet{width:100%;max-width:460px;box-sizing:border-box;background:#fff;color:#16181d;border-radius:18px 18px 0 0;',
    'padding:22px 20px 20px;box-shadow:0 -8px 30px rgba(0,0,0,.18)}',
    '.e3a-block .e3a-sheet{border-radius:18px;margin:16px;box-shadow:none;background:transparent;text-align:center}',
    '.e3a-sheet h2{margin:0 0 8px;font-size:19px;line-height:1.4;font-weight:800}',
    '.e3a-sheet p{margin:0 0 18px;font-size:15px;line-height:1.6;color:#5b606b}',
    '.e3a-row{display:flex;gap:10px;flex-wrap:wrap}',
    '.e3a-btn{flex:1 1 140px;min-height:48px;border:0;border-radius:12px;font:700 16px/1.2 Cairo,system-ui,sans-serif;',
    'cursor:pointer;padding:0 16px}',
    '.e3a-main{background:#16181d;color:#fff}',
    '.e3a-alt{background:#efeee9;color:#16181d}',
    '.e3a-banner{position:fixed;left:12px;right:12px;bottom:12px;z-index:2147483644;margin:0 auto;max-width:460px;',
    'display:flex;align-items:center;gap:10px;padding:10px 12px;border-radius:14px;background:#16181d;color:#fff;',
    'font:600 14px/1.45 Cairo,system-ui,sans-serif;box-shadow:0 6px 24px rgba(0,0,0,.25)}',
    '.e3a-banner span{flex:1}',
    '.e3a-banner button{border:0;border-radius:10px;min-height:40px;padding:0 12px;font:700 14px Cairo,system-ui,sans-serif;cursor:pointer}',
    '.e3a-banner .e3a-go{background:#fff;color:#16181d}',
    '.e3a-banner .e3a-x{background:transparent;color:#fff;font-size:20px;min-width:40px}'
  ].join('');

  whenRoot(function () {
    var root = document.documentElement;
    root.classList.add('in-app', 'in-app-' + PLATFORM);
    root.setAttribute('data-app-version', String(cfg.version || ''));
    root.classList.toggle('app-social-off', !socialEnabled());
    var style = document.createElement('style');
    style.id = 'e3a-style';
    style.textContent = CSS;
    (document.head || root).appendChild(style);
  });

  // ---------- 2. no service worker in the app ----------

  safe(function () {
    var sw = navigator.serviceWorker;
    if (!sw) return;
    define(sw, 'register', function () {
      return Promise.reject(new Error('Not used in the app'));
    });
    if (typeof sw.getRegistrations === 'function') {
      sw.getRegistrations().then(function (regs) {
        regs.forEach(function (r) { r.unregister().catch(noop); });
      }).catch(noop);
    }
  })();

  // ---------- 3. the share sheet (Android web views have no navigator.share; iPhone's is kept) ----------

  safe(function () {
    if (navigator.share || !plugin('Share')) return;
    define(navigator, 'canShare', function (data) {
      return !!data && !(data.files && data.files.length) && !!(data.title || data.text || data.url);
    });
    define(navigator, 'share', function (data) {
      data = data || {};
      if (data.files && data.files.length) {
        return Promise.reject(new DOMException('Sharing files is not supported here', 'NotAllowedError'));
      }
      var options = {};
      if (data.title) options.title = String(data.title);
      if (data.text) options.text = String(data.text);
      if (data.url) {
        var u = parseUrl(data.url);
        if (!u) return Promise.reject(new TypeError('Invalid URL'));
        options.url = u.href;
      }
      if (!options.text && !options.url && !options.title) return Promise.reject(new TypeError('Nothing to share'));
      if (options.title) options.dialogTitle = options.title;
      return call('Share', 'share', options).then(noop, function (e) {
        throw new DOMException(errText(e) || 'Share failed', isCancel(e) ? 'AbortError' : 'DataError');
      });
    });
  })();

  // ---------- 4. links ----------

  function openOutside(href) {
    return call('Ebda3Shell', 'open', { url: href }).catch(function (e) {
      if (!isCancel(e)) toast(t('openFailed'));
    });
  }

  function isNewTab(a) {
    var target = (a.getAttribute('target') || '').toLowerCase();
    return !!target && target !== '_self' && target !== '_top' && target !== '_parent';
  }

  function isDownloadLink(a) {
    return a.hasAttribute('download') && /^(blob|data):/i.test(a.href || '');
  }

  var handleAnchor = safe(function (a, ev) {
    if (isDownloadLink(a)) {
      ev.preventDefault();
      saveDownload(a.href, a.getAttribute('download'));
      return;
    }
    var url = parseUrl(a.href);
    if (!url) return;
    if (url.origin === location.origin) {
      var social = /^\/auth\/(google|facebook)\/?$/.exec(url.pathname);
      if (social) {
        ev.preventDefault();
        socialSignIn(social[1], url.searchParams.get('next'));
        return;
      }
      if (isNewTab(a)) {
        ev.preventDefault();
        location.assign(url.href);
      }
      return;
    }
    if (url.protocol === 'javascript:') return;
    // Everything else (other sites, wa.me, tel:…): the app decides where it opens.
    ev.preventDefault();
    openOutside(url.href);
  });

  document.addEventListener('click', function (ev) {
    if (ev.defaultPrevented || ev.button !== 0 || ev.metaKey || ev.ctrlKey || ev.shiftKey || ev.altKey) return;
    var el = ev.target;
    var a = el && el.closest ? el.closest('a[href]') : null;
    if (a) handleAnchor(a, ev);
  }, false);

  // Links clicked by scripts without being in the page (e.g. a made-up <a download> for "Save image").
  safe(function () {
    var proto = window.HTMLAnchorElement && HTMLAnchorElement.prototype;
    if (!proto) return;
    var click = proto.click;
    define(proto, 'click', function () {
      if (this.isConnected === false && this.href) {
        var ev = { defaultPrevented: false, preventDefault: function () { this.defaultPrevented = true; } };
        handleAnchor(this, ev);
        if (ev.defaultPrevented) return undefined;
      }
      return click.apply(this, arguments);
    });
  })();

  safe(function () {
    var open = window.open;
    define(window, 'open', function (u) {
      var url = u == null || u === '' ? null : parseUrl(u);
      if (!url || url.href === 'about:blank') return open.apply(window, arguments);
      if (url.origin === location.origin) location.assign(url.href);
      else openOutside(url.href);
      return null;
    });
  })();

  // ---------- 5. saving files the page makes ----------

  function blobToBase64(blob) {
    return new Promise(function (resolve, reject) {
      var r = new FileReader();
      r.onload = function () {
        var s = String(r.result || '');
        resolve(s.slice(s.indexOf(',') + 1));
      };
      r.onerror = function () { reject(r.error || new Error('read failed')); };
      r.readAsDataURL(blob);
    });
  }
  var MIME = { png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', webp: 'image/webp', gif: 'image/gif', svg: 'image/svg+xml',
    pdf: 'application/pdf', csv: 'text/csv', txt: 'text/plain', json: 'application/json', zip: 'application/zip' };
  function fileName(name, type) {
    var n = String(name || '').replace(/[\\/:*?"<>|\u0000-\u001f]+/g, '-').replace(/^[.\s]+/, '').slice(0, 120);
    if (!n) n = 'ebda3';
    if (!/\.[a-z0-9]{2,5}$/i.test(n)) {
      for (var ext in MIME) if (MIME[ext] === type) { n += '.' + ext; break; }
    }
    return n;
  }
  function saveDownload(href, name) {
    return fetch(href).then(function (r) { return r.blob(); }).then(function (blob) {
      var ext = (/\.([a-z0-9]{2,5})$/i.exec(String(name || '')) || [])[1];
      var type = blob.type || (ext && MIME[ext.toLowerCase()]) || 'application/octet-stream';
      return blobToBase64(blob).then(function (data) {
        return call('Ebda3Shell', 'saveFile', { data: data, name: fileName(name, type), mimeType: type });
      });
    }).then(function (res) {
      var where = res && res.where;
      if (where === 'photos') toast(t('savedPhotos'));
      else if (where === 'downloads') toast(t('savedDownloads'));
    }).catch(function (e) {
      if (!isCancel(e)) {
        report(e);
        toast(t('saveFailed'));
      }
    });
  }

  // ---------- 6. printing (the invoice's "Print / Save as PDF") ----------

  define(window, 'print', function () {
    call('Ebda3Shell', 'print', { name: document.title || 'ebda3' }).catch(report);
  });

  // ---------- remote config (/app/config.json on the shop) ----------

  function validConfig(c) {
    return !!c && typeof c === 'object' && !Array.isArray(c);
  }
  function remote() {
    var kept = store('config');
    return kept && validConfig(kept.config) ? kept.config : {};
  }
  function platformConf(c) {
    var p = c && c[PLATFORM];
    return p && typeof p === 'object' ? p : {};
  }
  function feature(name) {
    var f = remote().features;
    var v = f && typeof f === 'object' ? f[name] : undefined;
    if (v && typeof v === 'object') v = v[PLATFORM];
    return v === true;
  }
  function socialEnabled() {
    return feature('socialLogin') && !!(window.crypto && crypto.subtle);
  }

  function checkedThisLaunch(set) {
    try {
      if (set) sessionStorage.setItem(KEY + 'config-checked', '1');
      return sessionStorage.getItem(KEY + 'config-checked') === '1';
    } catch (e) {
      return false;
    }
  }

  // Once per app launch (the web view's session) and at most every few hours; the last good copy is kept.
  function refreshConfig(force) {
    var kept = store('config');
    if (!force && kept && Date.now() - kept.at < CONFIG_MAX_AGE && checkedThisLaunch(false)) {
      return Promise.resolve(remote());
    }
    checkedThisLaunch(true);
    return fetch(CONFIG_PATH, { cache: 'no-store', credentials: 'same-origin', headers: { Accept: 'application/json' } })
      .then(function (r) {
        if (!r.ok) throw new Error('config ' + r.status);
        return r.json();
      })
      .then(function (c) {
        if (!validConfig(c)) throw new Error('config: not an object');
        store('config', { at: Date.now(), config: c });
        applyConfig(c);
        return c;
      })
      .catch(function (e) {
        report(e);
        return remote();
      });
  }

  var applyConfig = safe(function (c) {
    if (document.documentElement) document.documentElement.classList.toggle('app-social-off', !socialEnabled());
    var hosts = Array.isArray(c.inAppHosts) ? c.inAppHosts.filter(function (h) { return typeof h === 'string'; }) : [];
    call('Ebda3Shell', 'setRemoteConfig', { inAppHosts: hosts.slice(0, 20) }).catch(noop);
    whenReady(function () { checkForUpdate(c); });
  });

  // ---------- 9. updates ----------

  function msg(c, key) {
    var m = c && c.message && c.message[lang()];
    return typeof m === 'string' && m ? m : t(key);
  }

  function updateApp(c) {
    if (PLATFORM === 'android') {
      return call('AppUpdate', 'getAppUpdateInfo').then(function (info) {
        // 2 = UPDATE_AVAILABLE (Play in-app updates); otherwise open the store page.
        if (info && info.updateAvailability === 2 && info.immediateUpdateAllowed) return call('AppUpdate', 'performImmediateUpdate');
        return openStore(c);
      }).catch(function () { return openStore(c); });
    }
    return openStore(c);
  }
  function openStore(c) {
    var url = platformConf(c).storeUrl;
    if (typeof url === 'string' && /^https:\/\//.test(url)) return openOutside(url);
    return call('AppUpdate', 'openAppStore').catch(report);
  }

  var shownUpdate = false;
  function checkForUpdate(c) {
    if (shownUpdate || !BUILD) return;
    var p = platformConf(c);
    var min = Number(p.minBuild) || 0;
    var latest = Number(p.latestBuild) || 0;
    if (min && BUILD < min) {
      shownUpdate = true;
      sheet({
        block: true,
        title: t('updateRequiredTitle'),
        body: msg(c, 'updateRequiredBody'),
        main: t('updateNow'),
        onMain: function () { updateApp(c); return false; }
      });
    } else if (latest && BUILD < latest && store('update-dismissed') !== latest) {
      shownUpdate = true;
      banner(msg(c, 'updateBody'), t('updateNow'), function () { updateApp(c); }, function () { store('update-dismissed', latest); });
    }
  }

  // ---------- 8. notifications ----------

  function pushReady() {
    return !!cfg.push && !!plugin('PushNotifications') && feature('push');
  }

  var registering = null;
  function registerPush() {
    if (registering) return registering;
    registering = new Promise(function (resolve) {
      listen('PushNotifications', 'registration', function (token) {
        sendToken(token && token.value);
        resolve(true);
      });
      listen('PushNotifications', 'registrationError', function (e) {
        report(e && e.error);
        resolve(false);
      });
      call('PushNotifications', 'register').catch(function (e) {
        report(e);
        resolve(false);
      });
    });
    return registering;
  }

  function sendToken(token) {
    if (!token || typeof token !== 'string') return;
    var last = store('push-sent');
    if (last && last.token === token && Date.now() - last.at < 24 * 3600 * 1000) return;
    fetch(DEVICES_PATH, {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json', 'x-lang': lang() },
      body: JSON.stringify({ token: token, platform: PLATFORM, appVersion: String(cfg.version || ''), build: BUILD, lang: lang() })
    }).then(function (r) {
      if (r.ok) store('push-sent', { token: token, at: Date.now() });
    }).catch(report);
  }

  function enableNotifications() {
    if (!pushReady()) return Promise.resolve(false);
    return call('PushNotifications', 'requestPermissions').then(function (p) {
      if (!p || p.receive !== 'granted') {
        if (p && p.receive === 'denied') toast(t('pushOff'));
        return false;
      }
      return registerPush();
    }).catch(function (e) {
      report(e);
      return false;
    });
  }

  function offerNotifications() {
    if (!pushReady()) return;
    var asked = store('push-asked');
    if (asked && Date.now() - asked < 14 * 24 * 3600 * 1000) return;
    call('PushNotifications', 'checkPermissions').then(function (p) {
      var state = p && p.receive;
      if (state === 'granted') return registerPush();
      if (state !== 'prompt' && state !== 'prompt-with-rationale') return;
      store('push-asked', Date.now());
      sheet({
        title: t('pushTitle'),
        body: t('pushBody'),
        main: t('pushOn'),
        alt: t('notNow'),
        onMain: function () { enableNotifications(); }
      });
    }).catch(report);
  }

  safe(function () {
    if (!cfg.push || !plugin('PushNotifications')) return;
    // A tapped notification opens its page (only the shop's own pages).
    listen('PushNotifications', 'pushNotificationActionPerformed', function (action) {
      var data = action && action.notification && action.notification.data;
      var url = data && parseUrl(data.url || data.link);
      if (url && url.origin === location.origin && url.href !== location.href) location.assign(url.href);
    });
    onConfig(function () {
      if (!feature('push')) return;
      // Keep the shop's copy of this phone's address fresh when notifications are already allowed.
      call('PushNotifications', 'checkPermissions').then(function (p) {
        if (p && p.receive === 'granted') registerPush();
      }).catch(noop);
      // Right after an order is placed is when notifications mean something.
      var q = new URLSearchParams(location.search);
      if (location.pathname.replace(/\.html$/, '') === '/order' && q.get('new') === '1') setTimeout(offerNotifications, 1200);
    });
  })();

  // ---------- 7. Google / Facebook sign-in through the phone's browser ----------

  function b64url(bytes) {
    var s = '';
    for (var i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]);
    return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  }

  function socialSignIn(provider, next) {
    if (!socialEnabled()) {
      toast(t('socialOff'));
      return;
    }
    var back = next === 'cart' ? '&next=cart' : '';
    // PKCE-style: the browser gets only the hash (challenge); the app keeps the secret (verifier) and shows it to
    // the shop when it hands the sign-in back, so a stolen code is useless. The app then opens
    // /auth/app?code=…&verifier=… itself (it also works if Android had to restart the app meanwhile).
    var verifier = b64url(crypto.getRandomValues(new Uint8Array(32)));
    crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier)).then(function (hash) {
      var challenge = b64url(new Uint8Array(hash));
      var start = location.origin + '/auth/' + provider + '?app=1&challenge=' + challenge + back;
      return call('Ebda3Shell', 'signIn', { url: start, verifier: verifier, next: next === 'cart' ? 'cart' : '' });
    }).catch(function (e) {
      if (isCancel(e)) return;
      report(e);
      location.assign('/account?oauth=failed' + back);
    });
  }

  // ---------- the app's own small UI ----------

  var toastTimer = null;
  function toast(text) {
    whenReady(function () {
      var el = document.getElementById('e3a-toast');
      if (!el) {
        el = document.createElement('div');
        el.id = 'e3a-toast';
        el.className = 'e3a-toast';
        el.setAttribute('role', 'status');
        el.setAttribute('aria-live', 'polite');
        document.body.appendChild(el);
      }
      el.dir = lang() === 'ar' ? 'rtl' : 'ltr';
      el.textContent = text;
      void el.offsetWidth;
      el.classList.add('e3a-on');
      clearTimeout(toastTimer);
      toastTimer = setTimeout(function () { el.classList.remove('e3a-on'); }, 3500);
    });
  }

  function button(cls, text, fn) {
    var b = document.createElement('button');
    b.type = 'button';
    b.className = 'e3a-btn ' + cls;
    b.textContent = text;
    b.addEventListener('click', fn);
    return b;
  }

  function sheet(o) {
    whenReady(function () {
      if (document.getElementById('e3a-sheet')) return;
      var veil = document.createElement('div');
      veil.id = 'e3a-sheet';
      veil.className = 'e3a-veil' + (o.block ? ' e3a-block' : '');
      veil.dir = lang() === 'ar' ? 'rtl' : 'ltr';
      veil.lang = lang();
      var box = document.createElement('div');
      box.className = 'e3a-sheet';
      box.setAttribute('role', 'dialog');
      box.setAttribute('aria-modal', 'true');
      var h = document.createElement('h2');
      h.textContent = o.title;
      var p = document.createElement('p');
      p.textContent = o.body;
      var row = document.createElement('div');
      row.className = 'e3a-row';
      var close = function () { if (veil.parentNode) veil.parentNode.removeChild(veil); };
      row.appendChild(button('e3a-main', o.main, function () {
        if (o.onMain() !== false) close();
      }));
      if (o.alt) row.appendChild(button('e3a-alt', o.alt, close));
      box.appendChild(h);
      box.appendChild(p);
      box.appendChild(row);
      veil.appendChild(box);
      if (!o.block) veil.addEventListener('click', function (ev) { if (ev.target === veil) close(); });
      document.body.appendChild(veil);
    });
  }

  function banner(text, action, onAction, onClose) {
    whenReady(function () {
      if (document.getElementById('e3a-banner')) return;
      var el = document.createElement('div');
      el.id = 'e3a-banner';
      el.className = 'e3a-banner';
      el.dir = lang() === 'ar' ? 'rtl' : 'ltr';
      var span = document.createElement('span');
      span.textContent = text;
      var go = document.createElement('button');
      go.type = 'button';
      go.className = 'e3a-go';
      go.textContent = action;
      var x = document.createElement('button');
      x.type = 'button';
      x.className = 'e3a-x';
      x.textContent = '×';
      x.setAttribute('aria-label', t('later'));
      var remove = function () { if (el.parentNode) el.parentNode.removeChild(el); };
      go.addEventListener('click', function () { remove(); onAction(); });
      x.addEventListener('click', function () { remove(); onClose(); });
      el.appendChild(span);
      el.appendChild(go);
      el.appendChild(x);
      document.body.appendChild(el);
    });
  }

  // ---------- start ----------

  whenReady(function () {
    checkForUpdate(remote());
    refreshConfig(false).then(configFinished, configFinished);
  });
  document.addEventListener('visibilitychange', safe(function () {
    if (document.visibilityState !== 'visible') return;
    var kept = store('config');
    if (!kept || Date.now() - kept.at > CONFIG_MAX_AGE) refreshConfig(true);
  }));

  define(window, 'ebda3App', Object.freeze({
    isApp: true,
    platform: PLATFORM,
    version: String(cfg.version || ''),
    build: BUILD,
    enableNotifications: enableNotifications,
    openExternal: function (u) {
      var url = parseUrl(u);
      return url ? openOutside(url.href) : Promise.resolve();
    },
    refreshConfig: function () { return refreshConfig(true); }
  }));
})();
