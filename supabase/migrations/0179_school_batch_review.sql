-- School batch after review: waiting list safety, messages with the family's link (one kind per step), office acceptance
-- and deadlines, offer numbers, fee payment integrity and refunds, UDISE+ speed and export log.
begin;
insert into public.notification_event_type (key, label, urgent, channels, sort) values
  ('admission_offer', 'Admission: seat offered', false, array['sms', 'whatsapp', 'email'], 96),
  ('admission_waitlist', 'Admission: waiting list', false, array['sms', 'whatsapp', 'email'], 97),
  ('admission_accepted', 'Admission: seat accepted', false, array['sms', 'whatsapp', 'email'], 98),
  ('admission_closed', 'Admission: offer closed', false, array['sms', 'whatsapp', 'email'], 99),
  ('admission_admitted', 'Admission: admitted', false, array['sms', 'whatsapp', 'email'], 100),
  ('admission_reminder', 'Admission: offer ends tomorrow', false, array['sms', 'whatsapp', 'email'], 101),
  ('admission_fee_paid', 'Admission: application fee received', false, array['sms', 'email'], 102)
on conflict (key) do nothing;
delete from public.notification_event_type where key = 'admission_update' and not exists (select 1 from public.notification where event_key = 'admission_update');

-- the family's private page, for messages
create or replace function public.applicant_link(p_enquiry bigint) returns text
language sql stable security definer set search_path = '' as $$
  select 'https://' || s.slug || '.campustwin.org/apply/status/' || e.public_token
  from public.admission_enquiry e join public.school s on s.id = e.school_id where e.id = p_enquiry;
$$;
revoke all on function public.applicant_link(bigint) from public, anon, authenticated;

drop function if exists public.promote_waitlist(bigint, bigint);
create function public.promote_waitlist(p_year bigint, p_class bigint, p_exclude bigint default null) returns int
language plpgsql security definer set search_path = '' as $$
declare v_seats int; v_school bigint; e record; n int := 0; v_days int; v_auto boolean;
begin
  select c.school_id into v_school from public.class c where c.id = p_class;
  select offer_days, auto_waitlist into v_days, v_auto from public.school where id = v_school;
  if not coalesce(v_auto, true) then return 0; end if;
  perform pg_advisory_xact_lock(hashtextextended('admission_seat:' || p_year || ':' || p_class, 0));
  select seats into v_seats from public.admission_seat where academic_year_id = p_year and class_id = p_class;
  if v_seats is null then return 0; end if;   -- no seat count: the office decides by hand
  for e in select x.id from public.admission_enquiry x where x.academic_year_id = p_year and x.class_id = p_class and x.status = 'waitlisted'
             and x.id is distinct from p_exclude
           order by x.score desc nulls last, x.waitlisted_at, x.id loop
    exit when public.admission_taken(p_year, p_class) >= v_seats;
    perform public.issue_offer(e.id, (now() at time zone 'Asia/Kolkata')::date + v_days);
    n := n + 1;
  end loop;
  return n;
end $$;
revoke all on function public.promote_waitlist(bigint, bigint, bigint) from public, anon, authenticated;

create or replace function public.admission_seat_moves_on() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if old.status in ('offered', 'accepted') and new.status not in ('offered', 'accepted', 'admitted') then
    perform public.promote_waitlist(new.academic_year_id, new.class_id, case when new.status = 'waitlisted' then new.id end);
  end if;
  return new;
end $$;

create or replace function public.waitlist_application(p_enquiry bigint) returns int
language plpgsql security definer set search_path = '' as $$
declare e public.admission_enquiry;
begin
  if not coalesce(app.is_office(), false) then raise exception 'Only the office can do this'; end if;
  select * into e from public.admission_enquiry where id = p_enquiry and school_id = public.current_school_id() for update;
  if e.id is null then raise exception 'Unknown application'; end if;
  if e.status = 'admitted' then raise exception 'This child is already admitted'; end if;
  -- someone moved back from an offer joins the end of the line
  update public.admission_enquiry set status = 'waitlisted', seat_claimed_at = null, offer_expires_on = null,
         waitlisted_at = case when e.status in ('offered', 'accepted') or e.waitlisted_at is null then now() else e.waitlisted_at end where id = e.id;
  return (select count(*)::int from public.admission_enquiry x where x.academic_year_id = e.academic_year_id and x.class_id = e.class_id and x.status = 'waitlisted');
