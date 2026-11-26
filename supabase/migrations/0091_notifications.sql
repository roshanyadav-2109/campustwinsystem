-- Notifications: one engine for the in-app inbox and every outside channel.
--
-- * notify(): called by events (absence, fees, results ...). Writes one inbox
--   message per recipient (a parent or staff record) and, for each channel the
--   institution has switched on, one delivery to send. dedupe_key makes a
--   re-run send nothing twice.
-- * Channels: sms, whatsapp, email. Providers: 'off', 'log' (records the exact
--   message, sends nothing: works without any keys), 'http' (a generic
--   provider: the institution's own SMS/WhatsApp gateway URL and body
--   template), 'ses' (Amazon SES email). Provider keys live in Supabase Vault,
--   never readable by any signed-in person.
-- * Templates per event and channel, with {variables}; the institution can
--   override the defaults and set its DLT / WhatsApp template id.
-- * Dispatch: deliveries for 'log' are completed in the database; others are
--   sent by the app's dispatcher (/api/notifications/dispatch), called every
--   minute by pg_cron, with retries (3 attempts, growing delay).
begin;

create table if not exists public.notification_setting (
  school_id   bigint not null default public.current_school_id() references public.school(id) on delete cascade,
  channel     text not null check (channel in ('sms', 'whatsapp', 'email')),
  provider    text not null default 'off' check (provider in ('off', 'log', 'http', 'ses')),
  config      jsonb not null default '{}'::jsonb,       -- non-secret: sender, from address, URL, body template
  secret_id   uuid,                                      -- Vault secret with the keys
  updated_at  timestamptz not null default now(),
  primary key (school_id, channel)
);

create table if not exists public.notification_template (
  id          bigint generated always as identity primary key,
  school_id   bigint references public.school(id) on delete cascade,   -- null = CampusTwin default
  event_key   text not null check (char_length(event_key) <= 60),
  channel     text not null check (channel in ('inbox', 'sms', 'whatsapp', 'email')),
  subject     text check (subject is null or char_length(subject) <= 200),
  body        text not null check (char_length(body) <= 2000),
  external_id text check (external_id is null or char_length(external_id) <= 80),   -- DLT / WhatsApp template id
  active      boolean not null default true
);
create unique index if not exists uq_notification_template on public.notification_template (coalesce(school_id, 0), event_key, channel);

create table if not exists public.notification (
  id           bigint generated always as identity primary key,
  school_id    bigint not null references public.school(id) on delete cascade,
  guardian_id  bigint references public.guardian(id) on delete cascade,
  staff_id     bigint references public.staff(id) on delete cascade,
  student_id   bigint references public.student(id) on delete set null,   -- whom it is about
  event_key    text not null,
  title        text not null check (char_length(title) <= 200),
  body         text not null check (char_length(body) <= 2000),
  link         text check (link is null or char_length(link) <= 300),
  dedupe_key   text not null check (char_length(dedupe_key) <= 200),
  created_at   timestamptz not null default now(),
  read_at      timestamptz,
  check ((guardian_id is not null) <> (staff_id is not null))
);
create unique index if not exists uq_notification_dedupe on public.notification (school_id, dedupe_key, coalesce(guardian_id, 0), coalesce(staff_id, 0));
create index if not exists idx_notification_guardian on public.notification (guardian_id, created_at desc) where guardian_id is not null;
create index if not exists idx_notification_staff on public.notification (staff_id, created_at desc) where staff_id is not null;

create table if not exists public.notification_delivery (
  id              bigint generated always as identity primary key,
  school_id       bigint not null references public.school(id) on delete cascade,
  notification_id bigint not null references public.notification(id) on delete cascade,
  channel         text not null check (channel in ('sms', 'whatsapp', 'email')),
  provider        text not null,
  to_address      text,
  subject         text,
  body            text not null,
  external_id     text,
  status          text not null default 'queued' check (status in ('queued', 'sending', 'sent', 'failed', 'skipped')),
  attempts        int not null default 0,
  last_error      text,
  provider_ref    text,
  next_attempt_at timestamptz not null default now(),
  created_at      timestamptz not null default now(),
  sent_at         timestamptz
);
create index if not exists idx_delivery_due on public.notification_delivery (next_attempt_at) where status = 'queued';
create index if not exists idx_delivery_school on public.notification_delivery (school_id, created_at desc);

