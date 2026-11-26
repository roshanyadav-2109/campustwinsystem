-- Notifications, after the product + CTO review of 0091.
-- Security: the office can no longer set secret_id or bypass validation;
--   take_deliveries only decrypts the institution's own channel secret.
-- Reliability: rows stuck in 'sending' are retried; urgent messages first;
--   one institution cannot hold up the others; old logs are purged.
-- Product: an event catalogue with default channels per event (SMS only for
--   what matters), the office's own per-event choice, phone numbers
--   normalised to 91XXXXXXXXXX, one SMS per number per event (parents who
--   share a phone), quiet hours 9 pm to 7 am IST for non-urgent SMS/WhatsApp,
--   and a daily limit per channel.
begin;

-- ---------- event catalogue ----------
create table if not exists public.notification_event_type (
  key       text primary key,
  label     text not null,
  urgent    boolean not null default false,
  channels  text[] not null default '{}',       -- default outside channels
  sort      int not null default 100
);
insert into public.notification_event_type (key, label, urgent, channels, sort) values
  ('absence',          'Student absent today',            true,  '{sms,whatsapp,email}', 10),
  ('emergency',        'Emergency or school closed',      true,  '{sms,whatsapp,email}', 20),
  ('fee_due',          'Fee due reminder',                false, '{sms,whatsapp,email}', 30),
  ('fee_receipt',      'Fee payment received',            false, '{whatsapp,email}',     40),
  ('result_published', 'Results and report cards',        false, '{sms,whatsapp,email}', 50),
  ('leave_decision',   'Leave approved or declined',      false, '{email}',              60),
  ('announcement',     'Announcements',                   false, '{email}',              70),
  ('homework',         'Homework',                        false, '{}',                   80),
  ('admission_status', 'Admission application updates',   false, '{sms,email}',          90),
  ('test',             'Test message',                    true,  '{sms,whatsapp,email}', 999)
on conflict (key) do update set label = excluded.label, urgent = excluded.urgent, channels = excluded.channels, sort = excluded.sort;
alter table public.notification_event_type enable row level security;
drop policy if exists net_read on public.notification_event_type;
create policy net_read on public.notification_event_type for select to authenticated using (true);
grant select on public.notification_event_type to authenticated;
grant all on public.notification_event_type to service_role;

-- the office's own choice per event and channel (absent row = the default)
create table if not exists public.notification_event_channel (
  school_id  bigint not null default public.current_school_id() references public.school(id) on delete cascade,
  event_key  text not null references public.notification_event_type(key) on delete cascade,
  channel    text not null check (channel in ('sms', 'whatsapp', 'email')),
  enabled    boolean not null,
  primary key (school_id, event_key, channel)
);
alter table public.notification_event_channel enable row level security;
drop policy if exists nec_read on public.notification_event_channel;
create policy nec_read on public.notification_event_channel for select to authenticated using (school_id = (select public.current_school_id()) and (select app.is_admin_scope()));
drop policy if exists nec_write on public.notification_event_channel;
create policy nec_write on public.notification_event_channel for all to authenticated
  using (school_id = (select public.current_school_id()) and (select app.is_office())) with check (school_id = (select public.current_school_id()) and (select app.is_office()));
grant select, insert, update, delete on public.notification_event_channel to authenticated;
grant all on public.notification_event_channel to service_role;

-- ---------- settings: column grants + validation ----------
alter table public.notification_setting add column if not exists daily_limit int check (daily_limit is null or daily_limit between 0 and 1000000);
revoke insert, update on public.notification_setting from authenticated;
grant insert (channel, provider, config, daily_limit, updated_at) on public.notification_setting to authenticated;
grant update (provider, config, daily_limit, updated_at) on public.notification_setting to authenticated;

create or replace function public.check_notification_setting() returns trigger
language plpgsql set search_path = '' as $$
begin
  if not (new.channel = 'email' and new.provider in ('off', 'log', 'ses')
       or new.channel in ('sms', 'whatsapp') and new.provider in ('off', 'log', 'http')) then
    raise exception 'That provider is not available for %', new.channel;
  end if;
  if new.provider = 'http' and coalesce(new.config ->> 'url', '') !~ '^https://[^\s/]+' then
    raise exception 'The provider address must start with https://';
  end if;
  if new.provider = 'ses' and (coalesce(new.config ->> 'region', '') !~ '^[a-z]{2}-[a-z]+-\d$' or coalesce(new.config ->> 'from', '') !~ '@') then
    raise exception 'Amazon SES needs a region and a from address';
  end if;
  if octet_length(new.config::text) > 6000 then raise exception 'Settings are too long'; end if;
  return new;
end $$;
drop trigger if exists trg_check_notification_setting on public.notification_setting;
create trigger trg_check_notification_setting before insert or update on public.notification_setting
  for each row execute function public.check_notification_setting();