end $$;

-- offer numbers from the highest so far (an application deleted never makes two the same)
create or replace function public.issue_offer(p_enquiry bigint, p_until date) returns text
language plpgsql security definer set search_path = '' as $$
declare e public.admission_enquiry; v_no text; v_yr text := to_char(now() at time zone 'Asia/Kolkata', 'YYYY');
begin
  select * into e from public.admission_enquiry where id = p_enquiry for update;
  perform pg_advisory_xact_lock(hashtext('admission-offer-no'), e.school_id::int);
  select 'OF-' || v_yr || '-' || lpad((coalesce(max(nullif(split_part(offer_no, '-', 3), '')::int), 0) + 1)::text, 4, '0') into v_no
    from public.admission_enquiry where school_id = e.school_id and offer_no like 'OF-' || v_yr || '-%' and split_part(offer_no, '-', 3) ~ '^\d+$';
  update public.admission_enquiry set status = 'offered', offer_no = coalesce(e.offer_no, v_no), offered_at = now(), offer_expires_on = p_until,
         seat_claimed_at = null, decided_at = null, decision_note = null where id = p_enquiry;
  return coalesce(e.offer_no, v_no);
end $$;

-- the family accepts (link) or the office records it: the seat is held until a date to complete the admission
create or replace function public.accept_offer(p_enquiry bigint) returns void
language plpgsql security definer set search_path = '' as $$
declare e public.admission_enquiry; v_days int;
begin
  select * into e from public.admission_enquiry where id = p_enquiry for update;
  if e.status <> 'offered' then raise exception 'There is no open offer on this application'; end if;
  if e.offer_expires_on < (now() at time zone 'Asia/Kolkata')::date then raise exception 'This offer has lapsed'; end if;
  select offer_days into v_days from public.school where id = e.school_id;
  update public.admission_enquiry set status = 'accepted', decided_at = now(), offer_expires_on = (now() at time zone 'Asia/Kolkata')::date + v_days where id = e.id;
end $$;
revoke all on function public.accept_offer(bigint) from public, anon, authenticated;

create or replace function public.respond_offer(p_token text, p_accept boolean) returns text
language plpgsql security definer set search_path = '' as $$
declare e public.admission_enquiry;
begin
  select * into e from public.admission_enquiry where public_token = p_token and length(p_token) = 32 for update;
  if e.id is null then raise exception 'This link is not valid'; end if;
  if e.status <> 'offered' then raise exception 'There is no open offer on this application'; end if;
  if e.offer_expires_on < (now() at time zone 'Asia/Kolkata')::date then raise exception 'This offer has lapsed'; end if;
  if p_accept then perform public.accept_offer(e.id); return 'accepted'; end if;
  perform public.close_offer(e.id, 'Declined by the family');
  return 'declined';
end $$;

create or replace function public.accept_offer_at_office(p_enquiry bigint) returns void
language plpgsql security definer set search_path = '' as $$
begin
  if not coalesce(app.is_office(), false) then raise exception 'Only the office can do this'; end if;
  if not exists (select 1 from public.admission_enquiry where id = p_enquiry and school_id = public.current_school_id()) then raise exception 'Unknown application'; end if;
  perform public.accept_offer(p_enquiry);
end $$;
revoke all on function public.accept_offer_at_office(bigint) from public, anon;
grant execute on function public.accept_offer_at_office(bigint) to authenticated;

