-- ============================================================================
-- Calls booked on Cal.com (app/api/cal/webhook). Run ONCE in Supabase → SQL Editor → Run.
-- Safe to run again. Server only (service role): RLS on, no public policies.
-- ============================================================================
create table if not exists public.call_bookings (
  uid           text primary key,               -- Cal.com booking uid
  email         text not null,                  -- attendee, lowercased
  name          text,
  start_time    timestamptz not null,
  end_time      timestamptz,
  status        text not null default 'booked', -- booked | cancelled | rescheduled
  meeting_url   text,
  timezone      text,
  locale        text,                           -- en | fr (attendee's Cal.com language)
  source        text,                           -- which button: report, free-scan, email-call1, site...
  store         text,
  responses     jsonb,                          -- answers to the booking questions
  reminded_24h  timestamptz,
  reminded_1h   timestamptz,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);
create index if not exists call_bookings_email on public.call_bookings (email);
create index if not exists call_bookings_start on public.call_bookings (start_time) where status = 'booked';
alter table public.call_bookings enable row level security;
