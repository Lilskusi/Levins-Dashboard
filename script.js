/* Levins Dashboard - Logik
   Alles in einer Datei, ohne Frameworks. Daten werden im Browser (localStorage) gespeichert. */
(function () {
  'use strict';

  /* ===== Grundwerte ===== */
  const STORAGE_KEY = 'levinsDashboard.v1';
  const WEATHER_KEY = 'levinsDashboard.weather.v1';
  const WEATHER_MAX_AGE = 15 * 60 * 1000; // Wetter höchstens alle 15 Minuten neu laden
  const DEFAULT_METUBE = 'http://localhost:8081';

  // Neue Widgets später: hier eintragen, im HTML eine Karte mit data-widget="id" anlegen.
  const WIDGETS = [
    { id: 'weather', title: 'Wetter' },
    { id: 'meds', title: 'Medikamente' },
    { id: 'todo', title: 'Aufgaben' },
    { id: 'weekly', title: 'Wochenaufgaben' },
    { id: 'calendar', title: 'Kalender' },
    { id: 'links', title: 'Schnellzugriffe' },
    { id: 'metube', title: 'MeTube' },
    { id: 'music', title: 'Musik' },
    { id: 'notes', title: 'Notizen' }
  ];
  const THEMES = ['violet', 'magenta', 'indigo'];
  const PROJECT_TYPES = ['Single', 'EP', 'Album', 'Remix', 'Projekt'];
  const STATUS = { idea: 'Idee', wip: 'In Arbeit', done: 'Fertig', released: 'Veröffentlicht' };

  const WEATHER_TEXT = {
    0: 'Klar', 1: 'Überwiegend klar', 2: 'Teils bewölkt', 3: 'Bedeckt',
    45: 'Nebel', 48: 'Reifnebel',
    51: 'Leichter Nieselregen', 53: 'Nieselregen', 55: 'Starker Nieselregen',
    56: 'Gefrierender Nieselregen', 57: 'Gefrierender Nieselregen',
    61: 'Leichter Regen', 63: 'Regen', 65: 'Starker Regen',
    66: 'Gefrierender Regen', 67: 'Gefrierender Regen',
    71: 'Leichter Schneefall', 73: 'Schneefall', 75: 'Starker Schneefall', 77: 'Schneegriesel',
    80: 'Leichte Regenschauer', 81: 'Regenschauer', 82: 'Starke Regenschauer',
    85: 'Schneeschauer', 86: 'Starke Schneeschauer',
    95: 'Gewitter', 96: 'Gewitter mit Hagel', 99: 'Starkes Gewitter mit Hagel'
  };

  const $ = function (id) { return document.getElementById(id); };

  /* ===== Hilfsfunktionen ===== */
  function uid() {
    return Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
  }

  // Baut ein HTML-Element. Texte werden immer als reiner Text gesetzt (sicher gegen Code-Einschleusung).
  function h(tag, attrs, children) {
    const node = document.createElement(tag);
    Object.keys(attrs || {}).forEach(function (key) {
      const value = attrs[key];
      if (value === null || value === undefined || value === false) return;
      if (key === 'class') node.className = value;
      else if (key === 'text') node.textContent = value;
      else if (key.slice(0, 2) === 'on') node.addEventListener(key.slice(2), value);
      else node.setAttribute(key, value === true ? '' : value);
    });
    (children || []).forEach(function (child) {
      if (child) node.appendChild(typeof child === 'string' ? document.createTextNode(child) : child);
    });
    return node;
  }

  function setText(node, text) {
    if (node.textContent !== text) node.textContent = text;
  }

  // Macht aus Eingaben wie "gmail.com" eine gültige Adresse. Nur http und https sind erlaubt.
  function safeUrl(input) {
    let s = String(input || '').trim();
    if (!s) return '';
    if (!/^[a-z][a-z0-9+.\-]*:\/\//i.test(s)) {
      const local = /^(localhost|\d{1,3}(\.\d{1,3}){3})(:|\/|$)/i.test(s);
      s = (local ? 'http://' : 'https://') + s;
    }
    try {
      const u = new URL(s);
      if (u.protocol !== 'http:' && u.protocol !== 'https:') return '';
      return u.href;
    } catch (e) {
      return '';
    }
  }

  function hostOf(url) {
    try { return new URL(url).hostname.replace(/^www\./, ''); } catch (e) { return url; }
  }

  /* ===== Datums-Helfer (alles in deiner lokalen Zeit) ===== */
  const WD_SHORT = ['Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa', 'So'];
  const WD_LONG = ['Montag', 'Dienstag', 'Mittwoch', 'Donnerstag', 'Freitag', 'Samstag', 'Sonntag'];

  function pad(n) { return n < 10 ? '0' + n : String(n); }
  function isYmd(x) { return typeof x === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(x); }
  function ymd(d) { return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()); }
  function parseYmd(s) { const p = s.split('-'); return new Date(+p[0], +p[1] - 1, +p[2]); }
  function addDays(d, n) { return new Date(d.getFullYear(), d.getMonth(), d.getDate() + n); }
  function dayNum(s) { const p = s.split('-'); return Math.round(Date.UTC(+p[0], +p[1] - 1, +p[2]) / 86400000); }
  function wdIndex(d) { return (d.getDay() + 6) % 7; } // Montag = 0
  function todayStr() { return ymd(new Date()); }
  function fmtShort(s) { return parseYmd(s).toLocaleDateString('de-DE', { weekday: 'short', day: 'numeric', month: 'short' }); }
  function fmtLong(s) { return parseYmd(s).toLocaleDateString('de-DE', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }); }
  function fmtDM(s) { const d = parseYmd(s); return WD_SHORT[wdIndex(d)] + ' ' + d.getDate() + '.' + (d.getMonth() + 1) + '.'; }

  let toastTimer = null;
  function toast(message) {
    const t = $('toast');
    t.textContent = message;
    t.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { t.classList.remove('show'); }, 3500);
  }

  /* ===== Daten: Standardwerte, Laden, Speichern ===== */
  function autoLite() {
    try {
      return (navigator.hardwareConcurrency || 4) <= 2 || (navigator.deviceMemory || 4) <= 2;
    } catch (e) { return false; }
  }

  function defaults() {
    return {
      settings: { name: 'Levin', city: '', metubeUrl: DEFAULT_METUBE, theme: 'violet', lite: autoLite() },
      widgets: { order: ['weather', 'meds', 'todo', 'weekly', 'calendar', 'links', 'metube', 'music', 'notes'], hidden: [] },
      todos: [],
      meds: [],
      events: [],
      weekly: [],
      links: [
        { id: uid(), title: 'YouTube', url: 'https://www.youtube.com/' },
        { id: uid(), title: 'GitHub', url: 'https://github.com/' },
        { id: uid(), title: 'Google', url: 'https://www.google.com/' },
        { id: uid(), title: 'Wikipedia', url: 'https://de.wikipedia.org/' }
      ],
      music: {
        projects: [],
        links: [
          { id: uid(), title: 'Spotify', url: 'https://open.spotify.com/' },
          { id: uid(), title: 'SoundCloud', url: 'https://soundcloud.com/' },
          { id: uid(), title: 'Bandcamp', url: 'https://bandcamp.com/' }
        ]
      },
      notes: ''
    };
  }

  function cleanLinks(list) {
    return list.filter(function (l) { return l && typeof l.title === 'string' && safeUrl(l.url); })
      .map(function (l) { return { id: String(l.id || uid()), title: l.title.slice(0, 40), url: safeUrl(l.url) }; });
  }

  // Prüft geladene Daten und ergänzt Fehlendes. So kann eine kaputte Sicherung nichts zerstören.
  function normalize(raw) {
    const d = defaults();
    if (!raw || typeof raw !== 'object') return d;

    const s = raw.settings || {};
    ['name', 'city', 'metubeUrl', 'theme'].forEach(function (k) {
      if (typeof s[k] === 'string') d.settings[k] = s[k];
    });
    if (typeof s.lite === 'boolean') d.settings.lite = s.lite;
    if (THEMES.indexOf(d.settings.theme) < 0) d.settings.theme = 'violet';
    d.settings.metubeUrl = safeUrl(d.settings.metubeUrl) || DEFAULT_METUBE;
    d.settings.name = d.settings.name.slice(0, 40);
    d.settings.city = d.settings.city.slice(0, 80);

    const known = WIDGETS.map(function (w) { return w.id; });
    if (raw.widgets && Array.isArray(raw.widgets.order)) {
      const order = raw.widgets.order.filter(function (id, i, a) { return known.indexOf(id) >= 0 && a.indexOf(id) === i; });
      known.forEach(function (id) { if (order.indexOf(id) < 0) order.push(id); }); // neue Widgets hinten anhängen
      d.widgets.order = order;
    }
    if (raw.widgets && Array.isArray(raw.widgets.hidden)) {
      d.widgets.hidden = raw.widgets.hidden.filter(function (id) { return known.indexOf(id) >= 0; });
    }

    if (Array.isArray(raw.todos)) {
      d.todos = raw.todos.filter(function (t) { return t && typeof t.text === 'string'; })
        .map(function (t) { return { id: String(t.id || uid()), text: t.text.slice(0, 200), done: !!t.done }; });
    }
    if (Array.isArray(raw.links)) d.links = cleanLinks(raw.links);

    if (raw.music && typeof raw.music === 'object') {
      if (Array.isArray(raw.music.links)) d.music.links = cleanLinks(raw.music.links);
      if (Array.isArray(raw.music.projects)) {
        d.music.projects = raw.music.projects.filter(function (p) { return p && typeof p.title === 'string'; })
          .map(function (p) {
            return {
              id: String(p.id || uid()),
              title: p.title.slice(0, 80),
              type: PROJECT_TYPES.indexOf(p.type) >= 0 ? p.type : 'Projekt',
              status: STATUS[p.status] ? p.status : 'idea',
              date: /^\d{4}-\d{2}-\d{2}$/.test(p.date || '') ? p.date : '',
              url: safeUrl(p.url)
            };
          });
      }
    }
    if (Array.isArray(raw.meds)) {
      d.meds = raw.meds.filter(function (m) { return m && typeof m.name === 'string' && m.name.trim(); })
        .map(function (m) {
          const days = Array.isArray(m.days) ? m.days.filter(function (x, i, a) { return x >= 0 && x <= 6 && a.indexOf(x) === i; }) : [];
          const log = Array.isArray(m.log) ? m.log.filter(function (x, i, a) { return isYmd(x) && a.indexOf(x) === i; }).sort() : [];
          let mode = ['daily', 'interval', 'weekdays'].indexOf(m.mode) >= 0 ? m.mode : 'daily';
          if (mode === 'weekdays' && !days.length) mode = 'daily';
          return {
            id: String(m.id || uid()), name: m.name.trim().slice(0, 40),
            dose: typeof m.dose === 'string' ? m.dose.slice(0, 40) : '',
            mode: mode, interval: Math.min(60, Math.max(2, parseInt(m.interval, 10) || 2)), days: days,
            start: isYmd(m.start) ? m.start : ymd(new Date()),
            added: isYmd(m.added) ? m.added : ymd(new Date()),
            log: log
          };
        });
    }
    if (Array.isArray(raw.events)) {
      d.events = raw.events.filter(function (e) { return e && typeof e.title === 'string' && e.title.trim() && isYmd(e.date); })
        .map(function (e) {
          return {
            id: String(e.id || uid()), date: e.date, time: /^\d{2}:\d{2}$/.test(e.time || '') ? e.time : '', title: e.title.trim().slice(0, 100),
            repeat: ['weekly', 'monthly', 'yearly'].indexOf(e.repeat) >= 0 ? e.repeat : 'none'
          };
        });
    }
    if (Array.isArray(raw.weekly)) {
      d.weekly = raw.weekly.filter(function (t) { return t && typeof t.text === 'string' && t.text.trim(); })
        .map(function (t) {
          return {
            id: String(t.id || uid()), text: t.text.trim().slice(0, 120),
            day: typeof t.day === 'number' && t.day >= -1 && t.day <= 6 ? Math.floor(t.day) : -1,
            done: isYmd(t.done) ? t.done : '', count: Math.max(0, parseInt(t.count, 10) || 0)
          };
        });
    }
    if (typeof raw.notes === 'string') d.notes = raw.notes.slice(0, 20000);
    return d;
  }

  // Zeigt eine rote Warnung oben auf der Seite, wenn der Browser das Speichern verweigert
  function showStorageProblem() {
    const b = $('storageBanner');
    b.textContent = 'Achtung: Dein Browser speichert gerade nichts. Alles, was du einträgst, ist weg, sobald du die Seite schließt. ' +
      'Meist hilft es, den privaten Modus zu verlassen und in den Browser-Einstellungen das Speichern von Websitedaten für diese Seite zu erlauben.';
    b.hidden = false;
  }

  function storageWorks() {
    try {
      const k = 'levinsDashboard.test';
      localStorage.setItem(k, '1');
      const ok = localStorage.getItem(k) === '1';
      localStorage.removeItem(k);
      return ok;
    } catch (e) { return false; }
  }

  function save() {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
      if (localStorage.getItem(STORAGE_KEY) === null) throw new Error('nicht gespeichert');
      const d = new Date();
      setText($('saveState'), 'Zuletzt gespeichert um ' + pad(d.getHours()) + ':' + pad(d.getMinutes()) + ' Uhr.');
    } catch (e) {
      showStorageProblem();
    }
  }

  let loadProblem = false;
  function load() {
    let raw = null;
    try {
      raw = localStorage.getItem(STORAGE_KEY);
      return normalize(raw ? JSON.parse(raw) : null);
    } catch (e) {
      // Gespeicherte Daten waren da, ließen sich aber nicht lesen: Kopie aufbewahren statt sie zu überschreiben
      if (raw) {
        loadProblem = true;
        try { localStorage.setItem(STORAGE_KEY + '.kopie', raw); } catch (e2) { /* egal */ }
      }
      return normalize(null);
    }
  }

  let state = load();
  const editing = { links: false, music: false, meds: false };

  /* ===== Uhr, Datum, Begrüßung ===== */
  const dateFormat = new Intl.DateTimeFormat('de-DE', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
  let clockTimer = null;
  let lastDayKey = '';

  function greetingFor(hour) {
    if (hour >= 5 && hour < 11) return 'Guten Morgen';
    if (hour >= 11 && hour < 17) return 'Guten Tag';
    if (hour >= 17 && hour < 22) return 'Guten Abend';
    return 'Gute Nacht';
  }

  function updateGreeting(now) {
    const name = state.settings.name.trim();
    const g = greetingFor((now || new Date()).getHours());
    setText($('greeting'), name ? g + ', ' + name : g);
  }

  function tick() {
    const now = new Date();
    setText($('clockH'), pad(now.getHours()));
    setText($('clockM'), pad(now.getMinutes()));
    setText($('clockS'), pad(now.getSeconds()));
    setText($('date'), dateFormat.format(now));
    updateGreeting(now);
    const key = ymd(now);
    if (lastDayKey && key !== lastDayKey) onNewDay();
    lastDayKey = key;
    // Nächster Tick genau zur nächsten Sekunde
    clockTimer = setTimeout(tick, 1000 - now.getMilliseconds() + 5);
  }

  document.addEventListener('visibilitychange', function () {
    clearTimeout(clockTimer);
    if (!document.hidden) {
      tick();
      loadWeather(false);
    }
  });

  /* ===== Wetter (Open-Meteo, kostenlos, ohne Schlüssel) ===== */
  let weatherBusy = false;

  function fetchJSON(url, ms) {
    return new Promise(function (resolve, reject) {
      const ctrl = typeof AbortController === 'function' ? new AbortController() : null;
      const timer = setTimeout(function () {
        if (ctrl) ctrl.abort();
        reject(new Error('timeout'));
      }, ms);
      fetch(url, ctrl ? { signal: ctrl.signal } : {})
        .then(function (r) { if (!r.ok) throw new Error('http ' + r.status); return r.json(); })
        .then(function (d) { clearTimeout(timer); resolve(d); })
        .catch(function (e) { clearTimeout(timer); reject(e); });
    });
  }

  function readWeatherCache() {
    try {
      const c = JSON.parse(localStorage.getItem(WEATHER_KEY));
      const city = state.settings.city.trim().toLowerCase();
      return c && c.city === city && c.geo && c.current ? c : null;
    } catch (e) { return null; }
  }

  function writeWeatherCache(c) {
    try { localStorage.setItem(WEATHER_KEY, JSON.stringify(c)); } catch (e) { /* egal */ }
  }

  function timeLabel(ts) {
    const d = new Date(ts);
    return pad(d.getHours()) + ':' + pad(d.getMinutes());
  }

  function renderWeather(view) {
    const body = $('weatherBody');
    body.textContent = '';

    if (view.state === 'nocity') {
      body.appendChild(h('p', { class: 'empty', text: 'Lege deine Stadt fest, dann erscheint hier das aktuelle Wetter.' }));
      body.appendChild(h('button', { class: 'btn', type: 'button', text: 'Stadt festlegen', onclick: function () { openSettings('setCity'); } }));
      return;
    }
    if (view.state === 'loading') {
      body.appendChild(h('p', { class: 'empty', text: 'Wetter wird geladen …' }));
      return;
    }
    if (view.state === 'error' || view.state === 'notfound') {
      body.appendChild(h('p', { class: 'empty', text: view.state === 'notfound'
        ? 'Diese Stadt wurde nicht gefunden. Prüfe die Schreibweise in den Einstellungen.'
        : 'Das Wetter ist gerade nicht erreichbar. Der Rest des Dashboards funktioniert trotzdem.' }));
      body.appendChild(h('button', { class: 'btn', type: 'button', text: view.state === 'notfound' ? 'Stadt ändern' : 'Erneut versuchen',
        onclick: function () { if (view.state === 'notfound') openSettings('setCity'); else loadWeather(true); } }));
      return;
    }

    const c = view.cache;
    const cur = c.current;
    let desc = WEATHER_TEXT[cur.code] || 'Unbekannt';
    if (cur.isDay === 0 && (cur.code === 0 || cur.code === 1)) desc = cur.code === 0 ? 'Klare Nacht' : 'Überwiegend klare Nacht';

    body.appendChild(h('div', { class: 'w-main' }, [
      h('span', { class: 'w-temp', text: Math.round(cur.temp) + '°' }),
      h('span', { class: 'w-desc', text: desc })
    ]));
    body.appendChild(h('p', { class: 'w-place', text: c.geo.name }));
    body.appendChild(h('div', { class: 'w-details' }, [
      h('span', { text: 'Gefühlt ' + Math.round(cur.feels) + '°' }),
      h('span', { text: 'Wind ' + Math.round(cur.wind) + ' km/h' })
    ]));
    let note = 'Stand ' + timeLabel(c.ts) + ' Uhr';
    if (view.offline) note = 'Offline. Letzter Stand ' + timeLabel(c.ts) + ' Uhr';
    else if (view.refreshing) note += ', wird aktualisiert …';
    body.appendChild(h('p', { class: 'w-note', text: note }));
  }

  function loadWeather(force) {
    const city = state.settings.city.trim();
    if (!city) { renderWeather({ state: 'nocity' }); return; }

    const cache = readWeatherCache();
    const fresh = cache && Date.now() - cache.ts < WEATHER_MAX_AGE;
    if (fresh && !force) { renderWeather({ state: 'ok', cache: cache }); return; }
    if (cache) renderWeather({ state: 'ok', cache: cache, refreshing: true });
    else renderWeather({ state: 'loading' });
    if (weatherBusy) return;
    weatherBusy = true;

    const geoPromise = cache
      ? Promise.resolve(cache.geo)
      : fetchJSON('https://geocoding-api.open-meteo.com/v1/search?name=' + encodeURIComponent(city) + '&count=1&language=de&format=json', 8000)
          .then(function (data) {
            if (!data.results || !data.results.length) throw new Error('notfound');
            const r = data.results[0];
            return { name: r.name, lat: r.latitude, lon: r.longitude };
          });

    geoPromise.then(function (geo) {
      const url = 'https://api.open-meteo.com/v1/forecast?latitude=' + geo.lat + '&longitude=' + geo.lon +
        '&current=temperature_2m,apparent_temperature,weather_code,wind_speed_10m,is_day&timezone=auto';
      return fetchJSON(url, 8000).then(function (data) {
        const c = data.current;
        if (!c) throw new Error('nodata');
        const entry = {
          city: city.toLowerCase(), ts: Date.now(), geo: geo,
          current: { temp: c.temperature_2m, feels: c.apparent_temperature, code: c.weather_code, wind: c.wind_speed_10m, isDay: c.is_day }
        };
        writeWeatherCache(entry);
        renderWeather({ state: 'ok', cache: entry });
      });
    }).catch(function (e) {
      if (e && e.message === 'notfound') renderWeather({ state: 'notfound' });
      else if (cache) renderWeather({ state: 'ok', cache: cache, offline: true });
      else renderWeather({ state: 'error' });
    }).then(function () { weatherBusy = false; });
  }

  setInterval(function () { if (!document.hidden) loadWeather(false); }, WEATHER_MAX_AGE);

  /* ===== Aufgaben ===== */
  function renderTodos() {
    const list = $('todoList');
    list.textContent = '';
    // Offene Aufgaben zuerst, erledigte darunter
    const sorted = state.todos.filter(function (t) { return !t.done; }).concat(state.todos.filter(function (t) { return t.done; }));

    sorted.forEach(function (t) {
      list.appendChild(h('li', { class: 'todo' + (t.done ? ' done' : '') }, [
        h('label', { class: 'check' }, [
          h('input', { type: 'checkbox', checked: t.done, onchange: function (e) { t.done = e.target.checked; save(); renderTodos(); } }),
          h('span', { class: 'check-text', text: t.text })
        ]),
        h('button', { class: 'icon-btn small', type: 'button', 'aria-label': 'Aufgabe löschen: ' + t.text, text: '×',
          onclick: function () { state.todos = state.todos.filter(function (x) { return x.id !== t.id; }); save(); renderTodos(); } })
      ]));
    });

    const total = state.todos.length;
    const done = state.todos.filter(function (t) { return t.done; }).length;
    setText($('todoCount'), total ? done + ' von ' + total + ' erledigt' : 'Noch nichts zu tun. Schreib die erste Aufgabe oben hinein.');
    $('todoClear').hidden = done === 0;
  }

  $('todoForm').addEventListener('submit', function (e) {
    e.preventDefault();
    const input = $('todoInput');
    const text = input.value.trim();
    if (!text) return;
    state.todos.push({ id: uid(), text: text.slice(0, 200), done: false });
    input.value = '';
    save();
    renderTodos();
    input.focus();
  });

  $('todoClear').addEventListener('click', function () {
    state.todos = state.todos.filter(function (t) { return !t.done; });
    save();
    renderTodos();
  });

  /* ===== Link-Listen (Schnellzugriffe und Musiklinks) ===== */
  function renderLinkList(container, list, emptyText) {
    container.textContent = '';
    if (!list.length) {
      container.appendChild(h('p', { class: 'empty', text: emptyText }));
      return;
    }
    list.forEach(function (l) {
      container.appendChild(h('div', { class: 'tile-wrap' }, [
        h('a', { class: 'tile', href: l.url, target: '_blank', rel: 'noopener noreferrer' }, [
          h('span', { class: 'tile-title', text: l.title }),
          h('span', { class: 'tile-host', text: hostOf(l.url) })
        ]),
        h('button', { class: 'del edit-only', type: 'button', 'aria-label': 'Link entfernen: ' + l.title, text: '×',
          onclick: function () {
            const i = list.indexOf(l);
            if (i >= 0) list.splice(i, 1);
            save();
            renderLinks();
            renderMusic();
          } })
      ]));
    });
  }

  function renderLinks() {
    renderLinkList($('linkList'), state.links, 'Noch keine Links. Tippe auf Bearbeiten, um den ersten anzulegen.');
  }

  function addLinkFrom(titleId, urlId, list, after) {
    const title = $(titleId).value.trim();
    const url = safeUrl($(urlId).value);
    if (!title) return;
    if (!url) { toast('Diese Adresse ist ungültig. Beispiel: gmail.com'); return; }
    list.push({ id: uid(), title: title.slice(0, 40), url: url });
    $(titleId).value = '';
    $(urlId).value = '';
    save();
    after();
    $(titleId).focus();
  }

  $('linkForm').addEventListener('submit', function (e) {
    e.preventDefault();
    addLinkFrom('linkTitle', 'linkUrl', state.links, renderLinks);
  });

  $('musicLinkForm').addEventListener('submit', function (e) {
    e.preventDefault();
    addLinkFrom('mlTitle', 'mlUrl', state.music.links, renderMusic);
  });

  // Bearbeiten-Knöpfe: zeigen oder verstecken Formulare und Löschknöpfe
  Array.prototype.forEach.call(document.querySelectorAll('[data-edit-toggle]'), function (btn) {
    btn.addEventListener('click', function () {
      const key = btn.getAttribute('data-edit-toggle');
      editing[key] = !editing[key];
      btn.closest('.card').classList.toggle('editing', editing[key]);
      btn.setAttribute('aria-pressed', editing[key] ? 'true' : 'false');
      btn.textContent = editing[key] ? 'Fertig' : 'Bearbeiten';
    });
  });

  /* ===== Musik ===== */
  function fillSelect(select, options) {
    options.forEach(function (o) { select.appendChild(h('option', { value: o.value, text: o.label })); });
  }
  fillSelect($('pType'), PROJECT_TYPES.map(function (t) { return { value: t, label: t }; }));
  fillSelect($('pStatus'), Object.keys(STATUS).map(function (k) { return { value: k, label: STATUS[k] }; }));
  $('pStatus').value = 'wip';

  function formatDate(iso) {
    const d = new Date(iso + 'T00:00:00');
    return isNaN(d.getTime()) ? '' : d.toLocaleDateString('de-DE', { day: 'numeric', month: 'short', year: 'numeric' });
  }

  function renderMusic() {
    const list = $('projectList');
    list.textContent = '';
    if (!state.music.projects.length) {
      list.appendChild(h('li', { class: 'empty', text: 'Noch keine Projekte. Tippe auf Bearbeiten, um dein erstes anzulegen.' }));
    }

    state.music.projects.forEach(function (p) {
      const meta = p.type + (p.date ? ', ' + formatDate(p.date) : '');
      const select = h('select', { class: 'status s-' + p.status, 'aria-label': 'Stand von ' + p.title,
        onchange: function (e) {
          p.status = e.target.value;
          select.className = 'status s-' + p.status;
          save();
        } });
      fillSelect(select, Object.keys(STATUS).map(function (k) { return { value: k, label: STATUS[k] }; }));
      select.value = p.status;

      list.appendChild(h('li', { class: 'project' }, [
        h('div', { class: 'p-main' }, [
          h('div', { class: 'p-title', text: p.title }),
          h('div', { class: 'p-meta', text: meta })
        ]),
        select,
        p.url ? h('a', { class: 'p-link', href: p.url, target: '_blank', rel: 'noopener noreferrer', text: 'Öffnen' }) : null,
        h('button', { class: 'del edit-only', type: 'button', 'aria-label': 'Projekt entfernen: ' + p.title, text: '×',
          onclick: function () {
            state.music.projects = state.music.projects.filter(function (x) { return x.id !== p.id; });
            save();
            renderMusic();
          } })
      ]));
    });

    renderLinkList($('musicLinkList'), state.music.links, 'Noch keine Musiklinks. Tippe auf Bearbeiten, um einen anzulegen.');
  }

  $('projectForm').addEventListener('submit', function (e) {
    e.preventDefault();
    const title = $('pTitle').value.trim();
    if (!title) return;
    const rawUrl = $('pUrl').value.trim();
    const url = rawUrl ? safeUrl(rawUrl) : '';
    if (rawUrl && !url) { toast('Der Link ist ungültig. Lass das Feld leer oder gib eine Adresse an.'); return; }
    state.music.projects.unshift({
      id: uid(), title: title.slice(0, 80), type: $('pType').value, status: $('pStatus').value,
      date: $('pDate').value, url: url
    });
    $('pTitle').value = '';
    $('pDate').value = '';
    $('pUrl').value = '';
    save();
    renderMusic();
    $('pTitle').focus();
  });

  /* ===== Notizen ===== */
  let notesTimer = null;
  $('notesArea').addEventListener('input', function (e) {
    clearTimeout(notesTimer);
    notesTimer = setTimeout(function () {
      state.notes = e.target.value;
      save();
    }, 500);
  });
  window.addEventListener('pagehide', function () {
    const area = $('notesArea');
    if (area.value !== state.notes) { state.notes = area.value; save(); }
  });

  /* ===== Medikamente ===== */
  function medDueOn(m, ds) {
    if (m.mode === 'daily') return true;
    if (m.mode === 'interval') {
      const diff = dayNum(ds) - dayNum(m.start);
      return diff >= 0 && diff % m.interval === 0;
    }
    return m.days.indexOf(wdIndex(parseYmd(ds))) >= 0;
  }

  function medNextDue(m, fromStr) {
    for (let i = 1; i <= 400; i++) {
      const ds = ymd(addDays(parseYmd(fromStr), i));
      if (medDueOn(m, ds)) return ds;
    }
    return '';
  }

  function medSchedule(m) {
    if (m.mode === 'daily') return 'Jeden Tag';
    if (m.mode === 'interval') return m.interval === 2 ? 'Jeden 2. Tag' : 'Alle ' + m.interval + ' Tage';
    return m.days.slice().sort().map(function (i) { return WD_SHORT[i]; }).join(', ');
  }

  function toggleMedLog(m, ds) {
    const i = m.log.indexOf(ds);
    if (i >= 0) m.log.splice(i, 1);
    else { m.log.push(ds); m.log.sort(); }
    save();
    renderMeds();
  }

  function renderMeds() {
    const list = $('medList');
    list.textContent = '';
    if (!state.meds.length) {
      list.appendChild(h('li', { class: 'empty', text: 'Noch keine Medikamente. Tippe auf Bearbeiten, um eins einzutragen.' }));
      return;
    }
    const now = new Date();
    const today = ymd(now);
    const monthPrefix = today.slice(0, 7);

    state.meds.forEach(function (m) {
      const taken = m.log.indexOf(today) >= 0;
      const due = medDueOn(m, today);
      let stateText, stateClass = '';
      if (taken) { stateText = 'Heute genommen'; stateClass = ' ok'; }
      else if (due) { stateText = 'Heute fällig'; stateClass = ' due'; }
      else {
        const next = medNextDue(m, today);
        stateText = 'Heute nicht dran. Nächste Einnahme: ' + (next ? fmtShort(next) : 'nicht geplant');
      }

      // Nicht eingetragene Tage der letzten 3 Tage (nur Tage, seit das Medikament eingetragen ist)
      const missed = [];
      for (let i = 3; i >= 1; i--) {
        const ds = ymd(addDays(now, -i));
        if (ds >= m.added && medDueOn(m, ds) && m.log.indexOf(ds) < 0) missed.push(fmtDM(ds));
      }

      const strip = h('div', { class: 'strip', role: 'group', 'aria-label': 'Letzte 7 Tage, antippen zum Ändern' });
      for (let i = 6; i >= 0; i--) {
        const d = addDays(now, -i);
        const ds = ymd(d);
        const isTaken = m.log.indexOf(ds) >= 0;
        const isDue = medDueOn(m, ds) && ds >= m.added;
        const cls = (isTaken ? 'taken' : isDue ? 'due' : '') + (i === 0 ? ' today' : '');
        strip.appendChild(h('button', {
          type: 'button', class: cls.trim(),
          'aria-label': fmtShort(ds) + ': ' + (isTaken ? 'genommen' : isDue ? 'fällig, nicht eingetragen' : 'nicht fällig'),
          'aria-pressed': isTaken ? 'true' : 'false',
          onclick: function () { toggleMedLog(m, ds); }
        }, [h('span', { class: 'dot' }), h('span', { text: WD_SHORT[wdIndex(d)] })]));
      }

      const monthCount = m.log.filter(function (x) { return x.indexOf(monthPrefix) === 0; }).length;
      const last = m.log.length ? m.log[m.log.length - 1] : '';
      const countText = 'Insgesamt ' + m.log.length + ' mal genommen, diesen Monat ' + monthCount + ' mal.' + (last ? ' Zuletzt: ' + fmtShort(last) + '.' : '');

      list.appendChild(h('li', { class: 'med' }, [
        h('div', { class: 'med-top' }, [
          h('div', { class: 'med-info' }, [
            h('div', { class: 'med-name' }, [m.name, m.dose ? h('span', { class: 'med-dose', text: m.dose }) : null]),
            h('div', { class: 'med-sched', text: medSchedule(m) })
          ]),
          taken
            ? h('button', { class: 'ghost', type: 'button', text: 'Rückgängig', onclick: function () { toggleMedLog(m, today); } })
            : h('button', { class: 'btn', type: 'button', text: 'Genommen', onclick: function () { toggleMedLog(m, today); } }),
          h('button', { class: 'del edit-only', type: 'button', 'aria-label': 'Medikament entfernen: ' + m.name, text: '×',
            onclick: function () {
              if (!window.confirm(m.name + ' und alle eingetragenen Einnahmen löschen?')) return;
              state.meds = state.meds.filter(function (x) { return x.id !== m.id; });
              save();
              renderMeds();
            } })
        ]),
        h('div', { class: 'med-state' + stateClass, text: stateText }),
        missed.length ? h('div', { class: 'med-state late', text: 'Nicht eingetragen: ' + missed.join(', ') }) : null,
        strip,
        h('div', { class: 'med-count', text: countText })
      ]));
    });
  }

  // Wochentag-Auswahl im Formular
  (function buildMedDays() {
    const box = $('medDays');
    WD_SHORT.forEach(function (name, i) {
      box.appendChild(h('label', { class: 'chip' }, [h('input', { type: 'checkbox', value: String(i) }), h('span', { text: name })]));
    });
  })();

  $('medMode').addEventListener('change', function () {
    $('medIntervalBox').hidden = $('medMode').value !== 'interval';
    $('medDaysBox').hidden = $('medMode').value !== 'weekdays';
    if (!$('medStart').value) $('medStart').value = todayStr();
  });

  $('medForm').addEventListener('submit', function (e) {
    e.preventDefault();
    const name = $('medName').value.trim();
    if (!name) return;
    const mode = $('medMode').value;
    const today = todayStr();
    const interval = Math.min(60, Math.max(2, parseInt($('medInterval').value, 10) || 2));
    const days = Array.prototype.filter.call(document.querySelectorAll('#medDays input'), function (c) { return c.checked; })
      .map(function (c) { return parseInt(c.value, 10); });
    if (mode === 'weekdays' && !days.length) { toast('Wähle mindestens einen Wochentag.'); return; }
    state.meds.push({
      id: uid(), name: name.slice(0, 40), dose: $('medDose').value.trim().slice(0, 40),
      mode: mode, interval: interval, days: days,
      start: mode === 'interval' && isYmd($('medStart').value) ? $('medStart').value : today,
      added: today, log: []
    });
    $('medName').value = '';
    $('medDose').value = '';
    Array.prototype.forEach.call(document.querySelectorAll('#medDays input'), function (c) { c.checked = false; });
    save();
    renderMeds();
    $('medName').focus();
  });

  /* ===== Wochenaufgaben (setzen sich jede Woche von selbst zurück) ===== */
  function weekStart(d) { return ymd(addDays(d, -wdIndex(d))); }

  fillSelect($('weeklyDay'), [{ value: '-1', label: 'Irgendwann in der Woche' }].concat(
    WD_LONG.map(function (n, i) { return { value: String(i), label: n }; })));

  function renderWeekly() {
    const list = $('weeklyList');
    list.textContent = '';
    const now = new Date();
    const wk = weekStart(now);
    const todayIdx = wdIndex(now);
    function dayKey(t) { return t.day === -1 ? 7 : t.day; }
    const open = state.weekly.filter(function (t) { return t.done !== wk; }).sort(function (a, b) { return dayKey(a) - dayKey(b); });
    const finished = state.weekly.filter(function (t) { return t.done === wk; });

    open.concat(finished).forEach(function (t) {
      const done = t.done === wk;
      const late = !done && t.day >= 0 && t.day < todayIdx;
      list.appendChild(h('li', { class: 'todo' + (done ? ' done' : '') + (!done && t.day === todayIdx ? ' today' : '') }, [
        h('label', { class: 'check' }, [
          h('input', { type: 'checkbox', checked: done,
            onchange: function (e) {
              if (e.target.checked) { t.done = wk; t.count += 1; }
              else { t.done = ''; t.count = Math.max(0, t.count - 1); }
              save();
              renderWeekly();
            } }),
          h('span', { class: 'check-col' }, [
            h('span', { class: 'check-text', text: t.text }),
            t.count > 0 ? h('span', { class: 'meta', text: 'Schon ' + t.count + ' mal erledigt' }) : null
          ])
        ]),
        h('span', { class: 'badge' + (late ? ' late' : ''), text: t.day === -1 ? 'Diese Woche' : WD_SHORT[t.day] }),
        h('button', { class: 'icon-btn small', type: 'button', 'aria-label': 'Wochenaufgabe löschen: ' + t.text, text: '×',
          onclick: function () { state.weekly = state.weekly.filter(function (x) { return x.id !== t.id; }); save(); renderWeekly(); } })
      ]));
    });

    const total = state.weekly.length;
    setText($('weeklyCount'), total
      ? finished.length + ' von ' + total + ' diese Woche erledigt'
      : 'Noch keine Wochenaufgaben. Trage unten die erste ein.');
  }

  $('weeklyForm').addEventListener('submit', function (e) {
    e.preventDefault();
    const text = $('weeklyText').value.trim();
    if (!text) return;
    state.weekly.push({ id: uid(), text: text.slice(0, 120), day: parseInt($('weeklyDay').value, 10), done: '', count: 0 });
    $('weeklyText').value = '';
    save();
    renderWeekly();
    $('weeklyText').focus();
  });

  /* ===== Kalender ===== */
  const cal = { y: 0, m: 0, sel: '' };

  function calReset() {
    const n = new Date();
    cal.y = n.getFullYear();
    cal.m = n.getMonth();
    cal.sel = ymd(n);
  }

  function relLabel(ds) {
    const now = new Date();
    if (ds === ymd(now)) return 'Heute';
    if (ds === ymd(addDays(now, 1))) return 'Morgen';
    return fmtShort(ds);
  }

  function eventSort(a, b) {
    return a.time < b.time ? -1 : a.time > b.time ? 1 : 0; // nur nach Uhrzeit sortieren
  }

  // Wiederholungen: Ein Termin gilt ab seinem Startdatum an allen passenden Tagen.
  const REPEAT_TEXT = { weekly: 'wöchentlich', monthly: 'monatlich', yearly: 'jährlich' };

  function occursOn(ev, ds) {
    if (ds < ev.date) return false;
    if (!ev.repeat || ev.repeat === 'none') return ds === ev.date;
    if (ev.repeat === 'weekly') return (dayNum(ds) - dayNum(ev.date)) % 7 === 0;
    const d = parseYmd(ds);
    const startDay = +ev.date.slice(8, 10);
    if (ev.repeat === 'monthly') {
      // Gibt es den Tag im Monat nicht (zum Beispiel der 31.), gilt der letzte Tag des Monats
      const last = new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate();
      return d.getDate() === Math.min(startDay, last);
    }
    const startMonth = +ev.date.slice(5, 7);
    if (d.getMonth() + 1 !== startMonth) return false;
    const last = new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate(); // 29. Februar: sonst 28.
    return d.getDate() === Math.min(startDay, last);
  }

  // Die nächsten Termine mit Wiederholungen, bis zu einem Jahr voraus
  function nextOccurrences(limit) {
    const out = [];
    const start = new Date();
    for (let i = 0; i <= 366 && out.length < limit; i++) {
      const ds = ymd(addDays(start, i));
      state.events.filter(function (e) { return occursOn(e, ds); }).sort(eventSort).forEach(function (e) {
        if (out.length < limit) out.push({ ev: e, date: ds });
      });
    }
    return out;
  }

  function removeEvent(ev) {
    if (ev.repeat && ev.repeat !== 'none' && !window.confirm('"' + ev.title + '" wiederholt sich ' + REPEAT_TEXT[ev.repeat] + '. Alle Wiederholungen löschen?')) return;
    state.events = state.events.filter(function (x) { return x.id !== ev.id; });
    save();
    renderCalendar();
  }

  function renderCalendar() {
    const first = new Date(cal.y, cal.m, 1);
    setText($('calTitle'), first.toLocaleDateString('de-DE', { month: 'long', year: 'numeric' }));
    const grid = $('calGrid');
    grid.textContent = '';
    const lead = wdIndex(first);
    const count = new Date(cal.y, cal.m + 1, 0).getDate();
    const has = {};
    for (let d = 1; d <= count; d++) {
      const key = cal.y + '-' + pad(cal.m + 1) + '-' + pad(d);
      if (state.events.some(function (e) { return occursOn(e, key); })) has[key] = true;
    }
    const today = todayStr();

    for (let i = 0; i < lead; i++) grid.appendChild(h('span', { class: 'cal-blank' }));
    for (let d = 1; d <= count; d++) {
      const ds = cal.y + '-' + pad(cal.m + 1) + '-' + pad(d);
      grid.appendChild(h('button', {
        type: 'button',
        class: 'day' + (ds === today ? ' today' : '') + (ds === cal.sel ? ' sel' : '') + (has[ds] ? ' has' : ''),
        'aria-label': fmtLong(ds) + (has[ds] ? ', mit Terminen' : ''),
        'aria-pressed': ds === cal.sel ? 'true' : 'false',
        text: String(d),
        onclick: function () {
          cal.sel = ds;
          renderCalendar();
          const s = grid.querySelector('.sel');
          if (s) s.focus();
        }
      }));
    }

    setText($('calDayTitle'), fmtLong(cal.sel));
    const dayList = $('calDayList');
    dayList.textContent = '';
    const dayEvents = state.events.filter(function (e) { return occursOn(e, cal.sel); }).sort(eventSort);
    if (!dayEvents.length) dayList.appendChild(h('li', { class: 'empty', text: 'Keine Termine an diesem Tag.' }));
    dayEvents.forEach(function (ev) {
      dayList.appendChild(h('li', { class: 'event' }, [
        h('span', { class: 'ev-time', text: ev.time || 'Ganztägig' }),
        h('span', { class: 'ev-main' }, [ev.title, ev.repeat !== 'none' ? h('span', { class: 'ev-date', text: 'wiederholt sich ' + REPEAT_TEXT[ev.repeat] }) : null]),
        h('button', { class: 'icon-btn small', type: 'button', 'aria-label': 'Termin löschen: ' + ev.title, text: '×', onclick: function () { removeEvent(ev); } })
      ]));
    });

    const up = $('calUpcoming');
    up.textContent = '';
    const upcoming = nextOccurrences(6);
    if (!upcoming.length) up.appendChild(h('li', { class: 'empty', text: 'Keine anstehenden Termine.' }));
    upcoming.forEach(function (o) {
      const ev = o.ev;
      const rel = relLabel(o.date);
      up.appendChild(h('li', { class: 'event' + (rel === 'Heute' || rel === 'Morgen' ? ' soon' : '') }, [
        h('span', { class: 'ev-time', text: ev.time || 'Ganztägig' }),
        h('span', { class: 'ev-main' }, [ev.title, h('span', { class: 'ev-date', text: rel + (ev.repeat !== 'none' ? ', ' + REPEAT_TEXT[ev.repeat] : '') })]),
        h('button', { class: 'icon-btn small', type: 'button', 'aria-label': 'Termin löschen: ' + ev.title, text: '×', onclick: function () { removeEvent(ev); } })
      ]));
    });
  }

  function calShift(step) {
    const d = new Date(cal.y, cal.m + step, 1);
    cal.y = d.getFullYear();
    cal.m = d.getMonth();
    const now = new Date();
    cal.sel = (cal.y === now.getFullYear() && cal.m === now.getMonth()) ? ymd(now) : ymd(d);
    renderCalendar();
  }

  $('calPrev').addEventListener('click', function () { calShift(-1); });
  $('calNext').addEventListener('click', function () { calShift(1); });
  $('calToday').addEventListener('click', function () { calReset(); renderCalendar(); });

  $('eventForm').addEventListener('submit', function (e) {
    e.preventDefault();
    const title = $('eventTitle').value.trim();
    if (!title) return;
    const time = $('eventTime').value;
    state.events.push({ id: uid(), date: cal.sel, time: /^\d{2}:\d{2}$/.test(time) ? time : '', title: title.slice(0, 100), repeat: $('eventRepeat').value });
    $('eventRepeat').value = 'none';
    $('eventTitle').value = '';
    $('eventTime').value = '';
    save();
    renderCalendar();
    $('eventTitle').focus();
  });

  // Um Mitternacht: "heute" in Medikamenten, Wochenaufgaben und Kalender auffrischen
  function onNewDay() {
    calReset();
    renderMeds();
    renderWeekly();
    renderCalendar();
  }

  /* ===== Layout: Reihenfolge und Sichtbarkeit der Widgets ===== */
  function applyLayout() {
    const order = state.widgets.order;
    const hidden = state.widgets.hidden;
    WIDGETS.forEach(function (w) {
      const el = $('w-' + w.id);
      if (!el) return;
      el.style.order = String(order.indexOf(w.id));
      el.hidden = hidden.indexOf(w.id) >= 0;
    });
    Array.prototype.forEach.call(document.querySelectorAll('.nav [data-for]'), function (a) {
      a.hidden = hidden.indexOf(a.getAttribute('data-for')) >= 0;
    });
  }

  /* ===== Einstellungen ===== */
  const panel = $('settings');
  const overlay = $('overlay');
  let lastFocus = null;

  function fillSettingsForm() {
    const s = state.settings;
    $('setName').value = s.name;
    $('setCity').value = s.city;
    $('setMetube').value = s.metubeUrl;
    $('setLite').checked = s.lite;
    Array.prototype.forEach.call(document.querySelectorAll('input[name="theme"]'), function (r) { r.checked = r.value === s.theme; });
  }

  function openSettings(focusId) {
    lastFocus = document.activeElement;
    panel.classList.add('open');
    overlay.classList.add('open');
    setTimeout(function () { const f = $(focusId || 'setName'); if (f) f.focus(); }, 60);
  }

  function closeSettings() {
    panel.classList.remove('open');
    overlay.classList.remove('open');
    if (lastFocus && lastFocus.focus) lastFocus.focus();
  }

  function applySettings() {
    const s = state.settings;
    document.documentElement.setAttribute('data-theme', s.theme);
    document.documentElement.classList.toggle('lite', s.lite);
    $('metubeLink').href = s.metubeUrl;
    setText($('metubeUrlText'), s.metubeUrl);
    updateGreeting();
  }

  function onSettingsChange() {
    const s = state.settings;
    s.name = $('setName').value.trim().slice(0, 40);

    const newCity = $('setCity').value.trim().slice(0, 80);
    const cityChanged = newCity !== s.city;
    s.city = newCity;

    const m = $('setMetube').value.trim();
    if (!m) {
      s.metubeUrl = DEFAULT_METUBE;
    } else {
      const u = safeUrl(m);
      if (u) s.metubeUrl = u;
      else toast('Diese MeTube-Adresse ist ungültig. Beispiel: http://localhost:8081');
    }
    $('setMetube').value = s.metubeUrl;

    const picked = document.querySelector('input[name="theme"]:checked');
    if (picked && THEMES.indexOf(picked.value) >= 0) s.theme = picked.value;
    s.lite = $('setLite').checked;

    save();
    applySettings();
    if (cityChanged) loadWeather(true);
  }

  $('settingsForm').addEventListener('change', onSettingsChange);
  $('settingsForm').addEventListener('submit', function (e) { e.preventDefault(); onSettingsChange(); });

  function renderWidgetSettings() {
    const ul = $('widgetList');
    ul.textContent = '';
    state.widgets.order.forEach(function (id, i) {
      const meta = WIDGETS.filter(function (w) { return w.id === id; })[0];
      if (!meta) return;
      ul.appendChild(h('li', { class: 'wrow' }, [
        h('label', { class: 'check' }, [
          h('input', { type: 'checkbox', checked: state.widgets.hidden.indexOf(id) < 0,
            onchange: function (e) {
              const hidden = state.widgets.hidden.filter(function (x) { return x !== id; });
              if (!e.target.checked) hidden.push(id);
              state.widgets.hidden = hidden;
              save();
              applyLayout();
            } }),
          h('span', { class: 'check-text', text: meta.title })
        ]),
        h('span', { class: 'wmove' }, [
          h('button', { class: 'icon-btn small', type: 'button', 'aria-label': meta.title + ' nach oben', text: '↑', disabled: i === 0, onclick: function () { moveWidget(i, -1); } }),
          h('button', { class: 'icon-btn small', type: 'button', 'aria-label': meta.title + ' nach unten', text: '↓', disabled: i === state.widgets.order.length - 1, onclick: function () { moveWidget(i, 1); } })
        ])
      ]));
    });
  }

  function moveWidget(index, step) {
    const order = state.widgets.order;
    const target = index + step;
    if (target < 0 || target >= order.length) return;
    const tmp = order[index];
    order[index] = order[target];
    order[target] = tmp;
    save();
    applyLayout();
    renderWidgetSettings();
  }

  $('openSettings').addEventListener('click', function () { openSettings(); });
  $('closeSettings').addEventListener('click', closeSettings);
  overlay.addEventListener('click', closeSettings);
  $('metubeChange').addEventListener('click', function () { openSettings('setMetube'); });
  $('weatherRefresh').addEventListener('click', function () { loadWeather(true); });
  document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape' && panel.classList.contains('open')) closeSettings();
  });

  /* ===== Sicherung, Wiederherstellung, Zurücksetzen ===== */
  $('exportBtn').addEventListener('click', function () {
    const blob = new Blob([JSON.stringify(state, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = h('a', { href: url, download: 'levins-dashboard-sicherung.json' });
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(function () { URL.revokeObjectURL(url); }, 2000);
    toast('Sicherung wurde gespeichert.');
  });

  $('importBtn').addEventListener('click', function () { $('importFile').click(); });
  $('importFile').addEventListener('change', function (e) {
    const file = e.target.files && e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = function () {
      try {
        state = normalize(JSON.parse(String(reader.result)));
        save();
        renderAll();
        toast('Sicherung wurde geladen.');
      } catch (err) {
        toast('Diese Datei ist keine gültige Sicherung.');
      }
    };
    reader.readAsText(file);
    e.target.value = '';
  });

  $('resetBtn').addEventListener('click', function () {
    if (!window.confirm('Wirklich alles zurücksetzen? Aufgaben, Links, Projekte und Einstellungen gehen verloren.')) return;
    state = normalize(null);
    try { localStorage.removeItem(WEATHER_KEY); } catch (e) { /* egal */ }
    save();
    renderAll();
    toast('Alles wurde zurückgesetzt.');
  });

  /* ===== Start ===== */
  function renderAll() {
    applySettings();
    applyLayout();
    renderTodos();
    renderLinks();
    renderMusic();
    renderMeds();
    renderWeekly();
    renderCalendar();
    $('notesArea').value = state.notes;
    fillSettingsForm();
    renderWidgetSettings();
    loadWeather(false);
  }

  calReset();
  renderAll();
  tick();

  // Beim Start prüfen, ob der Browser Daten behalten darf, und um dauerhaften Speicher bitten
  if (!storageWorks()) showStorageProblem();
  else if (loadProblem) {
    const b = $('storageBanner');
    b.textContent = 'Deine gespeicherten Daten konnten nicht gelesen werden. Eine Kopie wurde aufbewahrt. Schreib das bitte Claude, dann lässt sich vermutlich alles retten.';
    b.hidden = false;
  }
  else if (navigator.storage && navigator.storage.persist) navigator.storage.persist().catch(function () { /* egal */ });

  // Installierbare Web-App (PWA): Service Worker nur über http/https, nicht beim Öffnen per Doppelklick
  if ('serviceWorker' in navigator && location.protocol.indexOf('http') === 0) {
    window.addEventListener('load', function () {
      navigator.serviceWorker.register('sw.js').catch(function () { /* ohne Offline-Funktion weiter */ });
    });
  }
})();
