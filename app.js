'use strict';

/* =========================================================
   Arbeitszeit – Web-App zur Zeiterfassung (offline, lokal)
   Ein Bildschirm: Stempeln, Woche/Monat mit Summe, Tagesliste.
   Alle Daten liegen nur im Speicher dieses Geräts (localStorage).
   ========================================================= */

// ---------- Konstanten & Helfer ----------
const KEY = 'arbeitszeit.v1';
const WD = ['So', 'Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa'];
const WD_LONG = ['Sonntag', 'Montag', 'Dienstag', 'Mittwoch', 'Donnerstag', 'Freitag', 'Samstag'];
const MONTHS = ['Januar', 'Februar', 'März', 'April', 'Mai', 'Juni', 'Juli', 'August', 'September', 'Oktober', 'November', 'Dezember'];
const MON_SHORT = ['Jan.', 'Feb.', 'März', 'Apr.', 'Mai', 'Juni', 'Juli', 'Aug.', 'Sep.', 'Okt.', 'Nov.', 'Dez.'];

const $ = (sel, root = document) => root.querySelector(sel);
const pad = (n) => String(n).padStart(2, '0');
const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
const keyOf = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const fromKey = (k) => { const [y, m, d] = k.split('-').map(Number); return new Date(y, m - 1, d); };
const addDays = (d, n) => { const x = new Date(d); x.setDate(x.getDate() + n); return x; };
const startOfWeek = (d) => { const x = new Date(d.getFullYear(), d.getMonth(), d.getDate()); return addDays(x, -((x.getDay() + 6) % 7)); };
const hm = (d) => `${pad(d.getHours())}:${pad(d.getMinutes())}`;
const fmtShort = (d) => `${pad(d.getDate())}.${pad(d.getMonth() + 1)}.`;
const fmtDate = (d) => `${pad(d.getDate())}.${pad(d.getMonth() + 1)}.${d.getFullYear()}`;
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

// Minuten -> "7:45"
function fmtDur(min) {
  const m = Math.round(Math.max(0, min));
  return `${Math.floor(m / 60)}:${pad(m % 60)}`;
}
// Minuten -> "7,75"
const fmtDec = (min) => (Math.round(Math.max(0, min)) / 60).toFixed(2).replace('.', ',');
// "7:45 h" als HTML mit kleiner Einheit
const durHTML = (min) => `${fmtDur(min)}<small> h</small>`;

function isoWeek(d) {
  const t = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
  const day = t.getUTCDay() || 7;
  t.setUTCDate(t.getUTCDate() + 4 - day);
  const yearStart = new Date(Date.UTC(t.getUTCFullYear(), 0, 1));
  return Math.ceil(((t - yearStart) / 86400000 + 1) / 7);
}

// Kurzer Zeitraum-Text, z. B. "16.–22. Nov." oder "30. Nov. – 6. Dez."
function rangeText(s, e) {
  if (s.getMonth() === e.getMonth()) return `${s.getDate()}.–${e.getDate()}. ${MON_SHORT[e.getMonth()]}`;
  return `${s.getDate()}. ${MON_SHORT[s.getMonth()]} – ${e.getDate()}. ${MON_SHORT[e.getMonth()]}`;
}

// ---------- Datenhaltung ----------
const DEFAULT_TIMES = { start: '08:00', end: '16:30', pause: 30 };

function defaults() {
  return {
    version: 1,
    entries: [], // { id, start: ISO, end: ISO|null, pauseMin, breakStart: ISO|null, note }
    settings: { lastBackup: null, lastTimes: { ...DEFAULT_TIMES } },
  };
}

const validISO = (v) => typeof v === 'string' && !isNaN(Date.parse(v));
const validHM = (v) => typeof v === 'string' && /^\d{2}:\d{2}$/.test(v);

