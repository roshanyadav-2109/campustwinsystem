-- Parents are told when a report card is published.
begin;
create or replace function public.fan_out_result(o public.notification_outbox) returns int
language plpgsql security definer set search_path = '' as $$
declare x record; r record; v_n int := 0; v_vars jsonb;
begin
  select rc.id, rc.student_id, rc.status, rc.snapshot ->> 'term_name' term_name, rc.snapshot -> 'student' ->> 'name' student,
         coalesce(nullif(s.short_name, ''), s.name) school
    into x from public.report_card rc join public.school s on s.id = rc.school_id where rc.id = o.ref_id;
  if x.id is null or x.status <> 'published' then return 0; end if;
  v_vars := jsonb_build_object('student', x.student, 'term', coalesce(x.term_name, ''), 'school', x.school);
  for r in select gs.guardian_id from public.guardian_student gs where gs.student_id = x.student_id and gs.school_id = o.school_id loop
    if public.notify_safe(o.school_id, 'result_published', 'result:' || x.id, r.guardian_id, null, x.student_id, v_vars,
         'Report card: {student}, {term}', '{school}: the {term} report card of {student} is ready. Open CampusTwin to see and download it.',
         '/dashboard/reports') is not null then v_n := v_n + 1; end if;
  end loop;
  return v_n;
end $$;
revoke all on function public.fan_out_result(public.notification_outbox) from public, anon, authenticated;

create or replace function public.fan_out_notifications(p_limit int default 200) returns int
language plpgsql security definer set search_path = '' as $$
declare o public.notification_outbox; v_total int := 0; v_n int; v_start timestamptz := clock_timestamp();
begin
  for o in select * from public.notification_outbox where processed_at is null and not_before <= now()
           order by not_before limit p_limit for update skip locked loop
    exit when clock_timestamp() - v_start > interval '20 seconds';
    begin
      v_n := case when o.event_key = 'result_published' then public.fan_out_result(o) else public.fan_out_one(o) end;
      if v_n < 0 then
        v_total := v_total - v_n - 1;
      else
        update public.notification_outbox set processed_at = now(), sent = coalesce(sent, 0) + v_n, error = null where id = o.id;
        v_total := v_total + v_n;
      end if;
    exception when others then
      update public.notification_outbox set attempts = attempts + 1, error = left(sqlerrm, 300),
        processed_at = case when attempts + 1 >= 3 then now() end,
        not_before = now() + (attempts + 1) * interval '5 minutes'
      where id = o.id;
    end;
  end loop;
  return v_total;
end $$;
revoke all on function public.fan_out_notifications(int) from public, anon, authenticated;
grant execute on function public.fan_out_notifications(int) to service_role;
commit;
