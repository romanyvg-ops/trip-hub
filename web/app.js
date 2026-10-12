import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.45.4/+esm';
import { SUPABASE_URL, SUPABASE_ANON_KEY } from './config.js';
import { parseIcs, icsToItem } from './ics.js';
import { extractPdfText, parseBookingText, townFromAddress } from './pdfimport.js';

// ---------------------------------------------------------------------------
// Setup
// ---------------------------------------------------------------------------
// Add ?demo to the address to try the app with sample data and no backend.
const DEMO = new URLSearchParams(location.search).has('demo');
const configured = DEMO || (SUPABASE_URL && !SUPABASE_URL.includes('YOUR-PROJECT'));
const sb = DEMO
  ? (await import('./demo.js')).createDemoClient()
  : configured ? createClient(SUPABASE_URL, SUPABASE_ANON_KEY, { auth: { flowType: 'implicit' } }) : null;

const app = document.getElementById('app');

const KINDS = {
  flight: '✈️', train: '🚆', bus: '🚌', ferry: '⛴️', car: '🚗',
  stay: '🏠', activity: '🎟️', food: '🍽️', note: '📝', other: '📌',
};
const KIND_LABELS = {
  flight: 'Flight', train: 'Train', bus: 'Bus', ferry: 'Ferry', car: 'Car / transfer',
  stay: 'Accommodation', activity: 'Activity', food: 'Food & drink', note: 'Note', other: 'Other',
};
const LINK_CATS = { photos: '📷 Photo album', route: '🥾 Route', map: '🗺️ Map', doc: '📄 Document', other: '🔗 Link' };

let user = null;
let profile = null;
let realtime = null;

// ---------------------------------------------------------------------------
// Small helpers
// ---------------------------------------------------------------------------
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

// Times are stored as plain local timestamps ("2026-10-12T10:00:00"), no timezone.
const fmtDay = (iso) => new Date(iso.slice(0, 10) + 'T00:00:00').toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short' });
const fmtDayLong = (iso) => new Date(iso.slice(0, 10) + 'T00:00:00').toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'long' });
const fmtTime = (iso) => iso.slice(11, 16);
const fmtDateRange = (a, b) => {
  if (!a && !b) return '';
  if (a && b && a !== b) return `${fmtDay(a)} – ${fmtDay(b)}`;
  return fmtDay(a || b);
};
const toInputDT = (iso) => (iso ? iso.slice(0, 16) : '');
const fromInputDT = (v) => (v ? (v.length === 10 ? v + 'T00:00' : v) + ':00' : null);
const fileSize = (n) => (n > 1e6 ? (n / 1e6).toFixed(1) + ' MB' : Math.max(1, Math.round(n / 1e3)) + ' KB');

let toastTimer;
function toast(msg) {
  const t = $('#toast');
  t.textContent = msg;
  t.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove('show'), 2600);
}

async function copy(text) {
  try { await navigator.clipboard.writeText(text); toast('Copied'); }
  catch { prompt('Copy this:', text); }
}

function openDialog(html) {
  $$('dialog').forEach((d) => d.remove());
  const dlg = document.createElement('dialog');
  dlg.innerHTML = `<div class="dialog-body">${html}</div>`;
  document.body.appendChild(dlg);
  dlg.addEventListener('click', (e) => { if (e.target === dlg) dlg.close(); });
  dlg.addEventListener('close', () => dlg.remove());
  $$('[data-close]', dlg).forEach((b) => b.addEventListener('click', () => dlg.close()));
  dlg.showModal();
  return dlg;
}

function topbar({ back, title, subtitle }) {
  return `
    <header class="topbar">
      ${back ? `<a class="back" href="${back}" aria-label="Back">‹</a>` : ''}
      <div class="title">
        <h1>${esc(title)}</h1>
        ${subtitle ? `<p class="muted small">${esc(subtitle)}</p>` : ''}
      </div>
      ${user ? `<button class="btn ghost user" id="userMenu">${esc(profile?.display_name || 'You')} ▾</button>` : ''}
    </header>`;
}

function bindUserMenu() {
  $('#userMenu')?.addEventListener('click', () => {
    const dlg = openDialog(`
      <div class="dialog-head"><h2>Your account</h2><button class="btn ghost" data-close>✕</button></div>
      <form class="stack" id="profileForm">
        <label>Name shown to friends <input name="display_name" value="${esc(profile?.display_name || '')}" required></label>
        <p class="muted small">${esc(user.email)}</p>
        <div class="dialog-foot">
          <button type="button" class="btn danger" id="signOut">Sign out</button>
          <button class="btn primary">Save</button>
        </div>
      </form>`);
    $('#profileForm', dlg).addEventListener('submit', async (e) => {
      e.preventDefault();
      const display_name = e.target.display_name.value.trim();
      const { error } = await sb.from('profiles').update({ display_name }).eq('id', user.id);
      if (error) return toast(error.message);
      profile.display_name = display_name;
      dlg.close(); toast('Saved'); route();
    });
    $('#signOut', dlg).addEventListener('click', async () => { await sb.auth.signOut(); dlg.close(); location.hash = '#/'; });
  });
}

// ---------------------------------------------------------------------------
// Router
// ---------------------------------------------------------------------------
async function route() {
  if (!configured) return renderNotConfigured();
  realtime?.unsubscribe(); realtime = null;

  let hash = location.hash;
  if (!hash.startsWith('#/')) hash = '#/';
  const [page, arg] = hash.slice(2).split('/');

  if (page === 'join' && arg) {
    if (!user) { localStorage.setItem('pendingJoin', arg); return renderAuth('Sign in to join the trip.'); }
    return joinTrip(arg);
  }
  if (!user) return renderAuth();
  if (page === 'trip' && arg) return renderTrip(arg);
  return renderTrips();
}

window.addEventListener('hashchange', route);

function renderNotConfigured() {
  app.innerHTML = `
    <section class="auth">
      <div class="logo">🧳</div>
      <h1>Trip Hub</h1>
      <p class="muted" style="margin-top:12px">Almost there. Put your Supabase URL and anon key in <code>config.js</code>, then reload.<br>See the README for the setup steps.</p>
      <p style="margin-top:20px"><a class="btn" href="?demo#/">Try the demo with sample data</a></p>
    </section>`;
}

// ---------------------------------------------------------------------------
// Auth
// ---------------------------------------------------------------------------
function renderAuth(message = '') {
  app.innerHTML = `
    <section class="auth">
      <div class="logo">🧳</div>
      <h1>Trip Hub</h1>
      <p class="muted" style="margin-top:6px">Dates, tickets, stays and photos. One place for the whole group.</p>
      <form class="stack" id="loginForm">
        ${message ? `<div class="banner">${esc(message)}</div>` : ''}
        <label>Email <input type="email" name="email" placeholder="you@example.com" autocomplete="email" required></label>
        <button class="btn primary block">Send me a sign-in link</button>
        <p class="help" id="loginMsg">No password. We email you a link that signs you in.</p>
      </form>
    </section>`;
  $('#loginForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const btn = $('button', e.target); btn.disabled = true;
    const email = e.target.email.value.trim();
    const { error } = await sb.auth.signInWithOtp({
      email,
      options: { emailRedirectTo: location.origin + location.pathname },
    });
    $('#loginMsg').textContent = error ? error.message : `Check your inbox at ${email} and tap the link. You can close this tab.`;
    if (error) btn.disabled = false;
  });
}

async function loadProfile() {
  const { data } = await sb.from('profiles').select('*').eq('id', user.id).maybeSingle();
  profile = data || { id: user.id, display_name: user.email.split('@')[0] };
}

