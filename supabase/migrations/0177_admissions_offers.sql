-- Admissions extras (schools): offers with a letter and a date, a waiting list that moves on its own,
-- messages to the family at every step, and the application fee paid online from a private status page.
begin;
alter table public.admission_enquiry
  add column if not exists public_token text unique default encode(extensions.gen_random_bytes(16), 'hex'),
  add column if not exists offer_no text, add column if not exists offered_at timestamptz, add column if not exists offer_expires_on date,
  add column if not exists waitlisted_at timestamptz, add column if not exists decided_at timestamptz,
  add column if not exists decision_note text check (decision_note is null or char_length(decision_note) <= 200);
update public.admission_enquiry set public_token = encode(extensions.gen_random_bytes(16), 'hex') where public_token is null;
alter table public.admission_enquiry drop constraint if exists admission_enquiry_status_check;
alter table public.admission_enquiry add constraint admission_enquiry_status_check check (status in
  ('new', 'contacted', 'visit_scheduled', 'applied', 'offered', 'accepted', 'waitlisted', 'declined', 'admitted', 'not_interested'));
create unique index if not exists uq_admission_offer_no on public.admission_enquiry (school_id, offer_no) where offer_no is not null;
create index if not exists idx_admission_waitlist on public.admission_enquiry (academic_year_id, class_id, waitlisted_at) where status = 'waitlisted';
create index if not exists idx_admission_offer_due on public.admission_enquiry (offer_expires_on) where status = 'offered';
alter table public.school add column if not exists application_fee numeric(10,2) check (application_fee is null or application_fee >= 0),
  add column if not exists offer_days int not null default 7 check (offer_days between 1 and 60),
  add column if not exists auto_waitlist boolean not null default true;

-- payments may be for an application (no bill or student yet)
alter table public.payment_order alter column invoice_id drop not null, alter column student_id drop not null, alter column created_by drop not null;
alter table public.payment_order add column if not exists enquiry_id bigint references public.admission_enquiry(id) on delete restrict;
alter table public.payment_order drop constraint if exists payment_order_target_check;
alter table public.payment_order add constraint payment_order_target_check check ((invoice_id is not null and student_id is not null) or enquiry_id is not null);
create index if not exists idx_payment_order_enquiry on public.payment_order (enquiry_id) where enquiry_id is not null;

-- messages to applicant families (no login yet)
alter table public.notification add column if not exists enquiry_id bigint references public.admission_enquiry(id) on delete cascade;
alter table public.notification drop constraint if exists notification_check;
alter table public.notification add constraint notification_check check (
  ((guardian_id is not null) <> (staff_id is not null))
  or (guardian_id is null and staff_id is null and (student_id is not null or enquiry_id is not null)));
insert into public.notification_event_type (key, label, urgent, channels, sort)
values ('admission_update', 'Admission updates to applicants', false, array['sms', 'whatsapp', 'email'], 96) on conflict (key) do nothing;

create or replace function public.notify_applicant(p_school bigint, p_enquiry bigint, p_event text, p_dedupe text, p_vars jsonb, p_title text, p_body text, p_link text default null)
returns bigint language plpgsql security definer set search_path = '' as $$
declare v_id bigint; v_phone text; v_email text; s record; v_body text; v_title text; v_tsub text; v_tbody text; v_text text;
  v_to text; v_raw text; v_type record; v_on boolean; v_status text; v_err text; v_due timestamptz; v_sent int;