function normalize(s) {
  if (!s || typeof s !== 'object' || !Array.isArray(s.entries)) throw new Error('Keine gültigen Arbeitszeit-Daten');
  const lt = s.settings?.lastTimes || {};
  return {
    version: 1,
    entries: s.entries.filter((e) => e && validISO(e.start)).map((e) => ({
      id: String(e.id || uid()),
      start: new Date(e.start).toISOString(),
      end: validISO(e.end) ? new Date(e.end).toISOString() : null,
      pauseMin: Math.max(0, Number(e.pauseMin) || 0),
      breakStart: !e.end && validISO(e.breakStart) ? new Date(e.breakStart).toISOString() : null,
      note: String(e.note || '').slice(0, 200),
    })),
    settings: {
      lastBackup: validISO(s.settings?.lastBackup) ? s.settings.lastBackup : null,
      lastTimes: {
        start: validHM(lt.start) ? lt.start : DEFAULT_TIMES.start,
        end: validHM(lt.end) ? lt.end : DEFAULT_TIMES.end,
        pause: Number.isFinite(lt.pause) && lt.pause >= 0 ? lt.pause : DEFAULT_TIMES.pause,
      },
    },
  };
}

function load() {
  let raw = null;
  try {
    raw = localStorage.getItem(KEY);
    if (raw) return normalize(JSON.parse(raw));
  } catch (err) {
    console.error(err);
    // Beschädigte Daten nicht überschreiben, sondern zur Sicherheit aufheben
    try { if (raw) localStorage.setItem(`${KEY}.defekt-${Date.now()}`, raw); } catch (_) { /* ignore */ }
  }
  return defaults();
}

let state = load();

function save() {
  try {
    localStorage.setItem(KEY, JSON.stringify(state));
  } catch (err) {
    console.error(err);
    toast('Speichern fehlgeschlagen! Bitte Backup erstellen.');
  }
}

// ---------- Berechnungen ----------
const running = () => state.entries.find((e) => !e.end) || null;

function pauseOf(e, now = new Date()) {
  let p = e.pauseMin || 0;
  if (e.breakStart && !e.end) p += Math.max(0, (now - new Date(e.breakStart)) / 60000);
  return p;
}

function workMin(e, now = new Date()) {
  const end = e.end ? new Date(e.end) : now;
  return Math.max(0, (end - new Date(e.start)) / 60000 - pauseOf(e, now));
}

// Einträge nach Tag (Tag des Beginns) gruppiert und sortiert
function byDay() {
  const map = new Map();
  for (const e of state.entries) {
    const k = keyOf(new Date(e.start));
    if (!map.has(k)) map.set(k, []);
    map.get(k).push(e);
  }
  for (const list of map.values()) list.sort((a, b) => a.start.localeCompare(b.start));
  return map;
}

const dayTotal = (list, now) => (list || []).reduce((s, e) => s + workMin(e, now), 0);

function rangeTotal(map, from, to, now) {
  let sum = 0;
  let days = 0;
  for (let d = new Date(from); d <= to; d = addDays(d, 1)) {
    const list = map.get(keyOf(d));
    if (list && list.length) { sum += dayTotal(list, now); days++; }
  }
  return { sum, days };
}

// ---------- Stempeln ----------
function clockIn() {
  if (running()) return;
  state.entries.push({ id: uid(), start: new Date().toISOString(), end: null, pauseMin: 0, breakStart: null, note: '' });
  save(); render(); toast('Eingestempelt');
}

function toggleBreak() {
  const e = running();
  if (!e) return;
  const now = new Date();
  if (e.breakStart) {
    e.pauseMin = Math.round(pauseOf(e, now));
    e.breakStart = null;
    toast('Weiter geht’s');
  } else {
    e.breakStart = now.toISOString();
    toast('Pause gestartet');
  }
  save(); render();
}

function clockOut() {
  const e = running();
  if (!e) return;
  const now = new Date();
  e.pauseMin = Math.round(pauseOf(e, now));
  e.breakStart = null;
  e.end = now.toISOString();
  save(); render();
  toast(`Feierabend · ${fmtDur(workMin(e))} h gearbeitet`);
}

// ---------- Hauptansicht ----------
const view = { mode: 'week', offset: 0 };
let renderedDay = null;

