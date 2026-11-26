-- Admissions, after the product + CTO review of 0112.
begin;
-- a claim counts for 10 minutes only (an admit that died never holds a seat for ever)
create or replace function public.admission_taken(p_year bigint, p_class bigint) returns int
language sql stable security definer set search_path = '' as $$
  select count(*)::int from public.admission_enquiry e
  where e.class_id = p_class and e.academic_year_id = p_year
    and (e.status = 'admitted' or e.seat_claimed_at > now() - interval '10 minutes');
$$;

create or replace function public.admission_seats(p_year bigint)
returns table (class_id bigint, class_name text, seats int, taken int, available int)
language sql stable security definer set search_path = '' as $$
  select c.id, c.name, s.seats, public.admission_taken(p_year, c.id),
    case when s.seats is null then null else greatest(s.seats - public.admission_taken(p_year, c.id), 0) end
  from public.class c left join public.admission_seat s on s.class_id = c.id and s.academic_year_id = p_year
  where c.school_id = public.current_school_id() and coalesce(app.is_admin_scope(), false)
  order by c.level;
$$;

create or replace function public.claim_admission_seat(p_enquiry bigint) returns void
language plpgsql security definer set search_path = '' as $$
declare e public.admission_enquiry; v_seats int;
begin
  if not coalesce(app.is_office(), false) then raise exception 'Only the office can admit'; end if;
  select * into e from public.admission_enquiry where id = p_enquiry and school_id = public.current_school_id() for update;
  if e.id is null then raise exception 'Unknown enquiry'; end if;
  if e.status = 'admitted' or e.seat_claimed_at > now() - interval '10 minutes' then return; end if;
  perform pg_advisory_xact_lock(hashtextextended('admission_seat:' || e.academic_year_id || ':' || e.class_id, 0));
  select seats into v_seats from public.admission_seat where academic_year_id = e.academic_year_id and class_id = e.class_id;
  if v_seats is not null and public.admission_taken(e.academic_year_id, e.class_id) >= v_seats then
    raise exception 'All % seats in this class are taken', v_seats;
  end if;
  update public.admission_enquiry set seat_claimed_at = now() where id = e.id;
end $$;

-- leaving "admitted", or moving class / year, frees the seat
create or replace function public.admission_seat_free() returns trigger
language plpgsql set search_path = '' as $$
begin
  if (old.status = 'admitted' and new.status <> 'admitted') or new.class_id is distinct from old.class_id or new.academic_year_id is distinct from old.academic_year_id then
    new.seat_claimed_at := null;
  end if;
  return new;
end $$;
drop trigger if exists trg_admission_seat_free on public.admission_enquiry;
create trigger trg_admission_seat_free before update on public.admission_enquiry for each row execute function public.admission_seat_free();

-- documents: the key must be in this institution's admissions folder for that applicant
create or replace function public.admission_document_guard() returns trigger
language plpgsql security definer set search_path = '' as $$
declare v_prefix text;
begin
  select case when u.slug is not null then 'universities/' || u.slug || '/campuses/' || s.slug else 'schools/' || s.slug end
    into v_prefix from public.school s left join public.university u on u.id = s.university_id where s.id = new.school_id;
  if new.file_key not like v_prefix || '/admissions/' || new.enquiry_id || '/%'
     or not exists (select 1 from public.admission_enquiry e where e.id = new.enquiry_id and e.school_id = new.school_id) then
    raise exception 'That document does not belong to this applicant';
  end if;
  return new;
end $$;
drop trigger if exists trg_admission_document_guard on public.admission_document;
create trigger trg_admission_document_guard before insert or update on public.admission_document for each row execute function public.admission_document_guard();

-- slot use counted in the database; the slot must suit the applicant
create or replace function public.admission_slot_usage(p_year bigint)
returns table (slot_id bigint, used int)
language sql stable security definer set search_path = '' as $$
  select s.id, (select count(*)::int from public.admission_booking b where b.slot_id = s.id)
  from public.admission_slot s where s.school_id = public.current_school_id() and s.academic_year_id = p_year and coalesce(app.is_admin_scope(), false);
$$;
grant execute on function public.admission_slot_usage(bigint) to authenticated;

create or replace function public.admission_booking_guard() returns trigger
language plpgsql security definer set search_path = '' as $$
declare s public.admission_slot; e public.admission_enquiry; v_used int;
begin
  select * into s from public.admission_slot where id = new.slot_id;
  select * into e from public.admission_enquiry where id = new.enquiry_id;
  if s.school_id is distinct from new.school_id or e.school_id is distinct from new.school_id then raise exception 'That record belongs to another institution'; end if;
  if s.academic_year_id <> e.academic_year_id or (s.class_id is not null and s.class_id is distinct from e.class_id) then raise exception 'This slot is for another class or year'; end if;
  new.kind := s.kind;
  perform pg_advisory_xact_lock(hashtextextended('admission_slot:' || s.id, 0));
  select count(*) into v_used from public.admission_booking b where b.slot_id = s.id and b.id is distinct from new.id;
  if v_used >= s.capacity then raise exception 'This slot is full (% places)', s.capacity; end if;
  return new;
end $$;

-- merit: a sibling is a child enrolled this year whose parent's mobile matches (last 10 digits)
create or replace function public.admission_merit(p_year bigint, p_class bigint)
returns table (enquiry_id bigint, rank int, child_name text, score numeric, sibling boolean, enquired_on date, status text, within_seats boolean)
language sql stable security definer set search_path = '' as $$
  with ranked as (
    select e.id, e.child_name, e.score, e.status, (e.created_at at time zone 'Asia/Kolkata')::date d, e.created_at,
      length(regexp_replace(coalesce(e.phone, ''), '\D', '', 'g')) >= 10 and exists (
        select 1 from public.guardian g
        join public.guardian_student gs on gs.guardian_id = g.id
        join public.student_enrollment en on en.student_id = gs.student_id and en.status = 'active'
        join public.academic_year y on y.id = en.academic_year_id and y.is_current
        where g.school_id = e.school_id
          and right(regexp_replace(coalesce(g.phone, ''), '\D', '', 'g'), 10) = right(regexp_replace(coalesce(e.phone, ''), '\D', '', 'g'), 10)) sib
    from public.admission_enquiry e
    where e.school_id = public.current_school_id() and e.academic_year_id = p_year and e.class_id = p_class
      and e.score is not null and e.status not in ('admitted', 'not_interested'))
  select r.id, (row_number() over (order by r.score desc, r.sib desc, r.created_at))::int, r.child_name, r.score, r.sib, r.d, r.status,
    (row_number() over (order by r.score desc, r.sib desc, r.created_at)) <= coalesce((select a.available from public.admission_seats(p_year) a where a.class_id = p_class), 1000000)
  from ranked r
  where coalesce(app.is_admin_scope(), false)
  order by 2;
$$;

revoke all on function public.admission_seats(bigint), public.admission_merit(bigint, bigint), public.admission_slot_usage(bigint), public.release_admission_seat(bigint) from public, anon;
revoke all on function public.admission_taken(bigint, bigint) from public, anon, authenticated;
commit;