-- {name} placeholders from a json object; unknown ones are left empty.
create or replace function public.render_template(p_text text, p_vars jsonb) returns text
language plpgsql immutable as $$
declare k text; v text; out text := coalesce(p_text, '');
begin
  for k, v in select key, value from jsonb_each_text(coalesce(p_vars, '{}'::jsonb)) loop
    out := replace(out, '{' || k || '}', coalesce(v, ''));
  end loop;
  return regexp_replace(out, '\{[a-z_]+\}', '', 'g');
end $$;

-- The one way to send something. p_title/p_body are used when the event has
-- no inbox template. Returns the inbox message id (null when already sent).
create or replace function public.notify(p_school bigint, p_event text, p_dedupe text, p_guardian bigint, p_staff bigint,
                                         p_student bigint, p_vars jsonb, p_title text, p_body text, p_link text default null)
returns bigint language plpgsql security definer set search_path = '' as $$
declare v_id bigint; v_phone text; v_email text; s record; v_body text; v_title text; v_tsub text; v_tbody text; v_text text; v_to text;
begin
  select coalesce(tt.subject, p_title), coalesce(tt.body, p_body) into v_title, v_body
    from (select 1) x left join lateral (
      select subject, body from public.notification_template nt
      where nt.event_key = p_event and nt.channel = 'inbox' and nt.active and (nt.school_id = p_school or nt.school_id is null)
      order by nt.school_id nulls last limit 1) tt on true;
  insert into public.notification (school_id, guardian_id, staff_id, student_id, event_key, title, body, link, dedupe_key)
  values (p_school, p_guardian, p_staff, p_student, p_event,
          left(public.render_template(v_title, p_vars), 200), left(public.render_template(v_body, p_vars), 2000), p_link, p_dedupe)
  on conflict do nothing
  returning id into v_id;
  if v_id is null then return null; end if;   -- already sent for this event

  if p_guardian is not null then select g.phone, g.email into v_phone, v_email from public.guardian g where g.id = p_guardian;
  else select st.phone, st.email into v_phone, v_email from public.staff st where st.id = p_staff; end if;

  for s in select * from public.notification_setting ns where ns.school_id = p_school and ns.provider <> 'off' loop
    v_tsub := null; v_tbody := null; v_text := null;
    select nt.subject, nt.body, nt.external_id into v_tsub, v_tbody, v_text from public.notification_template nt
      where nt.event_key = p_event and nt.channel = s.channel and nt.active and (nt.school_id = p_school or nt.school_id is null)
      order by nt.school_id nulls last limit 1;
    v_to := case when s.channel = 'email' then v_email else v_phone end;
    insert into public.notification_delivery (school_id, notification_id, channel, provider, to_address, subject, body, external_id, status, last_error)
    values (p_school, v_id, s.channel, s.provider, v_to,
            left(public.render_template(coalesce(v_tsub, v_title), p_vars), 200),
            left(public.render_template(coalesce(v_tbody, v_body), p_vars), 2000),
            v_text,
            case when v_to is null then 'skipped' else 'queued' end,
            case when v_to is null then 'No ' || case when s.channel = 'email' then 'email' else 'phone number' end || ' on record' end);
  end loop;
  return v_id;
end $$;
revoke all on function public.notify(bigint, text, text, bigint, bigint, bigint, jsonb, text, text, text) from public, anon, authenticated;
grant execute on function public.notify(bigint, text, text, bigint, bigint, bigint, jsonb, text, text, text) to service_role;