begin
  select e.phone, e.email into v_phone, v_email from public.admission_enquiry e where e.id = p_enquiry and e.school_id = p_school;
  if not found then raise exception 'Unknown application'; end if;
  select coalesce(tt.subject, p_title), coalesce(tt.body, p_body) into v_title, v_body
    from (select 1) x left join lateral (
      select subject, body from public.notification_template nt
      where nt.event_key = p_event and nt.channel = 'inbox' and nt.active and (nt.school_id = p_school or nt.school_id is null)
      order by nt.school_id nulls last limit 1) tt on true;
  insert into public.notification (school_id, guardian_id, staff_id, student_id, enquiry_id, event_key, title, body, link, dedupe_key)
  values (p_school, null, null, null, p_enquiry, p_event,
          left(public.render_template(v_title, p_vars), 200), left(public.render_template(v_body, p_vars), 2000), p_link, 'e' || p_enquiry || ':' || p_dedupe)
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
    -- a student and a parent often share one number: the same message goes to it once
    if v_status = 'queued' and public.is_higher_ed(p_school) and exists (select 1 from public.notification_delivery d
         where d.school_id = p_school and d.channel = s.channel and d.to_address = v_to and d.created_at > now() - interval '1 day'
           and d.body = left(public.render_template(coalesce(v_tbody, v_body), p_vars), 2000)) then
      v_status := 'skipped'; v_err := 'The same message already went to this number';
    end if;
    if v_status = 'queued' and s.channel <> 'email' and not coalesce(v_type.urgent, false) then v_due := public.after_quiet_hours(now()); end if;
    insert into public.notification_delivery (school_id, notification_id, channel, provider, to_address, subject, body, external_id,
                                              status, last_error, priority, dedupe_key, next_attempt_at)
    values (p_school, v_id, s.channel, s.provider, v_to,
            left(public.render_template(coalesce(v_tsub, v_title), p_vars), 200),
            left(public.render_template(coalesce(v_tbody, v_body), p_vars), 2000),
            v_text, v_status, v_err, case when coalesce(v_type.urgent, false) then 1 else 5 end, 'e' || p_enquiry || ':' || p_dedupe, v_due)
    on conflict do nothing;   -- the same number already gets this message (parents sharing a phone)
  end loop;
  return v_id;
end $$;
revoke all on function public.notify_applicant(bigint, bigint, text, text, jsonb, text, text, text) from public, anon, authenticated;

create or replace function public.admission_taken(p_year bigint, p_class bigint) returns int
language sql stable security definer set search_path = '' as $$
  select count(*)::int from public.admission_enquiry e
  where e.class_id = p_class and e.academic_year_id = p_year
    and (e.status in ('admitted', 'offered', 'accepted') or e.seat_claimed_at > now() - interval '10 minutes');
$$;

create or replace function public.claim_admission_seat(p_enquiry bigint) returns void
language plpgsql security definer set search_path = '' as $$
declare e public.admission_enquiry; v_seats int;
begin
  if not coalesce(app.is_office(), false) then raise exception 'Only the office can admit'; end if;
  select * into e from public.admission_enquiry where id = p_enquiry and school_id = public.current_school_id() for update;
  if e.id is null then raise exception 'Unknown enquiry'; end if;
  if e.status in ('admitted', 'offered', 'accepted') or e.seat_claimed_at > now() - interval '10 minutes' then return; end if;
  perform pg_advisory_xact_lock(hashtextextended('admission_seat:' || e.academic_year_id || ':' || e.class_id, 0));
  select seats into v_seats from public.admission_seat where academic_year_id = e.academic_year_id and class_id = e.class_id;
  if v_seats is not null and public.admission_taken(e.academic_year_id, e.class_id) >= v_seats then
    raise exception 'All % seats in this class are taken', v_seats;
  end if;
  update public.admission_enquiry set seat_claimed_at = now() where id = e.id;
end $$;

-- the next waitlisted applicants get the seats that are free (best score first, then who waited longest)
create or replace function public.promote_waitlist(p_year bigint, p_class bigint) returns int
language plpgsql security definer set search_path = '' as $$
declare v_seats int; v_school bigint; e record; n int := 0; v_days int; v_auto boolean;
begin
  select c.school_id into v_school from public.class c where c.id = p_class;
  select offer_days, auto_waitlist into v_days, v_auto from public.school where id = v_school;
  if not coalesce(v_auto, true) then return 0; end if;
  perform pg_advisory_xact_lock(hashtextextended('admission_seat:' || p_year || ':' || p_class, 0));
  select seats into v_seats from public.admission_seat where academic_year_id = p_year and class_id = p_class;
  for e in select x.id from public.admission_enquiry x where x.academic_year_id = p_year and x.class_id = p_class and x.status = 'waitlisted'
           order by x.score desc nulls last, x.waitlisted_at, x.id loop
    exit when v_seats is not null and public.admission_taken(p_year, p_class) >= v_seats;
    perform public.issue_offer(e.id, (now() at time zone 'Asia/Kolkata')::date + v_days);
    n := n + 1;
  end loop;
  return n;
