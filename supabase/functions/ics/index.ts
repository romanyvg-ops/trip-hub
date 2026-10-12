// Trip Hub calendar feed.
// GET /functions/v1/ics?token=<trip ical_token>  ->  text/calendar
// Subscribe to this URL once in Google Calendar / iPhone Calendar and every
// flight, stay and activity in the trip shows up and stays in sync.

import { createClient } from "npm:@supabase/supabase-js@2.45.4";

const KIND_PREFIX: Record<string, string> = {
  flight: "✈️", train: "🚆", bus: "🚌", ferry: "⛴️", car: "🚗",
  stay: "🏠", activity: "🎟️", food: "🍽️", note: "📝", other: "📌",
};

type Item = {
  id: string; kind: string; title: string;
  starts_at: string | null; ends_at: string | null; all_day: boolean;
  location: string | null; address: string | null; url: string | null;
  booking_ref: string | null; notes: string | null; updated_at: string;
};

function esc(s: string): string {
  return s.replace(/\\/g, "\\\\").replace(/;/g, "\\;").replace(/,/g, "\\,").replace(/\r?\n/g, "\\n");
}

// RFC 5545: lines longer than 75 octets must be folded with CRLF + space.
function fold(line: string): string {
  const enc = new TextEncoder();
  const out: string[] = [];
  let cur = "";
  for (const ch of line) {
    if (enc.encode(cur + ch).length > 73) { out.push(cur); cur = " " + ch; } else { cur += ch; }
  }
  out.push(cur);
  return out.join("\r\n");
}

// "2026-10-12T10:00:00" -> "20261012T100000" (floating local time, no timezone)
const dt = (s: string) => s.slice(0, 19).replace(/[-:]/g, "");
// "2026-10-12..." -> "20261012"
const d = (s: string) => s.slice(0, 10).replace(/-/g, "");

function addDays(s: string, n: number): string {
  const x = new Date(s.slice(0, 10) + "T00:00:00Z");
  x.setUTCDate(x.getUTCDate() + n);
  return x.toISOString().slice(0, 10);
}
function addHours(s: string, n: number): string {
  const x = new Date(s.slice(0, 19) + "Z");
  x.setUTCHours(x.getUTCHours() + n);
  return x.toISOString().slice(0, 19);
}
const stampUtc = (s?: string) => (s ? new Date(s) : new Date()).toISOString().replace(/[-:]/g, "").slice(0, 15) + "Z";

function event(it: Item): string[] {
  const lines: string[] = ["BEGIN:VEVENT", `UID:${it.id}@trip-hub`, `DTSTAMP:${stampUtc()}`, `LAST-MODIFIED:${stampUtc(it.updated_at)}`];
  const start = it.starts_at!;
  const isStay = it.kind === "stay";

  if (isStay || it.all_day) {
    // All-day block. Stays run from check-in date to check-out date.
    const endDate = it.ends_at ?? start;
    lines.push(`DTSTART;VALUE=DATE:${d(start)}`);
    // DTEND is exclusive for all-day events.
    lines.push(`DTEND;VALUE=DATE:${d(addDays(endDate, 1))}`);
  } else {
    lines.push(`DTSTART:${dt(start)}`);
    lines.push(`DTEND:${dt(it.ends_at ?? addHours(start, 1))}`);
  }

  lines.push(`SUMMARY:${esc(`${KIND_PREFIX[it.kind] ?? ""} ${it.title}`.trim())}`);

  const loc = [it.location, it.address].filter(Boolean).join(", ");
  if (loc) lines.push(`LOCATION:${esc(loc)}`);

  const desc: string[] = [];
  if (isStay && it.starts_at && it.ends_at && !it.all_day) {
    desc.push(`Check-in ${it.starts_at.slice(11, 16)}, check-out ${it.ends_at.slice(11, 16)}`);
  }
  if (it.booking_ref) desc.push(`Booking ref: ${it.booking_ref}`);
  if (it.notes) desc.push(it.notes);
  if (it.url) { desc.push(it.url); lines.push(`URL:${esc(it.url)}`); }
  if (desc.length) lines.push(`DESCRIPTION:${esc(desc.join("\n"))}`);

  lines.push("END:VEVENT");
  return lines;
}

Deno.serve(async (req) => {
  const token = new URL(req.url).searchParams.get("token");
  if (!token) return new Response("Missing token", { status: 400 });

  const sb = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

  const { data: trip } = await sb.from("trips").select("id,name,destination").eq("ical_token", token).maybeSingle();
  if (!trip) return new Response("Not found", { status: 404 });

  const { data: items } = await sb.from("items").select("*")
    .eq("trip_id", trip.id).not("starts_at", "is", null).order("starts_at");

  const name = trip.destination ? `${trip.name} · ${trip.destination}` : trip.name;
  const lines = [
    "BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//Trip Hub//EN", "CALSCALE:GREGORIAN", "METHOD:PUBLISH",
    `X-WR-CALNAME:${esc(name)}`, "X-PUBLISHED-TTL:PT1H", "REFRESH-INTERVAL;VALUE=DURATION:PT1H",
  ];
  for (const it of (items ?? []) as Item[]) lines.push(...event(it));
  lines.push("END:VCALENDAR");

  const body = lines.map(fold).join("\r\n") + "\r\n";
  const slug = trip.name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "trip";
  return new Response(body, {
    headers: {
      "Content-Type": "text/calendar; charset=utf-8",
      "Content-Disposition": `inline; filename="${slug}.ics"`,
      "Cache-Control": "no-cache",
      "Access-Control-Allow-Origin": "*",
    },
  });
});