// ---------------------------------------------------------------------------
// Trips list
// ---------------------------------------------------------------------------
async function renderTrips() {
  app.innerHTML = topbar({ title: 'Your trips' }) + '<p class="loading">Loading…</p>';
  bindUserMenu();

  const { data: trips, error } = await sb.from('trips')
    .select('*, trip_members(count)')
    .order('start_date', { ascending: true, nullsFirst: false });
  if (error) { app.insertAdjacentHTML('beforeend', `<p class="error">${esc(error.message)}</p>`); return; }

  const list = trips.length
    ? trips.map((t) => `
        <a class="card trip-card" href="#/trip/${t.id}">
          <div class="emoji">${esc(t.emoji || '🧳')}</div>
          <div>
            <div class="name">${esc(t.name)}</div>
            <div class="muted small">${esc([t.destination, fmtDateRange(t.start_date, t.end_date)].filter(Boolean).join(' · '))}</div>
            <div class="muted small">${t.trip_members?.[0]?.count ?? 1} ${(t.trip_members?.[0]?.count ?? 1) === 1 ? 'person' : 'people'}</div>
          </div>
        </a>`).join('')
    : `<div class="empty">No trips yet.<br>Create one, or open an invite link from a friend.</div>`;

  app.innerHTML = topbar({ title: 'Your trips' }) + `
    <div class="stack" id="tripList">${list}</div>
    <div class="section">
      <div class="card">
        <h3>Have an invite code?</h3>
        <form class="row" id="joinForm" style="margin-top:8px">
          <input name="code" placeholder="e.g. 3f9a1c2b7d4e" style="flex:1" required>
          <button class="btn">Join</button>
        </form>
      </div>
    </div>
    <button class="fab" id="newTrip" aria-label="New trip">+</button>`;
  bindUserMenu();

  $('#joinForm').addEventListener('submit', (e) => { e.preventDefault(); joinTrip(e.target.code.value.trim()); });
  $('#newTrip').addEventListener('click', () => {
    const dlg = openDialog(`
      <div class="dialog-head"><h2>New trip</h2><button class="btn ghost" data-close>✕</button></div>
      <form class="stack" id="tripForm">
        <div class="two">
          <label>Emoji <input name="emoji" value="🧳" maxlength="4"></label>
          <label>Trip name <input name="name" placeholder="Madeira with the gang" required></label>
        </div>
        <label>Destination <input name="destination" placeholder="Madeira, Portugal"></label>
        <div class="two">
          <label>From <input type="date" name="start_date"></label>
          <label>To <input type="date" name="end_date"></label>
        </div>
        <div class="dialog-foot"><button class="btn primary">Create trip</button></div>
      </form>`);
    $('#tripForm', dlg).addEventListener('submit', async (e) => {
      e.preventDefault();
      const f = e.target;
      const { data, error } = await sb.from('trips').insert({
        name: f.name.value.trim(), destination: f.destination.value.trim() || null,
        emoji: f.emoji.value.trim() || '🧳',
        start_date: f.start_date.value || null, end_date: f.end_date.value || null,
      }).select().single();
      if (error) return toast(error.message);
      dlg.close();
      location.hash = `#/trip/${data.id}`;
    });
  });
}

async function joinTrip(code) {
  localStorage.removeItem('pendingJoin');
  const { data, error } = await sb.rpc('join_trip', { code });
  if (error) { toast(error.message.replace(/^.*?: /, '')); location.hash = '#/'; return; }
  toast('You joined the trip');
  location.hash = `#/trip/${data}`;
}

// ---------------------------------------------------------------------------
// Trip page
// ---------------------------------------------------------------------------
async function fetchTrip(id) {
  const [tripRes, itemsRes, linksRes, expRes] = await Promise.all([
    sb.from('trips').select('*, trip_members(role, user_id, profiles(display_name))').eq('id', id).maybeSingle(),
    sb.from('items').select('*, attachments(*), profiles(display_name)').eq('trip_id', id).order('starts_at', { ascending: true, nullsFirst: false }).order('created_at'),
    sb.from('links').select('*, profiles(display_name)').eq('trip_id', id).order('created_at'),
    sb.from('expenses').select('*').eq('trip_id', id).order('spent_on', { ascending: false }).order('created_at', { ascending: false }),
  ]);
  const err = tripRes.error || itemsRes.error || linksRes.error || expRes.error;
  if (err) throw err;
  if (!tripRes.data) throw new Error('Trip not found, or you are not a member of it.');
  const data = { trip: tripRes.data, items: itemsRes.data, links: linksRes.data, expenses: expRes.data };
  try { localStorage.setItem('trip:' + id, JSON.stringify(data)); } catch {}
  return data;
}

async function renderTrip(id) {
  let data, offline = false;
  try {
    data = await fetchTrip(id);
  } catch (e) {
    const cached = localStorage.getItem('trip:' + id);
    if (!cached) {
      app.innerHTML = topbar({ back: '#/', title: 'Trip' }) + `<p class="error">${esc(e.message)}</p>`;
      bindUserMenu(); return;
    }
    data = JSON.parse(cached); offline = true;
  }
  const { trip, items, links, expenses = [] } = data;
  const isOwner = trip.created_by === user.id;
  const tab = sessionStorage.getItem('tab:' + id) || 'itinerary';

  app.innerHTML = topbar({ back: '#/', title: trip.name, subtitle: [trip.destination, fmtDateRange(trip.start_date, trip.end_date)].filter(Boolean).join(' · ') }) + `
    ${offline ? '<div class="banner">Offline: showing the last saved version of this trip.</div>' : ''}
    <div class="members">${trip.trip_members.map((m) => `<span class="chip">${esc(m.profiles?.display_name || '?')}${m.role === 'owner' ? ' ★' : ''}</span>`).join('')}</div>
    <div class="actions">
      <button class="btn small" id="calBtn">📅 Add to calendar</button>
      <button class="btn small" id="inviteBtn">👋 Invite friends</button>
      ${photoLinks(links)[0] ? `<a class="btn small" href="${esc(photoLinks(links)[0].url)}" target="_blank" rel="noopener">📷 Photos</a>` : ''}
    </div>
    <nav class="tabs">
      ${['itinerary', 'stays', 'photos', 'expenses', 'links', 'settings'].map((t) => `<button data-tab="${t}" class="${t === tab ? 'active' : ''}">${{ itinerary: 'Itinerary', stays: 'Stays', photos: 'Photos', expenses: 'Expenses', links: 'Links & routes', settings: 'Settings' }[t]}</button>`).join('')}
    </nav>
    <section id="tabBody"></section>
    ${['itinerary', 'stays', 'expenses'].includes(tab) ? '<button class="fab" id="addItem" aria-label="Add">+</button>' : ''}`;
  bindUserMenu();

  $$('.tabs button').forEach((b) => b.addEventListener('click', () => { sessionStorage.setItem('tab:' + id, b.dataset.tab); renderTrip(id); }));
  $('#calBtn').addEventListener('click', () => calendarDialog(trip));
  $('#inviteBtn').addEventListener('click', () => inviteDialog(trip));
  $('#addItem')?.addEventListener('click', () => {
    if (tab === 'expenses') return expenseDialog(trip, null);
    itemDialog(trip, tab === 'stays' ? { kind: 'stay' } : null);
  });

  const body = $('#tabBody');
  if (tab === 'itinerary') renderItinerary(body, trip, items);
  if (tab === 'stays') renderStays(body, trip, items.filter((i) => i.kind === 'stay'));
  if (tab === 'photos') renderPhotos(body, trip, photoLinks(links));
  if (tab === 'expenses') renderExpenses(body, trip, expenses);
  if (tab === 'links') renderLinks(body, trip, links.filter((l) => !['photos', 'drive'].includes(l.category)));
  if (tab === 'settings') renderSettings(body, trip, isOwner);

  // Live refresh when a friend changes something.
  if (!offline) {
    realtime = sb.channel('trip-' + id)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'items', filter: `trip_id=eq.${id}` }, () => softRefresh(id))
      .on('postgres_changes', { event: '*', schema: 'public', table: 'links', filter: `trip_id=eq.${id}` }, () => softRefresh(id))
      .on('postgres_changes', { event: '*', schema: 'public', table: 'expenses', filter: `trip_id=eq.${id}` }, () => softRefresh(id))
      .subscribe();
  }
}

