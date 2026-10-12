// Demo mode: open the app with ?demo in the URL to try it with sample data and no backend.
// Everything lives in memory and disappears on reload. Nothing here is used in normal mode.

const uid = () => crypto.randomUUID();
const now = () => new Date().toISOString();

export function createDemoClient() {
  const me = { id: 'u-romany', email: 'romany@example.com' };
  const db = {
    profiles: [
      { id: 'u-romany', display_name: 'Romany' },
      { id: 'u-lisa', display_name: 'Lisa' },
      { id: 'u-tom', display_name: 'Tom' },
    ],
    trips: [{
      id: 't-madeira', name: 'Madeira with the gang', destination: 'Madeira, Portugal', emoji: '🌋',
      start_date: '2026-11-12', end_date: '2026-11-19', currency: 'EUR',
      notes: null, invite_code: '3f9a1c2b7d4e', ical_token: 'demo-token', created_by: 'u-romany', created_at: now(),
    }, {
      id: 't-berlin', name: 'Berlin weekend', destination: 'Berlin', emoji: '🍺',
      start_date: '2027-03-05', end_date: '2027-03-07', currency: 'EUR', notes: null,
      invite_code: 'b7e2d9a14c03', ical_token: 'demo-token-2', created_by: 'u-lisa', created_at: now(),
    }],
    trip_members: [
      { trip_id: 't-madeira', user_id: 'u-romany', role: 'owner' },
      { trip_id: 't-madeira', user_id: 'u-lisa', role: 'member' },
      { trip_id: 't-madeira', user_id: 'u-tom', role: 'member' },
      { trip_id: 't-berlin', user_id: 'u-lisa', role: 'owner' },
      { trip_id: 't-berlin', user_id: 'u-romany', role: 'member' },
    ],
    items: [
      { id: 'i1', trip_id: 't-madeira', kind: 'flight', title: 'KL 1693 Amsterdam → Funchal', starts_at: '2026-11-12T09:40:00', ends_at: '2026-11-12T12:35:00', all_day: false, location: 'Schiphol, gate D7', address: null, url: null, booking_ref: 'X7K9PQ', notes: 'Be at the airport by 07:30. Tom has the car.', created_by: 'u-romany' },
      { id: 'i2', trip_id: 't-madeira', kind: 'car', title: 'Rental car pick-up', starts_at: '2026-11-12T13:15:00', ends_at: null, all_day: false, location: 'Funchal airport, Guerin desk', address: null, url: null, booking_ref: 'GR-558112', notes: null, created_by: 'u-tom' },
      { id: 'i3', trip_id: 't-madeira', kind: 'stay', title: 'Casa da Levada', starts_at: '2026-11-12T15:00:00', ends_at: '2026-11-19T11:00:00', all_day: false, location: 'Ponta do Sol', address: 'Caminho da Levada 14, 9360-123 Ponta do Sol', url: 'https://www.airbnb.com/rooms/example', booking_ref: 'HMABC123', notes: 'Door code 4471#. Keys in the box by the gate.', created_by: 'u-lisa' },
      { id: 'i4', trip_id: 't-madeira', kind: 'activity', title: 'Levada das 25 Fontes hike', starts_at: '2026-11-14T08:30:00', ends_at: '2026-11-14T13:00:00', all_day: false, location: 'Rabaçal car park', address: null, url: 'https://www.komoot.com/tour/example', booking_ref: null, notes: 'Bring layers, it gets cold up there.', created_by: 'u-romany' },
      { id: 'i5', trip_id: 't-madeira', kind: 'food', title: 'Dinner at Taberna Ruel', starts_at: '2026-11-14T19:30:00', ends_at: null, all_day: false, location: 'Funchal old town', address: null, url: null, booking_ref: null, notes: 'Table for 3 under Lisa.', created_by: 'u-lisa' },
      { id: 'i6', trip_id: 't-madeira', kind: 'activity', title: 'Rest day at the beach', starts_at: '2026-11-16T00:00:00', ends_at: null, all_day: true, location: 'Seixal', address: null, url: null, booking_ref: null, notes: null, created_by: 'u-tom' },
      { id: 'i7', trip_id: 't-madeira', kind: 'flight', title: 'KL 1694 Funchal → Amsterdam', starts_at: '2026-11-19T13:30:00', ends_at: '2026-11-19T18:10:00', all_day: false, location: 'Funchal airport', address: null, url: null, booking_ref: 'X7K9PQ', notes: null, created_by: 'u-romany' },
      { id: 'i8', trip_id: 't-madeira', kind: 'note', title: 'Still to book: whale watching', starts_at: null, ends_at: null, all_day: false, location: null, address: null, url: null, booking_ref: null, notes: 'Lisa is checking prices.', created_by: 'u-lisa' },
    ],
    attachments: [
      { id: 'a1', item_id: 'i1', trip_id: 't-madeira', path: 'demo/boarding-pass.pdf', filename: 'boarding-pass-romany.pdf', size: 184000, uploaded_by: 'u-romany' },
      { id: 'a2', item_id: 'i3', trip_id: 't-madeira', path: 'demo/airbnb.pdf', filename: 'airbnb-confirmation.pdf', size: 92000, uploaded_by: 'u-lisa' },
    ],
    expenses: [
      { id: 'e1', trip_id: 't-madeira', title: 'Airbnb deposit', amount: '420.00', paid_by: 'u-lisa', split_with: ['u-romany', 'u-lisa', 'u-tom'], spent_on: '2026-10-02', is_settlement: false, notes: null, created_by: 'u-lisa' },
      { id: 'e2', trip_id: 't-madeira', title: 'Rental car (week)', amount: '312.00', paid_by: 'u-tom', split_with: ['u-romany', 'u-lisa', 'u-tom'], spent_on: '2026-11-12', is_settlement: false, notes: null, created_by: 'u-tom' },
      { id: 'e3', trip_id: 't-madeira', title: 'Groceries', amount: '63.40', paid_by: 'u-romany', split_with: ['u-romany', 'u-lisa', 'u-tom'], spent_on: '2026-11-13', is_settlement: false, notes: 'Pingo Doce', created_by: 'u-romany' },
      { id: 'e4', trip_id: 't-madeira', title: 'Dinner Taberna Ruel', amount: '98.50', paid_by: 'u-romany', split_with: ['u-romany', 'u-lisa'], spent_on: '2026-11-14', is_settlement: false, notes: 'Tom skipped dinner', created_by: 'u-romany' },
    ],
    links: [
      { id: 'l0', trip_id: 't-madeira', category: 'drive', label: 'Trip photos (Drive)', url: 'https://drive.google.com/drive/folders/1A2b3C4d5E6f7G8h9I0jKLMNOPqrstuv?usp=sharing', created_by: 'u-tom' },
      { id: 'l1', trip_id: 't-madeira', category: 'photos', label: 'Shared album (Google Photos)', url: 'https://photos.app.goo.gl/example', created_by: 'u-romany' },
      { id: 'l2', trip_id: 't-madeira', category: 'route', label: '25 Fontes on Komoot', url: 'https://www.komoot.com/tour/example', created_by: 'u-romany' },
      { id: 'l3', trip_id: 't-madeira', category: 'map', label: 'Our saved places', url: 'https://maps.app.goo.gl/example', created_by: 'u-tom' },
    ],
  };
  for (const t of Object.values(db)) for (const r of t) r.created_at ??= now(), r.updated_at ??= now();
  const files = new Map();

  const profile = (id) => db.profiles.find((p) => p.id === id) || null;
  const embed = (table, row, select) => {
    const out = { ...row };
    if (table === 'trips' && /trip_members\(/.test(select)) {
      const ms = db.trip_members.filter((m) => m.trip_id === row.id);
      out.trip_members = /count/.test(select) ? [{ count: ms.length }] : ms.map((m) => ({ ...m, profiles: profile(m.user_id) }));
    }
    if (table === 'items' && /attachments\(/.test(select)) out.attachments = db.attachments.filter((a) => a.item_id === row.id);
    if (/profiles\(/.test(select)) out.profiles = profile(row.created_by);
    return out;
  };
  const cascade = (table, row) => {
    if (table !== 'trips') return;
    for (const t of ['items', 'attachments', 'links', 'trip_members']) db[t] = db[t].filter((r) => r.trip_id !== row.id);
  };

  function from(table) {
    const q = { op: 'select', select: '*', filters: [], orders: [], mode: 'many', payload: null };
    const run = () => {
      let rows = db[table].filter((r) => q.filters.every((f) => f(r)));
      if (q.op === 'insert') {
        rows = [];
        for (const p of Array.isArray(q.payload) ? q.payload : [q.payload]) {
          const row = { id: uid(), created_by: me.id, created_at: now(), updated_at: now(), ...p };
          if (table === 'trips') { row.invite_code ??= uid().slice(0, 12); row.ical_token ??= uid(); row.emoji ??= '🧳'; }
          db[table].push(row);
          if (table === 'trips') db.trip_members.push({ trip_id: row.id, user_id: me.id, role: 'owner', joined_at: now() });
          rows.push(row);
        }
      } else if (q.op === 'update') {
        for (const r of rows) Object.assign(r, q.payload, { updated_at: now() });
      } else if (q.op === 'delete') {
        for (const r of rows) cascade(table, r);
        db[table] = db[table].filter((r) => !rows.includes(r));
      }
      for (const { col, asc, nullsFirst } of [...q.orders].reverse()) {
        rows.sort((a, b) => {
          const x = a[col], y = b[col];
          if (x == null && y == null) return 0;
          if (x == null) return nullsFirst ? -1 : 1;
          if (y == null) return nullsFirst ? 1 : -1;
          return (x < y ? -1 : x > y ? 1 : 0) * (asc ? 1 : -1);
        });
      }
      let data = rows.map((r) => embed(table, r, q.select));
      if (q.mode === 'single' || q.mode === 'maybe') data = data[0] ?? null;
      if (q.mode === 'single' && !data) return { data: null, error: { message: 'Row not found' } };
      return { data, error: null };
    };
    const b = {
      select(s = '*') { if (q.op === 'select') q.select = s; else q.select = s; return b; },
      insert(p) { q.op = 'insert'; q.payload = p; return b; },
      update(p) { q.op = 'update'; q.payload = p; return b; },
      delete() { q.op = 'delete'; return b; },
      eq(col, val) { q.filters.push((r) => r[col] === val); return b; },
      not(col, op, val) { if (op === 'is' && val === null) q.filters.push((r) => r[col] != null); return b; },
      order(col, o = {}) { q.orders.push({ col, asc: o.ascending !== false, nullsFirst: !!o.nullsFirst }); return b; },
      single() { q.mode = 'single'; return b; },
      maybeSingle() { q.mode = 'maybe'; return b; },
      then(res, rej) { return Promise.resolve(run()).then(res, rej); },
    };
    return b;
  }

  return {
    auth: {
      async getSession() { return { data: { session: { user: me } } }; },
      onAuthStateChange() { return { data: { subscription: { unsubscribe() {} } } }; },
      async signInWithOtp() { return { error: null }; },
      async signOut() { alert('Demo mode: sign-out does nothing. Remove ?demo from the address to use the real app.'); return { error: null }; },
    },
    from,
    async rpc(name, args) {
      if (name !== 'join_trip') return { data: null, error: { message: 'unknown function' } };
      const t = db.trips.find((x) => x.invite_code === String(args.code).trim().toLowerCase());
      if (!t) return { data: null, error: { message: 'Invalid invite code' } };
      if (!db.trip_members.some((m) => m.trip_id === t.id && m.user_id === me.id)) db.trip_members.push({ trip_id: t.id, user_id: me.id, role: 'member', joined_at: now() });
      return { data: t.id, error: null };
    },
    storage: {
      from() {
        return {
          async upload(path, file) { files.set(path, URL.createObjectURL(file)); return { data: { path }, error: null }; },
          async createSignedUrl(path) {
            const url = files.get(path) || 'data:text/plain,' + encodeURIComponent('Demo file: ' + path);
            return { data: { signedUrl: url }, error: null };
          },
          async remove(paths) { paths.forEach((p) => files.delete(p)); return { error: null }; },
          async list() { return { data: [], error: null }; },
        };
      },
    },
    channel() { const c = { on() { return c; }, subscribe() { return c; }, unsubscribe() {} }; return c; },
  };
}
