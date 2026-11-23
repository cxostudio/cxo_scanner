-- ============================================================================
-- Follow-ups after a free scan (lib/followups), and unsubscribes.
-- Run this ONCE in Supabase → SQL Editor → New query → Run. Safe to run again.
-- Server only (service role): RLS on, no public policies.
-- ============================================================================

-- one row per address and follow-up: the row is written BEFORE the email goes out,
-- so a follow-up can never be sent twice to the same address
create table if not exists public.scan_followups (
  email        text not null,
  kind         text not null,                 -- offer | call1 | call2
  scan_job_id  uuid,
  sent_at      timestamptz not null default now(),
  primary key (email, kind)
);

-- addresses that clicked "Stop these emails": no follow-up ever again
create table if not exists public.email_optouts (
  email       text primary key,
  created_at  timestamptz not null default now()
);

alter table public.scan_followups enable row level security;
alter table public.email_optouts enable row level security;
