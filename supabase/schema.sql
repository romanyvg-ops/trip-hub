-- Trip Hub database schema
-- Run this once in the Supabase SQL editor (Dashboard -> SQL Editor -> New query -> paste -> Run).

create extension if not exists pgcrypto;

-- ---------------------------------------------------------------------------
-- Profiles (one per signed-up user, created automatically)
-- ---------------------------------------------------------------------------
create table if not exists public.profiles (
  id uuid primary key references auth.users on delete cascade,
  display_name text,
  created_at timestamptz default now()
);

create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles (id, display_name)
  values (new.id, coalesce(new.raw_user_meta_data->>'display_name', split_part(new.email, '@', 1)))
  on conflict (id) do nothing;
  return new;
end $$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users for each row execute function public.handle_new_user();

-- ---------------------------------------------------------------------------
-- Trips
-- ---------------------------------------------------------------------------
create table if not exists public.trips (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  destination text,
  start_date date,
  end_date date,
  emoji text default '🧳',
  notes text,
  currency text not null default 'EUR',
  invite_code text unique not null default encode(gen_random_bytes(6), 'hex'),
  ical_token text unique not null default encode(gen_random_bytes(16), 'hex'),
  created_by uuid not null references public.profiles(id) default auth.uid(),
  created_at timestamptz default now()
);

create table if not exists public.trip_members (
  trip_id uuid references public.trips on delete cascade,
  user_id uuid references public.profiles(id) on delete cascade,
  role text not null default 'member' check (role in ('owner', 'member')),
  joined_at timestamptz default now(),
  primary key (trip_id, user_id)
);

