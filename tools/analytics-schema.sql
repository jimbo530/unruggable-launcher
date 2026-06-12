-- ============================================================
-- Site analytics + funnel tracking — run once in Supabase SQL editor
-- Project: hhniimufxjjgmessjtbc
-- Created 2026-06-12
--
-- analytics_events: written by track.js on every page (anon key, INSERT only)
-- funnel_wallets / funnel_snapshots: written daily by funnel-snapshot bot (service key)
-- analytics_summary() / funnel_summary(): aggregate-only reads for the dashboard
-- ============================================================

create table if not exists public.analytics_events (
  id bigint generated always as identity primary key,
  ts timestamptz not null default now(),
  site text not null check (char_length(site) <= 100),
  path text not null check (char_length(path) <= 500),
  event text not null check (char_length(event) <= 50),
  label text check (char_length(label) <= 200),
  wallet text check (wallet ~ '^0x[0-9a-f]{40}$'),
  vid text check (char_length(vid) <= 40),
  sid text check (char_length(sid) <= 40),
  referrer text check (char_length(referrer) <= 500),
  ua text check (char_length(ua) <= 300),
  props jsonb
);

create index if not exists analytics_events_ts_idx on public.analytics_events (ts);
create index if not exists analytics_events_event_idx on public.analytics_events (event, ts);
create index if not exists analytics_events_path_idx on public.analytics_events (path, ts);
create index if not exists analytics_events_wallet_idx on public.analytics_events (wallet) where wallet is not null;

alter table public.analytics_events enable row level security;

-- Browsers insert with the anon key; nobody reads raw rows through the API.
drop policy if exists analytics_insert_anon on public.analytics_events;
create policy analytics_insert_anon on public.analytics_events
  for insert to anon, authenticated with check (true);

-- Funnel stage per wallet (bot-written, service key only — no policies)
create table if not exists public.funnel_wallets (
  wallet text primary key check (wallet ~ '^0x[0-9a-f]{40}$'),
  vault_depositor boolean not null default false,
  vault_balance numeric,
  lp_holder boolean not null default false,
  lp_detail jsonb,
  mft_holder boolean not null default false,
  mft_balance numeric,
  game_player boolean not null default false,
  site_visitor boolean not null default false,
  first_seen timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table public.funnel_wallets enable row level security;

create table if not exists public.funnel_snapshots (
  id bigint generated always as identity primary key,
  ts timestamptz not null default now(),
  totals jsonb not null
);
alter table public.funnel_snapshots enable row level security;

-- ============================================================
-- Aggregate read functions — the dashboard calls these with the anon key.
-- SECURITY DEFINER so they can read the RLS-locked tables, but they only
-- ever return counts/aggregates, never raw rows.
-- ============================================================

create or replace function public.analytics_summary(days int default 7)
returns jsonb
language sql
security definer
set search_path = public
as $$
  select jsonb_build_object(
    'since', now() - make_interval(days => least(greatest(days,1),90)),
    'pageviews', (select count(*) from analytics_events
                  where event = 'pageview' and ts > now() - make_interval(days => least(greatest(days,1),90))),
    'visitors', (select count(distinct vid) from analytics_events
                 where ts > now() - make_interval(days => least(greatest(days,1),90))),
    'wallets', (select count(distinct wallet) from analytics_events
                where wallet is not null and ts > now() - make_interval(days => least(greatest(days,1),90))),
    'by_day', (select coalesce(jsonb_agg(row_to_json(d) order by d.day), '[]'::jsonb) from (
        select date_trunc('day', ts)::date as day,
               count(*) filter (where event = 'pageview') as pageviews,
               count(distinct vid) as visitors
        from analytics_events
        where ts > now() - make_interval(days => least(greatest(days,1),90))
        group by 1) d),
    'top_pages', (select coalesce(jsonb_agg(row_to_json(p)), '[]'::jsonb) from (
        select path, count(*) as views, count(distinct vid) as visitors
        from analytics_events
        where event = 'pageview' and ts > now() - make_interval(days => least(greatest(days,1),90))
        group by path order by views desc limit 30) p),
    'top_events', (select coalesce(jsonb_agg(row_to_json(e)), '[]'::jsonb) from (
        select event, label, count(*) as n
        from analytics_events
        where event <> 'pageview' and ts > now() - make_interval(days => least(greatest(days,1),90))
        group by event, label order by n desc limit 30) e)
  );
$$;

revoke all on function public.analytics_summary(int) from public;
grant execute on function public.analytics_summary(int) to anon, authenticated;

create or replace function public.funnel_summary()
returns jsonb
language sql
security definer
set search_path = public
as $$
  select jsonb_build_object(
    'updated', (select max(updated_at) from funnel_wallets),
    'stages', jsonb_build_object(
      'vault_depositors', (select count(*) from funnel_wallets where vault_depositor),
      'lp_holders',       (select count(*) from funnel_wallets where lp_holder),
      'mft_holders',      (select count(*) from funnel_wallets where mft_holder),
      'game_players',     (select count(*) from funnel_wallets where game_player),
      'site_visitors',    (select count(*) from funnel_wallets where site_visitor)
    ),
    'transitions', jsonb_build_object(
      'depositor_and_lp',   (select count(*) from funnel_wallets where vault_depositor and lp_holder),
      'depositor_and_mft',  (select count(*) from funnel_wallets where vault_depositor and mft_holder),
      'lp_and_mft',         (select count(*) from funnel_wallets where lp_holder and mft_holder),
      'depositor_lp_mft',   (select count(*) from funnel_wallets where vault_depositor and lp_holder and mft_holder),
      'player_and_mft',     (select count(*) from funnel_wallets where game_player and mft_holder),
      'player_and_depositor', (select count(*) from funnel_wallets where game_player and vault_depositor)
    ),
    'history', (select coalesce(jsonb_agg(row_to_json(h) order by h.ts), '[]'::jsonb) from (
        select ts, totals from funnel_snapshots order by ts desc limit 60) h)
  );
$$;

revoke all on function public.funnel_summary() from public;
grant execute on function public.funnel_summary() to anon, authenticated;