-- ---------- deliveries: priority, dedupe per number, taken_at ----------
alter table public.notification_delivery add column if not exists priority smallint not null default 5;
alter table public.notification_delivery add column if not exists dedupe_key text;
alter table public.notification_delivery add column if not exists taken_at timestamptz;
create unique index if not exists uq_delivery_per_address on public.notification_delivery (school_id, channel, to_address, dedupe_key)
  where to_address is not null and dedupe_key is not null;
drop index if exists public.idx_delivery_due;
create index if not exists idx_delivery_due on public.notification_delivery (priority, next_attempt_at) where status = 'queued';

-- 10-digit Indian mobile -> 91XXXXXXXXXX; already with 91 -> kept; else null
create or replace function public.normalise_phone(p text) returns text
language sql immutable as $$
  select case
    when d ~ '^[6-9][0-9]{9}$' then '91' || d
    when d ~ '^91[6-9][0-9]{9}$' then d
    when d ~ '^0[6-9][0-9]{9}$' then '91' || substr(d, 2)
    else null end
  from (select regexp_replace(coalesce(p, ''), '\D', '', 'g') d) x;
$$;

-- next 07:00 IST if it is now between 21:00 and 07:00 IST
create or replace function public.after_quiet_hours(p_at timestamptz) returns timestamptz
language sql stable as $$
  select case
    when extract(hour from p_at at time zone 'Asia/Kolkata') >= 21
      then ((date_trunc('day', p_at at time zone 'Asia/Kolkata') + interval '1 day 7 hours') at time zone 'Asia/Kolkata')
    when extract(hour from p_at at time zone 'Asia/Kolkata') < 7
      then ((date_trunc('day', p_at at time zone 'Asia/Kolkata') + interval '7 hours') at time zone 'Asia/Kolkata')
    else p_at end;
$$;

create or replace function public.notify(p_school bigint, p_event text, p_dedupe text, p_guardian bigint, p_staff bigint,
                                         p_student bigint, p_vars jsonb, p_title text, p_body text, p_link text default null)
returns bigint language plpgsql security definer set search_path = '' as $$
declare v_id bigint; v_phone text; v_email text; s record; v_body text; v_title text; v_tsub text; v_tbody text; v_text text;
  v_to text; v_raw text; v_type record; v_on boolean; v_status text; v_err text; v_due timestamptz; v_sent int;
begin
  -- the recipient must belong to this institution
  if p_guardian is not null then
    select g.phone, g.email into v_phone, v_email from public.guardian g where g.id = p_guardian and g.school_id = p_school;
  elsif p_staff is not null then
    select st.phone, st.email into v_phone, v_email from public.staff st where st.id = p_staff and st.school_id = p_school;
  end if;
  if not found then raise exception 'Recipient is not at this institution'; end if;

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

  select * into v_type from public.notification_event_type where key = p_event;
  for s in select * from public.notification_setting ns where ns.school_id = p_school and ns.provider <> 'off' loop
    -- is this channel on for this event? the office's choice, else the default
    select ec.enabled into v_on from public.notification_event_channel ec where ec.school_id = p_school and ec.event_key = p_event and ec.channel = s.channel;
    if v_on is null then v_on := coalesce(s.channel = any(v_type.channels), false); end if;
    if not v_on then continue; end if;

    v_tsub := null; v_tbody := null; v_text := null;
    select nt.subject, nt.body, nt.external_id into v_tsub, v_tbody, v_text from public.notification_template nt
      where nt.event_key = p_event and nt.channel = s.channel and nt.active and (nt.school_id = p_school or nt.school_id is null)
      order by nt.school_id nulls last limit 1;
    v_raw := case when s.channel = 'email' then v_email else v_phone end;
    v_to := case when s.channel = 'email' then nullif(trim(lower(v_email)), '') else public.normalise_phone(v_phone) end;
    v_status := 'queued'; v_err := null; v_due := now();
    if v_to is null then
      v_status := 'skipped';
      v_err := case when v_raw is null or trim(v_raw) = '' then 'No ' || case when s.channel = 'email' then 'email' else 'phone number' end || ' on record'
                    else 'Phone number is not a valid mobile number' end;
    elsif s.daily_limit is not null then
      select count(*) into v_sent from public.notification_delivery d
        where d.school_id = p_school and d.channel = s.channel and d.status in ('queued', 'sending', 'sent')
          and d.created_at >= (date_trunc('day', now() at time zone 'Asia/Kolkata') at time zone 'Asia/Kolkata');
      if v_sent >= s.daily_limit then v_status := 'skipped'; v_err := 'Daily limit reached'; end if;
    end if;
    if v_status = 'queued' and s.channel <> 'email' and not coalesce(v_type.urgent, false) then v_due := public.after_quiet_hours(now()); end if;
    insert into public.notification_delivery (school_id, notification_id, channel, provider, to_address, subject, body, external_id,
                                              status, last_error, priority, dedupe_key, next_attempt_at)
    values (p_school, v_id, s.channel, s.provider, v_to,
            left(public.render_template(coalesce(v_tsub, v_title), p_vars), 200),
            left(public.render_template(coalesce(v_tbody, v_body), p_vars), 2000),
            v_text, v_status, v_err, case when coalesce(v_type.urgent, false) then 1 else 5 end, p_dedupe, v_due)
    on conflict do nothing;   -- the same number already gets this message (parents sharing a phone)
  end loop;
  return v_id;
