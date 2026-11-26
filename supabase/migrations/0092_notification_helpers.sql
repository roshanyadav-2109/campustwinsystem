-- Unread count for the bell, and a test message the office can send to itself.
create or replace function public.my_unread_notifications() returns int
language sql stable security definer set search_path = '' as $$
  select count(*)::int from public.notification n
  where n.school_id = public.current_school_id() and n.read_at is null
    and ((n.guardian_id is not null and n.guardian_id = app.my_guardian_id()) or (n.staff_id is not null and n.staff_id = app.my_staff_id()));
$$;
grant execute on function public.my_unread_notifications() to authenticated;

create or replace function public.send_test_notification() returns bigint
language plpgsql security definer set search_path = '' as $$
declare v_staff bigint := app.my_staff_id(); v_school bigint := public.current_school_id();
begin
  if not coalesce(app.is_office(), false) or v_staff is null then raise exception 'Only the office can send a test message'; end if;
  if (select count(*) from public.notification where school_id = v_school and event_key = 'test' and created_at > now() - interval '1 hour') >= 10 then
    raise exception 'Too many test messages in the last hour';
  end if;
  return public.notify(v_school, 'test', 'test:' || v_staff || ':' || extract(epoch from clock_timestamp())::text, null, v_staff, null,
    jsonb_build_object('school', (select name from public.school where id = v_school)),
    'Test message from {school}', 'This is a test message from CampusTwin. If you received it, this channel works.', '/dashboard/notifications');
end $$;
revoke all on function public.send_test_notification() from public, anon;
grant execute on function public.send_test_notification() to authenticated;
