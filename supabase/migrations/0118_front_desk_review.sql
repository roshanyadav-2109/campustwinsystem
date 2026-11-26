-- Front desk, after the product + CTO review of 0115.
begin;
-- only a parent (not the student) or the office raises a gate pass
drop policy if exists gp_parent_ask on public.gate_pass;
create policy gp_parent_ask on public.gate_pass for insert to authenticated
  with check (((select app.is_admin_scope()) or ((select app.my_guardian_id()) is not null and app.owns_student(student_id))) and status = 'requested' and requested_by = auth.uid());

-- the allowed steps, and what may change at each
create or replace function public.gate_pass_rules() returns trigger
language plpgsql security definer set search_path = '' as $$
declare v_admin boolean := coalesce(app.is_admin_scope(), false);
begin
  if tg_op = 'INSERT' then
    new.status := 'requested'; new.decided_by := null; new.decision_note := null; new.left_at := null; new.created_at := now();
    if new.leave_at < now() - interval '1 hour' then raise exception 'The pick-up time is in the past'; end if;
    return new;
  end if;
  if new.student_id <> old.student_id or new.requested_by <> old.requested_by or new.created_at <> old.created_at then
    raise exception 'A gate pass cannot move to another student';
  end if;
  if not v_admin then
    if not (old.status = 'requested' and new.status = 'cancelled') then raise exception 'You can only cancel your request'; end if;
    new.reason := old.reason; new.pickup_name := old.pickup_name; new.pickup_relation := old.pickup_relation; new.pickup_phone := old.pickup_phone;
    new.leave_at := old.leave_at; new.decided_by := old.decided_by; new.decision_note := old.decision_note; new.left_at := old.left_at;
    return new;
  end if;
  if new.status <> old.status and not (
       (old.status = 'requested' and new.status in ('approved', 'rejected', 'cancelled'))
    or (old.status = 'approved' and new.status in ('left', 'cancelled'))) then
    raise exception 'A gate pass cannot go from % to %', old.status, new.status;
  end if;
  if old.status <> 'requested' and (new.pickup_name <> old.pickup_name or new.leave_at <> old.leave_at
       or new.pickup_phone is distinct from old.pickup_phone or new.pickup_relation is distinct from old.pickup_relation) then
    raise exception 'Who picks up and when cannot change after the decision. Cancel and raise a new one.';
  end if;
  return new;
end $$;
drop trigger if exists trg_gate_pass_rules on public.gate_pass;
create trigger trg_gate_pass_rules before insert or update on public.gate_pass for each row execute function public.gate_pass_rules();

-- the office hears about new requests; parents hear about a cancellation
create or replace function public.front_desk_notify() returns trigger
language plpgsql security definer set search_path = '' as $$
declare r record; v jsonb; v_school text; v_name text; v_title text; v_body text; v_key text;
begin
  select coalesce(nullif(s.short_name, ''), s.name) into v_school from public.school s where s.id = new.school_id;
  select full_name into v_name from public.student where id = new.student_id;
  if tg_table_name = 'gate_pass' then
    if tg_op = 'UPDATE' and new.status = old.status then return null; end if;
    v := jsonb_build_object('student', v_name, 'school', v_school, 'person', new.pickup_name || coalesce(' (' || new.pickup_relation || ')', ''),
      'time', to_char(coalesce(new.left_at, new.leave_at) at time zone 'Asia/Kolkata', 'HH24:MI, DD/MM'), 'reason', new.reason, 'note', coalesce(new.decision_note, ''));
    v_key := 'gate_pass:' || new.id || ':' || new.status;
    if new.status = 'requested' then
      for r in select s.id from public.staff s where s.school_id = new.school_id and s.role in ('office', 'principal') loop
        perform public.notify_safe(new.school_id, 'gate_pass', v_key, null, r.id, new.student_id, v, 'Early pick-up request: {student}',
          '{student} to leave at {time} with {person}. Reason: {reason}. Approve or decline at the front desk.', '/dashboard/front-desk?view=passes');
      end loop;
      return null;
    end if;
    if new.status = 'approved' then
      v_title := 'Early pick-up approved: {student}'; v_body := '{school}: {student} may leave at {time} with {person}.';
    elsif new.status = 'left' then
      v_title := '{student} has left school'; v_body := '{school}: {student} left school at {time} with {person}.';
    elsif new.status = 'rejected' then
      v_title := 'Early pick-up not approved: {student}'; v_body := '{school}: the early pick-up for {student} was not approved. {note}';
    elsif new.status = 'cancelled' then
      v_title := 'Early pick-up cancelled: {student}'; v_body := '{school}: the early pick-up for {student} at {time} was cancelled.';
    else return null; end if;
    for r in select gs.guardian_id from public.guardian_student gs where gs.student_id = new.student_id and gs.school_id = new.school_id loop
      perform public.notify_safe(new.school_id, 'gate_pass', v_key, r.guardian_id, null, new.student_id, v, v_title, v_body, '/dashboard/front-desk');
    end loop;
  else
    if not new.tell_parent then return null; end if;
    v := jsonb_build_object('student', v_name, 'school', v_school);
    for r in select gs.guardian_id from public.guardian_student gs where gs.student_id = new.student_id and gs.school_id = new.school_id loop
      -- the complaint itself stays in the app, not in an SMS
      perform public.notify_safe(new.school_id, 'health_visit', 'health:' || new.id, r.guardian_id, null, new.student_id, v,
        '{student} visited the health room',
        '{school}: {student} came to the health room today.' || case when new.sent_home then ' Please collect ' || v_name || ' from school.' else ' Details are in CampusTwin.' end,
        '/dashboard/front-desk');
    end loop;
  end if;
  return null;
exception when others then raise warning 'front_desk_notify: %', sqlerrm; return null;
end $$;

-- visitors: phone and ID details are cleared after 180 days; the log cannot be deleted
revoke delete on public.visitor from authenticated;
do $$ begin
  perform cron.unschedule(jobid) from cron.job where jobname = 'visitor-retention';
  perform cron.schedule('visitor-retention', '15 22 * * *', $q$update public.visitor set phone = null, id_proof = null where in_at < now() - interval '180 days' and (phone is not null or id_proof is not null)$q$);
end $$;
commit;
