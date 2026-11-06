-- ============================================================================
-- Lead dashboard (/scan/admin/leads)
-- 1. public.lead_scans: a short summary of each free scan (score, counts, failed checkpoints).
--    No screenshots or page text. Kept 12 months (see the privacy policy on cxo.studio).
-- 2. Status and notes on public.leads, set from the dashboard.
-- Run this ONCE in Supabase → SQL Editor → New query → Run. Safe to run again.
-- ============================================================================

create table if not exists public.lead_scans (
  id          uuid primary key default gen_random_uuid(),
  created_at  timestamptz not null default now(),
  scan_id     text,
  email       text not null,
  url         text not null,
  page_type   text,                   -- 'product' | 'category' | 'homepage' | 'other'
  niche       text,
  score       int,                    -- 0-100, same formula as the results page
  passed      int,
  failed      int,
  na          int,
  unknown     int,
  test        boolean not null default false,  -- CXO Studio / +test emails
  results     jsonb                   -- [{ id, title, answer, reason, priority, difficulty }]
);

create index if not exists lead_scans_created_at_idx on public.lead_scans (created_at desc);
create index if not exists lead_scans_email_idx on public.lead_scans (lower(email));

alter table public.lead_scans enable row level security;

alter table public.leads add column if not exists status text not null default 'new';  -- new | contacted | call | won | lost
alter table public.leads add column if not exists notes text;
alter table public.leads add column if not exists status_at timestamptz;

-- 12-month retention, as stated in the privacy policy. Run by hand, or schedule with pg_cron:
-- delete from public.lead_scans where created_at < now() - interval '12 months';
-- delete from public.leads where created_at < now() - interval '12 months' and status not in ('won');