end $$;
revoke all on function public.promote_waitlist(bigint, bigint) from public, anon, authenticated;

-- an offer: a seat held until the date, with a number for the letter
create or replace function public.issue_offer(p_enquiry bigint, p_until date) returns text
language plpgsql security definer set search_path = '' as $$
declare e public.admission_enquiry; v_no text;
begin
  select * into e from public.admission_enquiry where id = p_enquiry for update;
  perform pg_advisory_xact_lock(hashtext('admission-offer-no'), e.school_id::int);
  select 'OF-' || to_char(now() at time zone 'Asia/Kolkata', 'YYYY') || '-' || lpad((count(*) + 1)::text, 4, '0') into v_no
    from public.admission_enquiry where school_id = e.school_id and offer_no like 'OF-' || to_char(now() at time zone 'Asia/Kolkata', 'YYYY') || '-%';
  update public.admission_enquiry set status = 'offered', offer_no = coalesce(e.offer_no, v_no), offered_at = now(), offer_expires_on = p_until,
         seat_claimed_at = null, decided_at = null, decision_note = null where id = p_enquiry;
  return coalesce(e.offer_no, v_no);
end $$;
revoke all on function public.issue_offer(bigint, date) from public, anon, authenticated;

create or replace function public.make_offer(p_enquiry bigint, p_until date default null) returns text
language plpgsql security definer set search_path = '' as $$
declare e public.admission_enquiry; v_seats int; v_days int;
begin
  if not coalesce(app.is_office(), false) then raise exception 'Only the office can offer a seat'; end if;
  select * into e from public.admission_enquiry where id = p_enquiry and school_id = public.current_school_id() for update;
  if e.id is null then raise exception 'Unknown application'; end if;
  if e.status in ('admitted', 'offered', 'accepted') then raise exception 'This application already has a seat'; end if;
  if p_until is not null and p_until < (now() at time zone 'Asia/Kolkata')::date then raise exception 'The offer must be open until today or later'; end if;
  perform pg_advisory_xact_lock(hashtextextended('admission_seat:' || e.academic_year_id || ':' || e.class_id, 0));
  select seats into v_seats from public.admission_seat where academic_year_id = e.academic_year_id and class_id = e.class_id;
  if v_seats is not null and public.admission_taken(e.academic_year_id, e.class_id) >= v_seats then
    raise exception 'All % seats in this class are taken; put the application on the waiting list', v_seats;
  end if;
  select offer_days into v_days from public.school where id = e.school_id;
  return public.issue_offer(e.id, coalesce(p_until, (now() at time zone 'Asia/Kolkata')::date + v_days));
end $$;
revoke all on function public.make_offer(bigint, date) from public, anon;
grant execute on function public.make_offer(bigint, date) to authenticated;

create or replace function public.waitlist_application(p_enquiry bigint) returns int
language plpgsql security definer set search_path = '' as $$
declare e public.admission_enquiry;
begin
  if not coalesce(app.is_office(), false) then raise exception 'Only the office can do this'; end if;
  select * into e from public.admission_enquiry where id = p_enquiry and school_id = public.current_school_id() for update;
  if e.id is null then raise exception 'Unknown application'; end if;
  if e.status = 'admitted' then raise exception 'This child is already admitted'; end if;
  update public.admission_enquiry set status = 'waitlisted', waitlisted_at = coalesce(waitlisted_at, now()), seat_claimed_at = null, offer_expires_on = null where id = e.id;
  perform public.promote_waitlist(e.academic_year_id, e.class_id) where e.status in ('offered', 'accepted');
  return (select count(*)::int from public.admission_enquiry x where x.academic_year_id = e.academic_year_id and x.class_id = e.class_id and x.status = 'waitlisted'
            and (x.score is not distinct from e.score and x.waitlisted_at <= (select waitlisted_at from public.admission_enquiry where id = e.id) or x.score > e.score or (x.score is not null and e.score is null)));
