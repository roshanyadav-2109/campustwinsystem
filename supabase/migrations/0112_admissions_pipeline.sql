-- Admissions pipeline: seat limits per class, applicant documents (private
-- storage), entrance test / interview slots with capacity, scores and a merit
-- list with explicit tie-breaks, and the application fee recorded by the office.
begin;

-- ---------- seats ----------
create table if not exists public.admission_seat (
  school_id        bigint not null default public.current_school_id() references public.school(id) on delete cascade,
  academic_year_id bigint not null references public.academic_year(id) on delete cascade,
  class_id         bigint not null references public.class(id) on delete cascade,
  seats            int not null check (seats between 0 and 5000),
  primary key (academic_year_id, class_id)
);
alter table public.admission_enquiry add column if not exists seat_claimed_at timestamptz;
alter table public.admission_enquiry add column if not exists app_fee_amount numeric(10,2) check (app_fee_amount is null or app_fee_amount >= 0);
alter table public.admission_enquiry add column if not exists app_fee_paid_on date;
alter table public.admission_enquiry add column if not exists app_fee_ref text check (app_fee_ref is null or char_length(app_fee_ref) <= 80);
alter table public.admission_enquiry add column if not exists score numeric(6,2);
alter table public.admission_enquiry add column if not exists score_note text check (score_note is null or char_length(score_note) <= 200);

-- seats taken = admitted + those being admitted right now
create or replace function public.admission_seats(p_year bigint)
returns table (class_id bigint, class_name text, seats int, taken int, available int)
language sql stable security definer set search_path = '' as $$
  select c.id, c.name, s.seats,
    (select count(*)::int from public.admission_enquiry e where e.class_id = c.id and e.academic_year_id = p_year and (e.status = 'admitted' or e.seat_claimed_at is not null)),
    case when s.seats is null then null else greatest(s.seats - (select count(*)::int from public.admission_enquiry e where e.class_id = c.id and e.academic_year_id = p_year and (e.status = 'admitted' or e.seat_claimed_at is not null)), 0) end
  from public.class c left join public.admission_seat s on s.class_id = c.id and s.academic_year_id = p_year
  where c.school_id = public.current_school_id() and coalesce(app.is_admin_scope(), false)
  order by c.level;
$$;
grant execute on function public.admission_seats(bigint) to authenticated;

-- claim a seat before admitting (locked: two admits at once cannot both take the last seat)
create or replace function public.claim_admission_seat(p_enquiry bigint) returns void
language plpgsql security definer set search_path = '' as $$
declare e public.admission_enquiry; v_seats int; v_taken int;
begin
  if not coalesce(app.is_office(), false) then raise exception 'Only the office can admit'; end if;
  select * into e from public.admission_enquiry where id = p_enquiry and school_id = public.current_school_id() for update;
  if e.id is null then raise exception 'Unknown enquiry'; end if;
  if e.status = 'admitted' or e.seat_claimed_at is not null then return; end if;
  perform pg_advisory_xact_lock(hashtextextended('admission_seat:' || e.academic_year_id || ':' || e.class_id, 0));
  select seats into v_seats from public.admission_seat where academic_year_id = e.academic_year_id and class_id = e.class_id;
  if v_seats is not null then
    select count(*) into v_taken from public.admission_enquiry x where x.class_id = e.class_id and x.academic_year_id = e.academic_year_id and (x.status = 'admitted' or x.seat_claimed_at is not null);
    if v_taken >= v_seats then raise exception 'All % seats in this class are taken', v_seats; end if;
  end if;
  update public.admission_enquiry set seat_claimed_at = now() where id = e.id;
end $$;
revoke all on function public.claim_admission_seat(bigint) from public, anon;
grant execute on function public.claim_admission_seat(bigint) to authenticated;

create or replace function public.release_admission_seat(p_enquiry bigint) returns void
language sql security definer set search_path = '' as $$
  update public.admission_enquiry set seat_claimed_at = null where id = p_enquiry and status <> 'admitted' and school_id = public.current_school_id() and coalesce(app.is_office(), false);
$$;
grant execute on function public.release_admission_seat(bigint) to authenticated;

-- ---------- documents ----------
create table if not exists public.admission_document (
  id          bigint generated always as identity primary key,
  school_id   bigint not null default public.current_school_id() references public.school(id) on delete cascade,
  enquiry_id  bigint not null references public.admission_enquiry(id) on delete cascade,
  kind        text not null check (char_length(kind) between 1 and 60),
  file_key    text not null check (char_length(file_key) <= 300),
  verified    boolean not null default false,
  uploaded_by bigint references public.staff(id) on delete set null,
  created_at  timestamptz not null default now()
);
create index if not exists idx_admission_document_enquiry on public.admission_document (enquiry_id);

