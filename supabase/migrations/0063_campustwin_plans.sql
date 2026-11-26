-- CampusTwin plans that actually decide features.
--
-- Before: school.plan / university.plan was free text that controlled nothing;
-- modules were switched one by one per school.
--
-- Now:
--   * CampusTwin plans live in core.plan (product 'campustwin'); each plan's
--     features.modules says which paid modules it includes.
--   * Each school / university has module_overrides: per-institution add-ons or
--     removals on top of its plan.
--   * modules (what the app reads) = plan modules, then overrides, kept up to
--     date by triggers: changing a school's plan, its overrides, or a plan's
--     contents updates every affected school at once.
--   * Campuses follow their university's plan and overrides.
--   * The organisation's CampusTwin subscription points at the same plan.
--   * Existing institutions keep exactly the modules they have today: any
--     difference from their plan is recorded as an override.
-- Idempotent.
begin;

-- ------------------------------------------------------------ plans
insert into core.plan (product_code, code, name, price_paise, period, features) values
  ('campustwin', 'standard',     'Standard',     0, 'year', '{}'::jsonb),
  ('campustwin', 'professional', 'Professional', 0, 'year', '{}'::jsonb),
  ('campustwin', 'enterprise',   'Enterprise',   0, 'year', '{}'::jsonb)
on conflict (product_code, code) do nothing;

-- Module bundles (only set where a plan has none yet, so re-running never
-- undoes changes made in the console).
update core.plan set features = features || jsonb_build_object('modules', m.mods, 'unit', 'student')
from (values
  ('standard',     '{"fees":true,"homework":true,"admissions":true,"library":false,"hr":false,"transport":false,"twin":false}'::jsonb),
  ('professional', '{"fees":true,"homework":true,"admissions":true,"library":true,"hr":true,"transport":false,"twin":false}'::jsonb),
  ('enterprise',   '{"fees":true,"homework":true,"admissions":true,"library":true,"hr":true,"transport":true,"twin":false}'::jsonb)
) as m(code, mods)
where core.plan.product_code = 'campustwin' and core.plan.code = m.code and not (core.plan.features ? 'modules');

-- ------------------------------------------------------------ overrides
alter table public.school     add column if not exists module_overrides jsonb not null default '{}'::jsonb;
alter table public.university add column if not exists module_overrides jsonb not null default '{}'::jsonb;

create or replace function public.plan_modules(p_plan text) returns jsonb
language sql stable security definer set search_path = '' as $$
  select p.features -> 'modules' from core.plan p
  where p.product_code = 'campustwin' and p.code = p_plan;
$$;

-- What an institution can use: its plan's modules, then its own overrides.
-- Unknown plan: null (callers then leave modules as they are).
create or replace function public.effective_modules(p_plan text, p_overrides jsonb) returns jsonb
language sql stable security definer set search_path = '' as $$
  select case when public.plan_modules(p_plan) is null then null
              else public.plan_modules(p_plan) || coalesce(p_overrides, '{}'::jsonb) end;
$$;
revoke all on function public.plan_modules(text), public.effective_modules(text, jsonb) from public, anon;
grant execute on function public.plan_modules(text), public.effective_modules(text, jsonb) to authenticated, service_role;

-- Record today's modules as overrides wherever they differ from the plan, so
-- switching plans on does not change what anyone can use today.
update public.school s set module_overrides = coalesce((
  select jsonb_object_agg(k, s.modules -> k)
  from jsonb_object_keys(s.modules) k
  where (public.plan_modules(s.plan) -> k) is distinct from (s.modules -> k)), '{}'::jsonb)
where public.plan_modules(s.plan) is not null and s.modules is not null;
update public.university u set module_overrides = coalesce((
  select jsonb_object_agg(k, u.modules -> k)
  from jsonb_object_keys(u.modules) k
  where (public.plan_modules(u.plan) -> k) is distinct from (u.modules -> k)), '{}'::jsonb)
