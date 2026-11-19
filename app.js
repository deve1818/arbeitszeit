'use strict';

/* =========================================================
   Arbeitszeit – Web-App zur Zeiterfassung (offline, lokal)
   Arbeitszeiten eintragen und pro Woche / Monat zusammenrechnen.
   Alle Daten liegen nur im Speicher dieses Geräts (localStorage).
   ========================================================= */

// ---------- Konstanten & Helfer ----------
const KEY = 'arbeitszeit.v1';
const WD = ['So', 'Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa'];
const WD_LONG = ['Sonntag', 'Montag', 'Dienstag', 'Mittwoch', 'Donnerstag', 'Freitag', 'Samstag'];
const MONTHS = ['Januar', 'Februar', 'März', 'April', 'Mai', 'Juni', 'Juli', 'August', 'September', 'Oktober', 'November', 'Dezember'];

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

function isoWeek(d) {
  const t = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
  const day = t.getUTCDay() || 7;
  t.setUTCDate(t.getUTCDate() + 4 - day);
  const yearStart = new Date(Date.UTC(t.getUTCFullYear(), 0, 1));
  return Math.ceil(((t - yearStart) / 86400000 + 1) / 7);
}

// ---------- Datenhaltung ----------
function defaults() {
  return {
    version: 1,
    entries: [], // { id, start: ISO, end: ISO|null, pauseMin, breakStart: ISO|null, note }
    settings: { lastBackup: null },
  };
}

const validISO = (v) => typeof v === 'string' && !isNaN(Date.parse(v));

