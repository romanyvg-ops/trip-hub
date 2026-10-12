// Reads .ics calendar files (Airbnb, Booking.com, airlines, Google Calendar…) into trip items.

const pad = (n) => String(n).padStart(2, '0');
const ymd = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

// "20261112" -> all-day date; "20261112T150000" -> local time kept as written (TZID or floating);
// "20261112T140000Z" -> UTC, converted to this device's local time.
function icsDate(v, params) {
  if (params.VALUE === 'DATE' || /^\d{8}$/.test(v)) {
    return { value: `${v.slice(0, 4)}-${v.slice(4, 6)}-${v.slice(6, 8)}`, allDay: true };
  }
  const m = v.match(/^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})?(Z?)$/);
  if (!m) return null;
  if (m[7] === 'Z') {
    const d = new Date(Date.UTC(+m[1], m[2] - 1, +m[3], +m[4], +m[5], +(m[6] || 0)));
    return { value: `${ymd(d)}T${pad(d.getHours())}:${pad(d.getMinutes())}:00`, allDay: false };
  }
  return { value: `${m[1]}-${m[2]}-${m[3]}T${m[4]}:${m[5]}:00`, allDay: false };
}

const unescapeText = (s) => s.replace(/\\n/gi, '\n').replace(/\\([,;\\])/g, '$1').trim();

export function parseIcs(text) {
  const raw = text.replace(/\r\n?/g, '\n').split('\n');
  const lines = [];
  for (const l of raw) {
    if (/^[ \t]/.test(l) && lines.length) lines[lines.length - 1] += l.slice(1); // unfold
    else lines.push(l);
  }
  const events = [];
  let cur = null;
  for (const line of lines) {
    if (line === 'BEGIN:VEVENT') { cur = {}; continue; }
    if (line === 'END:VEVENT') { if (cur) events.push(cur); cur = null; continue; }
    if (!cur) continue;
    const i = line.indexOf(':');
    if (i < 0) continue;
    const [name, ...paramList] = line.slice(0, i).split(';');
    const value = line.slice(i + 1);
    const key = name.toUpperCase();
    const params = Object.fromEntries(paramList.map((p) => p.split('=').map((x) => x.toUpperCase())));
    if (key === 'DTSTART' || key === 'DTEND') cur[key] = icsDate(value, params);
    else if (key === 'SUMMARY' || key === 'LOCATION' || key === 'DESCRIPTION' || key === 'URL') cur[key] = unescapeText(value);
  }
  return events.filter((e) => e.DTSTART);
}

function guessKind(ev) {
  const s = `${ev.SUMMARY || ''}\n${ev.DESCRIPTION || ''}`.toLowerCase();
  if (/airbnb|booking\.com|hotels?\b|apartment|hostel|resort|villa|guesthouse|check-?in|reservation at|stay at|nights?\b/.test(s)) return 'stay';
  if (/flight|airline|boarding|\bklm\b|ryanair|easyjet|transavia|lufthansa|\btap\b|vueling|wizz/.test(s)) return 'flight';
  if (/\btrain\b|\brail\b|eurostar|thalys|\bice\b|intercity/.test(s)) return 'train';
  if (/ferry/.test(s)) return 'ferry';
  if (/\bbus\b|flixbus|coach/.test(s)) return 'bus';
  if (/rental car|car rental|car hire|hertz|sixt|europcar|\bavis\b/.test(s)) return 'car';
  if (/dinner|lunch|breakfast|restaurant|table for/.test(s)) return 'food';
  // An all-day block of two nights or more is almost always a stay (DTEND is exclusive, so one day = 1 day apart).
  if (ev.DTSTART.allDay && ev.DTEND) {
    const days = (new Date(ev.DTEND.value) - new Date(ev.DTSTART.value)) / 86400000;
    if (days >= 2) return 'stay';
  }
  return 'activity';
}

function bookingRef(text) {
  const m = (text || '').match(/(?:confirmation (?:code|number)|booking (?:number|reference|ref|id)|reservation (?:code|number)|pnr|reference)\s*[:#]?\s*([A-Z0-9][A-Z0-9.-]{4,})/i);
  return m ? m[1] : null;
}

// Turns one parsed event into the shape of a trip item.
export function icsToItem(ev) {
  const kind = guessKind(ev);
  const allDay = ev.DTSTART.allDay;
  let starts = ev.DTSTART.value;
  let ends = ev.DTEND?.value || null;
  if (allDay && ends && kind !== 'stay') {
    // All-day DTEND is exclusive in .ics; a stay's DTEND is its check-out day, which we keep.
    const d = new Date(ends + 'T00:00:00');
    d.setDate(d.getDate() - 1);
    ends = ymd(d);
    if (ends <= starts) ends = null;
  }
  if (allDay) { starts += 'T00:00:00'; if (ends) ends += 'T00:00:00'; }
  const description = ev.DESCRIPTION || null;
  return {
    kind,
    title: ev.SUMMARY || 'Imported from calendar',
    all_day: allDay,
    starts_at: starts,
    ends_at: ends,
    location: kind === 'stay' ? null : (ev.LOCATION || null),
    address: kind === 'stay' ? (ev.LOCATION || null) : null,
    url: ev.URL || null,
    booking_ref: bookingRef(description),
    notes: description && description.length > 600 ? description.slice(0, 600) + '…' : description,
  };
}