function periodRange(now = new Date()) {
  if (view.mode === 'week') {
    const s = addDays(startOfWeek(now), 7 * view.offset);
    const e = addDays(s, 6);
    const title = view.offset === 0 ? 'Diese Woche' : view.offset === -1 ? 'Letzte Woche' : `KW ${isoWeek(s)}`;
    return { start: s, end: e, title, sub: `${view.offset === 0 || view.offset === -1 ? `KW ${isoWeek(s)} · ` : ''}${rangeText(s, e)}` };
  }
  const s = new Date(now.getFullYear(), now.getMonth() + view.offset, 1);
  const e = new Date(s.getFullYear(), s.getMonth() + 1, 0);
  const sameYear = s.getFullYear() === now.getFullYear();
  return { start: s, end: e, title: `${MONTHS[s.getMonth()]}${sameYear ? '' : ` ${s.getFullYear()}`}`, sub: view.offset === 0 ? 'Dieser Monat' : `${s.getFullYear()}` };
}

function clockHTML(now, map) {
  const run = running();
  const today = dayTotal(map.get(keyOf(now)), now);
  let label;
  let actions;
  if (!run) {
    label = `<span class="dot"></span>Heute gearbeitet`;
    actions = `<button class="pill go" data-act="in">Einstempeln</button>`;
  } else {
    const rs = new Date(run.start);
    const since = keyOf(rs) === keyOf(now) ? hm(rs) : `${WD[rs.getDay()]}. ${hm(rs)}`;
    label = run.breakStart
      ? `<span class="dot pause"></span>Pause seit ${hm(new Date(run.breakStart))}`
      : `<span class="dot on"></span>Läuft seit ${since}`;
    actions = `
      <button class="pill pause" data-act="break">${run.breakStart ? 'Weiter' : 'Pause'}</button>
      <button class="pill stop" data-act="out">Stopp</button>`;
  }
  return `
    <section class="clock">
      <div class="clock-info">
        <div class="clock-label">${label}</div>
        <div class="clock-time num" id="clock-time">${clockTimeHTML(today, !!run)}</div>
      </div>
      <div class="clock-actions">${actions}</div>
    </section>`;
}

function clockTimeHTML(min, live) {
  if (!live) return durHTML(min);
  const sec = Math.floor(min * 60);
  return `${Math.floor(sec / 3600)}:${pad(Math.floor((sec % 3600) / 60))}<small>:${pad(sec % 60)}</small>`;
}

function entryHTML(e, now) {
  const s = new Date(e.start);
  const end = e.end ? new Date(e.end) : null;
  const nextDay = end && keyOf(end) !== keyOf(s) ? ' <small class="muted">(+1 Tag)</small>' : '';
  const pause = Math.round(pauseOf(e, now));
  const meta = [
    pause ? `Pause ${pause} Min.` : '',
    e.breakStart ? 'gerade in Pause' : '',
    e.note ? esc(e.note) : '',
  ].filter(Boolean).join(' · ');
  return `
    <button class="entry" data-edit="${e.id}">
      <span class="range num">${hm(s)} – ${end ? hm(end) + nextDay : 'jetzt<span class="live">läuft</span>'}</span>
      ${meta ? `<span class="meta">${meta}</span>` : ''}
    </button>`;
}

function dayHTML(k, list, now, todayKey) {
  const d = fromKey(k);
  const empty = !list || !list.length;
  const future = k > todayKey;
  return `
    <div class="day ${k === todayKey ? 'is-today' : ''} ${d.getDay() % 6 === 0 ? 'is-weekend' : ''}">
      <div class="day-date"><span class="dow">${WD[d.getDay()]}</span><span class="dom">${d.getDate()}</span></div>
      <div class="day-entries">
        ${empty
          ? `<button class="entry add ${future ? 'future' : ''}" data-add="${k}">+ Eintragen</button>`
          : list.map((e) => entryHTML(e, now)).join('')}
      </div>
      ${empty ? '' : `<div class="day-total num">${durHTML(dayTotal(list, now))}</div>`}
    </div>`;
}