function normalize(s) {
  if (!s || typeof s !== 'object' || !Array.isArray(s.entries)) throw new Error('Keine gültigen Arbeitszeit-Daten');
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
    settings: { lastBackup: validISO(s.settings?.lastBackup) ? s.settings.lastBackup : null },
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

// Summe aller Einträge, deren Beginn im Zeitraum [from, to] (Tage, inklusive) liegt
function rangeTotal(map, from, to, now) {
  let sum = 0;
  let days = 0;
  for (let d = new Date(from); d <= to; d = addDays(d, 1)) {
    const list = map.get(keyOf(d));
    if (list && list.length) { sum += dayTotal(list, now); days++; }
  }
  return { sum, days };
}

// ---------- Aktionen ----------
function clockIn() {
  if (running()) return;
  state.entries.push({ id: uid(), start: new Date().toISOString(), end: null, pauseMin: 0, breakStart: null, note: '' });
  save(); renderToday(); toast('Eingestempelt');
}

function toggleBreak() {
  const e = running();
  if (!e) return;
  const now = new Date();
  if (e.breakStart) {
    e.pauseMin = Math.round(pauseOf(e, now));
    e.breakStart = null;
    toast('Pause beendet');
  } else {
    e.breakStart = now.toISOString();
    toast('Pause gestartet');
  }
  save(); renderToday();
}

function clockOut() {
  const e = running();
  if (!e) return;
  const now = new Date();
  e.pauseMin = Math.round(pauseOf(e, now));
  e.breakStart = null;
  e.end = now.toISOString();
  save(); renderToday();
  toast(`Ausgestempelt · ${fmtDur(workMin(e))} Std. gearbeitet`);
}

// ---------- Ansicht: Heute ----------
let renderedDay = null;

function todayVM(now = new Date()) {
  const map = byDay();
  const k = keyOf(now);
  const run = running();
  const ws = startOfWeek(now);
  const ms = new Date(now.getFullYear(), now.getMonth(), 1);
  const me = new Date(now.getFullYear(), now.getMonth() + 1, 0);
  return {
    now, k, map, run,
    onBreak: !!(run && run.breakStart),
    entries: map.get(k) || [],
    today: dayTotal(map.get(k), now),
    week: rangeTotal(map, ws, addDays(ws, 6), now).sum,
    month: rangeTotal(map, ms, me, now).sum,
  };
}

function renderToday() {
  const vm = todayVM();
  renderedDay = vm.k;
  const { run, onBreak, now } = vm;

  const actions = !run
    ? `<button class="btn primary" data-act="in">Einstempeln</button>`
    : `<button class="btn pause" data-act="break">${onBreak ? 'Pause beenden' : 'Pause'}</button>
       <button class="btn stop" data-act="out">Ausstempeln</button>`;

  const runOtherDay = run && keyOf(new Date(run.start)) !== vm.k;
  const needsBackup = state.entries.length >= 5 &&
    (!state.settings.lastBackup || (now - new Date(state.settings.lastBackup)) / 86400000 > 30);

  $('#view-today').innerHTML = `
    <h1>Heute</h1>
    <p class="subtitle">${WD_LONG[now.getDay()]}, ${now.getDate()}. ${MONTHS[now.getMonth()]}</p>

    <div class="clock-card">
      <div class="big-time num" id="big-time"></div>
      <div class="big-sub">Stunden heute</div>
      <div class="status" id="status"></div>
      <div class="actions">${actions}</div>
    </div>

    ${runOtherDay ? `<div class="banner"><p>Du bist seit ${WD[new Date(run.start).getDay()]}, ${hm(new Date(run.start))} eingestempelt. Vergessen auszustempeln? Tippe den Eintrag unten an, um ihn zu korrigieren.</p></div>` : ''}

    <div class="stats">
      <div class="stat"><div class="label">Diese Woche</div><div class="value num" id="st-week"></div><div class="note">KW ${isoWeek(now)}</div></div>
      <div class="stat"><div class="label">Dieser Monat</div><div class="value num" id="st-month"></div><div class="note">${MONTHS[now.getMonth()]}</div></div>
    </div>

    ${needsBackup ? `<div class="banner"><p>Deine Daten liegen nur auf diesem iPhone. Sichere sie ab und zu als Backup.</p><button class="btn small" data-act="backup">Backup</button></div>` : ''}

    <h3 class="section">Einträge heute</h3>
    <div class="group">${vm.entries.map((e) => entryItem(e, now)).join('') || '<div class="empty">Noch keine Einträge</div>'}</div>
    ${runOtherDay ? `<div class="group" style="margin-top:10px">${entryItem(run, now, true)}</div>` : ''}
    <div style="margin-top:10px"><button class="btn plain full" data-act="add-today">+ Eintrag nachtragen</button></div>
  `;
  fillToday(vm);
}

function fillToday(vm) {
  const { run, onBreak, now } = vm;
  const view = $('#view-today');
  if (!view.querySelector('#big-time')) return;

  const totalSec = Math.floor(vm.today * 60);
  const h = Math.floor(totalSec / 3600);
  const m = Math.floor((totalSec % 3600) / 60);
  const s = totalSec % 60;
  $('#big-time').innerHTML = run ? `${h}:${pad(m)}<small>:${pad(s)}</small>` : `${h}:${pad(m)}`;

  let status;
  if (!run) status = `<span class="dot"></span>Nicht eingestempelt`;
  else if (onBreak) status = `<span class="dot pause"></span>Pause seit ${hm(new Date(run.breakStart))}`;
  else status = `<span class="dot on"></span>Eingestempelt seit ${hm(new Date(run.start))}`;
  $('#status').innerHTML = status;

  $('#st-week').textContent = fmtDur(vm.week);
  $('#st-month').textContent = fmtDur(vm.month);

  if (run) {
    const el = view.querySelector(`[data-dur="${run.id}"]`);
    if (el) el.textContent = fmtDur(workMin(run, now));
  }
}

function entryItem(e, now = new Date(), showDay = false) {
  const s = new Date(e.start);
  const nextDay = e.end && keyOf(new Date(e.end)) !== keyOf(s) ? ' <span class="muted">(+1)</span>' : '';
  const pause = Math.round(pauseOf(e, now));
  const sub = [
    showDay ? `${WD[s.getDay()]}, ${fmtShort(s)}` : '',
    pause ? `Pause ${pause} Min.` : '',
    e.breakStart ? 'gerade in Pause' : '',
    e.note ? esc(e.note) : '',
  ].filter(Boolean).join(' · ');
  return `
    <button class="item" data-edit="${e.id}">
      <div class="main">
        <div class="title num">${hm(s)} – ${e.end ? hm(new Date(e.end)) + nextDay : '<span class="badge live">läuft</span>'}</div>
        ${sub ? `<div class="sub">${sub}</div>` : ''}
      </div>
      <div class="right num" data-dur="${e.id}">${fmtDur(workMin(e, now))}</div>
      <span class="chev">›</span>
    </button>`;
}

// ---------- Ansicht: Verlauf ----------
const hist = { mode: 'week', offset: 0 };

function histRange() {
  const now = new Date();
  if (hist.mode === 'week') {
    const s = addDays(startOfWeek(now), 7 * hist.offset);
    const e = addDays(s, 6);
    return { start: s, end: e, label: `KW ${isoWeek(s)}`, sub: `${fmtShort(s)} – ${fmtShort(e)}${e.getFullYear()}` };
  }
  const s = new Date(now.getFullYear(), now.getMonth() + hist.offset, 1);
  const e = new Date(s.getFullYear(), s.getMonth() + 1, 0);
  return { start: s, end: e, label: `${MONTHS[s.getMonth()]} ${s.getFullYear()}`, sub: `${fmtShort(s)} – ${fmtShort(e)}` };
}

function renderHistory() {
  const now = new Date();
  const today = keyOf(now);
  const map = byDay();
  const r = histRange();
  const { sum, days } = rangeTotal(map, r.start, r.end, now);
  const rows = [];

  for (let d = new Date(r.start); d <= r.end; d = addDays(d, 1)) {
    const k = keyOf(d);
    const list = map.get(k) || [];
    // Monatsansicht: nur Tage mit Einträgen, Wochenansicht: alle 7 Tage
    if (hist.mode === 'month' && !list.length) continue;
    const spans = list.map((e) => `${hm(new Date(e.start))}–${e.end ? hm(new Date(e.end)) : 'läuft'}`).join(', ');
    const total = dayTotal(list, now);
    rows.push(`
      <button class="item ${k > today ? 'dim' : ''} ${k === today ? 'today' : ''}" data-day="${k}">
        <div class="main">
          <div class="title">${WD[d.getDay()]} ${fmtShort(d)}</div>
          <div class="sub num">${spans || 'keine Einträge'}</div>
        </div>
        <div class="right num title">${list.length ? fmtDur(total) : '–'}</div>
        <span class="chev">›</span>
      </button>`);
  }

  $('#view-history').innerHTML = `
    <h1>Verlauf</h1>
    <p class="subtitle">Tippe einen Tag an, um ihn zu bearbeiten.</p>
    <div class="segmented" role="tablist">
      <button class="${hist.mode === 'week' ? 'on' : ''}" data-mode="week">Woche</button>
      <button class="${hist.mode === 'month' ? 'on' : ''}" data-mode="month">Monat</button>
    </div>
    <div class="pager">
      <button data-page="-1" aria-label="Zurück">‹</button>
      <div class="label"><b>${r.label}</b><span>${r.sub}</span></div>
      <button data-page="1" aria-label="Weiter">›</button>
    </div>
    <div class="summary">
      <div class="stat"><div class="label">Gesamt</div><div class="value num">${fmtDur(sum)} Std.</div><div class="note">= ${fmtDec(sum)} Std. dezimal</div></div>
      <div class="stat"><div class="label">Arbeitstage</div><div class="value num">${days}</div><div class="note">${days ? `Ø ${fmtDur(sum / days)} pro Tag` : '&nbsp;'}</div></div>
    </div>
    <div class="group">${rows.join('') || '<div class="empty">Keine Einträge in diesem Monat</div>'}</div>
    ${hist.mode === 'month' ? `<div style="margin-top:10px"><button class="btn plain full" data-act="add-any">+ Eintrag hinzufügen</button></div>` : ''}
    ${hist.offset !== 0 ? `<div style="margin-top:10px"><button class="btn plain full" data-page="0">Zurück zu heute</button></div>` : ''}
  `;
}

// ---------- Ansicht: Einstellungen ----------
function renderSettings() {
  const standalone = window.matchMedia('(display-mode: standalone)').matches || navigator.standalone;
  const lb = state.settings.lastBackup ? new Date(state.settings.lastBackup) : null;

  $('#view-settings').innerHTML = `
    <h1>Einstellungen</h1>
    <p class="subtitle">Export und Datensicherung</p>

    ${standalone ? '' : `
    <h3 class="section">Als App installieren</h3>
    <div class="group"><div class="item"><div class="main">
      <div class="title">Zum Home-Bildschirm hinzufügen</div>
      <div class="sub" style="white-space:normal">In Safari unten auf <b>Teilen</b> (Quadrat mit Pfeil) tippen, dann <b>„Zum Home-Bildschirm“</b>. Danach die App immer über das Icon öffnen.</div>
    </div></div></div>`}

    <h3 class="section">Daten</h3>
    <div class="stack">
      <button class="btn plain full" data-act="csv">Als CSV exportieren (Excel)</button>
      <button class="btn plain full" data-act="backup">Backup sichern</button>
      <button class="btn plain full" data-act="restore">Backup laden</button>
    </div>
    <p class="hint">${lb ? `Letztes Backup: ${fmtDate(lb)}.` : 'Noch kein Backup erstellt.'} Die Daten liegen nur auf diesem Gerät. Sichere das Backup z. B. in „Dateien“ → iCloud Drive.</p>

    <h3 class="section">Gefahrenzone</h3>
    <button class="btn danger-text full" data-act="wipe">Alle Daten löschen</button>

    <p class="about">${state.entries.length} Einträge gespeichert · Arbeitszeit 1.1</p>
  `;
}

// ---------- Dialog: Tag ----------
let openDayKey = null;

function openDay(k) {
  openDayKey = k;
  renderDay();
  const dlg = $('#day-dialog');
  if (!dlg.open) dlg.showModal();
}

function renderDay() {
  const k = openDayKey;
  if (!k) return;
  const d = fromKey(k);
  const now = new Date();
  const list = byDay().get(k) || [];
  $('#day-title').textContent = `${WD_LONG[d.getDay()]}, ${fmtDate(d)}`;
  $('#day-body').innerHTML = `
    <div class="group">${list.map((e) => entryItem(e, now)).join('') || '<div class="empty">Keine Einträge</div>'}</div>
    <button class="btn plain full" data-act="add-day" style="margin-bottom:14px">+ Eintrag hinzufügen</button>
    ${list.length ? `<div class="group"><div class="item"><div class="main"><b>Gesamt</b></div><div class="num"><b>${fmtDur(dayTotal(list, now))} Std.</b></div></div></div>` : ''}
  `;
}

// ---------- Dialog: Eintrag ----------
let editing = null; // Eintrag oder null (= neu)

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
    f.pause.value = Math.round(editing.pauseMin || 0);
    f.note.value = editing.note || '';
    $('#entry-title').textContent = 'Eintrag bearbeiten';
    $('#entry-delete').hidden = false;
    $('#entry-hint').textContent = editing.end ? '' :
      `Läuft gerade – Ende leer lassen, um weiter zu stempeln.${editing.breakStart ? ' Die laufende Pause wird automatisch dazugerechnet.' : ''}`;
  } else {
    f.date.value = dateKey || keyOf(new Date());
    f.start.value = '08:00';
    f.end.value = '16:30';
    f.pause.value = 30;
    $('#entry-title').textContent = 'Neuer Eintrag';
    $('#entry-delete').hidden = true;
    $('#entry-hint').textContent = 'Endet die Schicht nach Mitternacht, wird das Ende automatisch auf den Folgetag gelegt.';
  }
  $('#entry-dialog').showModal();
}