-- 'log' deliveries complete in the database; others wait for the dispatcher.
create or replace function public.complete_log_deliveries() returns int
language sql security definer set search_path = '' as $$
  with done as (
    update public.notification_delivery set status = 'sent', sent_at = now(), attempts = attempts + 1, provider_ref = 'log'
    where status = 'queued' and provider = 'log' returning 1)
  select count(*)::int from done;
$$;
revoke all on function public.complete_log_deliveries() from public, anon, authenticated;

-- The dispatcher takes a batch to send (locked so two runs never send twice) ...
create or replace function public.take_deliveries(p_limit int default 50)
returns table (id bigint, school_id bigint, channel text, provider text, to_address text, subject text, body text, external_id text, config jsonb, secret text)
language plpgsql security definer set search_path = '' as $$
begin
  return query
  with due as (
    select d.id from public.notification_delivery d
    where d.status = 'queued' and d.provider not in ('log', 'off') and d.next_attempt_at <= now()
    order by d.next_attempt_at limit p_limit for update skip locked),
  taken as (
    update public.notification_delivery d set status = 'sending', attempts = d.attempts + 1
    from due where d.id = due.id returning d.*)
  select t.id, t.school_id, t.channel, t.provider, t.to_address, t.subject, t.body, t.external_id, ns.config,
         (select ds.decrypted_secret from vault.decrypted_secrets ds where ds.id = ns.secret_id)
  from taken t left join public.notification_setting ns on ns.school_id = t.school_id and ns.channel = t.channel;
end $$;
revoke all on function public.take_deliveries(int) from public, anon, authenticated;
grant execute on function public.take_deliveries(int) to service_role;

-- ... and reports each result: sent, or failed with a retry later (3 attempts).
create or replace function public.delivery_result(p_id bigint, p_ok boolean, p_ref text, p_error text)
returns void language sql security definer set search_path = '' as $$
  update public.notification_delivery set
    status = case when p_ok then 'sent' when attempts >= 3 then 'failed' else 'queued' end,
    sent_at = case when p_ok then now() end,
    provider_ref = left(p_ref, 200), last_error = left(p_error, 500),
    next_attempt_at = case when p_ok then next_attempt_at else now() + (attempts * interval '5 minutes') end
  where id = p_id;
$$;
revoke all on function public.delivery_result(bigint, boolean, text, text) from public, anon, authenticated;
grant execute on function public.delivery_result(bigint, boolean, text, text) to service_role;

-- The office sets a channel's keys; they go straight into Vault.
create or replace function public.set_notification_secret(p_channel text, p_secret text) returns void
language plpgsql security definer set search_path = '' as $$
declare v_school bigint := public.current_school_id(); v_id uuid;
begin
  if not coalesce(app.is_office(), false) then raise exception 'Only the office can change message settings'; end if;
  if p_channel not in ('sms', 'whatsapp', 'email') then raise exception 'Unknown channel'; end if;
  select secret_id into v_id from public.notification_setting where school_id = v_school and channel = p_channel;
  if v_id is null then
    v_id := vault.create_secret(p_secret, 'ntf:' || v_school || ':' || p_channel || ':' || gen_random_uuid(), 'CampusTwin message keys');
    insert into public.notification_setting (school_id, channel, secret_id) values (v_school, p_channel, v_id)
      on conflict (school_id, channel) do update set secret_id = excluded.secret_id, updated_at = now();
  else
    perform vault.update_secret(v_id, p_secret);
    update public.notification_setting set updated_at = now() where school_id = v_school and channel = p_channel;
  end if;
end $$;
revoke all on function public.set_notification_secret(text, text) from public, anon;
grant execute on function public.set_notification_secret(text, text) to authenticated;