-- daily: a reminder the day before; offers not accepted and accepted seats not completed lapse; one bad row never stops the rest
create or replace function public.expire_admission_offers() returns int
language plpgsql security definer set search_path = '' as $$
declare e record; n int := 0;
begin
  for e in select id, school_id, child_name, status from public.admission_enquiry where status in ('offered', 'accepted') and offer_expires_on = (now() at time zone 'Asia/Kolkata')::date + 1 loop
    begin
      perform public.notify_applicant(e.school_id, e.id, 'admission_reminder', 'reminder:' || e.status || ':' || ((now() at time zone 'Asia/Kolkata')::date)::text,
        jsonb_build_object('child', e.child_name, 'link', public.applicant_link(e.id)),
        case e.status when 'offered' then 'Admission offer ends tomorrow' else 'Complete the admission by tomorrow' end,
        case e.status when 'offered' then 'The seat offered for {child} is held until tomorrow. Accept it here: {link}'
             else 'The seat for {child} is held until tomorrow. Please complete the admission at the school office. {link}' end, null);
    exception when others then null; end;
  end loop;
  for e in select id, status from public.admission_enquiry where status in ('offered', 'accepted') and offer_expires_on < (now() at time zone 'Asia/Kolkata')::date order by offer_expires_on loop
    begin
      perform public.close_offer(e.id, case e.status when 'offered' then 'Lapsed: not accepted in time' else 'Lapsed: admission not completed in time' end);
      n := n + 1;
    exception when others then null; end;
  end loop;
  return n;
end $$;

-- messages: one kind per step (each can have its own approved template), always with the family's link;
-- nothing on a new online application (the link is on the screen; the public form cannot be used to send messages)
create or replace function public.admission_messages() returns trigger
language plpgsql security definer set search_path = '' as $$
declare v_vars jsonb; v_t text; v_b text; v_ev text;
begin
  if tg_op = 'UPDATE' and new.status is not distinct from old.status then return new; end if;
  v_vars := jsonb_build_object('child', new.child_name, 'school', (select coalesce(nullif(short_name, ''), name) from public.school where id = new.school_id),
    'until', to_char(new.offer_expires_on, 'DD Mon YYYY'), 'class', (select name from public.class where id = new.class_id), 'offer', coalesce(new.offer_no, ''),
    'link', public.applicant_link(new.id));
  case new.status
    when 'offered' then v_ev := 'admission_offer'; v_t := 'Admission offer'; v_b := '{school} offers {child} a seat in {class} (offer {offer}). Please accept by {until}: {link}';
    when 'waitlisted' then v_ev := 'admission_waitlist'; v_t := 'Waiting list'; v_b := '{child} is on the waiting list for {class} at {school}. You will be told at once if a seat becomes free. {link}';
    when 'accepted' then v_ev := 'admission_accepted'; v_t := 'Seat accepted'; v_b := 'The seat for {child} in {class} is held until {until}. Please complete the admission at the school office by then. {link}';
    when 'declined' then v_ev := 'admission_closed'; v_t := 'Offer closed'; v_b := 'The admission offer for {child} at {school} is closed. Contact the office with any questions. {link}';
    when 'admitted' then v_ev := 'admission_admitted'; v_t := 'Admission complete'; v_b := 'Welcome to {school}. {child} is admitted to {class}.';
    else return new;
  end case;
  perform public.notify_applicant(new.school_id, new.id, v_ev, v_ev || ':' || coalesce(new.offer_no, '') || ':' || to_char(now(), 'YYYYMMDDHH24MISS'), v_vars, v_t, v_b, null);
  return new;
exception when others then return new;
end $$;

-- the fee: nothing to pay on a closed application; the test gateway only at demo schools
create or replace function public.create_application_payment_guard() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if new.enquiry_id is not null and exists (select 1 from public.admission_enquiry e where e.id = new.enquiry_id and e.status in ('declined', 'not_interested', 'admitted')) then
    raise exception 'This application is closed; there is nothing to pay';
  end if;
  return new;
end $$;
drop trigger if exists trg_application_payment_guard on public.payment_order;
create trigger trg_application_payment_guard before insert on public.payment_order for each row execute function public.create_application_payment_guard();