end $$;
revoke all on function public.notify(bigint, text, text, bigint, bigint, bigint, jsonb, text, text, text) from public, anon, authenticated;
grant execute on function public.notify(bigint, text, text, bigint, bigint, bigint, jsonb, text, text, text) to service_role;

-- urgent first; at most 10 per institution per batch; only the channel's own secret
drop function if exists public.take_deliveries(int);
create function public.take_deliveries(p_limit int default 50)
returns table (id bigint, school_id bigint, channel text, provider text, to_address text, subject text, body text, external_id text, config jsonb, secret text)
language plpgsql security definer set search_path = '' as $$
begin
  return query
  with ranked as (
    select d.id, row_number() over (partition by d.school_id order by d.priority, d.next_attempt_at) rn, d.priority, d.next_attempt_at
    from public.notification_delivery d
    where d.status = 'queued' and d.provider not in ('log', 'off') and d.next_attempt_at <= now()),
  pick as (
    select r.id from ranked r where r.rn <= 10 order by r.priority, r.next_attempt_at limit p_limit),
  due as (
    select d.id from public.notification_delivery d join pick on pick.id = d.id for update of d skip locked),
  taken as (
    update public.notification_delivery d set status = 'sending', attempts = d.attempts + 1, taken_at = now()
    from due where d.id = due.id returning d.*)
  select t.id, t.school_id, t.channel, t.provider, t.to_address, t.subject, t.body, t.external_id, ns.config,
         (select ds.decrypted_secret from vault.decrypted_secrets ds
           where ds.id = ns.secret_id and ds.name like 'ntf:' || t.school_id || ':' || t.channel || ':%')
  from taken t left join public.notification_setting ns on ns.school_id = t.school_id and ns.channel = t.channel;
end $$;
revoke all on function public.take_deliveries(int) from public, anon, authenticated;
grant execute on function public.take_deliveries(int) to service_role;

-- every minute: complete test mode, requeue stuck sends, wake the dispatcher
create or replace function public.dispatch_notifications() returns text
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_log int; v_stuck int; v_url text; v_key text;
begin
  v_log := public.complete_log_deliveries();
  with s as (
    update public.notification_delivery set status = case when attempts >= 3 then 'failed' else 'queued' end,
      last_error = coalesce(last_error, 'Sending did not finish; retried')
    where status = 'sending' and taken_at < now() - interval '10 minutes' returning 1)
  select count(*) into v_stuck from s;
  if exists (select 1 from public.notification_delivery where status = 'queued' and provider not in ('log', 'off') and next_attempt_at <= now()) then
    v_url := app.vault_secret('notify_dispatch_url'); v_key := app.vault_secret('notify_dispatch_key');
    if v_url is not null and v_key is not null then
      perform net.http_post(url := v_url, headers := jsonb_build_object('Content-Type', 'application/json', 'x-dispatch-key', v_key),
                            body := '{}'::jsonb, timeout_milliseconds := 25000);
    end if;
  end if;
  return format('log %s, stuck %s', v_log, v_stuck);
end $$;
revoke all on function public.dispatch_notifications() from public, anon, authenticated;

-- results: keep only a short reference; never store a gateway's whole reply
create or replace function public.delivery_result(p_id bigint, p_ok boolean, p_ref text, p_error text)
returns void language sql security definer set search_path = '' as $$
  update public.notification_delivery set
    status = case when p_ok then 'sent' when attempts >= 3 then 'failed' else 'queued' end,
    sent_at = case when p_ok then now() end,
    provider_ref = left(p_ref, 80), last_error = left(p_error, 200),
    next_attempt_at = case when p_ok then next_attempt_at else now() + (attempts * interval '5 minutes') end
  where id = p_id and status = 'sending';
$$;

-- other staff's inbox messages are private (HR, payroll later); office and
-- principal see what went to families
drop policy if exists n_read on public.notification;
create policy n_read on public.notification for select to authenticated
  using (school_id = (select public.current_school_id()) and (select app.is_admin_scope()) and guardian_id is not null);

-- housekeeping: delivery log 180 days, cron history 7 days (weekly, Sunday 03:30)
do $$ begin
  perform cron.unschedule(jobid) from cron.job where jobname = 'notifications-purge';
  perform cron.schedule('notifications-purge', '30 22 * * 6',
    $q$delete from public.notification_delivery where created_at < now() - interval '180 days';
       delete from cron.job_run_details where end_time < now() - interval '7 days';$q$);
end $$;
commit;