let refreshTimer;
function softRefresh(id) {
  clearTimeout(refreshTimer);
  refreshTimer = setTimeout(() => { if (!document.querySelector('dialog[open]') && location.hash === `#/trip/${id}`) renderTrip(id); }, 600);
}

// --- Itinerary -------------------------------------------------------------
function renderItinerary(root, trip, items) {
  if (!items.length) {
    root.innerHTML = `<div class="empty">Nothing planned yet.<br>Tap + to add a flight, a stay or anything else.</div>`;
    return;
  }
  // Each day lists: all-day items, then timed items in order, then check-ins (after the day's travel),
  // then a "sleeping at" line. Check-outs go first on their day, before the journey onwards.
  const groups = new Map();
  const add = (key, entry) => { if (!groups.has(key)) groups.set(key, []); groups.get(key).push(entry); };
  for (const it of items) {
    if (!it.starts_at) { add('unscheduled', { it, sort: '' }); continue; }
    const day = it.starts_at.slice(0, 10);
    if (it.kind !== 'stay') {
      // Timed items in time order. All-day transport (a transfer without a set time) goes after the
      // day's timed travel and before check-in; other all-day items lead the day.
      const transport = ['flight', 'train', 'bus', 'ferry', 'car'].includes(it.kind);
      add(day, { it, sort: it.all_day ? (transport ? '2' : '0') : '1' + it.starts_at.slice(11, 16) });
      continue;
    }
    add(day, { it, mode: 'checkin', sort: '3' });
    if (it.ends_at && it.ends_at.slice(0, 10) !== day) add(it.ends_at.slice(0, 10), { it, mode: 'checkout', sort: '0' });
  }
  for (const it of items.filter((i) => i.kind === 'stay' && i.starts_at && i.ends_at)) {
    const d = new Date(it.starts_at.slice(0, 10) + 'T00:00:00');
    for (d.setDate(d.getDate() + 1); ymd(d) < it.ends_at.slice(0, 10); d.setDate(d.getDate() + 1)) {
      if (groups.has(ymd(d))) add(ymd(d), { it, mode: 'night', sort: '4' });
    }
  }
  const days = [...groups.keys()].sort((a, b) => (a === 'unscheduled') - (b === 'unscheduled') || a.localeCompare(b));
  const stays = items.filter((i) => i.kind === 'stay' && i.starts_at).sort((a, b) => a.starts_at.localeCompare(b.starts_at));
  const nightStay = (day) => stays.find((s) => s.starts_at.slice(0, 10) <= day && (!s.ends_at || day < s.ends_at.slice(0, 10)));
  root.innerHTML = days.map((day) => {
    // Arrival day: date, then the flight, then the check-in card carries the place.
    // From the next day on, the heading says where you are.
    const stay = day !== 'unscheduled' ? nightStay(day) : null;
    const area = stay && stay.starts_at.slice(0, 10) !== day ? stayArea(stay) : null;
    return `
    <div class="day">
      <h2>${day === 'unscheduled' ? 'Not scheduled yet' : fmtDayLong(day)}${area ? ` <span class="area">📍 ${esc(area)}</span>` : ''}</h2>
      <div class="stack">${groups.get(day).sort((a, b) => a.sort.localeCompare(b.sort)).map((e) => itemCard(e.it, e.mode, trip)).join('')}</div>
    </div>`;
  }).join('');
  bindItemCards(root, trip, items);
}

// The town or area of a stay: its "Place" field, or the town picked out of its address.
const stayArea = (s) => (s ? (s.location || townFromAddress(s.address)) : null);

const pad2 = (n) => String(n).padStart(2, '0');
const ymd = (d) => `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
const nightsBetween = (a, b) => Math.round((new Date(b.slice(0, 10) + 'T00:00:00') - new Date(a.slice(0, 10) + 'T00:00:00')) / 86400000);

const mapsSearch = (q) => `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(q)}`;
const mapsDirections = (q) => `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(q)}`;
const mapLinks = (q) => `<a href="${mapsSearch(q)}" target="_blank" rel="noopener" data-stop>Map</a> · <a href="${mapsDirections(q)}" target="_blank" rel="noopener" data-stop>Directions</a>`;

// Escapes text and turns web links and phone numbers into tappable links.
function rich(s) {
  return esc(s)
    .replace(/(https?:\/\/[^\s<]+)/g, '<a href="$1" target="_blank" rel="noopener" data-stop>$1</a>')
    .replace(/(^|[\s:])(\+\d[\d\s().-]{6,}\d|0\d{1,3}[\s-]?\d[\d\s-]{5,}\d)/g, (m, pre, num) => `${pre}<a href="tel:${num.replace(/[^\d+]/g, '')}" data-stop>${num}</a>`);
}

function itemCard(it, mode, trip) {
  const isStay = it.kind === 'stay';
  let icon = KINDS[it.kind] || '📌', time = '', title = it.title;
  const area = isStay ? stayArea(it) : null;
  const inArea = area && !it.title.toLowerCase().includes(area.toLowerCase()) ? `, ${area}` : '';
  if (mode === 'checkin') { time = it.all_day ? 'check-in' : `from ${fmtTime(it.starts_at)}`; title = `Check in: ${it.title}${inArea}`; }
  else if (mode === 'checkout') { icon = '🧳'; time = it.all_day ? 'check-out' : `by ${fmtTime(it.ends_at)}`; title = `Check out: ${it.title}${inArea}`; }
  else if (mode === 'night') { icon = '🛏️'; time = 'night'; title = `Sleeping at ${it.title}${inArea}`; }
  else if (it.starts_at && !it.all_day) time = fmtTime(it.starts_at);
  else if (it.all_day) time = 'all day';

  if (mode === 'night' || mode === 'checkout') {
    return `
    <div class="card item compact" data-item="${it.id}">
      <div class="time"><span class="icon">${icon}</span>${time}</div>
      <div><div class="title">${esc(title)}</div>${mode === 'checkout' && it.address ? `<div class="meta">${mapLinks(it.address)}</div>` : ''}</div>
      <div class="muted">›</div>
    </div>`;
  }

  const meta = [];
  if (mode === 'checkin' && it.ends_at) meta.push(esc(`${nightsBetween(it.starts_at, it.ends_at)} nights, until ${fmtDay(it.ends_at)}`));
  else if (it.ends_at && !it.all_day && it.starts_at && it.ends_at.slice(0, 10) === it.starts_at.slice(0, 10)) meta.push(esc(`→ ${fmtTime(it.ends_at)}`));
  else if (it.ends_at && it.starts_at && it.ends_at.slice(0, 10) !== it.starts_at.slice(0, 10)) meta.push(esc(`→ ${fmtDay(it.ends_at)} ${it.all_day ? '' : fmtTime(it.ends_at)}`));
  if (it.location) meta.push(`<a href="${mapsSearch(it.location + (trip?.destination ? ', ' + trip.destination : ''))}" target="_blank" rel="noopener" data-stop>${esc(it.location)}</a>`);
  if (it.booking_ref) meta.push(esc(`ref ${it.booking_ref}`));
  const files = (it.attachments || []).map((a) => `<a href="#" data-file="${esc(a.path)}">📎 ${esc(a.filename)}</a>`).join('');
  return `
    <div class="card item" data-item="${it.id}">
      <div class="time"><span class="icon">${icon}</span>${time}</div>
      <div>
        <div class="title">${esc(title)}</div>
        ${meta.length ? `<div class="meta">${meta.join(' · ')}</div>` : ''}
        ${it.address ? `<div class="meta">📍 ${esc(it.address)}<br>${mapLinks(it.address)}</div>` : ''}
        ${it.notes ? `<div class="notes">${rich(it.notes)}</div>` : ''}
        ${files ? `<div class="files">${files}</div>` : ''}
        <div class="by">added by ${esc(it.profiles?.display_name || 'someone')}</div>
      </div>
      <div class="muted">›</div>
    </div>`;
}

function bindItemCards(root, trip, items) {
  $$('[data-item]', root).forEach((card) => card.addEventListener('click', (e) => {
    if (e.target.closest('[data-stop]')) return;
    const fileLink = e.target.closest('[data-file]');
    if (fileLink) { e.preventDefault(); openFile(fileLink.dataset.file); return; }
    itemDialog(trip, items.find((i) => i.id === card.dataset.item));
  }));
}

async function openFile(path) {
  const w = window.open('', '_blank'); // open synchronously so mobile browsers allow it
  const { data, error } = await sb.storage.from('attachments').createSignedUrl(path, 300);
  if (error) { w?.close(); return toast(error.message); }
  if (w) w.location = data.signedUrl; else location.href = data.signedUrl;
}

// --- Stays -------------------------------------------------------------------
function renderStays(root, trip, stays) {
  if (!stays.length) {
    root.innerHTML = `<div class="empty">No accommodation added yet.<br>Tap + to add where you're staying.</div>`;
    return;
  }
  root.innerHTML = `<div class="stack">${stays.map((s) => `
    <div class="card stay" data-item="${s.id}">
      <div class="row spread">
        <h3>🏠 ${esc(s.title)}</h3>
        <span class="muted small">${s.starts_at ? fmtDateRange(s.starts_at, s.ends_at) : ''}</span>
      </div>
      ${s.address ? `<div class="addr">📍 ${esc(s.address)}<br>${mapLinks(s.address)}</div>` : ''}
      <dl class="kv">
        ${s.starts_at && !s.all_day ? `<dt>Check-in</dt><dd>${fmtTime(s.starts_at)}</dd>` : ''}
        ${s.ends_at && !s.all_day ? `<dt>Check-out</dt><dd>${fmtTime(s.ends_at)}</dd>` : ''}
        ${s.booking_ref ? `<dt>Booking ref</dt><dd>${esc(s.booking_ref)}</dd>` : ''}
        ${s.url ? `<dt>Link</dt><dd><a href="${esc(s.url)}" target="_blank" rel="noopener" data-stop>${esc(s.url.replace(/^https?:\/\//, '').slice(0, 40))}</a></dd>` : ''}
        ${s.notes ? `<dt>Notes</dt><dd class="notes">${rich(s.notes)}</dd>` : ''}
      </dl>
      ${(s.attachments || []).length ? `<div class="files" style="margin-top:8px">${s.attachments.map((a) => `<a href="#" data-file="${esc(a.path)}">📎 ${esc(a.filename)}</a> `).join('')}</div>` : ''}
    </div>`).join('')}</div>`;
  $$('[data-item]', root).forEach((card) => card.addEventListener('click', (e) => {
    if (e.target.closest('[data-stop]')) return;
    const fileLink = e.target.closest('[data-file]');
    if (fileLink) { e.preventDefault(); openFile(fileLink.dataset.file); return; }
    itemDialog(trip, stays.find((i) => i.id === card.dataset.item));
  }));
}