-- who exported sensitive lists, and when
create or replace function public.log_export(p_what text, p_scope text) returns void
language plpgsql security definer set search_path = '' as $$
begin
  if not coalesce(app.is_admin_scope(), false) then return; end if;
  insert into public.audit_log (school_id, actor_id, actor_name, action, entity, entity_id, label, fields)
  values (public.current_school_id(), auth.uid(), (select full_name from public.profile where id = auth.uid()), 'export', left(p_what, 40), null, left(coalesce(p_scope, ''), 120), '{}');
end $$;
revoke all on function public.log_export(text, text) from public, anon;
grant execute on function public.log_export(text, text) to authenticated;

create or replace function public.applicant_status(p_token text)
returns table (child_name text, class_name text, school_name text, status text, offer_no text, offer_expires_on date, waitlist_position int,
               application_fee numeric, fee_paid boolean, online_payment boolean, slots jsonb, year_name text, guardian_name text)
language sql stable security definer set search_path = '' as $$
  select e.child_name, c.name, s.name, e.status, e.offer_no, e.offer_expires_on,
    case when e.status = 'waitlisted' then (select count(*)::int from public.admission_enquiry x where x.academic_year_id = e.academic_year_id and x.class_id = e.class_id and x.status = 'waitlisted'
      and (coalesce(x.score, -1) > coalesce(e.score, -1) or (coalesce(x.score, -1) = coalesce(e.score, -1) and (x.waitlisted_at, x.id) <= (e.waitlisted_at, e.id)))) end,
    coalesce(e.app_fee_amount, s.application_fee), e.app_fee_paid_on is not null,
    exists (select 1 from public.payment_gateway g where g.school_id = e.school_id and g.active and (g.provider <> 'test' or s.is_sample)),
    coalesce((select jsonb_agg(jsonb_build_object('kind', sl.kind, 'at', sl.starts_at, 'venue', sl.venue) order by sl.starts_at)
              from public.admission_booking b join public.admission_slot sl on sl.id = b.slot_id where b.enquiry_id = e.id), '[]'),
    y.name, e.guardian_name
  from public.admission_enquiry e join public.class c on c.id = e.class_id join public.school s on s.id = e.school_id
  left join public.academic_year y on y.id = e.academic_year_id
  where e.public_token = p_token and length(p_token) = 32;
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
    perform 1 from public.admission_enquiry where id = o.enquiry_id for update;
    if o.status = 'review' then return query select false, null::text, 'Waiting for the office to review'; return; end if;
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
    perform public.notify_applicant(o.school_id, o.enquiry_id, 'admission_fee_paid', 'fee:' || o.public_id,
      jsonb_build_object('amount', to_char(o.amount, 'FM999999990.00'), 'ref', upper(o.public_id), 'link', public.applicant_link(o.enquiry_id)),
      'Application fee received', 'Application fee of Rs {amount} received. Receipt {ref}. {link}', null);
    return query select true, upper(o.public_id), 'Application fee recorded'; return;
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

create or replace function public.refund_payment_order(p_public_id text, p_amount numeric, p_ref text, p_kind text default 'refund')
returns table (ok boolean, message text)
language plpgsql security definer set search_path = '' as $$
declare o public.payment_order; v_part numeric;
begin
  select * into o from public.payment_order where public_id = p_public_id for update;
  if o.id is null then return query select false, 'Unknown payment'; return; end if;
  if exists (select 1 from public.payment_event e where e.order_id = o.id and e.kind = p_kind and e.detail ->> 'ref' = p_ref) then
    return query select true, 'Already recorded'; return;
  end if;
  if round(p_amount, 2) <= 0 or o.refunded_amount + round(p_amount, 2) > coalesce(o.received_amount, 0) then
    return query select false, 'Refund is more than was received'; return;
  end if;
  insert into public.payment_event (school_id, order_id, kind, detail) values (o.school_id, o.id, p_kind, jsonb_build_object('ref', p_ref, 'amount', p_amount));
  -- first from the refund due (money never credited to the bill), then from the bill
  v_part := greatest(round(p_amount, 2) - o.refund_due, 0);
  if v_part > 0 and o.fee_payment_id is not null then
    insert into public.fee_payment (school_id, invoice_id, amount, paid_on, mode, reference, note, is_refund, is_test, fin_voucher_id)
    values (o.school_id, o.invoice_id, v_part, (now() at time zone 'Asia/Kolkata')::date, 'online', left(o.provider || ' ' || p_kind || ' ' || coalesce(p_ref, ''), 80),
            case when p_kind = 'chargeback' then 'Chargeback by the bank' else 'Refunded online' end, true, o.mode = 'test', case when o.mode = 'test' then 0 end);
  end if;
  update public.payment_order set refunded_amount = refunded_amount + round(p_amount, 2), refund_due = greatest(refund_due - round(p_amount, 2), 0) where id = o.id;
  -- an application fee given back is no longer paid
  if o.enquiry_id is not null and v_part > 0 then
    update public.admission_enquiry set app_fee_paid_on = null, app_fee_ref = left(coalesce(app_fee_ref, '') || ' (' || p_kind || ')', 80) where id = o.enquiry_id;
  end if;
  return query select true, 'Recorded';