end $$;
revoke all on function public.waitlist_application(bigint) from public, anon;
grant execute on function public.waitlist_application(bigint) to authenticated;

-- an offer withdrawn by the office, or declined by the family: the seat goes to the waiting list
create or replace function public.close_offer(p_enquiry bigint, p_note text) returns void
language plpgsql security definer set search_path = '' as $$
declare e public.admission_enquiry;
begin
  select * into e from public.admission_enquiry where id = p_enquiry for update;
  update public.admission_enquiry set status = 'declined', decided_at = now(), decision_note = left(p_note, 200), seat_claimed_at = null where id = e.id;
  perform public.promote_waitlist(e.academic_year_id, e.class_id);
end $$;
revoke all on function public.close_offer(bigint, text) from public, anon, authenticated;

create or replace function public.withdraw_offer(p_enquiry bigint, p_note text default null) returns void
language plpgsql security definer set search_path = '' as $$
begin
  if not coalesce(app.is_office(), false) then raise exception 'Only the office can withdraw an offer'; end if;
  if not exists (select 1 from public.admission_enquiry where id = p_enquiry and school_id = public.current_school_id() and status in ('offered', 'accepted')) then
    raise exception 'There is no open offer to withdraw';
  end if;
  perform public.close_offer(p_enquiry, coalesce(nullif(trim(p_note), ''), 'Withdrawn by the school'));
end $$;
revoke all on function public.withdraw_offer(bigint, text) from public, anon;
grant execute on function public.withdraw_offer(bigint, text) to authenticated;

-- the family answers on the status page (no login: the private link is the key)
create or replace function public.respond_offer(p_token text, p_accept boolean) returns text
language plpgsql security definer set search_path = '' as $$
declare e public.admission_enquiry;
begin
  select * into e from public.admission_enquiry where public_token = p_token and length(p_token) = 32 for update;
  if e.id is null then raise exception 'This link is not valid'; end if;
  if e.status <> 'offered' then raise exception 'There is no open offer on this application'; end if;
  if e.offer_expires_on < (now() at time zone 'Asia/Kolkata')::date then raise exception 'This offer has lapsed'; end if;
  if p_accept then
    update public.admission_enquiry set status = 'accepted', decided_at = now() where id = e.id;
    return 'accepted';
  end if;
  perform public.close_offer(e.id, 'Declined by the family');
  return 'declined';
end $$;
revoke all on function public.respond_offer(text, boolean) from public;
grant execute on function public.respond_offer(text, boolean) to anon, authenticated;

-- daily: offers past their date lapse (the seat moves on); a reminder the day before
create or replace function public.expire_admission_offers() returns int
language plpgsql security definer set search_path = '' as $$
declare e record; n int := 0;
begin
  for e in select id, school_id from public.admission_enquiry where status = 'offered' and offer_expires_on = (now() at time zone 'Asia/Kolkata')::date + 1 loop
    perform public.notify_applicant(e.school_id, e.id, 'admission_update', 'offer-reminder:' || ((now() at time zone 'Asia/Kolkata')::date)::text,
      jsonb_build_object('child', (select child_name from public.admission_enquiry where id = e.id)), 'Admission offer ends tomorrow',
      'The seat offered for {child} is held until tomorrow. Please accept it on the application page or contact the school office.', null);
  end loop;
  for e in select id from public.admission_enquiry where status = 'offered' and offer_expires_on < (now() at time zone 'Asia/Kolkata')::date order by offer_expires_on loop
    perform public.close_offer(e.id, 'Lapsed: not accepted in time');
    n := n + 1;
  end loop;
  return n;
end $$;
revoke all on function public.expire_admission_offers() from public, anon, authenticated;
select cron.unschedule('admission-offers') where exists (select 1 from cron.job where jobname = 'admission-offers');
select cron.schedule('admission-offers', '30 0 * * *', 'select public.expire_admission_offers()');

