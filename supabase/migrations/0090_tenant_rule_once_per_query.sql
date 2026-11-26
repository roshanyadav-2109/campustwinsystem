-- Speed: every table's per-institution rule ("tenant_isolation") called
-- current_school_id() for EVERY row it checked. Since 0078 that function also
-- resolves the person's membership for the website, so large reads (a section's
-- 4,000 marks) took about half a second. Wrapping the call as a sub-select lets
-- Postgres work it out once per query. Same rule, same result; only faster.
-- Idempotent: rules already wrapped are left alone.
do $$
declare p record; q text; c text;
begin
  for p in select schemaname, tablename, qual, with_check from pg_policies where policyname = 'tenant_isolation' loop
    q := replace(p.qual, 'current_school_id()', '(select public.current_school_id())');
    q := replace(q, 'public.(select public.current_school_id())', '(select public.current_school_id())');
    q := replace(q, '(select public.(select public.current_school_id()))', '(select public.current_school_id())');
    if q = p.qual then continue; end if;
    if p.with_check is null then
      execute format('alter policy tenant_isolation on %I.%I using (%s)', p.schemaname, p.tablename, q);
    else
      c := replace(p.with_check, 'current_school_id()', '(select public.current_school_id())');
      c := replace(c, 'public.(select public.current_school_id())', '(select public.current_school_id())');
      execute format('alter policy tenant_isolation on %I.%I using (%s) with check (%s)', p.schemaname, p.tablename, q, c);
    end if;
  end loop;
end $$;
