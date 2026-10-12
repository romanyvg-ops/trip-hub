// Reads a Booking.com confirmation PDF (English or Dutch) into a stay.
// Text extraction happens in the browser with pdf.js; nothing is sent anywhere.

const PDFJS_VERSION = '4.6.82';
let pdfjsPromise;
function loadPdfJs() {
  pdfjsPromise ??= import(`https://cdnjs.cloudflare.com/ajax/libs/pdf.js/${PDFJS_VERSION}/pdf.min.mjs`).then((pdfjs) => {
    pdfjs.GlobalWorkerOptions.workerSrc = `https://cdnjs.cloudflare.com/ajax/libs/pdf.js/${PDFJS_VERSION}/pdf.worker.min.mjs`;
    return pdfjs;
  });
  return pdfjsPromise;
}

// Returns the PDF's text as lines, in reading order, one string per visual line.
export async function extractPdfText(file) {
  const pdfjs = await loadPdfJs();
  const doc = await pdfjs.getDocument({ data: await file.arrayBuffer() }).promise;
  const lines = [];
  for (let p = 1; p <= doc.numPages; p++) {
    const page = await doc.getPage(p);
    const content = await page.getTextContent();
    // Group text runs by their y position so each visual line becomes one string.
    const rows = new Map();
    for (const it of content.items) {
      if (!it.str) continue;
      const y = Math.round(it.transform[5] / 3) * 3;
      if (!rows.has(y)) rows.set(y, []);
      rows.get(y).push({ x: it.transform[4], s: it.str });
    }
    [...rows.entries()].sort((a, b) => b[0] - a[0]).forEach(([, runs]) => {
      lines.push(runs.sort((a, b) => a.x - b.x).map((r) => r.s).join(' ').replace(/\s+/g, ' ').trim());
    });
  }
  return lines.filter(Boolean);
}

const MONTHS = {
  january: 1, february: 2, march: 3, april: 4, may: 5, june: 6, july: 7, august: 8, september: 9, october: 10, november: 11, december: 12,
  jan: 1, feb: 2, mar: 3, apr: 4, jun: 6, jul: 7, aug: 8, sep: 9, sept: 9, oct: 10, nov: 11, dec: 12,
  januari: 1, februari: 2, maart: 3, mei: 5, juni: 6, juli: 7, augustus: 8, oktober: 10, // Dutch
  mrt: 3, okt: 10,
};
const pad = (n) => String(n).padStart(2, '0');

// Finds "12 November 2026", "November 12, 2026", "12-11-2026" or "2026-11-12" in a string.
function findDate(s) {
  let m = s.match(/(\d{1,2})\s+([A-Za-z]+)\.?,?\s+(\d{4})/);
  if (m && MONTHS[m[2].toLowerCase()]) return `${m[3]}-${pad(MONTHS[m[2].toLowerCase()])}-${pad(m[1])}`;
  m = s.match(/([A-Za-z]+)\.?\s+(\d{1,2}),?\s+(\d{4})/);
  if (m && MONTHS[m[1].toLowerCase()]) return `${m[3]}-${pad(MONTHS[m[1].toLowerCase()])}-${pad(m[2])}`;
  m = s.match(/(\d{4})-(\d{2})-(\d{2})/);
  if (m) return `${m[1]}-${m[2]}-${m[3]}`;
  m = s.match(/(\d{1,2})[-/](\d{1,2})[-/](\d{4})/);
  if (m) return `${m[3]}-${pad(m[2])}-${pad(m[1])}`;
  return null;
}
function findTime(s) {
  const m = s.match(/(\d{1,2})[:.](\d{2})/);
  return m ? `${pad(m[1])}:${m[2]}` : null;
}

// Looks for a label on a line and takes the rest of that line, or the next line if empty.
function after(lines, labelRe) {
  for (let i = 0; i < lines.length; i++) {
    const m = lines[i].match(labelRe);
    if (!m) continue;
    const rest = lines[i].slice(m.index + m[0].length).replace(/^[\s:.-]+/, '').trim();
    return rest || lines[i + 1] || '';
  }
  return '';
}