-- Itinerary items: flights, trains, stays, activities, notes...
-- Times are stored WITHOUT a timezone on purpose: they mean "local time where you are".
create table if not exists public.items (
  id uuid primary key default gen_random_uuid(),
  trip_id uuid not null references public.trips on delete cascade,
  kind text not null check (kind in ('flight','train','bus','ferry','car','stay','activity','food','note','other')),
  title text not null,
  starts_at timestamp,
  ends_at timestamp,
  all_day boolean default false,
  location text,
  address text,
  url text,
  booking_ref text,
  notes text,
  created_by uuid not null references public.profiles(id) default auth.uid(),
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

-- Uploaded tickets / confirmations, stored in the "attachments" bucket.
create table if not exists public.attachments (
  id uuid primary key default gen_random_uuid(),
  item_id uuid not null references public.items on delete cascade,
  trip_id uuid not null references public.trips on delete cascade,
  path text not null,
  filename text not null,
  size bigint,
  uploaded_by uuid not null references public.profiles(id) default auth.uid(),
  created_at timestamptz default now()
);

-- Shared links: photo albums and Drive folders (Photos tab), routes, maps, documents (Links tab).
create table if not exists public.links (
  id uuid primary key default gen_random_uuid(),
  trip_id uuid not null references public.trips on delete cascade,
  label text not null,
  url text not null,
  category text default 'other' check (category in ('photos','drive','route','map','doc','other')),
  created_by uuid not null references public.profiles(id) default auth.uid(),
  created_at timestamptz default now()
);

-- Shared expenses, Splitwise-style. Amount is in the trip's currency.
-- paid_by paid the whole amount; it is split equally between everyone in split_with.
-- A settlement ("Lisa paid Romany back") is an expense with is_settlement = true,
-- paid_by = the person paying and split_with = [the person receiving].
create table if not exists public.expenses (
  id uuid primary key default gen_random_uuid(),
  trip_id uuid not null references public.trips on delete cascade,
  title text not null,
  amount numeric(12,2) not null check (amount > 0),
  paid_by uuid not null references public.profiles(id),
  split_with uuid[] not null check (cardinality(split_with) > 0),
  spent_on date not null default current_date,
  is_settlement boolean not null default false,
  notes text,
  created_by uuid not null references public.profiles(id) default auth.uid(),
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

create index if not exists items_trip_start on public.items (trip_id, starts_at);
create index if not exists expenses_trip on public.expenses (trip_id, spent_on);
create index if not exists attachments_item on public.attachments (item_id);
create index if not exists links_trip on public.links (trip_id);

-- ---------------------------------------------------------------------------
-- Helpers
-- ---------------------------------------------------------------------------
create or replace function public.is_trip_member(t uuid)
returns boolean language sql security definer stable set search_path = public as $$
  select exists (select 1 from public.trip_members where trip_id = t and user_id = auth.uid());
$$;

create or replace function public.is_trip_owner(t uuid)
returns boolean language sql security definer stable set search_path = public as $$
  select exists (select 1 from public.trips where id = t and created_by = auth.uid());
$$;

-- Creator automatically becomes the owner member of a new trip.
create or replace function public.add_trip_owner()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.trip_members (trip_id, user_id, role) values (new.id, new.created_by, 'owner')
  on conflict do nothing;
  return new;
end $$;

drop trigger if exists on_trip_created on public.trips;
create trigger on_trip_created
  after insert on public.trips for each row execute function public.add_trip_owner();

-- Join a trip with its invite code. Returns the trip id.
create or replace function public.join_trip(code text)
returns uuid language plpgsql security definer set search_path = public as $$
declare t uuid;
begin
  if auth.uid() is null then raise exception 'Not signed in'; end if;
  select id into t from public.trips where invite_code = lower(trim(code));
  if t is null then raise exception 'Invalid invite code'; end if;
  insert into public.trip_members (trip_id, user_id) values (t, auth.uid()) on conflict do nothing;
  return t;
end $$;

create or replace function public.touch_updated_at()
returns trigger language plpgsql as $$
begin new.updated_at = now(); return new; end $$;

drop trigger if exists items_touch on public.items;
create trigger items_touch before update on public.items for each row execute function public.touch_updated_at();
drop trigger if exists expenses_touch on public.expenses;
create trigger expenses_touch before update on public.expenses for each row execute function public.touch_updated_at();

-- ---------------------------------------------------------------------------
-- Row level security: members of a trip can see and edit everything in it.
-- ---------------------------------------------------------------------------
alter table public.profiles     enable row level security;
alter table public.trips        enable row level security;
alter table public.trip_members enable row level security;
alter table public.items        enable row level security;
alter table public.attachments  enable row level security;
alter table public.links        enable row level security;
alter table public.expenses     enable row level security;

drop policy if exists "profiles readable by signed-in users" on public.profiles;
create policy "profiles readable by signed-in users" on public.profiles
  for select to authenticated using (true);
drop policy if exists "users update own profile" on public.profiles;
create policy "users update own profile" on public.profiles
  for update to authenticated using (id = auth.uid()) with check (id = auth.uid());

drop policy if exists "members read trips" on public.trips;
create policy "members read trips" on public.trips
  for select to authenticated using (is_trip_member(id) or created_by = auth.uid());
drop policy if exists "anyone creates trips" on public.trips;
create policy "anyone creates trips" on public.trips
  for insert to authenticated with check (created_by = auth.uid());
drop policy if exists "owner updates trip" on public.trips;
create policy "owner updates trip" on public.trips
  for update to authenticated using (created_by = auth.uid());
drop policy if exists "owner deletes trip" on public.trips;
create policy "owner deletes trip" on public.trips
  for delete to authenticated using (created_by = auth.uid());

drop policy if exists "members see members" on public.trip_members;
create policy "members see members" on public.trip_members
  for select to authenticated using (is_trip_member(trip_id));
drop policy if exists "leave or remove" on public.trip_members;
create policy "leave or remove" on public.trip_members
  for delete to authenticated using (user_id = auth.uid() or is_trip_owner(trip_id));

drop policy if exists "members manage items" on public.items;
create policy "members manage items" on public.items
  for all to authenticated using (is_trip_member(trip_id)) with check (is_trip_member(trip_id));

drop policy if exists "members manage attachments" on public.attachments;
create policy "members manage attachments" on public.attachments
  for all to authenticated using (is_trip_member(trip_id)) with check (is_trip_member(trip_id));

drop policy if exists "members manage links" on public.links;
create policy "members manage links" on public.links
  for all to authenticated using (is_trip_member(trip_id)) with check (is_trip_member(trip_id));

drop policy if exists "members manage expenses" on public.expenses;
create policy "members manage expenses" on public.expenses
  for all to authenticated using (is_trip_member(trip_id)) with check (is_trip_member(trip_id));

-- ---------------------------------------------------------------------------
-- Storage bucket for tickets and confirmations. Files live at <trip_id>/<item_id>/<file>.
-- ---------------------------------------------------------------------------
insert into storage.buckets (id, name, public, file_size_limit)
values ('attachments', 'attachments', false, 26214400)
on conflict (id) do nothing;

drop policy if exists "members read files" on storage.objects;
create policy "members read files" on storage.objects
  for select to authenticated
  using (bucket_id = 'attachments' and is_trip_member(((storage.foldername(name))[1])::uuid));
drop policy if exists "members upload files" on storage.objects;
create policy "members upload files" on storage.objects
  for insert to authenticated
  with check (bucket_id = 'attachments' and is_trip_member(((storage.foldername(name))[1])::uuid));
drop policy if exists "members delete files" on storage.objects;
create policy "members delete files" on storage.objects
  for delete to authenticated
  using (bucket_id = 'attachments' and is_trip_member(((storage.foldername(name))[1])::uuid));

-- Live updates: when a friend adds something, everyone's open trip page refreshes.
do $$
begin
  alter publication supabase_realtime add table public.items;
  alter publication supabase_realtime add table public.links;
  alter publication supabase_realtime add table public.expenses;
exception when duplicate_object then null;
end $$;