// --- Item add / edit dialog ---------------------------------------------------
function itemDialog(trip, item) {
  const editing = !!item?.id;
  const it = item || {};
  const kind = it.kind || 'activity';
  const dlg = openDialog(`
    <div class="dialog-head"><h2>${editing ? 'Edit' : 'Add to trip'}</h2><button class="btn ghost" data-close>✕</button></div>
    ${editing ? '' : `
    <div class="import-row">
      <div class="row">
        <label class="btn small">📄 Import a Booking.com PDF<input type="file" accept=".pdf,application/pdf" hidden id="pdfFile"></label>
        <label class="btn small">📥 Import a calendar file (.ics)<input type="file" accept=".ics,text/calendar" hidden id="icsFile"></label>
      </div>
      <p class="help">Booking.com: the confirmation PDF from the app or email. Airbnb: Trips → reservation → “Add to calendar” gives an .ics file. Airline and train tickets usually have one too. The details are filled in for you to check.</p>
    </div>`}
    <form class="stack" id="itemForm">
      <div class="two">
        <label>Type
          <select name="kind">${Object.keys(KINDS).map((k) => `<option value="${k}" ${k === kind ? 'selected' : ''}>${KINDS[k]} ${KIND_LABELS[k]}</option>`).join('')}</select>
        </label>
        <label>Title <input name="title" value="${esc(it.title || '')}" placeholder="e.g. KLM to Funchal" required></label>
      </div>
      <label class="inline"><input type="checkbox" name="all_day" ${it.all_day ? 'checked' : ''}> All day (no specific time)</label>
      <div class="two">
        <label><span data-start-label>Start</span> <input type="${it.all_day ? 'date' : 'datetime-local'}" name="starts_at" value="${it.all_day ? (it.starts_at || '').slice(0, 10) : esc(toInputDT(it.starts_at))}"></label>
        <label><span data-end-label>End</span> <input type="${it.all_day ? 'date' : 'datetime-local'}" name="ends_at" value="${it.all_day ? (it.ends_at || '').slice(0, 10) : esc(toInputDT(it.ends_at))}"></label>
      </div>
      <p class="help">Times are local to where you are at that moment (departure in departure time, arrival in arrival time).</p>
      <label>Place <input name="location" value="${esc(it.location || '')}" placeholder="Airport, hotel name, restaurant…"></label>
      <label>Address <input name="address" value="${esc(it.address || '')}" placeholder="Street, city"></label>
      <div class="two">
        <label>Booking reference <input name="booking_ref" value="${esc(it.booking_ref || '')}"></label>
        <label>Link <input type="url" name="url" value="${esc(it.url || '')}" placeholder="https://"></label>
      </div>
      <label>Notes <textarea name="notes" placeholder="Door code, meeting point, who booked it…">${esc(it.notes || '')}</textarea></label>
      ${editing ? '' : `
      <fieldset class="split cost">
        <legend class="muted small">Cost · goes straight into Expenses (leave empty if nothing was paid)</legend>
        <div class="two">
          <label>Amount (${esc(trip.currency || 'EUR')}) <input name="amount" type="number" inputmode="decimal" step="0.01" min="0" placeholder="0.00"></label>
          <label>Paid by <select name="paid_by">${trip.trip_members.map((m) => `<option value="${m.user_id}" ${m.user_id === user.id ? 'selected' : ''}>${esc(m.profiles?.display_name || '?')}</option>`).join('')}</select></label>
        </div>
        <div class="row"><span class="muted small">Split between</span>${trip.trip_members.map((m) => `<label class="inline small"><input type="checkbox" name="split" value="${m.user_id}" checked> ${esc(m.profiles?.display_name || '?')}</label>`).join('')}</div>
      </fieldset>`}
      <label>Tickets & confirmations
        <input type="file" name="files" multiple accept=".pdf,image/*,.pkpass">
        <div class="attach-list" id="attachList">${(it.attachments || []).map((a) => `
          <div class="row" data-att="${a.id}" data-path="${esc(a.path)}">
            <a href="#" data-file="${esc(a.path)}">📎 ${esc(a.filename)}</a>
            <span class="muted small">${a.size ? fileSize(a.size) : ''} <button type="button" class="btn ghost small" data-del-att>remove</button></span>
          </div>`).join('')}</div>
      </label>
      <p class="error" id="itemErr"></p>
      <div class="dialog-foot">
        ${editing ? '<button type="button" class="btn danger" id="delItem">Delete</button>' : ''}
        <button type="button" class="btn" data-close>Cancel</button>
        <button class="btn primary" id="saveItem">${editing ? 'Save' : 'Add'}</button>
      </div>
    </form>`);

  const form = $('#itemForm', dlg);
  const relabel = () => {
    const stay = form.kind.value === 'stay';
    $('[data-start-label]', form).textContent = stay ? 'Check-in' : 'Start';
    $('[data-end-label]', form).textContent = stay ? 'Check-out' : 'End';
  };
  relabel();
  form.kind.addEventListener('change', relabel);

  const fillForm = (v) => {
    form.kind.value = v.kind; form.title.value = v.title;
    form.all_day.checked = !!v.all_day;
    const type = v.all_day ? 'date' : 'datetime-local';
    form.starts_at.type = type; form.ends_at.type = type;
    form.starts_at.value = v.all_day ? (v.starts_at || '').slice(0, 10) : toInputDT(v.starts_at);
    form.ends_at.value = v.all_day ? (v.ends_at || '').slice(0, 10) : toInputDT(v.ends_at);
    form.location.value = v.location || ''; form.address.value = v.address || '';
    form.booking_ref.value = v.booking_ref || ''; form.url.value = v.url || ''; form.notes.value = v.notes || '';
    if (form.amount && v.price) form.amount.value = v.price;
    relabel();
  };
  $('#pdfFile', dlg)?.addEventListener('change', async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    const err = $('#itemErr', dlg); err.textContent = '';
    toast('Reading the PDF…');
    let parsed;
    try { parsed = parseBookingText(await extractPdfText(file)); }
    catch (ex) { err.textContent = `Could not read that PDF: ${ex.message}`; return; }
    if (!parsed.found) { err.textContent = 'That does not look like a Booking.com confirmation. You can still fill the form in by hand and attach the PDF.'; }
    fillForm({ ...parsed, url: null });
    // Attach the PDF itself to the stay as well.
    try { const dt = new DataTransfer(); dt.items.add(file); form.files.files = dt.files; } catch {}
    if (parsed.found) toast('Filled in from the PDF. Check it and save.');
  });
  $('#icsFile', dlg)?.addEventListener('change', async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    const err = $('#itemErr', dlg); err.textContent = '';
    let events;
    try { events = parseIcs(await file.text()); } catch { events = []; }
    if (!events.length) { err.textContent = 'No events found in that file.'; return; }
    if (events.length === 1) { fillForm(icsToItem(events[0])); toast('Filled in from the file. Check it and save.'); return; }
    if (!confirm(`This file has ${events.length} events. Add all of them to the trip?`)) return;
    const rows = events.map((ev) => ({ trip_id: trip.id, ...icsToItem(ev) }));
    const { error } = await sb.from('items').insert(rows);
    if (error) { err.textContent = error.message; return; }
    dlg.close(); toast(`Added ${rows.length} items`); renderTrip(trip.id);
  });
  form.all_day.addEventListener('change', () => {
    const type = form.all_day.checked ? 'date' : 'datetime-local';
    for (const name of ['starts_at', 'ends_at']) {
      const v = form[name].value;
      form[name].type = type;
      form[name].value = type === 'date' ? v.slice(0, 10) : (v ? v + 'T12:00' : '');
    }
  });

  $$('[data-file]', dlg).forEach((a) => a.addEventListener('click', (e) => { e.preventDefault(); openFile(a.dataset.file); }));
  $$('[data-del-att]', dlg).forEach((b) => b.addEventListener('click', async () => {
    const row = b.closest('[data-att]');
    if (!confirm('Remove this file?')) return;
    await sb.storage.from('attachments').remove([row.dataset.path]);
    const { error } = await sb.from('attachments').delete().eq('id', row.dataset.att);
    if (error) return toast(error.message);
    row.remove();
  }));

  $('#delItem', dlg)?.addEventListener('click', async () => {
    if (!confirm(`Delete "${it.title}"?`)) return;
    const paths = (it.attachments || []).map((a) => a.path);
    if (paths.length) await sb.storage.from('attachments').remove(paths);
    const { error } = await sb.from('items').delete().eq('id', it.id);
    if (error) return toast(error.message);
    dlg.close(); toast('Deleted'); renderTrip(trip.id);
  });

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const btn = $('#saveItem', dlg); btn.disabled = true;
    const err = $('#itemErr', dlg); err.textContent = '';
    const allDay = form.all_day.checked;
    const payload = {
      trip_id: trip.id,
      kind: form.kind.value,
      title: form.title.value.trim(),
      all_day: allDay,
      starts_at: fromInputDT(form.starts_at.value),
      ends_at: fromInputDT(form.ends_at.value),
      location: form.location.value.trim() || null,
      address: form.address.value.trim() || null,
      booking_ref: form.booking_ref.value.trim() || null,
      url: form.url.value.trim() || null,
      notes: form.notes.value.trim() || null,
    };
    if (payload.starts_at && payload.ends_at && payload.ends_at < payload.starts_at) {
      err.textContent = 'End is before start.'; btn.disabled = false; return;
    }
    const q = editing
      ? sb.from('items').update(payload).eq('id', it.id).select().single()
      : sb.from('items').insert(payload).select().single();
    const { data: saved, error } = await q;
    if (error) { err.textContent = error.message; btn.disabled = false; return; }

    // Upload any chosen files.
    const files = [...form.files.files];
    for (const f of files) {
      btn.textContent = `Uploading ${f.name}…`;
      const safe = f.name.replace(/[^\w.\-]+/g, '_');
      const path = `${trip.id}/${saved.id}/${Date.now()}-${safe}`;
      const up = await sb.storage.from('attachments').upload(path, f, { contentType: f.type || undefined });
      if (up.error) { err.textContent = `Upload failed: ${up.error.message}`; btn.disabled = false; btn.textContent = 'Save'; return; }
      await sb.from('attachments').insert({ item_id: saved.id, trip_id: trip.id, path, filename: f.name, size: f.size });
    }

    // Cost entered on a new item becomes an expense.
    let expenseNote = '';
    const amount = !editing && form.amount ? Number(form.amount.value) : 0;
    if (amount > 0) {
      const split_with = $$('input[name=split]:checked', form).map((i) => i.value);
      const { error: expErr } = await sb.from('expenses').insert({
        trip_id: trip.id, title: payload.title, amount: amount.toFixed(2), paid_by: form.paid_by.value,
        split_with: split_with.length ? split_with : [form.paid_by.value],
        spent_on: new Date().toISOString().slice(0, 10), notes: KIND_LABELS[payload.kind] || null,
      });
      expenseNote = expErr ? ` (expense not added: ${expErr.message})` : `, ${money(cents(amount), trip.currency || 'EUR')} added to expenses`;
    }
    dlg.close();
    toast((editing ? 'Saved' : 'Added') + expenseNote);
    renderTrip(trip.id);
  });
}

