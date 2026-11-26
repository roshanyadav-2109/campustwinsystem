-- Self-test for 0062 (leave types for every school). Rolls back.
begin;
do $$
declare v_school bigint; v_n int; v_missing int;
begin
  select count(*) into v_missing from public.school s
   where not exists (select 1 from public.staff_leave_type t where t.school_id = s.id);
  if v_missing <> 0 then raise exception 'FAIL: % school(s) still have no leave types', v_missing; end if;
  raise notice 'PASS every school has leave types';

  insert into public.school (name, slug, code) values ('QA Leave Types School', 'qa-leave-types-test', 'QALT') returning id into v_school;
  select count(*) into v_n from public.staff_leave_type where school_id = v_school;
  if v_n <> 4 then raise exception 'FAIL: a new school got % leave types, expected 4', v_n; end if;
  raise notice 'PASS a new school gets the four standard leave types';

  perform public.seed_staff_leave_types(v_school);
  select count(*) into v_n from public.staff_leave_type where school_id = v_school;
  if v_n <> 4 then raise exception 'FAIL: seeding twice made % types', v_n; end if;
  raise notice 'PASS seeding again changes nothing';
end $$;
rollback;
