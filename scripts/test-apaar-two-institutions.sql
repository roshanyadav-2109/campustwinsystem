-- The same APAAR ID may be saved at two institutions, but not twice in one. Rolled back.
begin;
do $$ declare a bigint; b bigint; c bigint; ok boolean := false; begin
  select id into a from public.student where school_id = 8 limit 1;
  select id into c from public.student where school_id = 8 and id <> a limit 1;
  select id into b from public.student where school_id = 12 limit 1;
  insert into public.student_identity (student_id, apaar_id) values (a, '999988887777');
  insert into public.student_identity (student_id, apaar_id) values (b, '999988887777');
  begin insert into public.student_identity (student_id, apaar_id) values (c, '999988887777'); exception when unique_violation then ok := true; end;
  if not ok then raise exception 'FAIL duplicate APAAR inside one institution accepted'; end if;
end $$;
rollback;