// Booking.com's printed confirmation lays check-in/out out as a table without a year:
//   CHECK-IN CHECK-OUT UNITS NIGHTS
//   ... 13 17 1 / 4        (day numbers, sometimes glued to the address line)
//   OCTOBER OCTOBER
//   Tuesday Saturday
//   15:00 - 23:30 07:00 - 10:00
function parseTableLayout(lines, text) {
  const h = lines.findIndex((l) => (/\bcheck-?\s?in\b/i.test(l) && /\bcheck-?\s?out\b/i.test(l)) || (/\binchecken\b/i.test(l) && /\buitchecken\b/i.test(l)));
  if (h < 0) return null;
  let days, months, times;
  for (const l of lines.slice(h + 1, h + 10)) {
    const d = l.match(/(\d{1,2})\s+(\d{1,2})\s+\d+\s*\/\s*\d+\s*$/) || l.match(/^(\d{1,2})\s+(\d{1,2})$/);
    if (d && !days) days = [+d[1], +d[2]];
    const toks = l.trim().split(/\s+/);
    if (toks.length === 2 && MONTHS[toks[0].toLowerCase()] && MONTHS[toks[1].toLowerCase()]) months = [MONTHS[toks[0].toLowerCase()], MONTHS[toks[1].toLowerCase()]];
    const t = l.match(/(\d{1,2}:\d{2})\s*-\s*(\d{1,2}:\d{2})\s+(\d{1,2}:\d{2})\s*-\s*(\d{1,2}:\d{2})/) || l.match(/^(\d{1,2}:\d{2})\s+()()(\d{1,2}:\d{2})$/);
    if (t && !times) times = [t[1], t[4]];
  }
  if (!days || !months) return null;
  // The year is not in the table; the cancellation policy dates usually carry it.
  const freq = {};
  for (const m of text.matchAll(/\b(20\d{2})\b/g)) freq[m[1]] = (freq[m[1]] || 0) + 1;
  const y1 = Object.keys(freq).length ? +Object.entries(freq).sort((a, b) => b[1] - a[1])[0][0] : new Date().getFullYear();
  const y2 = months[1] < months[0] ? y1 + 1 : y1;
  return {
    starts_at: `${y1}-${pad(months[0])}-${pad(days[0])}T${times?.[0] || '15:00'}:00`,
    ends_at: `${y2}-${pad(months[1])}-${pad(days[1])}T${times?.[1] || '11:00'}:00`,
  };
}

export function parseBookingText(lines) {
  const text = lines.join('\n');
  const out = { kind: 'stay', all_day: false };
  const table = parseTableLayout(lines, text);

  // Confirmation number and PIN
  const conf = text.match(/(?:confirmation (?:number|no\.?)|booking (?:number|no\.?)|bevestigingsnummer|boekingsnummer)\s*[:#]?\s*([\d][\d.\s-]{6,})/i);
  // The confirmation number is left out on purpose: for any change you need the Booking.com app anyway.

  // Check-in / check-out: the date (and time) usually follow the label on the same or next line.
  const inLine = after(lines, /\b(?:check-?\s?in|inchecken|aankomst)\b/i);
  const outLine = after(lines, /\b(?:check-?\s?out|uitchecken|vertrek)\b/i);
  const inDate = findDate(inLine) || findDate(text.slice(text.search(/check-?\s?in|inchecken/i)));
  const outDate = findDate(outLine) || findDate(text.slice(text.search(/check-?\s?out|uitchecken/i)));
  const inTime = findTime(inLine) || '15:00';
  const outTime = findTime(outLine) || '11:00';
  if (table) { out.starts_at = table.starts_at; out.ends_at = table.ends_at; }
  else {
    if (inDate) out.starts_at = `${inDate}T${inTime}:00`;
    if (outDate) out.ends_at = `${outDate}T${outTime}:00`;
  }

  // Property name: Booking.com PDFs put it as its own prominent line near the top, before the address.
  const skip = /booking\.com|confirmation|bevestiging|your booking|je boeking|check-?in|check-?out|pin|number|nummer|reservation|reservering|print|^\d|@|http|total|totaal|price|prijs|guest|gast|room|kamer|nights?|nachten|dear|beste/i;
  const addrIdx = lines.findIndex((l) => /\b(?:address|adres)\b/i.test(l));
  const candidates = (addrIdx > 0 ? lines.slice(0, addrIdx) : lines.slice(0, 12)).filter((l) => l.length > 3 && l.length < 80 && !skip.test(l));
  out.title = candidates[candidates.length - 1] || candidates[0] || 'Accommodation';

  const address = after(lines, /\b(?:address|adres)\b/i);
  if (address) {
    out.address = address
      .replace(/\s*(?:phone|telefoon|tel)\b.*$/i, '')
      .replace(/\s+\d{1,2}\s+\d{1,2}\s+\d+\s*\/\s*\d+\s*$/, '') // table day numbers glued to the address line
      .trim();
  }

  const phone = text.match(/(?:phone|telefoon|tel\.?)\s*[:#]?\s*(\+?[\d][\d\s()-]{7,})/i);
  const price = text.match(/(?:total price|final price|totaalprijs|totale prijs|total|price|prijs)\s*[:#]?\s*((?:€|EUR)\s?[\d.,]+|[\d.,]+\s?(?:EUR|€))/i);
  const guests = text.match(/(?:number of guests|aantal gasten)\s*:?\s*([^\n]+)/i);
  const room = lines.find((l, i) => i > 0 && /^(?:prepayment|vooruitbetaling)/i.test(lines[i + 1] || '') && l.length < 60 && !/:/.test(l));

  // One fact per line; the app shows these as separate lines with tappable phone numbers.
  const notes = [];
  if (room) notes.push(`Room: ${room.trim()}`);
  if (guests) notes.push(`Guests: ${guests[1].trim()}`);
  if (phone) notes.push(`Property phone: ${phone[1].trim()}`);
  if (price) notes.push(`Price: ${price[1].trim()}`);
  out.notes = notes.join('\n') || null;

  out.found = !!(inDate || conf);
  return out;
}
