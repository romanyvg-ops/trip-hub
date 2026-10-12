# Trip Hub

A shared trip planner for you and your friends. Everyone signs in with an email link, joins a trip with an invite link, and adds their own flights, trains, stays, activities and tickets. The whole itinerary lands in everybody's phone calendar through one subscription, and photo albums and routes are linked from Google Photos, Google Maps, Komoot and the like.

It installs to the phone home screen as an app (no app store needed) and keeps the last-seen itinerary available offline.

## What is in here

```
trip-hub/
  web/                      the app: plain HTML, CSS and JavaScript, no build step
    index.html
    app.js                  all the logic
    style.css
    config.js               <- put your Supabase URL and anon key here
    manifest.json, sw.js    install-to-home-screen and offline support
    icon.svg, icon-*.png
  supabase/
    schema.sql              database tables, security rules, storage bucket
    functions/ics/index.ts  the calendar feed (one URL per trip)
    config.toml
```

The backend is [Supabase](https://supabase.com) (free tier is plenty for a group of friends). It gives us login, the database, file storage for tickets, and hosting for the calendar feed.

## One-time setup (about 20 minutes)

### 1. Create a Supabase project

1. Go to https://supabase.com, sign up, and click **New project**. Pick a name, a database password (save it somewhere), and the region closest to you (e.g. West EU).
2. Wait a minute for it to spin up.

### 2. Create the database

1. In the Supabase dashboard open **SQL Editor** → **New query**.
2. Paste the whole contents of `supabase/schema.sql` and click **Run**. It should finish with "Success".

That creates the tables, the security rules (only members of a trip can see it), the `attachments` storage bucket for tickets, and live updates.

### 3. Set the app address for sign-in links

1. Open **Authentication → URL Configuration**.
2. Set **Site URL** to where the app will live, e.g. `https://trips.impactfultravels.com/` (see step 6). While testing locally use `http://localhost:8766/`.
3. Under **Redirect URLs** add both the live address and `http://localhost:8766/**`.

Sign-in links are emailed by Supabase. The built-in mailer is limited to a few emails per hour, which is fine for a group of friends. If it ever gets in the way, **Authentication → SMTP Settings** lets you plug in your own mail service.

### 4. Put the keys in the app

1. Open **Project Settings → API**.
2. Copy the **Project URL** and the **anon public** key into `web/config.js`.

The anon key is meant to be public. The database rules decide who can see what.

### 5. Deploy the calendar feed

This is the only part that needs a terminal. It publishes the small function that turns a trip into a calendar subscription.

```bash
npm install -g supabase
```

```bash
supabase login
```

Then from the `trip-hub` folder, using the project reference from **Project Settings → General**:

```bash
supabase link --project-ref YOUR-PROJECT-REF
```

```bash
supabase functions deploy ics --no-verify-jwt
```

### 6. Put the app online

The `web` folder is plain static files, so it can go anywhere: the same host as the Impactful Travels site (a subfolder or a subdomain like `trips.`), Netlify, Cloudflare Pages or GitHub Pages. It must be served over `https` for the install-to-home-screen and offline features to work.

Then go back to step 3 and make sure the Site URL matches.

## Trying it locally first

From the `ImpactfulTravels` folder:

```bash
python -m http.server 8766 --bind 127.0.0.1 --directory trip-hub/web
```

Open http://localhost:8766. Sign in with your email, create a trip, add a flight, open "Add to calendar".

To see the app with sample data before doing any setup at all, open http://localhost:8766/?demo (or the "Try the demo" button on the setup screen). Demo changes live in memory only and vanish on reload.

## How friends use it

1. You create the trip and tap **Invite friends**. Send the link in the group chat.
2. Each friend opens the link, enters their email, taps the sign-in link they receive, and they're in.
3. On the phone: in Safari tap Share → **Add to Home Screen**; in Chrome on Android tap the menu → **Install app**. It then opens like a normal app.
4. Everyone taps **Add to calendar** once. iPhone users tap the subscribe button; Google Calendar users paste the link under *Add calendar → From URL* on a computer, and it syncs to their phone.
5. Anyone can add flights, stays, dinners and upload the PDF or screenshot of the ticket. Everyone's calendar updates on its own within about an hour.
   Faster: on the add form tap **Import from a calendar file** and pick the `.ics` file you get from Airbnb (Trips → reservation → Add to calendar), Booking.com (confirmation email → Add to calendar) or an airline. Title, dates, address and booking code are filled in for you to check.
6. Under **Photos**, link a Google Drive folder (shared as "Anyone with the link → Editor") or a Google Photos / iCloud shared album. A Drive folder shows its contents right inside the app; everyone adds their pictures there.
7. Whenever someone pays for the group, they add it under **Expenses**: what, how much, who paid, who shares it (equal split). The tab keeps a running balance per person and, at the end, lists the fewest payments that settle everyone up. Tap "Mark as paid" when the money has been sent. The trip owner sets the currency under Settings.

## Notes and limits

- Times are stored as "local time where you are": a 10:00 departure means 10:00 at the departure airport. That is what you want on a trip, and it is how the calendar shows it.
- Uploads are capped at 25 MB per file. Free Supabase storage is 1 GB, which holds a lot of tickets, but it is not for photos. Use a shared album for those.
- Anyone with the invite link can join. If a link leaks, the trip owner can remove people from **Settings**.
- The calendar link contains a secret token. Anyone with it can read the itinerary (not edit it). Share it only with the group.
- Deleting a trip removes it for everyone, including the uploaded files.