-- what the family sees on its private status page
create or replace function public.applicant_status(p_token text)
returns table (child_name text, class_name text, school_name text, status text, offer_no text, offer_expires_on date, waitlist_position int,
               application_fee numeric, fee_paid boolean, online_payment boolean, slots jsonb, year_name text, guardian_name text)
language sql stable security definer set search_path = '' as $$
  select e.child_name, c.name, s.name, e.status, e.offer_no, e.offer_expires_on,
    case when e.status = 'waitlisted' then (select count(*)::int from public.admission_enquiry x where x.academic_year_id = e.academic_year_id and x.class_id = e.class_id and x.status = 'waitlisted'
      and (coalesce(x.score, -1) > coalesce(e.score, -1) or (coalesce(x.score, -1) = coalesce(e.score, -1) and (x.waitlisted_at, x.id) <= (e.waitlisted_at, e.id)))) end,
    coalesce(e.app_fee_amount, s.application_fee), e.app_fee_paid_on is not null,
    exists (select 1 from public.payment_gateway g where g.school_id = e.school_id and g.active),
    coalesce((select jsonb_agg(jsonb_build_object('kind', sl.kind, 'at', sl.starts_at, 'venue', sl.venue) order by sl.starts_at)
              from public.admission_booking b join public.admission_slot sl on sl.id = b.slot_id where b.enquiry_id = e.id), '[]'),
    y.name, e.guardian_name
  from public.admission_enquiry e join public.class c on c.id = e.class_id join public.school s on s.id = e.school_id
  left join public.academic_year y on y.id = e.academic_year_id
  where e.public_token = p_token and length(p_token) = 32;
$$;
revoke all on function public.applicant_status(text) from public;
grant execute on function public.applicant_status(text) to anon, authenticated;

-- the application fee, paid online from the status page
create or replace function public.create_application_payment(p_token text)
returns table (order_public_id text, amount numeric, provider text, mode text)
language plpgsql security definer set search_path = '' as $$
declare e public.admission_enquiry; v_gw public.payment_gateway; v_fee numeric; o public.payment_order; v_sample boolean;
begin
  select * into e from public.admission_enquiry where public_token = p_token and length(p_token) = 32 for update;
  if e.id is null then raise exception 'This link is not valid'; end if;
  if e.app_fee_paid_on is not null then raise exception 'The application fee is already paid'; end if;
  select coalesce(e.app_fee_amount, s.application_fee), s.is_sample into v_fee, v_sample from public.school s where s.id = e.school_id;
  if coalesce(v_fee, 0) <= 0 then raise exception 'There is no application fee to pay'; end if;
  select * into v_gw from public.payment_gateway g where g.school_id = e.school_id and g.active;
  if v_gw.id is null then raise exception 'Online payment is not switched on at this school; please pay at the office'; end if;
  if v_gw.provider = 'test' and not coalesce(v_sample, false) then raise exception 'Online payment is being set up at this school; please pay at the office'; end if;
  if exists (select 1 from public.payment_order po where po.enquiry_id = e.id and po.status = 'pending') then raise exception 'A payment is still being processed by the bank. Please check again in a few minutes'; end if;
  select * into o from public.payment_order po where po.enquiry_id = e.id and po.status = 'created' and po.amount = v_fee and po.gateway_id = v_gw.id
     and po.expires_at > now() + interval '5 minutes' order by po.id desc limit 1;
  if o.id is not null then return query select o.public_id, o.amount, o.provider, o.mode; return; end if;
  if (select count(*) from public.payment_order po where po.enquiry_id = e.id and po.created_at > now() - interval '1 hour') >= 10 then raise exception 'Too many payment attempts. Please try again later'; end if;
  insert into public.payment_order (school_id, enquiry_id, gateway_id, provider, mode, payer_name, payer_email, payer_phone, amount)
  values (e.school_id, e.id, v_gw.id, v_gw.provider, v_gw.mode, e.guardian_name, e.email, e.phone, v_fee) returning * into o;
  insert into public.payment_event (school_id, order_id, kind, detail) values (e.school_id, o.id, 'created', jsonb_build_object('amount', v_fee, 'application', e.id));
  return query select o.public_id, o.amount, o.provider, o.mode;