where public.plan_modules(u.plan) is not null and u.modules is not null;

-- ------------------------------------------------------------ keep modules in step
create or replace function public.school_apply_plan() returns trigger
language plpgsql security definer set search_path = '' as $$
declare u public.university; m jsonb;
begin
  -- a campus follows its university
  if new.university_id is not null then
    select * into u from public.university where id = new.university_id;
    if found then new.plan := u.plan; new.module_overrides := u.module_overrides; end if;
  end if;
  m := public.effective_modules(new.plan, new.module_overrides);
  if m is not null then new.modules := m; end if;
  return new;
end $$;
drop trigger if exists trg_school_apply_plan on public.school;
create trigger trg_school_apply_plan before insert or update of plan, module_overrides, university_id on public.school
  for each row execute function public.school_apply_plan();

create or replace function public.university_apply_plan() returns trigger
language plpgsql security definer set search_path = '' as $$
declare m jsonb;
begin
  m := public.effective_modules(new.plan, new.module_overrides);
  if m is not null then new.modules := m; end if;
  return new;
end $$;
drop trigger if exists trg_university_apply_plan on public.university;
create trigger trg_university_apply_plan before insert or update of plan, module_overrides on public.university
  for each row execute function public.university_apply_plan();

-- university plan or overrides changed: its campuses follow
create or replace function public.university_cascade_plan() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  update public.school set plan = new.plan, module_overrides = new.module_overrides
   where university_id = new.id;
  return null;
end $$;
drop trigger if exists trg_university_cascade_plan on public.university;
create trigger trg_university_cascade_plan after update of plan, module_overrides on public.university
  for each row execute function public.university_cascade_plan();

-- a plan's contents changed: every institution on it updates now
create or replace function core.plan_reapply() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if new.product_code = 'campustwin' and (new.features -> 'modules') is distinct from (old.features -> 'modules') then
    update public.university set modules = public.effective_modules(plan, module_overrides) where plan = new.code;
    update public.school     set modules = public.effective_modules(plan, module_overrides) where plan = new.code;
  end if;
  return null;
end $$;
drop trigger if exists trg_plan_reapply on core.plan;
create trigger trg_plan_reapply after update of features on core.plan
  for each row execute function core.plan_reapply();

-- the organisation's CampusTwin subscription points at the same plan
create or replace function public.sync_campustwin_subscription() returns trigger
language plpgsql security definer set search_path = '' as $$
declare v_plan uuid;
begin
  if new.org_id is null or (tg_table_name = 'school' and new.university_id is not null) then return null; end if;
  select id into v_plan from core.plan where product_code = 'campustwin' and code = new.plan;
  if v_plan is null then return null; end if;
  update core.subscription set plan_id = v_plan
   where org_id = new.org_id and product_code = 'campustwin'
     and status in ('trial', 'active', 'past_due', 'paused') and plan_id is distinct from v_plan;
  return null;
end $$;
drop trigger if exists trg_school_sync_subscription on public.school;
create trigger trg_school_sync_subscription after insert or update of plan on public.school
  for each row execute function public.sync_campustwin_subscription();
drop trigger if exists trg_university_sync_subscription on public.university;
create trigger trg_university_sync_subscription after insert or update of plan on public.university
  for each row execute function public.sync_campustwin_subscription();

-- bring subscriptions in line now
update core.subscription sub set plan_id = p.id
from public.school s join core.plan p on p.product_code = 'campustwin' and p.code = s.plan
where sub.org_id = s.org_id and s.university_id is null and sub.product_code = 'campustwin' and sub.plan_id is distinct from p.id;
update core.subscription sub set plan_id = p.id
from public.university u join core.plan p on p.product_code = 'campustwin' and p.code = u.plan
where sub.org_id = u.org_id and sub.product_code = 'campustwin' and sub.plan_id is distinct from p.id;

commit;
