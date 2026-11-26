-- Self-test for 0063 (CampusTwin plans). Rolls back.
begin;
do $$
declare v_school bigint; v_uni bigint; v_campus bigint; m jsonb; v_changed int;
begin
  -- no live institution's modules changed by the migration
  select count(*) into v_changed from public.school
   where modules is distinct from public.effective_modules(plan, module_overrides);
  if v_changed <> 0 then raise exception 'FAIL: % school(s) have modules that differ from plan + overrides', v_changed; end if;
  select modules into m from public.school where slug = 'snm';
  if m is distinct from '{"hr":true,"fees":true,"twin":false,"library":true,"homework":true,"transport":true,"admissions":true}'::jsonb then
    raise exception 'FAIL: the live school''s modules changed: %', m; end if;
  raise notice 'PASS existing schools keep exactly their modules';

  -- a new school on Standard gets Standard's modules
  insert into public.school (name, slug, code, plan) values ('QA Plan School', 'qa-plan-school', 'QAPS', 'standard') returning id into v_school;
  select modules into m from public.school where id = v_school;
  if (m->>'library')::boolean or (m->>'transport')::boolean or not (m->>'fees')::boolean then raise exception 'FAIL: Standard modules wrong: %', m; end if;
  raise notice 'PASS new school gets its plan''s modules';

  -- upgrade to Enterprise: transport and library switch on
  update public.school set plan = 'enterprise' where id = v_school;
  select modules into m from public.school where id = v_school;
  if not ((m->>'transport')::boolean and (m->>'library')::boolean) then raise exception 'FAIL: upgrade did not switch modules on: %', m; end if;
  raise notice 'PASS changing plan switches modules';

  -- an override survives a plan change
  update public.school set module_overrides = '{"transport":false}' where id = v_school;
  update public.school set plan = 'professional' where id = v_school;
  update public.school set plan = 'enterprise' where id = v_school;
  select modules into m from public.school where id = v_school;
  if (m->>'transport')::boolean then raise exception 'FAIL: override lost on plan change: %', m; end if;
  raise notice 'PASS per-school override survives plan changes';

  -- changing what a plan includes updates every school on it
  update core.plan set features = jsonb_set(features, '{modules,homework}', 'false') where product_code = 'campustwin' and code = 'enterprise';
  select modules into m from public.school where id = v_school;
  if (m->>'homework')::boolean then raise exception 'FAIL: plan change did not reach the school: %', m; end if;
  raise notice 'PASS editing a plan updates schools on it';

  -- campuses follow their university
  insert into public.university (name, slug, plan) values ('QA Plan Uni', 'qa-plan-uni', 'standard') returning id into v_uni;
  insert into public.school (name, slug, code, university_id) values ('QA Campus', 'qa-plan-campus', 'QAPC', v_uni) returning id into v_campus;
  update public.university set plan = 'professional' where id = v_uni;
  select modules into m from public.school where id = v_campus;
  if not (m->>'hr')::boolean then raise exception 'FAIL: campus did not follow university upgrade: %', m; end if;
  raise notice 'PASS campuses follow their university''s plan';
end $$;
rollback;
