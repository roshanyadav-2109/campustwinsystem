-- Front desk: visitors, student gate passes (early pick-up) and the health room.
-- Visitors: in / out log kept by the office. Gate passes: a parent asks (or the
-- office raises one), the office approves and records when the child left and
-- with whom; parents are told. Health room: visits with what was done; only
-- the office, principal and the child's own parents see them; parents can be told.
begin;
create table if not exists public.visitor (
  id           bigint generated always as identity primary key,
  school_id    bigint not null default public.current_school_id() references public.school(id) on delete cascade,
  name         text not null check (char_length(name) between 1 and 80),
  phone        text check (phone is null or char_length(phone) <= 16),
  purpose      text check (purpose is null or char_length(purpose) <= 120),
  meeting      text check (meeting is null or char_length(meeting) <= 80),
  id_proof     text check (id_proof is null or char_length(id_proof) <= 60),
  vehicle      text check (vehicle is null or char_length(vehicle) <= 20),
  badge_no     text check (badge_no is null or char_length(badge_no) <= 20),
  in_at        timestamptz not null default now(),
  out_at       timestamptz,
  created_by   bigint references public.staff(id) on delete set null,
  check (out_at is null or out_at >= in_at)
);
create index if not exists idx_visitor_school_in on public.visitor (school_id, in_at desc);

create table if not exists public.gate_pass (
  id              bigint generated always as identity primary key,
  school_id       bigint not null default public.current_school_id() references public.school(id) on delete cascade,
  student_id      bigint not null references public.student(id) on delete cascade,
  reason          text not null check (char_length(reason) between 1 and 200),
  pickup_name     text not null check (char_length(pickup_name) between 1 and 80),
  pickup_relation text check (pickup_relation is null or char_length(pickup_relation) <= 40),
  pickup_phone    text check (pickup_phone is null or char_length(pickup_phone) <= 16),
  leave_at        timestamptz not null,
  status          text not null default 'requested' check (status in ('requested', 'approved', 'rejected', 'left', 'cancelled')),
  requested_by    uuid not null default auth.uid(),
  decided_by      bigint references public.staff(id) on delete set null,
  decision_note   text check (decision_note is null or char_length(decision_note) <= 200),
  left_at         timestamptz,
  created_at      timestamptz not null default now()
);
create index if not exists idx_gate_pass_school on public.gate_pass (school_id, leave_at desc);

create table if not exists public.health_visit (
  id             bigint generated always as identity primary key,
  school_id      bigint not null default public.current_school_id() references public.school(id) on delete cascade,
  student_id     bigint not null references public.student(id) on delete cascade,
  visited_at     timestamptz not null default now(),
  complaint      text not null check (char_length(complaint) between 1 and 200),
  action_taken   text check (action_taken is null or char_length(action_taken) <= 300),
  sent_home      boolean not null default false,
  tell_parent    boolean not null default true,
  recorded_by    bigint references public.staff(id) on delete set null
);
create index if not exists idx_health_visit_student on public.health_visit (student_id, visited_at desc);

