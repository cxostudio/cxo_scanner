-- ============================================================================
-- Onboarding leads (table: public.leads)
-- Filled by the "Find my revenue leaks" flow on cxo.studio/start via POST /api/leads.
-- Run this ONCE in Supabase → SQL Editor → New query → Run.
-- ============================================================================

create table if not exists public.leads (
  id            uuid primary key default gen_random_uuid(),
  created_at    timestamptz not null default now(),
  email         text not null,
  name          text,
  site_type     text not null,          -- 'ecommerce' | 'b2b' | 'other'
  platform      text,                   -- 'shopify' | 'other' (e-commerce only)
  url           text,
  revenue_band  text,                   -- e-commerce: monthly online revenue band
  traffic_band  text,                   -- B2B: monthly traffic or media budget band
  goal          text,                   -- B2B: what the site should produce
  role          text,
  route         text not null,          -- 'scan' | 'call'
  locale        text,
  source        jsonb                   -- utm_* and referrer, for ad attribution
);

create index if not exists leads_created_at_idx on public.leads (created_at desc);
create index if not exists leads_email_idx on public.leads (lower(email));

-- Only the server (service role) writes or reads; no public access.
alter table public.leads enable row level security;
