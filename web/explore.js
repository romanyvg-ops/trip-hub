// "Things to do" for a place: Wikivoyage's See / Do / Eat / Drink sections (free, no key, CC BY-SA),
// plus a pointer to an Impactful Travels guide when the destination has one.

const API = 'https://en.wikivoyage.org/w/api.php';
const SECTIONS = ['See', 'Do', 'Eat', 'Drink'];
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

async function api(params) {
  const url = `${API}?${new URLSearchParams({ format: 'json', origin: '*', ...params })}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error('Wikivoyage is not answering');
  return res.json();
}

// Finds the Wikivoyage page for a place name, following redirects or falling back to search.
async function resolveTitle(place) {
  const q = await api({ action: 'query', titles: place, redirects: 1 });
  const page = Object.values(q.query?.pages || {})[0];
  if (page && !('missing' in page)) return page.title;
  const s = await api({ action: 'query', list: 'search', srsearch: place, srlimit: 1 });
  return s.query?.search?.[0]?.title || null;
}

const clean = (s) => (s || '').replace(/\[\d+\]/g, '').replace(/\s+/g, ' ').trim();

function parseSection(html) {
  const doc = new DOMParser().parseFromString(html, 'text/html');
  doc.querySelectorAll('.mw-editsection, sup, style, script, .noprint').forEach((n) => n.remove());
  const listings = [...doc.querySelectorAll('.vcard')].slice(0, MAX_LISTINGS).map((el) => {
    const name = clean(el.querySelector('.listing-name, .fn')?.textContent);
    const address = clean(el.querySelector('.listing-address, .adr')?.textContent);
    const content = clean(el.querySelector('.listing-content, .note')?.textContent);
    const lat = el.querySelector('.latitude')?.textContent || el.getAttribute('data-latitude');
    const lon = el.querySelector('.longitude')?.textContent || el.getAttribute('data-longitude');
    return name ? { name, address, desc: content.length > 240 ? content.slice(0, 237) + '…' : content, lat: lat ? +lat : null, lon: lon ? +lon : null } : null;
  }).filter(Boolean);
  const text = listings.length ? '' : clean([...doc.querySelectorAll('p')].map((p) => p.textContent).join(' ')).slice(0, 700);
  return { listings, text };
}

// { title, url, sections: [{ name, listings, text }] }  (remembered for 7 days)
export async function thingsToDo(place) {
  const key = 'wv:' + place.toLowerCase();
  const hit = cached(key, 7 * 86400000);
  if (hit) return hit;
  const title = await resolveTitle(place);
  if (!title) return null;
  const parsed = await api({ action: 'parse', page: title, prop: 'sections', redirects: 1 });
  const all = parsed.parse?.sections || [];
  const wanted = SECTIONS.map((name) => all.find((s) => s.toclevel === 1 && s.line.toLowerCase() === name.toLowerCase())).filter(Boolean);
  const sections = await Promise.all(wanted.map(async (s) => {
    const r = await api({ action: 'parse', page: title, section: s.index, prop: 'text', disabletoc: 1 });
    return { name: s.line, ...parseSection(r.parse?.text?.['*'] || '') };
  }));
  const out = { title, url: `https://en.wikivoyage.org/wiki/${encodeURIComponent(title.replace(/ /g, '_'))}`, sections: sections.filter((s) => s.listings.length || s.text) };
  store(key, out);
  return out;
}