-- ---------- test / interview slots ----------
create table if not exists public.admission_slot (
  id               bigint generated always as identity primary key,
  school_id        bigint not null default public.current_school_id() references public.school(id) on delete cascade,
  academic_year_id bigint not null references public.academic_year(id) on delete cascade,
  class_id         bigint references public.class(id) on delete cascade,
  kind             text not null check (kind in ('test', 'interview')),
  starts_at        timestamptz not null,
  venue            text check (venue is null or char_length(venue) <= 80),
  capacity         int not null check (capacity between 1 and 1000)
);
create table if not exists public.admission_booking (
  id          bigint generated always as identity primary key,
  school_id   bigint not null default public.current_school_id() references public.school(id) on delete cascade,
  slot_id     bigint not null references public.admission_slot(id) on delete cascade,
  enquiry_id  bigint not null references public.admission_enquiry(id) on delete cascade,
  kind        text not null,
  attended    boolean,
  unique (enquiry_id, kind)
);

create or replace function public.admission_booking_guard() returns trigger
language plpgsql security definer set search_path = '' as $$
declare s public.admission_slot; v_used int;
begin
  select * into s from public.admission_slot where id = new.slot_id;
  if s.school_id is distinct from new.school_id or not exists (select 1 from public.admission_enquiry e where e.id = new.enquiry_id and e.school_id = new.school_id) then
    raise exception 'That record belongs to another institution';
  end if;
  new.kind := s.kind;
  perform pg_advisory_xact_lock(hashtextextended('admission_slot:' || s.id, 0));
  select count(*) into v_used from public.admission_booking b where b.slot_id = s.id and b.id is distinct from new.id;
  if v_used >= s.capacity then raise exception 'This slot is full (% places)', s.capacity; end if;
  return new;
end $$;
drop trigger if exists trg_admission_booking_guard on public.admission_booking;
create trigger trg_admission_booking_guard before insert or update on public.admission_booking for each row execute function public.admission_booking_guard();

-- ---------- merit list ----------
-- Ranked by score (higher first); ties: a brother or sister already in the
-- school first, then the earlier enquiry. Only scored, not yet admitted or
-- declined applicants are ranked.
create or replace function public.admission_merit(p_year bigint, p_class bigint)
returns table (enquiry_id bigint, rank int, child_name text, score numeric, sibling boolean, enquired_on date, status text, within_seats boolean)
language sql stable security definer set search_path = '' as $$
  with ranked as (
    select e.id, e.child_name, e.score, e.status, (e.created_at at time zone 'Asia/Kolkata')::date d,
      exists (select 1 from public.guardian g join public.guardian_student gs on gs.guardian_id = g.id
              where g.school_id = e.school_id and regexp_replace(coalesce(g.phone, ''), '\D', '', 'g') = regexp_replace(coalesce(e.phone, ''), '\D', '', 'g') and coalesce(e.phone, '') <> '') sib,
      e.created_at
    from public.admission_enquiry e
    where e.school_id = public.current_school_id() and e.academic_year_id = p_year and e.class_id = p_class
      and e.score is not null and e.status not in ('admitted', 'not_interested'))
  select r.id, (row_number() over (order by r.score desc, r.sib desc, r.created_at))::int, r.child_name, r.score, r.sib, r.d, r.status,
    (row_number() over (order by r.score desc, r.sib desc, r.created_at)) <= coalesce((select a.available from public.admission_seats(p_year) a where a.class_id = p_class), 1000000)
  from ranked r
  where coalesce(app.is_admin_scope(), false)
  order by 2;
$$;
grant execute on function public.admission_merit(bigint, bigint) to authenticated;

-- ---------- security ----------
do $$ declare t text; begin
  foreach t in array array['admission_seat', 'admission_document', 'admission_slot', 'admission_booking'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('drop policy if exists tenant_isolation on public.%I', t);
    execute format('create policy tenant_isolation on public.%I as restrictive for all to authenticated using (school_id = (select public.current_school_id())) with check (school_id = (select public.current_school_id()))', t);
    execute format('drop policy if exists adm_read on public.%I', t);
    execute format('create policy adm_read on public.%I for select to authenticated using ((select app.is_admin_scope()))', t);
    execute format('drop policy if exists adm_write on public.%I', t);
    execute format('create policy adm_write on public.%I for all to authenticated using ((select app.is_office())) with check ((select app.is_office()))', t);
    execute format('revoke all on public.%I from anon', t);
    execute format('grant select, insert, update, delete on public.%I to authenticated', t);
    execute format('revoke truncate, trigger, references on public.%I from authenticated', t);
    execute format('grant all on public.%I to service_role', t);
  end loop;
end $$;
commit;
