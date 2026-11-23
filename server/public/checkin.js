// Employee check-in web page: login → location → live selfie → upload.
// The server does every real check (office Wi-Fi, geofence, selfie freshness,
// device binding); this page just collects the evidence.
(() => {
  const $ = (s) => document.querySelector(s);

  // ---------------------------------------------------------------- i18n
  const T = {
    en: {
      appTitle: 'Attendance', switchLang: 'العربية', loginSubtitle: 'Log in with the code your admin gave you',
      employeeCode: 'Employee code', password: 'Password', logIn: 'Log in', logOut: 'Log out',
      browserLinkNote: "Your account will be linked to this browser the first time you log in. Don't use a private / incognito window.",
      enterBoth: 'Enter your employee code and password.',
      hello: (n) => `Hello, ${n}`, workLocation: (n) => `Work location: ${n}`, workLocationAny: 'Work location: any company site',
      checkedInChip: 'You are checked in', notCheckedInChip: 'You are not checked in',
      checkIn: 'Check in', checkOut: 'Check out', today: 'Today', noPunchesToday: 'No check-ins yet today.',
      myHistory: 'My history', back: '← Back', checkedIn: 'Checked in', checkedOut: 'Checked out',
      punchedAt: (t, s) => `${t} at ${s}`, viaWifi: 'Verified on office Wi-Fi', ok: 'OK', cancel: 'Cancel',
      netOk: 'Connected to the office Wi-Fi', netOff: 'Not on the office Wi-Fi',
      netOffHelp: 'Turn off mobile data and connect to the office Wi-Fi to check in.',
      stepLocation: 'Getting your location…', stepCamera: 'Opening camera…', stepSending: 'Sending…',
      notRecorded: 'Not recorded', selfieIn: 'Check-in selfie', selfieOut: 'Check-out selfie',
      lookAtCamera: 'Look at the camera. Your face must be clearly visible.', retake: 'Retake', usePhoto: 'Use photo',
      notOfficeNetwork: 'You must be connected to the office Wi-Fi to check in. Turn off mobile data and connect to the office Wi-Fi, then try again.',
      needHttps: 'This page must be opened with https:// for the camera and location to work.',
      locDenied: 'Location access is blocked for this site. Allow location for this page in your browser settings (tap the icon next to the address bar), then try again.',
      locUnavailable: "Couldn't get your location. Make sure Location is turned on in your phone settings and try again.",
      camDenied: 'Camera access is blocked for this site. Allow the camera for this page in your browser settings, then try again.',
      camNone: 'No camera was found on this device.', camError: (e) => `Camera error: ${e}`,
      networkError: 'No connection to the server. Check your internet and try again.',
      serverError: (s) => `Server error (${s})`, sessionEnded: 'Please log in again.',
      myAttendance: 'My attendance', daysAttended: (n) => `${n} day${n === 1 ? '' : 's'} attended`,
      noAttendance: 'No attendance this month', inShort: 'In', outShort: 'Out',
      months: ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'],
      weekdays: ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'],
      am: 'AM', pm: 'PM',
    },
    ar: {
      appTitle: 'الحضور', switchLang: 'English', loginSubtitle: 'سجّل الدخول بالرمز الذي أعطاك إياه المسؤول',
      employeeCode: 'رمز الموظف', password: 'كلمة المرور', logIn: 'تسجيل الدخول', logOut: 'تسجيل الخروج',
      browserLinkNote: 'سيتم ربط حسابك بهذا المتصفح عند أول تسجيل دخول. لا تستخدم نافذة التصفح الخاص (المتخفي).',
      enterBoth: 'أدخل رمز الموظف وكلمة المرور.',
      hello: (n) => `مرحبًا، ${n}`, workLocation: (n) => `موقع العمل: ${n}`, workLocationAny: 'موقع العمل: أي موقع للشركة',
      checkedInChip: 'أنت مسجّل حضور', notCheckedInChip: 'لم تسجّل حضورك',
      checkIn: 'تسجيل الحضور', checkOut: 'تسجيل الانصراف', today: 'اليوم', noPunchesToday: 'لا يوجد تسجيل اليوم بعد.',
      myHistory: 'سجلّي', back: '→ رجوع', checkedIn: 'تم تسجيل الحضور', checkedOut: 'تم تسجيل الانصراف',
      punchedAt: (t, s) => `${t} في ${s}`, viaWifi: 'تم التحقق عبر شبكة المكتب', ok: 'حسنًا', cancel: 'إلغاء',
      netOk: 'متصل بشبكة Wi-Fi المكتب', netOff: 'غير متصل بشبكة Wi-Fi المكتب',
      netOffHelp: 'أوقف بيانات الجوال واتصل بشبكة Wi-Fi المكتب لتسجيل الحضور.',
      stepLocation: 'جارٍ تحديد موقعك…', stepCamera: 'جارٍ فتح الكاميرا…', stepSending: 'جارٍ الإرسال…',
      notRecorded: 'لم يتم التسجيل', selfieIn: 'سيلفي الحضور', selfieOut: 'سيلفي الانصراف',
      lookAtCamera: 'انظر إلى الكاميرا. يجب أن يظهر وجهك بوضوح.', retake: 'إعادة الالتقاط', usePhoto: 'استخدام الصورة',
      notOfficeNetwork: 'يجب أن تكون متصلًا بشبكة Wi-Fi الخاصة بالمكتب لتسجيل الحضور. أوقف بيانات الجوال واتصل بشبكة المكتب ثم حاول مرة أخرى.',
      needHttps: 'يجب فتح هذه الصفحة عبر https:// لكي تعمل الكاميرا والموقع.',
      locDenied: 'الوصول إلى الموقع محظور لهذا الموقع. اسمح بالموقع لهذه الصفحة من إعدادات المتصفح (اضغط الرمز بجانب شريط العنوان) ثم حاول مرة أخرى.',
      locUnavailable: 'تعذّر تحديد موقعك. تأكد من تشغيل خدمة الموقع في إعدادات الجوال وحاول مرة أخرى.',
      camDenied: 'الوصول إلى الكاميرا محظور لهذا الموقع. اسمح بالكاميرا لهذه الصفحة من إعدادات المتصفح ثم حاول مرة أخرى.',
      camNone: 'لم يتم العثور على كاميرا في هذا الجهاز.', camError: (e) => `خطأ في الكاميرا: ${e}`,
      networkError: 'لا يوجد اتصال بالخادم. تحقق من الإنترنت وحاول مرة أخرى.',
      serverError: (s) => `خطأ في الخادم (${s})`, sessionEnded: 'يرجى تسجيل الدخول مرة أخرى.',
      myAttendance: 'سجل حضوري',
      daysAttended: (n) => (n === 0 ? 'لا توجد أيام حضور' : n === 1 ? 'يوم حضور واحد' : n === 2 ? 'يوما حضور' : n <= 10 ? `${n} أيام حضور` : `${n} يوم حضور`),
      noAttendance: 'لا يوجد حضور هذا الشهر', inShort: 'حضور', outShort: 'انصراف',
      months: ['يناير', 'فبراير', 'مارس', 'أبريل', 'مايو', 'يونيو', 'يوليو', 'أغسطس', 'سبتمبر', 'أكتوبر', 'نوفمبر', 'ديسمبر'],
      weekdays: ['الأحد', 'الاثنين', 'الثلاثاء', 'الأربعاء', 'الخميس', 'الجمعة', 'السبت'],
      am: 'ص', pm: 'م',
    },
  };

  const store = {
    get(k) { try { return localStorage.getItem(k); } catch { return null; } },
    set(k, v) { try { v == null ? localStorage.removeItem(k) : localStorage.setItem(k, v); } catch {} },
  };

  let lang = store.get('att_lang') || ((navigator.language || '').toLowerCase().startsWith('ar') ? 'ar' : 'en');
  const s = () => T[lang];

  function applyLanguage() {
    document.documentElement.lang = lang;
    document.documentElement.dir = lang === 'ar' ? 'rtl' : 'ltr';
    document.querySelectorAll('[data-t]').forEach((el) => {
      const v = s()[el.dataset.t];
      if (typeof v === 'string') el.textContent = v;
    });
    $('#lang-btn').textContent = s().switchLang;
    document.title = company || s().appTitle;
    $('#brand').textContent = company || s().appTitle;
    if (me) renderHome();
    if (!$('#history-view').classList.contains('hidden')) loadHistory();
  }

  // ---------------------------------------------------------------- formatting
  const two = (n) => String(n).padStart(2, '0');
  const fmtTime = (d) => `${d.getHours() % 12 || 12}:${two(d.getMinutes())} ${d.getHours() < 12 ? s().am : s().pm}`;
  const fmtDate = (d) => `${s().weekdays[d.getDay()]}${lang === 'ar' ? '،' : ','} ${d.getDate()} ${s().months[d.getMonth()]} ${d.getFullYear()}`;
  const monthKey = (d) => `${d.getFullYear()}-${two(d.getMonth() + 1)}`;
  const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

  // ---------------------------------------------------------------- API
  let token = store.get('att_emp_token');
  let me = null;
  let company = '';

  class ApiError extends Error {
    constructor(msg, status, code) { super(msg); this.status = status; this.code = code; }
  }

  async function api(method, url, body) {
    const headers = { 'accept-language': lang };
    if (token) headers.authorization = `Bearer ${token}`;
    if (body && !(body instanceof FormData)) headers['content-type'] = 'application/json';
    let res;
    try {
      res = await fetch(url, {
        method, headers, credentials: 'same-origin',
        body: body instanceof FormData ? body : body ? JSON.stringify(body) : undefined,
      });
    } catch {
      throw new ApiError(s().networkError, 0);
    }
    let data = null;
    try { data = await res.json(); } catch {}
    if (!res.ok) {
      const err = new ApiError((data && data.error) || s().serverError(res.status), res.status, data && data.code);
      if (res.status === 401 || err.code === 'DEVICE_MISMATCH') logout(err.message);
      throw err;
    }
    return data;
  }

  // ---------------------------------------------------------------- views
  function show(view) {
    for (const v of ['login', 'home', 'history']) $(`#${v}-view`).classList.toggle('hidden', v !== view);
    $('#logout-btn').classList.toggle('hidden', view === 'login');
    window.scrollTo(0, 0);
  }

  const dialog = $('#dialog');
  function alertBox(title, text, icon = '⚠️') {
    $('#dialog-icon').textContent = icon;
    $('#dialog-title').textContent = title;
    $('#dialog-text').textContent = text || '';
    if (dialog.showModal) dialog.showModal(); else window.alert(`${title}\n\n${text}`);
    return new Promise((r) => dialog.addEventListener('close', r, { once: true }));
  }
  $('#dialog-ok').addEventListener('click', () => dialog.close());

  // ---------------------------------------------------------------- login
  function logout(message) {
    token = null;
    me = null;
    store.set('att_emp_token', null);
    show('login');
    $('#login-error').textContent = message || '';
  }

  $('#login-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const f = e.target;
    const emp_code = f.emp_code.value.trim();
    const password = f.password.value;
    $('#login-error').textContent = '';
    if (!emp_code || !password) { $('#login-error').textContent = s().enterBoth; return; }
    const btn = f.querySelector('button[type=submit]');
    btn.disabled = true;
    try {
      const r = await api('POST', '/api/auth/login', { emp_code, password, portal: 'web' });
      if (r.user.role !== 'employee') throw new ApiError(lang === 'ar' ? 'يستخدم المسؤولون لوحة التحكم.' : 'Admins use the dashboard at /admin.', 403);
      token = r.token;
      store.set('att_emp_token', token);
      f.password.value = '';
      await refresh();
      show('home');
    } catch (ex) {
      $('#login-error').textContent = ex.message;
    } finally {
      btn.disabled = false;
    }
  });

  $('#logout-btn').addEventListener('click', () => logout());
  $('#lang-btn').addEventListener('click', () => {
    lang = lang === 'ar' ? 'en' : 'ar';
    store.set('att_lang', lang);
    applyLanguage();
  });

  // ---------------------------------------------------------------- home
  let busy = false;

  async function refresh() {
    me = await api('GET', '/api/attendance/me');
    company = me.company_name || '';
    applyLanguage();
  }

  function renderHome() {
    const now = new Date();
    $('#hello').textContent = s().hello(me.user.name);
    $('#site-line').textContent = me.site ? s().workLocation(me.site.name) : s().workLocationAny;
    $('#clock-time').textContent = fmtTime(now);
    $('#clock-date').textContent = fmtDate(now);

    const chip = $('#status-chip');
    chip.textContent = me.checked_in ? s().checkedInChip : s().notCheckedInChip;
    chip.classList.toggle('in', me.checked_in);

    const banner = $('#net-banner');
    banner.className = 'banner';
    if (me.office_network === 'ok') {
      banner.classList.add('ok');
      banner.innerHTML = `<span aria-hidden="true">✓</span><div><strong>${esc(s().netOk)}</strong></div>`;
    } else if (me.office_network === 'off') {
      banner.classList.add('off');
      banner.innerHTML = `<span aria-hidden="true">⚠</span><div><strong>${esc(s().netOff)}</strong>${esc(s().netOffHelp)}</div>`;
    } else {
      banner.classList.add('hidden');
    }

    const btn = $('#punch-btn');
    if (!busy) btn.textContent = me.checked_in ? s().checkOut : s().checkIn;
    btn.classList.toggle('out', me.checked_in);
    btn.disabled = busy;

    const list = $('#today-list');
    list.innerHTML = me.today.length
      ? [...me.today].reverse().map((r) => `<li>
          <span class="${r.type === 'in' ? 'tag-in' : 'tag-out'}">${esc(r.type === 'in' ? s().checkedIn : s().checkedOut)}</span>
          <span class="t">${esc(fmtTime(new Date(r.ts)))}</span></li>`).join('')
      : `<li class="empty">${esc(s().noPunchesToday)}</li>`;
  }

  setInterval(() => { if (me && !$('#home-view').classList.contains('hidden')) renderHome(); }, 20000);
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible' && token && !busy) refresh().catch(() => {});
  });

  function setStep(text) {
    const line = $('#step-line');
    line.textContent = text || '';
    line.classList.toggle('hidden', !text);
  }

  function getLocation() {
    return new Promise((resolve, reject) => {
      if (!navigator.geolocation) return reject(new Error(s().locUnavailable));
      navigator.geolocation.getCurrentPosition(resolve, (err) => {
        reject(new Error(err.code === err.PERMISSION_DENIED ? s().locDenied : s().locUnavailable));
      }, { enableHighAccuracy: true, timeout: 25000, maximumAge: 0 });
    });
  }

  $('#punch-btn').addEventListener('click', async () => {
    if (busy || !me) return;
    const type = me.checked_in ? 'out' : 'in';
    if (!window.isSecureContext) return alertBox(s().notRecorded, s().needHttps);

    busy = true;
    const btn = $('#punch-btn');
    btn.disabled = true;
    try {
      // 1. Office Wi-Fi first, so nobody takes a selfie for nothing
      await refresh();
      if (me.office_network === 'off') throw new Error(s().notOfficeNetwork);

      // 2. Location
      btn.textContent = s().stepLocation;
      const pos = await getLocation();

      // 3. Live selfie
      btn.textContent = s().stepCamera;
      const selfie = await takeSelfie(type);
      if (!selfie) return;

      // 4. Upload
      btn.textContent = s().stepSending;
      const fd = new FormData();
      fd.append('type', type);
      fd.append('source', 'web');
      fd.append('lat', String(pos.coords.latitude));
      fd.append('lng', String(pos.coords.longitude));
      fd.append('accuracy', String(pos.coords.accuracy));
      fd.append('capture_age_sec', String(Math.round((Date.now() - selfie.takenAt) / 1000)));
      fd.append('photo', selfie.blob, 'selfie.jpg');
      const r = await api('POST', '/api/attendance', fd);

      await refresh();
      const time = fmtTime(new Date(r.ts));
      await alertBox(type === 'in' ? s().checkedIn : s().checkedOut,
        s().punchedAt(time, r.site) + (r.via_network ? `\n${s().viaWifi}` : ''), '✅');
    } catch (ex) {
      if (ex instanceof ApiError && (ex.status === 401 || ex.code === 'DEVICE_MISMATCH')) return;
      await alertBox(s().notRecorded, ex.message);
    } finally {
      busy = false;
      setStep('');
      if (me) renderHome();
    }
  });

  // ---------------------------------------------------------------- camera
  // Live capture only: the photo is taken from the camera stream inside the
  // page. There is no file picker, so gallery photos and filtered/edited
  // pictures can't be used.
  function takeSelfie(type) {
    return new Promise(async (resolve) => {
      const cam = $('#camera');
      const video = $('#cam-video');
      const img = $('#cam-photo');
      const errBox = $('#cam-error');
      const shutter = $('#cam-shutter');
      const review = $('#cam-review');
      let stream = null;
      let shot = null;

      $('#cam-title').textContent = type === 'in' ? s().selfieIn : s().selfieOut;
      cam.classList.remove('hidden');

      const stop = () => { if (stream) stream.getTracks().forEach((t) => t.stop()); stream = null; };
      const finish = (result) => {
        stop();
        cam.classList.add('hidden');
        if (img.src) URL.revokeObjectURL(img.src);
        img.removeAttribute('src');
        cleanup();
        resolve(result);
      };

      async function start() {
        shot = null;
        img.classList.add('hidden');
        video.classList.remove('hidden');
        review.classList.add('hidden');
        shutter.classList.remove('hidden');
        $('#cam-hint').classList.remove('hidden');
        errBox.classList.add('hidden');
        shutter.disabled = true;
        try {
          stream = await navigator.mediaDevices.getUserMedia({
            video: { facingMode: 'user', width: { ideal: 1280 }, height: { ideal: 960 } },
            audio: false,
          });
          video.srcObject = stream;
          await video.play().catch(() => {});
          shutter.disabled = false;
        } catch (e) {
          const name = e && e.name;
          errBox.textContent = name === 'NotAllowedError' || name === 'SecurityError' ? s().camDenied
            : name === 'NotFoundError' || name === 'OverconstrainedError' ? s().camNone
            : s().camError(name || e);
          errBox.classList.remove('hidden');
        }
      }

      function capture() {
        if (!video.videoWidth) return;
        const max = 960;
        const scale = Math.min(1, max / Math.max(video.videoWidth, video.videoHeight));
        const c = $('#cam-canvas');
        c.width = Math.round(video.videoWidth * scale);
        c.height = Math.round(video.videoHeight * scale);
        c.getContext('2d').drawImage(video, 0, 0, c.width, c.height);
        const takenAt = Date.now();
        c.toBlob((blob) => {
          if (!blob) return;
          stop();
          shot = { blob, takenAt };
          img.src = URL.createObjectURL(blob);
          img.classList.remove('hidden');
          video.classList.add('hidden');
          shutter.classList.add('hidden');
          $('#cam-hint').classList.add('hidden');
          review.classList.remove('hidden');
        }, 'image/jpeg', 0.85);
      }

      const onShutter = () => capture();
      const onRetake = () => { if (img.src) URL.revokeObjectURL(img.src); start(); };
      const onUse = () => shot && finish(shot);
      const onCancel = () => finish(null);
      shutter.addEventListener('click', onShutter);
      $('#cam-retake').addEventListener('click', onRetake);
      $('#cam-use').addEventListener('click', onUse);
      $('#cam-cancel').addEventListener('click', onCancel);
      function cleanup() {
        shutter.removeEventListener('click', onShutter);
        $('#cam-retake').removeEventListener('click', onRetake);
        $('#cam-use').removeEventListener('click', onUse);
        $('#cam-cancel').removeEventListener('click', onCancel);
      }

      start();
    });
  }

  // ---------------------------------------------------------------- history
  let month = new Date(new Date().getFullYear(), new Date().getMonth(), 1);

  async function loadHistory() {
    $('#month-title').textContent = `${s().months[month.getMonth()]} ${month.getFullYear()}`;
    $('#next-month').disabled = monthKey(month) >= monthKey(new Date());
    const list = $('#history-list');
    let records;
    try {
      records = (await api('GET', `/api/attendance/history?month=${monthKey(month)}`)).records;
    } catch (ex) {
      list.innerHTML = `<li class="empty">${esc(ex.message)}</li>`;
      return;
    }
    const byDay = new Map();
    for (const r of records) {
      if (!byDay.has(r.local_date)) byDay.set(r.local_date, []);
      byDay.get(r.local_date).push(r);
    }
    $('#month-count').textContent = s().daysAttended(byDay.size);
    list.innerHTML = byDay.size
      ? [...byDay].map(([day, recs]) => {
          const d = new Date(`${day}T12:00:00`);
          return `<li><span>${esc(`${s().weekdays[d.getDay()]} ${d.getDate()}`)}</span><span class="punches">${
            [...recs].reverse().map((r) => `<span class="${r.type === 'in' ? 'tag-in' : 'tag-out'}">${esc(r.type === 'in' ? s().inShort : s().outShort)} ${esc(fmtTime(new Date(r.ts)))}</span>`).join('')
          }</span></li>`;
        }).join('')
      : `<li class="empty">${esc(s().noAttendance)}</li>`;
  }

  $('#history-btn').addEventListener('click', () => { show('history'); loadHistory(); });
  $('#back-btn').addEventListener('click', () => { show('home'); refresh().catch(() => {}); });
  $('#prev-month').addEventListener('click', () => { month = new Date(month.getFullYear(), month.getMonth() - 1, 1); loadHistory(); });
  $('#next-month').addEventListener('click', () => {
    if (monthKey(month) >= monthKey(new Date())) return;
    month = new Date(month.getFullYear(), month.getMonth() + 1, 1);
    loadHistory();
  });

  // ---------------------------------------------------------------- start
  applyLanguage();
  if (token) {
    refresh().then(() => show('home')).catch((ex) => { if (token) { show('login'); $('#login-error').textContent = ex.message; } });
  } else {
    show('login');
  }
})();