function saveEntry() {
  const f = $('#entry-form');
  const err = (msg) => { $('#entry-error').textContent = msg; };
  const isRunning = editing && !editing.end;
  const now = new Date();

  if (!f.date.value || !f.start.value) return err('Bitte Datum und Beginn angeben.');
  const start = new Date(`${f.date.value}T${f.start.value}`);
  if (isNaN(start)) return err('Ungültiges Datum oder Uhrzeit.');

  let end = null;
  if (f.end.value) {
    end = new Date(`${f.date.value}T${f.end.value}`);
    if (end <= start) end = addDays(end, 1); // über Mitternacht
  } else if (!isRunning) {
    return err('Bitte ein Ende angeben.');
  }
  if (!end && start > now) return err('Der Beginn liegt in der Zukunft.');

  const pause = Number(f.pause.value || 0);
  if (!Number.isFinite(pause) || pause < 0) return err('Ungültige Pause.');
  const liveBreak = isRunning && editing.breakStart ? Math.max(0, ((end && end < now ? end : now) - new Date(editing.breakStart)) / 60000) : 0;
  const span = ((end || now) - start) / 60000;
  if (end && pause + liveBreak >= span) return err('Die Pause ist länger als die Arbeitszeit.');

  // Überschneidung mit anderen Einträgen prüfen
  const sMs = start.getTime();
  const eMs = (end || now).getTime();
  const clash = state.entries.find((o) => {
    if (editing && o.id === editing.id) return false;
    const os = new Date(o.start).getTime();
    const oe = o.end ? new Date(o.end).getTime() : now.getTime();
    return sMs < oe && os < eMs;
  });
  if (clash) {
    const cs = new Date(clash.start);
    return err(`Überschneidet sich mit ${WD[cs.getDay()]} ${fmtShort(cs)} ${hm(cs)}–${clash.end ? hm(new Date(clash.end)) : 'läuft'}.`);
  }

  const data = {
    start: start.toISOString(),
    end: end ? end.toISOString() : null,
    pauseMin: Math.round(pause + (end ? liveBreak : 0)),
    breakStart: !end && isRunning ? editing.breakStart : null,
    note: f.note.value.trim(),
  };
  if (editing) Object.assign(editing, data);
  else state.entries.push({ id: uid(), ...data });

  save();
  $('#entry-dialog').close();
  toast('Gespeichert');
  refresh();
}

