-- Fix for 0063: the subscription sync trigger read new.university_id, which a
-- university row does not have, so inserting or re-planning a university failed.
-- Read the field through jsonb so the same function serves both tables.
begin;
create or replace function public.sync_campustwin_subscription() returns trigger
language plpgsql security definer set search_path = '' as $$
declare v_plan uuid; r jsonb := to_jsonb(new);
begin
  if new.org_id is null or (r ? 'university_id' and r ->> 'university_id' is not null) then return null; end if;
  select id into v_plan from core.plan where product_code = 'campustwin' and code = new.plan;
  if v_plan is null then return null; end if;
  update core.subscription set plan_id = v_plan
   where org_id = new.org_id and product_code = 'campustwin'
     and status in ('trial', 'active', 'past_due', 'paused') and plan_id is distinct from v_plan;
  return null;
end $$;
commit;