function render() {
  const now = new Date();
  const todayKey = keyOf(now);
  renderedDay = todayKey;
  const map = byDay();
  const r = periodRange(now);
  const { sum, days } = rangeTotal(map, r.start, r.end, now);

  let list = '';
  if (view.mode === 'week') {
    // Alle 7 Tage zeigen (Mo–So), damit auch Wochenendarbeit direkt eintragbar ist
    let rows = '';
    for (let d = new Date(r.start); d <= r.end; d = addDays(d, 1)) {
      const k = keyOf(d);
      rows += dayHTML(k, map.get(k), now, todayKey);
    }
    list = `<div class="days">${rows}</div>`;
  } else {
    // Monat: nur Tage mit Einträgen, nach Wochen gruppiert mit Wochensumme
    let d = startOfWeek(r.start);
    while (d <= r.end) {
      const ws = d;
      const we = addDays(ws, 6);
      let rows = '';
      let wsum = 0;
      for (let x = new Date(ws); x <= we; x = addDays(x, 1)) {
        if (x < r.start || x > r.end) continue;
        const entries = map.get(keyOf(x));
        if (!entries) continue;
        wsum += dayTotal(entries, now);
        rows += dayHTML(keyOf(x), entries, now, todayKey);
      }
      if (rows) {
        const a = ws < r.start ? r.start : ws;
        const b = we > r.end ? r.end : we;
        list += `<div class="week-head"><span>KW ${isoWeek(ws)} · ${a.getDate()}.–${b.getDate()}.</span><b class="num">${fmtDur(wsum)} h</b></div><div class="days" style="margin-top:0">${rows}</div>`;
      }
      d = addDays(d, 7);
    }
    if (!list) list = `<div class="empty">Keine Einträge in diesem Monat.<br>Tippe auf <b>+</b>, um einen hinzuzufügen.</div>`;
  }

  const needsBackup = state.entries.length >= 10 &&
    (!state.settings.lastBackup || (now - new Date(state.settings.lastBackup)) / 86400000 > 30);

  $('#app').innerHTML = `
    ${clockHTML(now, map)}

    <div class="segmented" role="tablist">
      <button class="${view.mode === 'week' ? 'on' : ''}" data-mode="week">Woche</button>
      <button class="${view.mode === 'month' ? 'on' : ''}" data-mode="month">Monat</button>
    </div>

    <section class="total">
      <button class="nav" data-page="-1" aria-label="Zurück">‹</button>
      <div>
        <div class="total-period">${r.title}</div>
        <div class="total-range">${r.sub}</div>
        <div class="total-value num">${durHTML(sum)}</div>
        <div class="total-sub">${fmtDec(sum)} Std. · ${days} ${days === 1 ? 'Arbeitstag' : 'Arbeitstage'}</div>
      </div>
      <button class="nav" data-page="1" aria-label="Weiter">›</button>
    </section>
    ${view.offset !== 0 ? `<button class="today-link" data-page="0">Zurück zu heute</button>` : ''}

    ${needsBackup ? `<div class="banner"><p>Deine Daten liegen nur auf diesem iPhone. Sichere sie ab und zu.</p><button class="btn small" data-act="backup">Backup</button></div>` : ''}

    ${list}
  `;
}

// Jede Sekunde nur die Uhr aktualisieren, jede Minute alles (wenn eingestempelt)
let tick = 0;
setInterval(() => {
  if (document.hidden) return;
  const now = new Date();
  if (keyOf(now) !== renderedDay) return render();
  const run = running();
  if (!run) return;
  tick++;
  const anyDialog = document.querySelector('dialog[open]');
  if (tick % 60 === 0 && !anyDialog) return render();
  const el = $('#clock-time');
  if (el) el.innerHTML = clockTimeHTML(dayTotal(byDay().get(keyOf(now)), now), true);
}, 1000);

// ---------- Dialog: Eintrag ----------
let editing = null; // Eintrag oder null (= neu)
const PRESETS = [0, 15, 30, 45, 60];
let pauseSel = 30; // gewählte Pausen-Vorgabe (Chip) oder null, wenn "andere" eingetippt

function setPause(min) {
  const custom = $('#entry-form').pause;
  if (PRESETS.includes(min)) { pauseSel = min; custom.value = ''; }
  else { pauseSel = null; custom.value = min; }
}
function getPause() {
  const custom = $('#entry-form').pause.value;
  return custom !== '' ? Number(custom) : (pauseSel ?? 0);
}