// --- Expenses (Splitwise-style) ------------------------------------------------------
const cents = (n) => Math.round(Number(n) * 100);
function money(c, cur) {
  const v = Math.abs(c) / 100;
  try { return new Intl.NumberFormat(undefined, { style: 'currency', currency: cur }).format(v); }
  catch { return `${cur} ${v.toFixed(2)}`; }
}
const memberName = (trip, id) => trip.trip_members.find((m) => m.user_id === id)?.profiles?.display_name || 'Someone';

// Each person's share of an expense in cents. Leftover cents go to the first few people
// in the split, so the shares always add up to the exact amount.
function shareOf(e, id) {
  const parts = e.split_with?.length ? e.split_with : [e.paid_by];
  const idx = parts.indexOf(id);
  if (idx < 0) return 0;
  const total = cents(e.amount);
  const base = Math.floor(total / parts.length);
  return base + (idx < total - base * parts.length ? 1 : 0);
}

// Net position per person in cents: positive = gets money back, negative = owes money.
function computeBalances(expenses) {
  const net = {};
  for (const e of expenses) {
    const parts = e.split_with?.length ? e.split_with : [e.paid_by];
    net[e.paid_by] = (net[e.paid_by] || 0) + cents(e.amount);
    for (const p of parts) net[p] = (net[p] || 0) - shareOf(e, p);
  }
  return net;
}