end $$;
revoke all on function public.create_application_payment(text) from public;
grant execute on function public.create_application_payment(text) to anon, authenticated;

-- settings
create or replace function public.set_admission_rules(p_fee numeric, p_offer_days int, p_auto boolean) returns void
language plpgsql security definer set search_path = '' as $$
begin
  if not coalesce(app.is_office(), false) and not coalesce(app.is_head(), false) then raise exception 'Only the office or the head can change this'; end if;
  if p_fee is not null and p_fee < 0 then raise exception 'The fee cannot be negative'; end if;
  if p_offer_days is null or p_offer_days not between 1 and 60 then raise exception 'An offer stays open for 1 to 60 days'; end if;
  update public.school set application_fee = nullif(round(p_fee, 2), 0), offer_days = p_offer_days, auto_waitlist = coalesce(p_auto, true) where id = public.current_school_id();
end $$;
revoke all on function public.set_admission_rules(numeric, int, boolean) from public, anon;
grant execute on function public.set_admission_rules(numeric, int, boolean) to authenticated;

-- every step tells the family (SMS, WhatsApp, email as the school has switched on)
create or replace function public.admission_messages() returns trigger
language plpgsql security definer set search_path = '' as $$
declare v_vars jsonb; v_t text; v_b text;
begin
  if tg_op = 'UPDATE' and new.status is not distinct from old.status then return new; end if;
  v_vars := jsonb_build_object('child', new.child_name, 'school', (select coalesce(nullif(short_name, ''), name) from public.school where id = new.school_id),
    'until', to_char(new.offer_expires_on, 'DD Mon YYYY'), 'class', (select name from public.class where id = new.class_id), 'offer', coalesce(new.offer_no, ''));
  case new.status
    when 'new' then if new.source <> 'online' then return new; end if;
      v_t := 'Application received'; v_b := '{school} has received the application for {child} ({class}). You can follow it on the link sent with this message.';
    when 'offered' then v_t := 'Admission offer'; v_b := '{school} offers {child} a seat in {class} (offer {offer}). Please accept by {until} on the application page.';
    when 'waitlisted' then v_t := 'Waiting list'; v_b := '{child} is on the waiting list for {class} at {school}. You will be told at once if a seat becomes free.';
    when 'accepted' then v_t := 'Seat accepted'; v_b := 'Thank you. The seat for {child} in {class} is confirmed. The school office will complete the admission.';
    when 'declined' then v_t := 'Offer closed'; v_b := 'The admission offer for {child} at {school} is closed. Contact the office with any questions.';
    when 'admitted' then v_t := 'Admission complete'; v_b := 'Welcome to {school}. {child} is admitted to {class}.';
    else return new;
  end case;
  perform public.notify_applicant(new.school_id, new.id, 'admission_update', 'adm:' || new.status || ':' || coalesce(new.offer_no, '') || ':' || to_char(now(), 'YYYYMMDDHH24MI'),
    v_vars, v_t, v_b, null);
  return new;
exception when others then return new;   -- a message never blocks the admission
end $$;
drop trigger if exists trg_admission_messages on public.admission_enquiry;
create trigger trg_admission_messages after insert or update of status on public.admission_enquiry for each row execute function public.admission_messages();

create or replace function public.payment_order_for_gateway(p_public_id text)
returns table (id bigint, school_id bigint, public_id text, amount numeric, currency text, status text, provider text, mode text,
               provider_order_id text, config jsonb, secret text, payer_name text, payer_email text, payer_phone text,
               student_name text, school_name text, school_slug text, expires_at timestamptz)