function openEntry(id, dateKey) {
  editing = id ? state.entries.find((e) => e.id === id) : null;
  const f = $('#entry-form');
  f.reset();
  $('#entry-error').textContent = '';
  if (editing) {
    const s = new Date(editing.start);
    f.date.value = keyOf(s);
    f.start.value = hm(s);
    f.end.value = editing.end ? hm(new Date(editing.end)) : '';
    setPause(Math.round(editing.pauseMin || 0));
    f.note.value = editing.note || '';
    $('#entry-title').textContent = 'Bearbeiten';
    $('#entry-delete').hidden = false;
    $('#entry-hint').textContent = editing.end ? '' :
      `Läuft gerade. „Bis“ leer lassen, um weiter zu stempeln.${editing.breakStart ? ' Die laufende Pause wird automatisch dazugerechnet.' : ''}`;
  } else {
    const lt = state.settings.lastTimes;
    f.date.value = dateKey || keyOf(new Date());
    f.start.value = lt.start;
    f.end.value = lt.end;
    setPause(lt.pause);
    $('#entry-title').textContent = 'Eintragen';
    $('#entry-delete').hidden = true;
    $('#entry-hint').textContent = '';
  }
  updatePreview();
  $('#entry-dialog').showModal();
}

// Werte aus dem Formular lesen und prüfen (für Vorschau und Speichern)
function readForm() {
  const f = $('#entry-form');
  const isRunning = !!(editing && !editing.end);
  const now = new Date();
  if (!f.date.value || !f.start.value) return { error: 'Bitte Datum und Beginn angeben.' };
  const start = new Date(`${f.date.value}T${f.start.value}`);
  if (isNaN(start)) return { error: 'Ungültiges Datum oder Uhrzeit.' };
  let end = null;
  let overnight = false;
  if (f.end.value) {
    end = new Date(`${f.date.value}T${f.end.value}`);
    if (end <= start) { end = addDays(end, 1); overnight = true; }
  } else if (!isRunning) {
    return { error: 'Bitte angeben, bis wann gearbeitet wurde.' };
  }
  if (!end && start > now) return { error: 'Der Beginn liegt in der Zukunft.' };
  const pause = getPause();
  if (!Number.isFinite(pause) || pause < 0) return { error: 'Ungültige Pause.' };
  const liveBreak = isRunning && editing.breakStart
    ? Math.max(0, ((end && end < now ? end : now) - new Date(editing.breakStart)) / 60000) : 0;
  const span = ((end || now) - start) / 60000;
  if (end && pause + liveBreak >= span) return { error: 'Die Pause ist länger als die Arbeitszeit.' };
  return { start, end, pause, liveBreak, overnight, work: span - pause - liveBreak, note: f.note.value.trim(), isRunning };
}

function updatePreview() {
  const v = readForm();
  const res = $('#entry-result');
  const f = $('#entry-form');
  res.textContent = v.error ? '–' : `${fmtDur(v.work)} h${v.end ? '' : ' (läuft)'}`;
  if (!editing || editing.end) $('#entry-hint').textContent = v.overnight ? 'Endet nach Mitternacht – wird bis zum Folgetag gerechnet.' : '';
  const customSet = f.pause.value !== '';
  document.querySelectorAll('#pause-chips .chip[data-pause]').forEach((c) =>
    c.classList.toggle('on', !customSet && Number(c.dataset.pause) === pauseSel));
  f.pause.classList.toggle('on', customSet);
}

function saveEntry() {
  const err = (msg) => { $('#entry-error').textContent = msg; };
  const v = readForm();
  if (v.error) return err(v.error);
  const now = new Date();

  // Überschneidung mit anderen Einträgen prüfen
  const sMs = v.start.getTime();
  const eMs = (v.end || now).getTime();
  const clash = state.entries.find((o) => {
    if (editing && o.id === editing.id) return false;
    const os = new Date(o.start).getTime();
    const oe = o.end ? new Date(o.end).getTime() : now.getTime();
    return sMs < oe && os < eMs;
  });
  if (clash) {
    const cs = new Date(clash.start);
    return err(`Überschneidet sich mit ${WD[cs.getDay()]} ${fmtShort(cs)} ${hm(cs)}–${clash.end ? hm(new Date(clash.end)) : 'jetzt'}.`);
  }

  const data = {
    start: v.start.toISOString(),
    end: v.end ? v.end.toISOString() : null,
    pauseMin: Math.round(v.pause + (v.end ? v.liveBreak : 0)),
    breakStart: !v.end && v.isRunning ? editing.breakStart : null,
    note: v.note,
  };
  if (editing) Object.assign(editing, data);
  else state.entries.push({ id: uid(), ...data });

  // Zuletzt verwendete Zeiten als Vorschlag merken
  if (v.end) {
    const f = $('#entry-form');
    state.settings.lastTimes = { start: f.start.value, end: f.end.value, pause: Math.round(v.pause) };
  }

  save();
  $('#entry-dialog').close();
  toast('Gespeichert');
  // Ansicht auf den Zeitraum des Eintrags springen lassen, damit man ihn sieht
  jumpTo(v.start);
}