// The fewest transfers that bring everyone back to zero.
function settlements(net) {
  const debtors = Object.entries(net).filter(([, v]) => v < 0).map(([id, v]) => ({ id, v: -v })).sort((a, b) => b.v - a.v);
  const creditors = Object.entries(net).filter(([, v]) => v > 0).map(([id, v]) => ({ id, v })).sort((a, b) => b.v - a.v);
  const out = [];
  let i = 0, j = 0;
  while (i < debtors.length && j < creditors.length) {
    const amt = Math.min(debtors[i].v, creditors[j].v);
    if (amt > 0) out.push({ from: debtors[i].id, to: creditors[j].id, amount: amt });
    debtors[i].v -= amt; creditors[j].v -= amt;
    if (debtors[i].v === 0) i++;
    if (creditors[j].v === 0) j++;
  }
  return out;
}

function renderExpenses(root, trip, expenses) {
  const cur = trip.currency || 'EUR';
  const net = computeBalances(expenses);
  const real = expenses.filter((e) => !e.is_settlement);
  const total = real.reduce((s, e) => s + cents(e.amount), 0);
  const mine = net[user.id] || 0;
  const myShare = real.reduce((s, e) => s + shareOf(e, user.id), 0);
  const transfers = settlements(net);
  const people = trip.trip_members.map((m) => m.user_id);
  for (const id of Object.keys(net)) if (!people.includes(id)) people.push(id); // left the trip but still has a balance

  root.innerHTML = `
    <div class="card totals">
      <div><span class="muted small">Group total</span><strong>${money(total, cur)}</strong></div>
      <div><span class="muted small">Your share</span><strong>${money(myShare, cur)}</strong></div>
      <div><span class="muted small">Your balance</span><strong class="${mine > 0 ? 'pos' : mine < 0 ? 'neg' : ''}">${mine === 0 ? 'settled' : (mine > 0 ? '+' : '−') + money(mine, cur)}</strong></div>
    </div>

    <div class="section">
      <div class="section-title"><h2>Who owes what</h2></div>
      <div class="card stack">
        ${people.map((id) => { const v = net[id] || 0; return `
          <div class="row spread">
            <span>${esc(memberName(trip, id))}${id === user.id ? ' <span class="muted small">(you)</span>' : ''}</span>
            <span class="${v > 0 ? 'pos' : v < 0 ? 'neg' : 'muted'}">${v === 0 ? 'settled' : v > 0 ? 'gets back ' + money(v, cur) : 'owes ' + money(v, cur)}</span>
          </div>`; }).join('')}
      </div>
    </div>

    <div class="section">
      <div class="section-title"><h2>Settle up</h2></div>
      <div class="card stack">
        ${transfers.length ? transfers.map((t) => `
          <div class="row spread">
            <span><strong>${esc(memberName(trip, t.from))}</strong> pays <strong>${esc(memberName(trip, t.to))}</strong> ${money(t.amount, cur)}</span>
            <button class="btn small" data-settle="${t.from}|${t.to}|${t.amount}">Mark as paid</button>
          </div>`).join('') : '<p class="muted">Everyone is square 🎉</p>'}
        <p class="help">The fewest payments that balance the whole group. Tap “Mark as paid” once the money has actually been sent.</p>
      </div>
    </div>

    <div class="section">
      <div class="section-title"><h2>All expenses</h2><span class="muted small">${real.length}</span></div>
      ${expenses.length ? `<div class="stack">${expenses.map((e) => expenseCard(trip, e, cur)).join('')}</div>`
        : '<div class="empty">No expenses yet.<br>Tap + whenever someone pays for the group.</div>'}
    </div>`;

  $$('[data-expense]', root).forEach((c) => c.addEventListener('click', () => expenseDialog(trip, expenses.find((e) => e.id === c.dataset.expense))));
  $$('[data-settle]', root).forEach((b) => b.addEventListener('click', async () => {
    const [from, to, amount] = b.dataset.settle.split('|');
    if (!confirm(`${memberName(trip, from)} paid ${memberName(trip, to)} ${money(+amount, cur)}?`)) return;
    const { error } = await sb.from('expenses').insert({
      trip_id: trip.id, title: `${memberName(trip, from)} paid ${memberName(trip, to)}`, amount: (+amount / 100).toFixed(2),
      paid_by: from, split_with: [to], is_settlement: true,
    });
    if (error) return toast(error.message);
    toast('Settled'); renderTrip(trip.id);
  }));
}

function expenseCard(trip, e, cur) {
  const total = cents(e.amount);
  const share = shareOf(e, user.id);
  const who = e.split_with.length === trip.trip_members.length ? 'everyone' : e.split_with.map((id) => memberName(trip, id)).join(', ');
  return `
    <div class="card expense ${e.is_settlement ? 'settlement' : ''}" data-expense="${e.id}">
      <div class="row spread">
        <div>
          <div class="title">${e.is_settlement ? '🤝 ' : ''}${esc(e.title)}</div>
          <div class="muted small">${fmtDay(e.spent_on)} · ${e.is_settlement ? 'settlement' : `paid by ${esc(e.paid_by === user.id ? 'you' : memberName(trip, e.paid_by))} · split with ${esc(who)}`}</div>
          ${e.notes ? `<div class="muted small">${esc(e.notes)}</div>` : ''}
        </div>
        <div class="amount">
          <strong>${money(total, cur)}</strong>
          ${!e.is_settlement && share ? `<div class="muted small">your share ${money(share, cur)}</div>` : ''}
        </div>
      </div>
    </div>`;
}

function expenseDialog(trip, expense) {
  const editing = !!expense?.id;
  const e = expense || {};
  const cur = trip.currency || 'EUR';
  const members = trip.trip_members;
  const split = new Set(e.split_with || members.map((m) => m.user_id));
  const dlg = openDialog(`
    <div class="dialog-head"><h2>${editing ? 'Edit expense' : 'Add expense'}</h2><button class="btn ghost" data-close>✕</button></div>
    <form class="stack" id="expenseForm">
      <label>What <input name="title" value="${esc(e.title || '')}" placeholder="Dinner, rental car, groceries…" required></label>
      <div class="two">
        <label>Amount (${esc(cur)}) <input name="amount" type="number" inputmode="decimal" step="0.01" min="0.01" value="${e.amount ?? ''}" required></label>
        <label>Date <input type="date" name="spent_on" value="${e.spent_on || new Date().toISOString().slice(0, 10)}" required></label>
      </div>
      <label>Paid by
        <select name="paid_by">${members.map((m) => `<option value="${m.user_id}" ${(e.paid_by || user.id) === m.user_id ? 'selected' : ''}>${esc(m.profiles?.display_name || '?')}</option>`).join('')}</select>
      </label>
      <fieldset class="split">
        <legend class="muted small">Split equally between</legend>
        ${members.map((m) => `<label class="inline"><input type="checkbox" name="split" value="${m.user_id}" ${split.has(m.user_id) ? 'checked' : ''}> ${esc(m.profiles?.display_name || '?')}</label>`).join('')}
      </fieldset>
      <label>Notes <input name="notes" value="${esc(e.notes || '')}" placeholder="optional"></label>
      <p class="error" id="expErr"></p>
      <div class="dialog-foot">
        ${editing ? '<button type="button" class="btn danger" id="delExpense">Delete</button>' : ''}
        <button type="button" class="btn" data-close>Cancel</button>
        <button class="btn primary">${editing ? 'Save' : 'Add'}</button>
      </div>
    </form>`);
  const form = $('#expenseForm', dlg);
  $('#delExpense', dlg)?.addEventListener('click', async () => {
    if (!confirm(`Delete "${e.title}"?`)) return;
    const { error } = await sb.from('expenses').delete().eq('id', e.id);
    if (error) return toast(error.message);
    dlg.close(); toast('Deleted'); renderTrip(trip.id);
  });
  form.addEventListener('submit', async (ev) => {
    ev.preventDefault();
    const split_with = $$('input[name=split]:checked', form).map((i) => i.value);
    if (!split_with.length) { $('#expErr', dlg).textContent = 'Pick at least one person to split with.'; return; }
    const payload = {
      trip_id: trip.id, title: form.title.value.trim(), amount: Number(form.amount.value).toFixed(2),
      spent_on: form.spent_on.value, paid_by: form.paid_by.value, split_with, notes: form.notes.value.trim() || null,
      is_settlement: !!e.is_settlement,
    };
    const { error } = await (editing ? sb.from('expenses').update(payload).eq('id', e.id) : sb.from('expenses').insert(payload));
    if (error) { $('#expErr', dlg).textContent = error.message; return; }
    dlg.close(); toast(editing ? 'Saved' : 'Added'); renderTrip(trip.id);
  });
}

