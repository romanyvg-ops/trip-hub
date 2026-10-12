// "Things to do" for a place: Wikivoyage's See / Do / Eat / Drink sections (free, no key, CC BY-SA),
// plus a pointer to an Impactful Travels guide when the destination has one.
// One request per place (the whole page), cached for a week, so Wikivoyage's rate limit is never an issue.

const API = 'https://en.wikivoyage.org/w/api.php';
const SECTIONS = ['See', 'Do', 'Eat', 'Drink'];
const NEARBY_FROM = ['See', 'Do', 'Go next', 'Understand'];
const MAX_LISTINGS = 30;

// Impactful Travels guides, matched on words in the trip destination or stay towns.
const GUIDES = [
  { slug: 'madeira', name: 'Madeira', words: ['madeira', 'funchal'] },
  { slug: 'south-africa', name: 'South Africa', words: ['south africa', 'cape town', 'kruger', 'johannesburg', 'garden route'] },
  { slug: 'albania', name: 'Albania', words: ['albania', 'tirana', 'saranda', 'ksamil'] },
  { slug: 'greek-islands', name: 'Greek islands', words: ['greek', 'greece', 'crete', 'santorini', 'naxos', 'paros', 'milos', 'corfu'] },
  { slug: 'zakynthos', name: 'Zakynthos', words: ['zakynthos', 'zante'] },
  { slug: 'iceland', name: 'Iceland', words: ['iceland', 'reykjav'] },
  { slug: 'netherlands', name: 'The Netherlands', words: ['netherlands', 'holland', 'amsterdam'] },
  { slug: 'norway', name: 'Norway', words: ['norway', 'oslo', 'bergen', 'lofoten'] },
  { slug: 'thailand', name: 'Thailand', words: ['thailand', 'bangkok', 'chiang mai', 'phuket', 'krabi'] },
];
export function matchGuides(texts) {
  const hay = texts.filter(Boolean).join(' ').toLowerCase();
  return GUIDES.filter((g) => g.words.some((w) => hay.includes(w)))
    .map((g) => ({ ...g, url: `https://impactfultravels.com/destinations/${g.slug}.html` }));
}

function cached(key, maxAgeMs) {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return null;
    const { t, v } = JSON.parse(raw);
    return Date.now() - t < maxAgeMs ? v : null;
  } catch { return null; }
}
function store(key, v) { try { localStorage.setItem(key, JSON.stringify({ t: Date.now(), v })); } catch {} }

// Requests go one at a time, a beat apart, so a burst never trips Wikivoyage's limit.
let queue = Promise.resolve();
function api(params) {
  const run = async () => {
    const url = `${API}?${new URLSearchParams({ format: 'json', origin: '*', ...params })}`;
    const res = await fetch(url);
    const text = await res.text();
    try { return JSON.parse(text); } catch { throw new Error(/too many requests/i.test(text) ? 'Wikivoyage is busy, try again in a minute' : 'Wikivoyage is not answering'); }
  };
  const p = queue.then(run);
  queue = p.catch(() => {}).then(() => new Promise((r) => setTimeout(r, 400)));
  return p;
}

const clean = (s) => (s || '').replace(/\[\d+\]/g, '').replace(/\s+/g, ' ').trim();

// The nodes of one top-level section: everything between its heading and the next one.
function sectionNodes(doc, name) {
  const headings = [...doc.querySelectorAll('h2')];
  const h = headings.find((x) => clean(x.textContent).toLowerCase() === name.toLowerCase());
  if (!h) return null;
  // Newer pages wrap the heading in <div class="mw-heading">; walk from that wrapper.
  let node = h.closest('.mw-heading') || h;
  const out = [];
  for (node = node.nextSibling; node; node = node.nextSibling) {
    if (node.nodeType !== 1) continue;
    if (node.matches('h2') || node.querySelector?.(':scope > h2') || node.matches('.mw-heading2')) break;
    out.push(node);
  }
  return out;
}