function jumpTo(date) {
  const now = new Date();
  if (view.mode === 'week') view.offset = Math.round((startOfWeek(date) - startOfWeek(now)) / (7 * 86400000));
  else view.offset = (date.getFullYear() - now.getFullYear()) * 12 + date.getMonth() - now.getMonth();
  render();
}

function deleteEntry() {
  if (!editing) return;
  if (!confirm('Diesen Eintrag wirklich löschen?')) return;
  state.entries = state.entries.filter((e) => e !== editing);
  save();
  $('#entry-dialog').close();
  toast('Eintrag gelöscht');
  render();
}

// ---------- Dialog: Einstellungen ----------
function openSettings() {
  const standalone = window.matchMedia('(display-mode: standalone)').matches || navigator.standalone;
  const lb = state.settings.lastBackup ? new Date(state.settings.lastBackup) : null;
  $('#settings-body').innerHTML = `
    ${standalone ? '' : `
      <div class="info">
        <b>Als App auf den Home-Bildschirm</b>
        <p>In Safari unten auf <b style="display:inline">Teilen</b> tippen, dann „Zum Home-Bildschirm“. Danach immer über das Icon öffnen.</p>
      </div>`}

    <div class="section-title">Export</div>
    <div class="stack">
      <button class="btn plain full" data-act="csv">Alle Zeiten als Excel-Datei (CSV)</button>
    </div>

    <div class="section-title">Datensicherung</div>
    <div class="stack">
      <button class="btn plain full" data-act="backup">Backup sichern</button>
      <button class="btn plain full" data-act="restore">Backup laden</button>
    </div>
    <p class="hint">${lb ? `Letztes Backup: ${fmtDate(lb)}.` : 'Noch kein Backup erstellt.'} Deine Daten liegen nur auf diesem Gerät – speichere das Backup z. B. in iCloud Drive.</p>

    <div class="section-title">Löschen</div>
    <button class="btn plain full" style="color:var(--red)" data-act="wipe">Alle Einträge löschen</button>

    <p class="about">${state.entries.length} Einträge · Arbeitszeit 2.1</p>
  `;
  const dlg = $('#settings-dialog');
  if (!dlg.open) dlg.showModal();
}

// ---------- Export / Backup ----------
async function shareOrDownload(name, content, type) {
  const blob = new Blob([content], { type });
  const file = new File([blob], name, { type });
  const touch = navigator.maxTouchPoints > 0;
  if (touch && navigator.canShare && navigator.canShare({ files: [file] })) {
    try {
      await navigator.share({ files: [file], title: name });
      return true;
    } catch (err) {
      if (err.name === 'AbortError') return false;
    }
  }
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
  return true;
}

