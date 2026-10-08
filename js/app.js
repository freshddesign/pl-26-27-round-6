(() => {
  'use strict';

  /* ------------------------------------------------------------------ *
   *  CONFIG
   * ------------------------------------------------------------------ */
  const CFG = {
    stadiaKey: '',
    tileUrl: 'https://tile.openstreetmap.org/{z}/{x}/{y}.png',
    dataUrl: 'data/premier-league.json',
    stadiumZoom: 16,
    tourDelayMs: 10500,
  };

  const TZ = 'Europe/London';
  const $ = (s, el = document) => el.querySelector(s);
  const $$ = (s, el = document) => [...el.querySelectorAll(s)];
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const dtf = (o, tz) => new Intl.DateTimeFormat('en-GB', { ...o, timeZone: tz });
  const TIME = { hour: '2-digit', minute: '2-digit', hourCycle: 'h23' };
  const ordinal = (n) => { const s = ['th', 'st', 'nd', 'rd'], v = n % 100; return n + (s[(v - 20) % 10] || s[v] || s[0]); };
  const mobile = () => matchMedia('(max-width:760px)').matches;

  let map, data, matches = [], byId = new Map(), markers = new Map();
  let table = new Map(), tableLabel = '', activeId = null, travelMode = 'driving';
  let tourTimer = null, tourIdx = 0, listScroll = 0;

  /* ------------------------------ helpers ----------------------------- */
  function textOn(hex) {
    const n = parseInt(hex.slice(1), 16), r = n >> 16, g = (n >> 8) & 255, b = n & 255;
    return (r * 299 + g * 587 + b * 114) / 1000 > 150 ? '#1b0b2b' : '#fff';
  }
  function badge(t, cls = '') {
    if (t.crest) return `<img class="badge ${cls}" src="${esc(t.crest)}" alt="" loading="lazy">`;
    return `<span class="badge ${cls}" style="--bg:${t.color};--fg:${textOn(t.color)}" aria-hidden="true">${esc(t.code)}</span>`;
  }
  const posText = (code) => (table.get(code) ? ordinal(table.get(code).pos) : '');
  function notice(msg) { const n = $('#notice'); n.textContent = msg; n.hidden = false; setTimeout(() => (n.hidden = true), 9000); }

  function rangeLabel() {
    const a = matches[0].date, b = matches[matches.length - 1].date;
    const d = (x) => dtf({ day: 'numeric' }, TZ).format(x), m = (x) => dtf({ month: 'long' }, TZ).format(x);
    return m(a) === m(b) ? `${d(a)}-${d(b)} ${m(a)} ${a.getFullYear()}` : `${d(a)} ${m(a)} - ${d(b)} ${m(b)}`;
  }

  /* -------------------------------- init ------------------------------ */
  async function init() {
    try {
      data = await (await fetch(CFG.dataUrl, { cache: 'no-cache' })).json();
    } catch { notice('Could not load the match data.'); return; }

    Object.entries(data.teams).forEach(([code, t]) => (t.code = code));
    setTable(data.table.map((r, i) => ({ ...r, pos: r.pos || i + 1 })), data.tableLabel);

    matches = data.matches.map((m) => {
      const date = new Date(m.kickoff);
      return {
        ...m, date, home: data.teams[m.home], away: data.teams[m.away],
        dayKey: dtf({ year: 'numeric', month: '2-digit', day: '2-digit' }, TZ).format(date),
        dayLabel: dtf({ weekday: 'long', day: 'numeric', month: 'long' }, TZ).format(date),
        time: dtf(TIME, TZ).format(date),
      };
    }).sort((a, b) => a.date - b.date);
    matches.forEach((m) => byId.set(m.id, m));

    $('#league-title').textContent = data.league.name;
    $('#league-sub').textContent = `${data.league.round}, ${rangeLabel()}`;
    document.title = `${data.league.name} ${data.league.round} map | sportmapz`;

    $$('#logo').forEach((img) => img.addEventListener('error', () => { img.style.visibility = 'hidden'; }, { once: true }));

    initMap();
    renderList();
    addMarkers();
    wire();
    zoomAll(false);
  }

  function setTable(rows, label) {
    table = new Map(rows.map((r) => [r.tla, r]));
    tableLabel = label;
  }

  /* -------------------------------- map ------------------------------- */
  function initMap() {
    map = L.map('map', {
      zoomControl: false, zoomSnap: 0.25, zoomDelta: 0.5, wheelPxPerZoomLevel: 220,
      minZoom: 5, maxZoom: 19, worldCopyJump: false,
    });
    L.control.zoom({ position: 'bottomright', zoomInTitle: 'Zoom in', zoomOutTitle: 'Zoom out' }).addTo(map);

    const attr = '&copy; <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">OpenStreetMap</a> contributors';
    L.tileLayer(CFG.tileUrl, { minZoom: 0, maxZoom: 19, attribution: attr }).addTo(map);

    map.on('click', () => { if (activeId) showList(); });
    map.on('zoomend', () => $('#map').classList.toggle('z-low', map.getZoom() < 8));
    new ResizeObserver(() => map.invalidateSize()).observe($('#map'));
  }

  function pinIcon(m) {
    const pos = (t) => (table.get(t.code) ? table.get(t.code).pos : '?');
    return L.divIcon({
      className: 'pin-wrap', iconSize: [130, 64], iconAnchor: [65, 22],
      html: `<div class="pin" data-id="${m.id}">
          <span class="pin-circle" title="Table positions: ${esc(m.home.name)} ${pos(m.home)}, ${esc(m.away.name)} ${pos(m.away)}">${pos(m.home)}-${pos(m.away)}</span>
          <span class="pin-label">${esc(m.home.code)}-${esc(m.away.code)}<span class="pin-t"> ${m.time}</span></span>
        </div>`,
    });
  }
  function refreshPins() { matches.forEach((m) => markers.get(m.id).setIcon(pinIcon(m))); markPins(activeId); }

  function addMarkers() {
    matches.forEach((m) => {
      const mk = L.marker([m.home.lat, m.home.lng], { icon: pinIcon(m), title: `${m.home.name} v ${m.away.name}`, riseOnHover: true }).addTo(map);
      mk.bindTooltip(`${esc(m.home.name)} v ${esc(m.away.name)}<br>${m.time} UK`, { direction: 'top', offset: [0, -26], className: 'tip' });
      mk.on('click', () => select(m.id));
      markers.set(m.id, mk);
    });
  }

  function fitTo(list, animate = true, maxZoom = 7.5) {
    const b = L.latLngBounds(list.map((m) => [m.home.lat, m.home.lng]));
    const pad = mobile() ? [50, 40] : [70, 70];
    const opts = { padding: pad, maxZoom: list.length > 1 ? maxZoom : CFG.stadiumZoom, duration: CFG.fitDuration };
    animate ? map.flyToBounds(b, opts) : map.fitBounds(b, opts);
  }
  function zoomAll(animate = true) { fitTo(matches, animate); markPins(null); setChip('all'); }
  function zoomLondon() { fitTo(matches.filter((m) => m.home.city === 'London'), true, 14); setChip('london'); }
  function setChip(k) { $$('.chip[data-zoom]').forEach((c) => c.classList.toggle('is-on', c.dataset.zoom === k)); }

  function markPins(activeIdNow) {
    markers.forEach((mk, id) => {
      const el = mk.getElement() && $('.pin', mk.getElement());
      if (!el) return;
      el.classList.toggle('is-active', id === activeIdNow);
      el.classList.toggle('is-dim', !!activeIdNow && id !== activeIdNow);
    });
    $$('.game').forEach((g) => g.classList.toggle('is-active', g.dataset.id === activeIdNow));
  }

  /* ------------------------------- views ------------------------------ */
  function renderList() {
    let last = '', html = '';
    matches.forEach((m) => {
      if (m.dayKey !== last) { last = m.dayKey; html += `<h2 class="day">${esc(m.dayLabel)}</h2>`; }
      html += `
        <button type="button" class="game" data-id="${m.id}" aria-label="${esc(m.home.name)} versus ${esc(m.away.name)}, ${m.time} UK time">
          <span class="g-time">${m.time}</span>
          <span class="g-teams">
            <span class="g-row">${badge(m.home)}<b>${esc(m.home.name)}</b><span class="g-pos" data-pos="${m.home.code}">${posText(m.home.code)}</span></span>
            <span class="g-row">${badge(m.away)}<b>${esc(m.away.name)}</b><span class="g-pos" data-pos="${m.away.code}">${posText(m.away.code)}</span></span>
          </span>
          <span class="g-venue">${esc(m.home.venue)}, ${esc(m.home.city)}</span>
        </button>`;
    });
    $('#list').innerHTML = html;
    $('#chip-london').hidden = matches.filter((m) => m.home.city === 'London').length < 2;
  }

  function showList() {
    activeId = null;
    $('#view-detail').hidden = true;
    $('#view-list').hidden = false;
    $('#view-list').scrollTop = listScroll;
    markPins(null);
    zoomAll(true);
    $('#league-title').focus({ preventScroll: true });
  }

  function select(id, fly = true) {
    const m = byId.get(id); if (!m) return;
    if (!activeId) listScroll = $('#view-list').scrollTop;
    activeId = id;
    renderDetail(m);
    $('#view-list').hidden = true;
    $('#view-detail').hidden = false;
    $('#view-detail').scrollTop = 0;
    markPins(id);
    setChip('');
    if (fly) map.flyTo([m.home.lat, m.home.lng], CFG.stadiumZoom, { duration: CFG.flyDuration });
  }

  function localTimeNote(m) {
    const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
    if (!tz || tz === TZ) return '';
    const lt = dtf(TIME, tz).format(m.date);
    const ld = dtf({ weekday: 'short', day: 'numeric', month: 'short' }, tz).format(m.date);
    const ud = dtf({ weekday: 'short', day: 'numeric', month: 'short' }, TZ).format(m.date);
    if (lt === m.time && ld === ud) return '';
    return `<small>${lt}${ld !== ud ? ', ' + ld : ''} in your time zone</small>`;
  }

  function routeUrl(m) {
    const dest = encodeURIComponent(`${m.home.venue}, ${m.home.city}, UK`);
    // No origin parameter: Google Maps starts from the visitor's current location.
    return `https://www.google.com/maps/dir/?api=1&destination=${dest}&travelmode=${travelMode}`;
  }

  function tableBlock(m) {
    const row = (t) => {
      const r = table.get(t.code); if (!r) return '';
      const form = (r.form || '').split(',').filter(Boolean).slice(-5);
      return `
        <div class="trow"><span class="pos">${r.pos}</span><span class="nm">${badge(t)}<span>${esc(t.name)}</span></span>
          <span class="num">${r.p}</span><span class="num">${r.gd > 0 ? '+' : ''}${r.gd}</span><span class="num pts">${r.pts}</span></div>
        ${form.length ? `<div class="form" aria-label="Recent form">${form.map((f) => `<i class="${f}">${f}</i>`).join('')}</div>` : ''}`;
    };
    return `
      <h3>League table</h3>
      <div class="trow head"><span>#</span><span>Team</span><span class="num">P</span><span class="num">GD</span><span class="num">Pts</span></div>
      ${row(m.home)}${row(m.away)}`;
  }

  function renderDetail(m) {
    const h = m.home, a = m.away;
    $('#detail-body').innerHTML = `
      <div class="d-head"><p>${esc(data.league.round)}</p></div>
      <div class="d-teams">
        <div class="d-team">${badge(h, 'lg')}<h2>${esc(h.name)}</h2><small data-pos-long="${h.code}">${table.get(h.code) ? ordinal(table.get(h.code).pos) + ' in the table' : ''}</small></div>
        <div class="d-vs" aria-hidden="true">v</div>
        <div class="d-team">${badge(a, 'lg')}<h2>${esc(a.name)}</h2><small data-pos-long="${a.code}">${table.get(a.code) ? ordinal(table.get(a.code).pos) + ' in the table' : ''}</small></div>
      </div>
      <dl class="facts">
        <div><dt>Kick-off</dt><dd>${esc(m.dayLabel)}, ${m.time} UK time${localTimeNote(m)}</dd></div>
        <div><dt>Stadium</dt><dd>${esc(h.venue)}</dd></div>
        <div><dt>City</dt><dd>${esc(h.city)}</dd></div>
      </dl>
      <div class="route">
        <a class="btn" id="routeBtn" href="${routeUrl(m)}" target="_blank" rel="noopener">
          <svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true"><path d="M12 2l8 19-8-4-8 4z" fill="currentColor"/></svg>
          Route from my location
        </a>
        <div class="modes" role="group" aria-label="Travel mode">
          <button type="button" class="mode" data-mode="driving" aria-pressed="${travelMode === 'driving'}">Car</button>
          <button type="button" class="mode" data-mode="transit" aria-pressed="${travelMode === 'transit'}">Public transport</button>
          <button type="button" class="mode" data-mode="walking" aria-pressed="${travelMode === 'walking'}">Walk</button>
        </div>
        <p>Opens Google Maps with your current location as the start.</p>
      </div>
      <section class="block" id="tbl">${tableBlock(m)}</section>
      ${(m.facts || []).length ? `<section class="block"><h3>Did you know?</h3><ul class="fact-list">${m.facts.map((f) => `<li>${esc(f)}</li>`).join('')}</ul></section>` : ''}`;
    $('#closeDetail').focus({ preventScroll: true });
  }

  /* ------------------------------- tour ------------------------------- */
  function stopTour() {
    if (!tourTimer) return;
    clearInterval(tourTimer); tourTimer = null;
    const b = $('#tourBtn'); b.textContent = 'Play tour'; b.classList.remove('is-playing');
  }
  function startTour() {
    tourIdx = 0;
    const b = $('#tourBtn'); b.textContent = 'Stop tour'; b.classList.add('is-playing');
    const step = () => {
      if (tourIdx >= matches.length) { stopTour(); showList(); return; }
      select(matches[tourIdx++].id);
    };
    step();
    tourTimer = setInterval(step, CFG.tourDelayMs);
  }

  /* ----------------------------- fullscreen --------------------------- */
  function toggleFullscreen() {
    const d = document, el = d.documentElement;
    const on = d.fullscreenElement || d.webkitFullscreenElement;
    const can = d.fullscreenEnabled || d.webkitFullscreenEnabled;
    if (on) return (d.exitFullscreen || d.webkitExitFullscreen).call(d);
    if (can) return (el.requestFullscreen || el.webkitRequestFullscreen).call(el);
    // iPhone Safari and iframes without allowfullscreen: open the map as its own page
    window.open(location.href, '_blank', 'noopener');
  }

  /* ------------------------------- events ----------------------------- */
  function wire() {
    $('#list').addEventListener('click', (e) => { const g = e.target.closest('.game'); if (g) select(g.dataset.id); });
    $('#closeDetail').addEventListener('click', showList);
    $('#btnFull').addEventListener('click', toggleFullscreen);
    $('#btnReset').addEventListener('click', () => (activeId ? showList() : zoomAll(true)));
    $('#tourBtn').addEventListener('click', () => (tourTimer ? stopTour() : startTour()));
    $$('.chip[data-zoom]').forEach((c) => c.addEventListener('click', () => {
      if (activeId) { activeId = null; $('#view-detail').hidden = true; $('#view-list').hidden = false; markPins(null); }
      c.dataset.zoom === 'london' ? zoomLondon() : zoomAll(true);
    }));
    $('#detail-body').addEventListener('click', (e) => {
      const b = e.target.closest('.mode'); if (!b) return;
      travelMode = b.dataset.mode;
      $$('.mode').forEach((x) => x.setAttribute('aria-pressed', String(x === b)));
      $('#routeBtn').href = routeUrl(byId.get(activeId));
    });
    document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && activeId) showList(); });
    // any manual interaction ends the auto tour
    document.addEventListener('pointerdown', (e) => { if (tourTimer && !e.target.closest('#tourBtn')) stopTour(); }, true);
    ['fullscreenchange', 'webkitfullscreenchange'].forEach((ev) => document.addEventListener(ev, () => setTimeout(() => map.invalidateSize(), 150)));
    // pins are created asynchronously by Leaflet, so apply the dim/active state after layout
    map.whenReady(() => setTimeout(() => markPins(activeId), 0));
    $('#map').classList.toggle('z-low', map.getZoom() < 8);
  }

  init();
})();
