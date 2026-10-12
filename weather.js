// Daily weather per place from Open-Meteo (free, no key). Results are cached in the browser.

const WMO = [
  [0, '☀️', 'Clear'], [1, '🌤️', 'Mostly clear'], [2, '⛅', 'Partly cloudy'], [3, '☁️', 'Overcast'],
  [45, '🌫️', 'Fog'], [48, '🌫️', 'Fog'],
  [51, '🌦️', 'Light drizzle'], [53, '🌦️', 'Drizzle'], [55, '🌧️', 'Heavy drizzle'], [56, '🌧️', 'Freezing drizzle'], [57, '🌧️', 'Freezing drizzle'],
  [61, '🌦️', 'Light rain'], [63, '🌧️', 'Rain'], [65, '🌧️', 'Heavy rain'], [66, '🌧️', 'Freezing rain'], [67, '🌧️', 'Freezing rain'],
  [71, '🌨️', 'Light snow'], [73, '🌨️', 'Snow'], [75, '❄️', 'Heavy snow'], [77, '🌨️', 'Snow grains'],
  [80, '🌦️', 'Showers'], [81, '🌧️', 'Showers'], [82, '⛈️', 'Heavy showers'], [85, '🌨️', 'Snow showers'], [86, '🌨️', 'Snow showers'],
  [95, '⛈️', 'Thunderstorm'], [96, '⛈️', 'Thunderstorm with hail'], [99, '⛈️', 'Thunderstorm with hail'],
];
export function describe(code) {
  const hit = WMO.find(([c]) => c === code) || ['', '🌡️', ''];
  return { icon: hit[1], label: hit[2] };
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

// "Kotor" -> { lat, lon, name }  (remembered for 30 days)
export async function geocode(place) {
  const key = 'geo:' + place.toLowerCase();
  const hit = cached(key, 30 * 86400000);
  if (hit) return hit;
  const url = `https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(place)}&count=1&language=en&format=json`;
  const res = await fetch(url);
  if (!res.ok) throw new Error('geocoding failed');
  const data = await res.json();
  const r = data.results?.[0];
  if (!r) return null;
  const out = { lat: r.latitude, lon: r.longitude, name: r.name };
  store(key, out);
  return out;
}

// { 'YYYY-MM-DD': { code, max, min, rain } } for the next 16 days  (remembered for 1 hour)
export async function forecast(lat, lon) {
  const key = `wx:${lat.toFixed(2)},${lon.toFixed(2)}`;
  const hit = cached(key, 3600000);
  if (hit) return hit;
  const url = `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}` +
    `&daily=weather_code,temperature_2m_max,temperature_2m_min,precipitation_probability_max&timezone=auto&forecast_days=16`;
  const res = await fetch(url);
  if (!res.ok) throw new Error('forecast failed');
  const d = (await res.json()).daily;
  const out = {};
  d.time.forEach((date, i) => {
    out[date] = { code: d.weather_code[i], max: Math.round(d.temperature_2m_max[i]), min: Math.round(d.temperature_2m_min[i]), rain: d.precipitation_probability_max?.[i] ?? null };
  });
  store(key, out);
  return out;
}

// Convenience: weather for a list of { day, place } pairs -> { day: { ...forecast, place } }
export async function weatherForDays(pairs) {
  const byPlace = new Map();
  for (const { day, place } of pairs) {
    if (!place) continue;
    if (!byPlace.has(place)) byPlace.set(place, []);
    byPlace.get(place).push(day);
  }
  const result = {};
  await Promise.all([...byPlace.entries()].map(async ([place, days]) => {
    try {
      const geo = await geocode(place);
      if (!geo) return;
      const fc = await forecast(geo.lat, geo.lon);
      for (const day of days) if (fc[day]) result[day] = { ...fc[day], place: geo.name };
    } catch { /* no weather for this place; the itinerary still renders */ }
  }));
  return result;
}
