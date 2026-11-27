-- Ending a university-wide position at a university campus is for the central administration.
begin;
create or replace function public.end_position(p_id bigint, p_on date) returns void
language plpgsql security definer set search_path = '' as $$
declare p public.staff_position; t public.position_title; v_on date := coalesce(p_on, (now() at time zone 'Asia/Kolkata')::date);
begin
  if not coalesce(app.is_admin_scope(), false) or app.is_deputy_only() then raise exception 'Only the office or the head can end positions'; end if;
  select * into p from public.staff_position where id = p_id and school_id = public.current_school_id();
  select * into t from public.position_title where id = p.title_id;
  if p.id is null then raise exception 'Unknown position'; end if;
  perform public.check_university_position(t.id);
  if t.access_type = any(app.top_types()) then
    if not app.is_head() then raise exception 'Only the head of the institution can end this position'; end if;
    if p.staff_id = app.my_staff_id() then raise exception 'Someone else must end your own position'; end if;
    if t.access_type = 'head' and not exists (select 1 from public.staff s where s.school_id = p.school_id and s.role = 'principal')
       and not exists (select 1 from public.staff_position x join public.position_title xt on xt.id = x.title_id
                       where x.school_id = p.school_id and x.id <> p.id and xt.access_type = 'head' and x.starts_on <= v_on and (x.ends_on is null or x.ends_on > v_on)) then
      raise exception 'The institution would be left without a head. Assign the next head first';
    end if;
  end if;
  update public.staff_position set ends_on = greatest(v_on, starts_on) where id = p_id and (ends_on is null or ends_on > v_on) returning * into p;
  if p.id is null then raise exception 'This position has already ended'; end if;
  insert into public.position_log (school_id, by_staff, action, staff_id, detail)
  values (p.school_id, app.my_staff_id(), 'ended', p.staff_id, t.name || coalesce(', ' || public.position_place(p), '') || ' on ' || p.ends_on);
end $$;
commit;
