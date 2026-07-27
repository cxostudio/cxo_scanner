-- ============================================================================
-- Per-email daily scan limit  (table: public.scan_limit)
-- Run this ONCE in Supabase → SQL Editor → New query → Run.
-- Your table already has: id, created_at, email, scan_day, count, scan_ids(jsonb), updated_at
-- ============================================================================

-- 1) Guarantee ONE row per email per day (also lets the function upsert safely).
alter table public.scan_limit
  drop constraint if exists scan_limit_email_day_unique;
alter table public.scan_limit
  add  constraint scan_limit_email_day_unique unique (email, scan_day);

-- 2) The check-and-count function.
--    p_email   : the user's email (case-insensitive)
--    p_scan_id : the browser-generated id for this scan (shared by all its requests)
--    p_limit   : max scans per email per day (e.g. 5)
--  Returns: allowed (bool), used (today's count), max_allowed (the limit)
create or replace function public.register_scan(
  p_email   text,
  p_scan_id text,
  p_limit   int
)
returns table (allowed boolean, used int, max_allowed int)
language plpgsql
as $$
declare
  v_today date  := (now() at time zone 'utc')::date;   -- UTC day → auto daily reset
  v_email text  := lower(trim(p_email));
  v_count int;
  v_ids   jsonb;
begin
  -- Get today's row (locked), or create it, then re-read locked.
  select count, coalesce(scan_ids, '[]'::jsonb)
    into v_count, v_ids
    from public.scan_limit
   where email = v_email and scan_day = v_today
   for update;

  if not found then
    insert into public.scan_limit (email, scan_day, count, scan_ids, updated_at)
    values (v_email, v_today, 0, '[]'::jsonb, now())
    on conflict (email, scan_day) do nothing;

    select count, coalesce(scan_ids, '[]'::jsonb)
      into v_count, v_ids
      from public.scan_limit
     where email = v_email and scan_day = v_today
     for update;
  end if;

  -- Same scan seen already (batch / retry / fallback) -> allow, don't re-count.
  if v_ids ? p_scan_id then
    return query select true, v_count, p_limit;
    return;
  end if;

  -- Over the daily limit -> block.
  if v_count >= p_limit then
    return query select false, v_count, p_limit;
    return;
  end if;

  -- Count this new scan.
  update public.scan_limit
     set count      = count + 1,
         scan_ids   = coalesce(scan_ids, '[]'::jsonb) || to_jsonb(p_scan_id),
         updated_at = now()
   where email = v_email and scan_day = v_today
  returning count into v_count;

  return query select true, v_count, p_limit;
end;
$$;

-- Optional housekeeping (NOT needed for the reset): shrink old rows monthly.
-- delete from public.scan_limit where scan_day < (now() at time zone 'utc')::date - 60;