function deleteEntry() {
  if (!editing) return;
  if (!confirm('Diesen Eintrag wirklich löschen?')) return;
  state.entries = state.entries.filter((e) => e !== editing);
  save();
  $('#entry-dialog').close();
  toast('Eintrag gelöscht');
  refresh();
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
  if (!keys.length) return toast('Noch keine Daten zum Exportieren');
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
    refresh();
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
      refresh();
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
  toast('Alle Daten gelöscht');
  refresh();
}

// ---------- Navigation & Ereignisse ----------
let currentView = 'today';

function show(view) {
  currentView = view;
  document.querySelectorAll('.view').forEach((v) => v.classList.toggle('active', v.id === `view-${view}`));
  document.querySelectorAll('.tab').forEach((t) => t.classList.toggle('active', t.dataset.view === view));
  render();
  window.scrollTo(0, 0);
}

function render() {
  if (currentView === 'today') renderToday();
  else if (currentView === 'history') renderHistory();
  else renderSettings();
}

function refresh() {
  render();
  if ($('#day-dialog').open) renderDay();
}

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
  if (el.dataset.view) return show(el.dataset.view);
  if (el.dataset.edit) return openEntry(el.dataset.edit);
  if (el.dataset.day) return openDay(el.dataset.day);
  if (el.dataset.mode) { hist.mode = el.dataset.mode; hist.offset = 0; return renderHistory(); }
  if (el.dataset.page !== undefined) {
    const p = Number(el.dataset.page);
    hist.offset = p === 0 ? 0 : hist.offset + p;
    return renderHistory();
  }
  if (el.hasAttribute('data-close')) return el.closest('dialog').close();
  switch (el.dataset.act) {
    case 'in': return clockIn();
    case 'break': return toggleBreak();
    case 'out': return clockOut();
    case 'add-today': return openEntry(null, keyOf(new Date()));
    case 'add-day': return openEntry(null, openDayKey);
    case 'add-any': {
      // Im aktuell angezeigten Monat: heute, falls enthalten, sonst der 1.
      const r = histRange();
      const now = new Date();
      return openEntry(null, keyOf(now >= r.start && now <= addDays(r.end, 1) ? now : r.start));
    }
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
$('#day-dialog').addEventListener('close', () => { openDayKey = null; });

$('#entry-form').addEventListener('submit', (ev) => { ev.preventDefault(); saveEntry(); });
$('#entry-delete').addEventListener('click', deleteEntry);

$('#import-file').addEventListener('change', (ev) => {
  const file = ev.target.files[0];
  if (file) restore(file);
  ev.target.value = '';
});

// Live-Aktualisierung jede Sekunde (nur Zahlen, kein Neuaufbau)
setInterval(() => {
  if (document.hidden || currentView !== 'today') return;
  const now = new Date();
  if (keyOf(now) !== renderedDay) return renderToday();
  if (running()) fillToday(todayVM(now));
}, 1000);

document.addEventListener('visibilitychange', () => { if (!document.hidden) refresh(); });
window.addEventListener('storage', (ev) => { if (ev.key === KEY) { state = load(); refresh(); } });

// Start
if (navigator.storage && navigator.storage.persist) navigator.storage.persist().catch(() => {});
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => navigator.serviceWorker.register('sw.js').catch((e) => console.warn('SW', e)));
}
show('today');