end $$;
revoke all on function public.refund_payment_order(text, numeric, text, text) from public, anon, authenticated;
grant execute on function public.refund_payment_order(text, numeric, text, text) to service_role;

create or replace function public.udise_student_rows(p_section bigint default null)
returns table (admission_no text, student_name text, aadhaar_name text, gender text, dob date, class_name text, section_name text, roll_no int,
               admission_date date, mother_name text, father_name text, guardian_name text, mobile text, email text,
               address text, pincode text, mother_tongue text, social_category text, minority text, religion text, bpl boolean, aay boolean, disadvantaged boolean,
               cwsn boolean, cwsn_note text, disability_type text, udid_no text, rte_admission boolean, apaar_id text, pen text, aadhaar_last4 text, blood_group text,
               height_cm numeric, weight_kg numeric, medium text, stream text, prev_result text, prev_percent numeric, prev_attendance_days int, facilities text[],
               previous_school text, nationality text, missing text[])
language plpgsql stable security definer set search_path = '' as $$
declare v_school bigint := public.current_school_id();
begin
  if not coalesce(app.is_admin_scope(), false) then raise exception 'Only the office or the principal can export UDISE+ data'; end if;
  return query
  with py as (select y0.id, y0.start_date, y0.end_date from public.academic_year y0
              where y0.school_id = v_school and y0.end_date < (select y1.start_date from public.academic_year y1 where y1.school_id = v_school and y1.is_current)
              order by y0.end_date desc limit 1),
  -- last year's days present, counted once for everyone
  pa as (select a.student_id, (count(*) filter (where a.status in ('present', 'late')))::int days
         from public.attendance_record a, py where a.school_id = v_school and a.period is null and a.on_date between py.start_date and py.end_date
           and a.student_id in (select e0.student_id from public.student_enrollment e0 join public.academic_year y0 on y0.id = e0.academic_year_id and y0.is_current
                                where e0.school_id = v_school and e0.status = 'active' and (p_section is null or e0.section_id = p_section))
         group by a.student_id),
  base as (
    select st.id, st.admission_no, st.full_name, st.gender, st.dob, c.name cname, c.level, sec.name sname, e.roll_no::int roll,
           p.admission_date, p.address_line, p.city, p.state, p.pincode, p.mother_tongue, p.blood_group, p.previous_school, p.nationality,
           p.height_cm, p.weight_kg, p.medium, p.stream, p.prev_result, p.prev_percent, p.prev_attendance_days, coalesce(p.facilities, '{}') facilities,
           i.category, i.religion, i.bpl, i.special_needs, i.special_needs_note, i.apaar_id, i.pen, i.aadhaar_last4,
           i.aadhaar_name, i.minority, i.aay, i.disadvantaged, i.disability_type, i.udid_no, i.rte_admission,
           coalesce(p.mother_name, (select g.full_name from public.guardian_student gs join public.guardian g on g.id = gs.guardian_id where gs.student_id = st.id and lower(coalesce(g.relation, '')) like 'mother%' limit 1)) mum,
           coalesce(p.father_name, (select g.full_name from public.guardian_student gs join public.guardian g on g.id = gs.guardian_id where gs.student_id = st.id and lower(coalesce(g.relation, '')) like 'father%' limit 1)) dad,
           (select g.full_name from public.guardian_student gs join public.guardian g on g.id = gs.guardian_id where gs.student_id = st.id order by gs.is_primary desc limit 1) grd,
           coalesce(st.phone, (select g.phone from public.guardian_student gs join public.guardian g on g.id = gs.guardian_id where gs.student_id = st.id and g.phone is not null order by gs.is_primary desc limit 1)) mob,
           coalesce(st.email, (select g.email from public.guardian_student gs join public.guardian g on g.id = gs.guardian_id where gs.student_id = st.id and g.email is not null order by gs.is_primary desc limit 1)) mail,
           pe.status prev_status, pa.days prev_att_days
    from public.student_enrollment e
    join public.academic_year y on y.id = e.academic_year_id and y.is_current
    join public.student st on st.id = e.student_id
    join public.section sec on sec.id = e.section_id join public.class c on c.id = sec.class_id
    left join public.student_profile p on p.student_id = st.id
    left join public.student_identity i on i.student_id = st.id
    left join public.student_enrollment pe on pe.student_id = st.id and pe.academic_year_id = (select id from py)
    left join pa on pa.student_id = st.id
    where e.school_id = v_school and e.status = 'active' and (p_section is null or e.section_id = p_section))
  select b.admission_no, b.full_name, b.aadhaar_name::text, b.gender::text, b.dob, b.cname, b.sname, b.roll, b.admission_date, b.mum, b.dad, b.grd, b.mob, b.mail,
         nullif(concat_ws(', ', b.address_line, b.city, b.state), ''), b.pincode::text, b.mother_tongue::text, b.category::text, b.minority::text, b.religion::text, b.bpl,
         coalesce(b.aay, false), coalesce(b.disadvantaged, false),
         b.special_needs, b.special_needs_note::text, b.disability_type::text, b.udid_no::text, coalesce(b.rte_admission, false),
         b.apaar_id::text, b.pen::text, b.aadhaar_last4::text, b.blood_group::text,
         b.height_cm, b.weight_kg, b.medium::text, b.stream::text, coalesce(b.prev_result, case b.prev_status when 'promoted' then 'promoted' when 'detained' then 'detained' when 'active' then 'promoted' end, case when b.admission_date >= (select y.start_date from public.academic_year y where y.school_id = v_school and y.is_current) then 'new' end)::text,
         b.prev_percent, coalesce(b.prev_attendance_days, b.prev_att_days), b.facilities,
         b.previous_school::text, coalesce(b.nationality::text, 'Indian'),
         array_remove(array[
           case when b.gender is null then 'Gender' end,
           case when b.dob is null then 'Date of birth' end,
           case when b.aadhaar_name is null then 'Name as on Aadhaar' end,
           case when b.mum is null then 'Mother''s name' end,
           case when b.dad is null then 'Father''s name' end,
           case when b.mob is null then 'Mobile number' end,
           case when b.address_line is null then 'Address' end,
           case when b.pincode is null or b.pincode !~ '^\d{6}$' then 'Pincode' end,
           case when b.mother_tongue is null then 'Mother tongue' end,
           case when b.category is null then 'Social category' end,
           case when b.minority is null then 'Minority group' end,
           case when b.religion is null then 'Religion' end,
           case when b.admission_date is null then 'Admission date' end,
           case when b.aadhaar_last4 is null then 'Aadhaar' end,
           case when b.apaar_id is null then 'APAAR ID' end,
           case when b.medium is null then 'Medium of instruction' end,
           case when b.height_cm is null or b.weight_kg is null then 'Height and weight' end,
           case when b.special_needs and b.disability_type is null then 'Type of disability' end,
           case when b.level >= 11 and b.stream is null then 'Stream' end
         ], null)
  from base b
  order by b.level, b.sname, b.roll nulls last, b.full_name, b.id;
end $$;
commit;
notify pgrst, 'reload schema';