// --- Photos ------------------------------------------------------------------------------
const photoLinks = (links) => links.filter((l) => l.category === 'photos' || l.category === 'drive');

// Pulls the folder id out of any Google Drive folder link.
function driveFolderId(url) {
  const m = url.match(/\/folders\/([\w-]{10,})/) || url.match(/[?&]id=([\w-]{10,})/);
  return m ? m[1] : null;
}

function renderPhotos(root, trip, links) {
  const cards = links.map((l) => {
    const isDrive = l.category === 'drive';
    const folder = isDrive ? driveFolderId(l.url) : null;
    return `
      <div class="card stack photo-card">
        <div class="row spread link-row">
          <h3>${isDrive ? '📁' : '📷'} ${esc(l.label)}</h3>
          <button class="btn ghost small" data-del-link="${l.id}">remove</button>
        </div>
        ${folder && DEMO
          ? '<div class="drive-embed demo-embed">Demo: the pictures in your Drive folder show up here as a grid, right inside the app.</div>'
          : folder
          ? `<iframe class="drive-embed" src="https://drive.google.com/embeddedfolderview?id=${encodeURIComponent(folder)}#grid" loading="lazy" title="${esc(l.label)}"></iframe>
             <p class="help">If the folder shows as empty or asks you to sign in, its sharing is set to “Restricted”. The folder owner can fix that in Drive with Share → Anyone with the link → Editor.</p>`
          : isDrive ? '<p class="help">This link does not look like a Drive folder, so it cannot be shown inline. It still opens in Drive.</p>' : ''}
        <a class="btn primary block" href="${esc(l.url)}" target="_blank" rel="noopener">${isDrive ? 'Open folder in Google Drive' : 'Open the album'}</a>
        <p class="muted small">Added by ${esc(l.profiles?.display_name || memberName(trip, l.created_by))}</p>
      </div>`;
  }).join('');

  root.innerHTML = `
    ${cards || `
      <div class="card stack">
        <h3>Where do the photos go?</h3>
        <p class="help">The app does not store photos itself (phones make a lot of them). Instead the group picks a shared place and links it here. Two good options:</p>
        <p class="help"><strong>Google Drive folder.</strong> Works for everyone, iPhone or Android, with or without a Google Photos account. Create a folder in Drive, tap Share → Anyone with the link → Editor, and paste the link below. The folder shows up right here in the app.</p>
        <p class="help"><strong>Google Photos or iCloud shared album.</strong> Best for background uploads from the camera roll. Create a shared album, share it, paste the link below.</p>
      </div>`}
    <div class="section card">
      <h3>Link a folder or album</h3>
      <form class="stack" id="photoForm" style="margin-top:10px">
        <label>Type
          <select name="category">
            <option value="drive">📁 Google Drive folder</option>
            <option value="photos">📷 Shared album (Google Photos, iCloud…)</option>
          </select>
        </label>
        <label>Name <input name="label" placeholder="Trip photos" required></label>
        <label>Link <input type="url" name="url" placeholder="https://drive.google.com/drive/folders/…" required></label>
        <p class="error" id="photoErr"></p>
        <div class="dialog-foot"><button class="btn primary">Add</button></div>
      </form>
    </div>`;

  const form = $('#photoForm', root);
  form.category.addEventListener('change', () => {
    form.url.placeholder = form.category.value === 'drive' ? 'https://drive.google.com/drive/folders/…' : 'https://photos.app.goo.gl/…';
  });
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const payload = { trip_id: trip.id, category: form.category.value, label: form.label.value.trim(), url: form.url.value.trim() };
    if (payload.category === 'drive' && !driveFolderId(payload.url)) {
      $('#photoErr', root).textContent = 'That does not look like a Google Drive folder link. In Drive, open the folder, tap Share, and copy the link.';
      return;
    }
    const { error } = await sb.from('links').insert(payload);
    if (error) return toast(error.message);
    toast('Linked'); renderTrip(trip.id);
  });
  $$('[data-del-link]', root).forEach((b) => b.addEventListener('click', async () => {
    if (!confirm('Remove this link from the trip? The photos themselves stay where they are.')) return;
    const { error } = await sb.from('links').delete().eq('id', b.dataset.delLink);
    if (error) return toast(error.message);
    renderTrip(trip.id);
  }));
}

// --- Links & routes ---------------------------------------------------------------
function renderLinks(root, trip, links) {
  root.innerHTML = `
    <div class="stack">
      ${links.length ? links.map((l) => `
        <div class="card row spread link-row">
          <a href="${esc(l.url)}" target="_blank" rel="noopener">${LINK_CATS[l.category]?.split(' ')[0] || '🔗'} ${esc(l.label)}</a>
          <button class="btn ghost small" data-del-link="${l.id}">remove</button>
        </div>`).join('') : '<div class="empty">Add hiking routes, maps or documents here.<br>Photo albums go under the Photos tab.</div>'}
    </div>
    <div class="section card">
      <h3>Add a link</h3>
      <form class="stack" id="linkForm" style="margin-top:10px">
        <div class="two">
          <label>Type <select name="category">${Object.entries(LINK_CATS).filter(([k]) => k !== 'photos' && k !== 'drive').map(([k, v]) => `<option value="${k}" ${k === 'route' ? 'selected' : ''}>${v}</option>`).join('')}</select></label>
          <label>Label <input name="label" placeholder="Levada walk on Komoot" required></label>
        </div>
        <label>URL <input type="url" name="url" placeholder="https://www.komoot.com/…" required></label>
        <div class="dialog-foot"><button class="btn primary">Add link</button></div>
      </form>
      <p class="help" style="margin-top:8px">Routes from Google Maps, Komoot or AllTrails, a saved-places map, the rental car contract: anything the group should be able to find in one tap.</p>
    </div>`;
  $('#linkForm', root).addEventListener('submit', async (e) => {
    e.preventDefault();
    const f = e.target;
    const payload = { trip_id: trip.id, category: f.category.value, label: f.label.value.trim(), url: f.url.value.trim() };
    const { error } = await sb.from('links').insert(payload);
    if (error) return toast(error.message);
    toast('Added'); renderTrip(trip.id);
  });
  $$('[data-del-link]', root).forEach((b) => b.addEventListener('click', async () => {
    if (!confirm('Remove this link?')) return;
    const { error } = await sb.from('links').delete().eq('id', b.dataset.delLink);
    if (error) return toast(error.message);
    renderTrip(trip.id);
  }));
}