language sql stable security definer set search_path = '' as $$
  select po.id, po.school_id, po.public_id, po.amount, po.currency, po.status, po.provider, po.mode, po.provider_order_id, g.config,
         (select ds.decrypted_secret from vault.decrypted_secrets ds where ds.id = g.secret_id and ds.name like 'pay:' || po.school_id || ':' || g.id || ':%'),
         po.payer_name, po.payer_email, po.payer_phone, coalesce(st.full_name, ae.child_name), s.name, s.slug, po.expires_at
  from public.payment_order po
  join public.payment_gateway g on g.id = po.gateway_id
  left join public.student st on st.id = po.student_id
  left join public.admission_enquiry ae on ae.id = po.enquiry_id
  join public.school s on s.id = po.school_id
  where po.public_id = p_public_id;
$$;

create or replace function public.complete_payment_order(p_public_id text, p_provider_payment_id text, p_amount numeric,
                                              p_provider_order_id text default null, p_paid_at timestamptz default null,
                                              p_method text default null, p_gateway_fee numeric default null)
returns table (ok boolean, receipt_no text, message text)
language plpgsql security definer set search_path = '' as $$
declare o public.payment_order; v_inv record; v_paid numeric; v_bal numeric; v_credit numeric; v_pay bigint; v_receipt text; v_day date;
begin
  select * into o from public.payment_order where public_id = p_public_id;
  if o.id is null then return query select false, null::text, 'Unknown payment'; return; end if;
  -- lock the bill first, then the order (same order as create_payment_order)
  select i.id, i.amount, i.status into v_inv from public.fee_invoice i where i.id = o.invoice_id for update;
  select * into o from public.payment_order where id = o.id for update;
  perform public.payment_log(p_public_id, 'confirmed', jsonb_build_object('payment_id', p_provider_payment_id, 'amount', p_amount, 'order_id', p_provider_order_id));
  -- an application fee: recorded on the application, once
  if o.enquiry_id is not null then
    if o.status = 'paid' then
      if o.provider_payment_id is distinct from left(p_provider_payment_id, 120) then
        update public.payment_order set status = 'review', failure_reason = 'A second payment arrived for the same attempt', refund_due = refund_due + round(p_amount, 2) where id = o.id;
        return query select false, null::text, 'Second payment kept for review'; return;
      end if;
      return query select true, null::text, 'Already recorded'; return;
    end if;
    if round(p_amount, 2) < o.amount or (p_provider_order_id is not null and o.provider_order_id is not null and p_provider_order_id <> o.provider_order_id) then
      update public.payment_order set status = 'review', failure_reason = 'Amount or order did not match', received_amount = round(p_amount, 2), provider_payment_id = left(p_provider_payment_id, 120), refund_due = round(p_amount, 2) where id = o.id;
      return query select false, null::text, 'Kept for review'; return;
    end if;
    if exists (select 1 from public.admission_enquiry where id = o.enquiry_id and app_fee_paid_on is not null) then
      update public.payment_order set status = 'review', failure_reason = 'The application fee was already paid', received_amount = round(p_amount, 2), provider_payment_id = left(p_provider_payment_id, 120), refund_due = round(p_amount, 2) where id = o.id;
      return query select false, null::text, 'Already paid: kept for refund'; return;
    end if;
    update public.payment_order set status = 'paid', provider_payment_id = left(p_provider_payment_id, 120), received_amount = round(p_amount, 2), credited_amount = o.amount,
      refund_due = greatest(round(p_amount, 2) - o.amount, 0), method = left(p_method, 40), gateway_fee = p_gateway_fee, paid_at = coalesce(p_paid_at, now()) where id = o.id;
    update public.admission_enquiry set app_fee_amount = o.amount, app_fee_paid_on = (coalesce(p_paid_at, now()) at time zone 'Asia/Kolkata')::date,
      app_fee_ref = left(case when o.mode = 'test' then 'TEST ' else '' end || 'Online ' || coalesce(p_provider_payment_id, ''), 80),
      status = case when status in ('new', 'contacted', 'visit_scheduled') then 'applied' else status end where id = o.enquiry_id;
    return query select true, null::text, 'Application fee recorded'; return;
  end if;

  if o.status = 'paid' then
    if o.provider_payment_id is distinct from left(p_provider_payment_id, 120) then
      update public.payment_order set status = 'review', failure_reason = 'A second payment arrived for the same attempt: ' || left(coalesce(p_provider_payment_id, ''), 60),
        refund_due = refund_due + round(p_amount, 2) where id = o.id;
      return query select false, null::text, 'Second payment kept for review'; return;
    end if;
    return query select true, (select p.receipt_no from public.fee_payment p where p.id = o.fee_payment_id), 'Already recorded'; return;
  end if;
  if o.status = 'review' then return query select false, null::text, 'Waiting for the office to review'; return; end if;
  if p_provider_order_id is not null and o.provider_order_id is not null and p_provider_order_id <> o.provider_order_id then
    update public.payment_order set status = 'review', failure_reason = 'Gateway order did not match', received_amount = round(p_amount, 2),
      provider_payment_id = left(p_provider_payment_id, 120) where id = o.id;
    return query select false, null::text, 'Kept for review: order did not match'; return;
  end if;
  if round(p_amount, 2) < o.amount then
    update public.payment_order set status = 'review', failure_reason = 'Less money arrived than the bill', received_amount = round(p_amount, 2),
      provider_payment_id = left(p_provider_payment_id, 120), refund_due = round(p_amount, 2) where id = o.id;
    return query select false, null::text, 'Kept for review: amount was less than the bill'; return;
  end if;

  -- credit what the bill still needs now; anything more is kept as refund due
  select coalesce(sum(case when p.is_refund then -p.amount else p.amount end), 0) into v_paid from public.fee_payment p where p.invoice_id = o.invoice_id;
  v_bal := greatest(round(v_inv.amount - v_paid, 2), 0);
  if v_inv.status = 'cancelled' then v_bal := 0; end if;
  v_credit := least(o.amount, v_bal);
  v_day := coalesce(p_paid_at, now()) at time zone 'Asia/Kolkata';
  if v_credit > 0 then
    insert into public.fee_payment (school_id, invoice_id, amount, paid_on, mode, reference, note, is_test, fin_voucher_id)
    values (o.school_id, o.invoice_id, v_credit, v_day, 'online',
            left(case when o.mode = 'test' then 'TEST ' else '' end || o.provider || ' ' || coalesce(p_provider_payment_id, ''), 80),
            case when o.mode = 'test' then 'TEST payment: no money was received' else 'Paid online' end,
            o.mode = 'test', case when o.mode = 'test' then 0 end)
    returning id, fee_payment.receipt_no into v_pay, v_receipt;
  end if;
  update public.payment_order set
    status = case when v_credit > 0 then 'paid' else 'review' end,
    failure_reason = case when v_credit = 0 then 'The bill was already paid when the money arrived; refund due' end,
    paid_at = coalesce(p_paid_at, now()), provider_payment_id = left(p_provider_payment_id, 120),
    provider_order_id = coalesce(provider_order_id, left(p_provider_order_id, 120)),
    received_amount = round(p_amount, 2), credited_amount = v_credit, refund_due = round(p_amount, 2) - v_credit,
    method = left(p_method, 40), gateway_fee = p_gateway_fee, fee_payment_id = v_pay
  where id = o.id;
  return query select v_credit > 0, v_receipt, case when v_credit = 0 then 'Bill already paid; refund due' when round(p_amount, 2) > v_credit then 'Recorded; extra kept as refund due' else 'Recorded' end;
end $$;

-- a seat released any other way (status changed by hand) goes to the waiting list too
create or replace function public.admission_seat_moves_on() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if old.status in ('offered', 'accepted') and new.status not in ('offered', 'accepted', 'admitted') then
    perform public.promote_waitlist(new.academic_year_id, new.class_id);
  end if;
  return new;
end $$;
drop trigger if exists trg_admission_seat_moves_on on public.admission_enquiry;
create trigger trg_admission_seat_moves_on after update of status on public.admission_enquiry for each row execute function public.admission_seat_moves_on();
commit;
notify pgrst, 'reload schema';