-- The person's own inbox: as a parent, or as staff, at this institution.
create or replace function public.my_notifications(p_limit int default 50)
returns setof public.notification language sql stable security definer set search_path = '' as $$
  select n.* from public.notification n
  where n.school_id = public.current_school_id()
    and ((n.guardian_id is not null and n.guardian_id = app.my_guardian_id()) or (n.staff_id is not null and n.staff_id = app.my_staff_id()))
  order by n.created_at desc limit greatest(1, least(p_limit, 200));
$$;
grant execute on function public.my_notifications(int) to authenticated;

create or replace function public.mark_notifications_read(p_ids bigint[]) returns int
language sql security definer set search_path = '' as $$
  with r as (
    update public.notification n set read_at = now()
    where n.id = any(p_ids) and n.read_at is null and n.school_id = public.current_school_id()
      and ((n.guardian_id is not null and n.guardian_id = app.my_guardian_id()) or (n.staff_id is not null and n.staff_id = app.my_staff_id()))
    returning 1)
  select count(*)::int from r;
$$;
grant execute on function public.mark_notifications_read(bigint[]) to authenticated;

alter table public.notification_setting  enable row level security;
alter table public.notification_template enable row level security;
alter table public.notification          enable row level security;
alter table public.notification_delivery enable row level security;
-- settings and delivery log: office and principal of the institution; nobody reads secrets
drop policy if exists ns_read on public.notification_setting;
create policy ns_read on public.notification_setting for select to authenticated using (school_id = (select public.current_school_id()) and (select app.is_admin_scope()));
drop policy if exists ns_write on public.notification_setting;
create policy ns_write on public.notification_setting for all to authenticated
  using (school_id = (select public.current_school_id()) and (select app.is_office())) with check (school_id = (select public.current_school_id()) and (select app.is_office()));
drop policy if exists nt_read on public.notification_template;
create policy nt_read on public.notification_template for select to authenticated using (school_id is null or (school_id = (select public.current_school_id()) and (select app.is_admin_scope())));
drop policy if exists nt_write on public.notification_template;
create policy nt_write on public.notification_template for all to authenticated
  using (school_id = (select public.current_school_id()) and (select app.is_office())) with check (school_id = (select public.current_school_id()) and (select app.is_office()));
drop policy if exists nd_read on public.notification_delivery;
create policy nd_read on public.notification_delivery for select to authenticated using (school_id = (select public.current_school_id()) and (select app.is_admin_scope()));
-- inbox rows only through my_notifications(); office/principal can see what was sent
drop policy if exists n_read on public.notification;
create policy n_read on public.notification for select to authenticated using (school_id = (select public.current_school_id()) and (select app.is_admin_scope()));
grant select, insert, update, delete on public.notification_setting, public.notification_template to authenticated;
revoke update (secret_id) on public.notification_setting from authenticated;
grant select on public.notification, public.notification_delivery to authenticated;
grant all on public.notification_setting, public.notification_template, public.notification, public.notification_delivery to service_role;

-- Every minute: complete 'log' deliveries; wake the app's dispatcher when real ones wait.
create or replace function public.dispatch_notifications() returns text
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_log int; v_wait int; v_url text := app.vault_secret('notify_dispatch_url'); v_key text := app.vault_secret('notify_dispatch_key');
begin
  v_log := public.complete_log_deliveries();
  select count(*) into v_wait from public.notification_delivery where status = 'queued' and provider not in ('log', 'off') and next_attempt_at <= now();
  if v_wait > 0 and v_url is not null and v_key is not null then
    perform net.http_post(url := v_url, headers := jsonb_build_object('Content-Type', 'application/json', 'x-dispatch-key', v_key), body := '{}'::jsonb);
  end if;
  return format('log %s, waiting %s', v_log, v_wait);
end $$;
revoke all on function public.dispatch_notifications() from public, anon, authenticated;
do $$ begin
  perform cron.unschedule(jobid) from cron.job where jobname = 'notifications-dispatch';
  perform cron.schedule('notifications-dispatch', '* * * * *', 'select public.dispatch_notifications()');
end $$;
commit;