// --- Settings ----------------------------------------------------------------------
function renderSettings(root, trip, isOwner) {
  root.innerHTML = `
    <div class="card">
      <form class="stack" id="tripSettings">
        <div class="two">
          <label>Emoji <input name="emoji" value="${esc(trip.emoji || '🧳')}" maxlength="4" ${isOwner ? '' : 'disabled'}></label>
          <label>Trip name <input name="name" value="${esc(trip.name)}" required ${isOwner ? '' : 'disabled'}></label>
        </div>
        <div class="two">
          <label>Destination <input name="destination" value="${esc(trip.destination || '')}" ${isOwner ? '' : 'disabled'}></label>
          <label>Currency for expenses <input name="currency" value="${esc(trip.currency || 'EUR')}" maxlength="3" placeholder="EUR" ${isOwner ? '' : 'disabled'}></label>
        </div>
        <div class="two">
          <label>From <input type="date" name="start_date" value="${trip.start_date || ''}" ${isOwner ? '' : 'disabled'}></label>
          <label>To <input type="date" name="end_date" value="${trip.end_date || ''}" ${isOwner ? '' : 'disabled'}></label>
        </div>
        <label>Trip notes <textarea name="notes" ${isOwner ? '' : 'disabled'}>${esc(trip.notes || '')}</textarea></label>
        ${isOwner ? '<div class="dialog-foot"><button class="btn primary">Save</button></div>' : '<p class="help">Only the trip owner (★) can change these.</p>'}
      </form>
    </div>
    <div class="section card stack">
      <h3>People</h3>
      ${trip.trip_members.map((m) => `
        <div class="row spread">
          <span>${esc(m.profiles?.display_name || '?')} ${m.role === 'owner' ? '<span class="muted small">owner</span>' : ''}</span>
          ${isOwner && m.user_id !== user.id ? `<button class="btn ghost small" data-remove="${m.user_id}">remove</button>` : ''}
        </div>`).join('')}
    </div>
    <div class="section card stack">
      ${isOwner
        ? '<button class="btn danger" id="deleteTrip">Delete this trip for everyone</button>'
        : '<button class="btn danger" id="leaveTrip">Leave this trip</button>'}
    </div>`;

  $('#tripSettings', root).addEventListener('submit', async (e) => {
    e.preventDefault();
    const f = e.target;
    const { error } = await sb.from('trips').update({
      emoji: f.emoji.value.trim() || '🧳', name: f.name.value.trim(), destination: f.destination.value.trim() || null,
      currency: f.currency.value.trim().toUpperCase() || 'EUR',
      start_date: f.start_date.value || null, end_date: f.end_date.value || null,
      notes: f.notes.value.trim() || null,
    }).eq('id', trip.id);
    if (error) return toast(error.message);
    toast('Saved'); renderTrip(trip.id);
  });
  $$('[data-remove]', root).forEach((b) => b.addEventListener('click', async () => {
    if (!confirm('Remove this person from the trip?')) return;
    const { error } = await sb.from('trip_members').delete().eq('trip_id', trip.id).eq('user_id', b.dataset.remove);
    if (error) return toast(error.message);
    renderTrip(trip.id);
  }));
  $('#deleteTrip', root)?.addEventListener('click', async () => {
    if (!confirm(`Delete "${trip.name}" and everything in it, for everyone? This cannot be undone.`)) return;
    // Remove uploaded files first (folders are <trip>/<item>/<file>); the database rows cascade.
    const { data: folders } = await sb.storage.from('attachments').list(trip.id);
    const paths = [];
    for (const f of folders || []) {
      const { data: files } = await sb.storage.from('attachments').list(`${trip.id}/${f.name}`);
      for (const file of files || []) paths.push(`${trip.id}/${f.name}/${file.name}`);
    }
    if (paths.length) await sb.storage.from('attachments').remove(paths);
    const { error } = await sb.from('trips').delete().eq('id', trip.id);
    if (error) return toast(error.message);
    localStorage.removeItem('trip:' + trip.id);
    location.hash = '#/';
  });
  $('#leaveTrip', root)?.addEventListener('click', async () => {
    if (!confirm('Leave this trip?')) return;
    const { error } = await sb.from('trip_members').delete().eq('trip_id', trip.id).eq('user_id', user.id);
    if (error) return toast(error.message);
    localStorage.removeItem('trip:' + trip.id);
    location.hash = '#/';
  });
}

// --- Calendar & invite dialogs -----------------------------------------------------
function calendarDialog(trip) {
  const httpsUrl = `${SUPABASE_URL}/functions/v1/ics?token=${trip.ical_token}`;
  const webcalUrl = httpsUrl.replace(/^https?:\/\//, 'webcal://');
  const dlg = openDialog(`
    <div class="dialog-head"><h2>Add to your calendar</h2><button class="btn ghost" data-close>✕</button></div>
    <p class="help">Subscribe once. Every flight, stay and activity in this trip then appears in your calendar, and changes anyone makes show up automatically (within about an hour).</p>
    <div class="stack" style="margin-top:14px">
      <a class="btn primary block" href="${esc(webcalUrl)}">📱 Subscribe on iPhone / Mac / Outlook</a>
      <div class="copy-box"><input readonly value="${esc(httpsUrl)}" id="icsUrl"><button class="btn" id="copyIcs">Copy</button></div>
    </div>
    <div class="help" style="margin-top:14px">
      <strong>Google Calendar</strong> (also for Android phones):
      <ol>
        <li>Copy the link above.</li>
        <li>On a computer, open <a href="https://calendar.google.com/calendar/u/0/r/settings/addbyurl" target="_blank" rel="noopener">calendar.google.com → Add calendar → From URL</a>.</li>
        <li>Paste the link and click “Add calendar”. It then syncs to the Google Calendar app on your phone.</li>
      </ol>
      Each person does this once on their own account.
    </div>`);
  $('#copyIcs', dlg).addEventListener('click', () => copy(httpsUrl));
}

function inviteDialog(trip) {
  const link = `${location.origin}${location.pathname}#/join/${trip.invite_code}`;
  const dlg = openDialog(`
    <div class="dialog-head"><h2>Invite friends</h2><button class="btn ghost" data-close>✕</button></div>
    <p class="help">Anyone with this link can join the trip and add things. Send it in your group chat.</p>
    <div class="copy-box" style="margin-top:14px"><input readonly value="${esc(link)}"><button class="btn" id="copyInvite">Copy</button></div>
    <p class="help" style="margin-top:10px">Or share the code <strong>${esc(trip.invite_code)}</strong> and they type it in on the trips page.</p>
    <div class="dialog-foot">${navigator.share ? '<button class="btn primary" id="shareInvite">Share…</button>' : ''}</div>`);
  $('#copyInvite', dlg).addEventListener('click', () => copy(link));
  $('#shareInvite', dlg)?.addEventListener('click', () => navigator.share({ title: trip.name, text: `Join our trip "${trip.name}" on Trip Hub`, url: link }).catch(() => {}));
}

// ---------------------------------------------------------------------------
// Boot
// ---------------------------------------------------------------------------
async function boot() {
  if (!configured) return renderNotConfigured();
  const { data: { session } } = await sb.auth.getSession();
  user = session?.user ?? null;
  if (user) await loadProfile();

  sb.auth.onAuthStateChange(async (event, session) => {
    const prev = user?.id;
    user = session?.user ?? null;
    if (event === 'SIGNED_IN' && user) {
      if (user.id !== prev) await loadProfile();
      // The sign-in link lands here with tokens in the hash; replace it with a real route.
      if (!location.hash.startsWith('#/')) {
        const pending = localStorage.getItem('pendingJoin');
        history.replaceState(null, '', location.pathname + location.search + (pending ? `#/join/${pending}` : '#/'));
      }
      if (user.id !== prev) route();
    }
    if (event === 'SIGNED_OUT') { profile = null; route(); }
  });

  if (!location.hash.startsWith('#/') && !location.hash.includes('access_token')) history.replaceState(null, '', location.pathname + location.search + '#/');
  route();
}

boot();