do $$ declare t text; begin
  foreach t in array array['visitor', 'gate_pass', 'health_visit'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('drop policy if exists tenant_isolation on public.%I', t);
    execute format('create policy tenant_isolation on public.%I as restrictive for all to authenticated using (school_id = (select public.current_school_id())) with check (school_id = (select public.current_school_id()))', t);
    execute format('revoke all on public.%I from anon', t);
    execute format('revoke truncate, trigger, references on public.%I from authenticated', t);
    execute format('grant all on public.%I to service_role', t);
  end loop;
end $$;
grant select, insert, update, delete on public.visitor to authenticated;
drop policy if exists v_all on public.visitor;
create policy v_all on public.visitor for all to authenticated using ((select app.is_admin_scope())) with check ((select app.is_admin_scope()));

grant select, insert, update on public.gate_pass to authenticated;
drop policy if exists gp_read on public.gate_pass;
create policy gp_read on public.gate_pass for select to authenticated using ((select app.is_admin_scope()) or app.owns_student(student_id));
drop policy if exists gp_parent_ask on public.gate_pass;
create policy gp_parent_ask on public.gate_pass for insert to authenticated
  with check (((select app.is_admin_scope()) or app.owns_student(student_id)) and status = 'requested' and requested_by = auth.uid());
drop policy if exists gp_office on public.gate_pass;
create policy gp_office on public.gate_pass for update to authenticated using ((select app.is_admin_scope())) with check ((select app.is_admin_scope()));
-- a parent may only cancel their own request
drop policy if exists gp_parent_cancel on public.gate_pass;
create policy gp_parent_cancel on public.gate_pass for update to authenticated
  using (requested_by = auth.uid() and status = 'requested') with check (requested_by = auth.uid() and status = 'cancelled');

grant select, insert, update on public.health_visit to authenticated;
drop policy if exists hv_read on public.health_visit;
create policy hv_read on public.health_visit for select to authenticated using ((select app.is_admin_scope()) or app.owns_student(student_id));
drop policy if exists hv_write on public.health_visit;
create policy hv_write on public.health_visit for all to authenticated using ((select app.is_admin_scope())) with check ((select app.is_admin_scope()));

create or replace function public.front_desk_same_school() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if not exists (select 1 from public.student s where s.id = new.student_id and s.school_id = new.school_id) then raise exception 'That student is not at this institution'; end if;
  return new;
end $$;
drop trigger if exists trg_gate_pass_same_school on public.gate_pass;
create trigger trg_gate_pass_same_school before insert or update on public.gate_pass for each row execute function public.front_desk_same_school();
drop trigger if exists trg_health_same_school on public.health_visit;
create trigger trg_health_same_school before insert or update on public.health_visit for each row execute function public.front_desk_same_school();

-- ---------- telling parents ----------
insert into public.notification_event_type (key, label, urgent, channels, sort) values
  ('gate_pass', 'Early pick-up (gate pass)', true, '{sms,whatsapp,email}', 15),
  ('health_visit', 'Health room visit', true, '{sms,whatsapp,email}', 16)
on conflict (key) do update set label = excluded.label, urgent = excluded.urgent, channels = excluded.channels, sort = excluded.sort;

create or replace function public.front_desk_notify() returns trigger
language plpgsql security definer set search_path = '' as $$
declare r record; v jsonb; v_school text; v_name text; v_title text; v_body text; v_key text;
begin
  select coalesce(nullif(s.short_name, ''), s.name) into v_school from public.school s where s.id = new.school_id;
  select full_name into v_name from public.student where id = new.student_id;
  if tg_table_name = 'gate_pass' then
    if tg_op = 'UPDATE' and new.status = old.status then return null; end if;
    if new.status = 'approved' then
      v_title := 'Early pick-up approved: {student}'; v_body := '{school}: {student} may leave at {time} with {person}. Reason: {reason}.';
    elsif new.status = 'left' then
      v_title := '{student} has left school'; v_body := '{school}: {student} left school at {time} with {person}.';
    elsif new.status = 'rejected' then
      v_title := 'Early pick-up not approved: {student}'; v_body := '{school}: the early pick-up for {student} was not approved. {note}';
    else return null; end if;
    v := jsonb_build_object('student', v_name, 'school', v_school, 'person', new.pickup_name || coalesce(' (' || new.pickup_relation || ')', ''),
      'time', to_char(coalesce(new.left_at, new.leave_at) at time zone 'Asia/Kolkata', 'HH24:MI, DD/MM'), 'reason', new.reason, 'note', coalesce(new.decision_note, ''));
    v_key := 'gate_pass:' || new.id || ':' || new.status;
    for r in select gs.guardian_id from public.guardian_student gs where gs.student_id = new.student_id and gs.school_id = new.school_id loop
      perform public.notify_safe(new.school_id, 'gate_pass', v_key, r.guardian_id, null, new.student_id, v, v_title, v_body, '/dashboard/front-desk');
    end loop;
  else
    if not new.tell_parent then return null; end if;
    v := jsonb_build_object('student', v_name, 'school', v_school, 'complaint', new.complaint, 'action', coalesce(new.action_taken, ''),
      'home', case when new.sent_home then ' Please collect {student} from school.' else '' end);
    for r in select gs.guardian_id from public.guardian_student gs where gs.student_id = new.student_id and gs.school_id = new.school_id loop
      perform public.notify_safe(new.school_id, 'health_visit', 'health:' || new.id, r.guardian_id, null, new.student_id, v,
        '{student} visited the health room', '{school}: {student} came to the health room ({complaint}). {action}' || case when new.sent_home then ' Please collect ' || v_name || ' from school.' else '' end,
        '/dashboard/front-desk');
    end loop;
  end if;
  return null;
exception when others then raise warning 'front_desk_notify: %', sqlerrm; return null;
end $$;
drop trigger if exists trg_gate_pass_notify on public.gate_pass;
create trigger trg_gate_pass_notify after insert or update of status on public.gate_pass for each row execute function public.front_desk_notify();
drop trigger if exists trg_health_notify on public.health_visit;
create trigger trg_health_notify after insert on public.health_visit for each row execute function public.front_desk_notify();
commit;
