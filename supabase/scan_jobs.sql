-- ============================================================================
-- Scan jobs: each free scan, so it can finish without the visitor's tab and be reopened anywhere.
-- - The visitor's browser runs the scan as before and sends a heartbeat. If the tab closes
--   (or goes quiet), the server takes over and finishes the same scan.
-- - When it finishes (browser or server), the result is stored here, the results email is sent,
--   and the results open from /scan/results?id=<id> on any device.
-- Run this ONCE in Supabase → SQL Editor → New query → Run. Safe to run again.
-- Server only (service role): RLS on, no public policies.
-- ============================================================================

create table if not exists public.scan_jobs (
  id            uuid primary key default gen_random_uuid(),   -- the private results link id
  scan_id       text unique not null,                         -- same id as /api/scan and the daily limit
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  email         text not null,
  url           text not null,                                -- the URL the visitor gave
  locale        text not null default 'en',
  answers       jsonb,                                        -- { revenue, aov, cr } from /start
  origin        text,                                         -- site the visitor came from, for the results link
  status        text not null default 'running',              -- running | server | done | failed
  heartbeat_at  timestamptz not null default now(),
  snapshot      jsonb,                                        -- everything the results page needs
  emailed_at    timestamptz,
  error         text
);

create index if not exists scan_jobs_created_at_idx on public.scan_jobs (created_at desc);
create index if not exists scan_jobs_email_idx on public.scan_jobs (lower(email));

alter table public.scan_jobs enable row level security;

-- 12-month retention, as stated in the privacy policy. Run by hand, or schedule with pg_cron:
-- delete from public.scan_jobs where created_at < now() - interval '12 months';