function listingsFrom(nodes) {
  const frag = document.createElement('div');
  nodes.forEach((n) => frag.appendChild(n.cloneNode(true)));
  frag.querySelectorAll('.mw-editsection, sup, style, script, .noprint, .listing-metadata').forEach((n) => n.remove());

  // Structured listings first.
  let listings = [...frag.querySelectorAll('.vcard')].map((el) => {
    const name = clean(el.querySelector('.listing-name, .fn')?.textContent);
    const address = clean(el.querySelector('.listing-address, .adr')?.textContent);
    const content = clean(el.querySelector('.listing-content, .note')?.textContent);
    const lat = el.querySelector('.latitude')?.textContent || el.getAttribute('data-latitude');
    const lon = el.querySelector('.longitude')?.textContent || el.getAttribute('data-longitude');
    return name ? { name, address, desc: content, lat: lat ? +lat : null, lon: lon ? +lon : null } : null;
  }).filter(Boolean);

  // Otherwise bullet points: "Name - description" or "Name. Description".
  if (!listings.length) {
    listings = [...frag.querySelectorAll('li')].map((li) => {
      const text = clean(li.textContent);
      if (text.length < 4) return null;
      const bold = clean(li.querySelector(':scope > b, :scope > a, :scope > span > b')?.textContent);
      let name = bold, desc = '';
      if (name && text.startsWith(name)) desc = text.slice(name.length).replace(/^[\s:,.–-]+/, '');
      else {
        const m = text.match(/^(.{3,70}?)\s[-–—:]\s(.*)$/) || text.match(/^([^.]{3,70})\.\s+(.*)$/);
        if (m) { name = m[1]; desc = m[2]; } else { name = text.length > 70 ? text.slice(0, 67) + '…' : text; }
      }
      return { name, address: '', desc, lat: null, lon: null };
    }).filter(Boolean);
  }
  listings = listings.slice(0, MAX_LISTINGS).map((l) => ({ ...l, desc: l.desc.length > 260 ? l.desc.slice(0, 257) + '…' : l.desc }));

  const text = listings.length ? '' : clean([...frag.querySelectorAll('p')].map((p) => p.textContent).join(' ')).slice(0, 1200);
  return { listings, text };
}

// Other Wikivoyage destinations the page points to (parks, nearby towns), from See / Do / Go next.
function nearbyFrom(doc, selfTitle) {
  const seen = new Set();
  const out = [];
  for (const name of NEARBY_FROM) {
    for (const node of sectionNodes(doc, name) || []) {
      for (const a of node.querySelectorAll('a[href^="/wiki/"]')) {
        const title = decodeURIComponent(a.getAttribute('href').slice(6).split('#')[0]).replace(/_/g, ' ');
        if (!title || title.includes(':') || title === selfTitle || seen.has(title)) continue;
        if (a.classList.contains('new') || /^(List of|UNESCO|World Heritage)/i.test(title)) continue;
        seen.add(title);
        out.push(title);
      }
    }
  }
  return out.slice(0, 6);
}

// { title, url, sections: [{ name, listings, text }], nearby: [titles] }  (remembered for 7 days)
export async function thingsToDo(place) {
  const key = 'wv2:' + place.toLowerCase();
  const hit = cached(key, 7 * 86400000);
  if (hit) return hit;

  let page = await api({ action: 'parse', page: place, redirects: 1, prop: 'text|displaytitle', disabletoc: 1 });
  if (page.error) {
    const s = await api({ action: 'query', list: 'search', srsearch: place, srlimit: 1 });
    const title = s.query?.search?.[0]?.title;
    if (!title) return null;
    page = await api({ action: 'parse', page: title, redirects: 1, prop: 'text|displaytitle', disabletoc: 1 });
    if (page.error) return null;
  }
  const title = page.parse.title;
  const doc = new DOMParser().parseFromString(page.parse.text['*'], 'text/html');
  const sections = SECTIONS.map((name) => {
    const nodes = sectionNodes(doc, name);
    return nodes ? { name, ...listingsFrom(nodes) } : null;
  }).filter((s) => s && (s.listings.length || s.text));
  const out = { title, url: `https://en.wikivoyage.org/wiki/${encodeURIComponent(title.replace(/ /g, '_'))}`, sections, nearby: nearbyFrom(doc, title) };
  store(key, out);
  return out;
}