function csvCell(v) {
  const s = String(v ?? '');
  return /[;"\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

async function exportCSV() {
  const map = byDay();
  const now = new Date();
  const keys = [...map.keys()].sort();
  if (!keys.length) return toast('Noch keine Einträge zum Exportieren');
  const rows = [['Datum', 'Wochentag', 'Beginn', 'Ende', 'Pause (Min.)', 'Arbeitszeit (h:mm)', 'Arbeitszeit (Std.)', 'Notiz']];
  for (const k of keys) {
    const d = fromKey(k);
    for (const e of map.get(k)) {
      const w = workMin(e, now);
      rows.push([
        fmtDate(d), WD_LONG[d.getDay()], hm(new Date(e.start)), e.end ? hm(new Date(e.end)) : 'läuft',
        Math.round(pauseOf(e, now)), fmtDur(w), fmtDec(w), e.note,
      ]);
    }
  }
  const csv = '﻿' + rows.map((r) => r.map(csvCell).join(';')).join('\r\n');
  await shareOrDownload(`arbeitszeit-${keyOf(now)}.csv`, csv, 'text/csv');
}

async function backup() {
  const now = new Date();
  const payload = JSON.stringify({ app: 'arbeitszeit', exportedAt: now.toISOString(), ...state }, null, 2);
  const ok = await shareOrDownload(`arbeitszeit-backup-${keyOf(now)}.json`, payload, 'application/json');
  if (ok) {
    state.settings.lastBackup = now.toISOString();
    save();
    toast('Backup erstellt');
    render();
    if ($('#settings-dialog').open) openSettings();
  }
}

function restore(file) {
  const reader = new FileReader();
  reader.onload = () => {
    try {
      const raw = JSON.parse(reader.result);
      const data = normalize(raw);
      const when = validISO(raw.exportedAt) ? ` vom ${fmtDate(new Date(raw.exportedAt))}` : '';
      if (!confirm(`Backup${when} mit ${data.entries.length} Einträgen laden?\n\nDie aktuellen Daten auf diesem Gerät werden dabei ersetzt.`)) return;
      state = data;
      save();
      toast('Backup geladen');
      render();
      if ($('#settings-dialog').open) openSettings();
    } catch (err) {
      console.error(err);
      alert('Die Datei konnte nicht gelesen werden. Ist es ein Arbeitszeit-Backup (.json)?');
    }
  };
  reader.readAsText(file);
}

function wipe() {
  if (!confirm('Wirklich ALLE Einträge löschen? Das kann nicht rückgängig gemacht werden.')) return;
  if (!confirm('Bist du sicher? Ohne Backup sind die Daten weg.')) return;
  state = defaults();
  save();
  toast('Alle Einträge gelöscht');
  render();
  if ($('#settings-dialog').open) openSettings();
}

// ---------- Ereignisse ----------
let toastTimer;
function toast(msg) {
  const t = $('#toast');
  t.textContent = msg;
  t.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove('show'), 2200);
}

document.addEventListener('click', (ev) => {
  const el = ev.target.closest('button');
  if (!el) return;
  if (el.dataset.edit) return openEntry(el.dataset.edit);
  if (el.dataset.add) return openEntry(null, el.dataset.add);
  if (el.dataset.mode) { view.mode = el.dataset.mode; view.offset = 0; return render(); }
  if (el.dataset.page !== undefined) {
    const p = Number(el.dataset.page);
    view.offset = p === 0 ? 0 : view.offset + p;
    return render();
  }
  if (el.dataset.pause !== undefined) {
    setPause(Number(el.dataset.pause));
    return updatePreview();
  }
  if (el.hasAttribute('data-close')) return el.closest('dialog').close();
  switch (el.dataset.act) {
    case 'in': return clockIn();
    case 'break': return toggleBreak();
    case 'out': return clockOut();
    case 'add': return openEntry(null, keyOf(new Date()));
    case 'settings': return openSettings();
    case 'csv': return exportCSV();
    case 'backup': return backup();
    case 'restore': return $('#import-file').click();
    case 'wipe': return wipe();
  }
});

// Klick auf den abgedunkelten Hintergrund schließt Dialoge
document.querySelectorAll('dialog').forEach((dlg) => {
  dlg.addEventListener('click', (ev) => { if (ev.target === dlg) dlg.close(); });
});

const form = $('#entry-form');
form.addEventListener('submit', (ev) => { ev.preventDefault(); saveEntry(); });
form.addEventListener('input', () => { $('#entry-error').textContent = ''; updatePreview(); });
$('#entry-delete').addEventListener('click', deleteEntry);

$('#import-file').addEventListener('change', (ev) => {
  const file = ev.target.files[0];
  if (file) restore(file);
  ev.target.value = '';
});

document.addEventListener('visibilitychange', () => { if (!document.hidden) render(); });
window.addEventListener('storage', (ev) => { if (ev.key === KEY) { state = load(); render(); } });

// Start
if (navigator.storage && navigator.storage.persist) navigator.storage.persist().catch(() => {});
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => navigator.serviceWorker.register('sw.js').catch((e) => console.warn('SW', e)));
}
render();
