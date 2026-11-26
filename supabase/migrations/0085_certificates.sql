-- Certificates: transfer (TC), bonafide and character certificates.
--
-- * Each issued certificate keeps its content frozen (what was printed), a
--   number in the school's own series per kind and year (TC/2026/0001), and a
--   long random token for the QR code that anyone can check on the public
--   verification page.
-- * One original transfer certificate per student. Printing it again keeps the
--   same number and is marked "Duplicate" (copies counts them), as the board
--   requires. A certificate can be cancelled with a reason; it then shows as
--   cancelled when checked.
-- * Only the office issues, reprints and cancels; the office and principal
--   read. The content of an issued certificate can never be changed.
-- * school.tc_format: which transfer certificate layout the school uses
--   ('cbse' = CBSE Examination Bye-Laws Annexure I; 'state' = state-board
--   school leaving certificate with General Register number).
-- Idempotent.
begin;

alter table public.school add column if not exists tc_format text not null default 'cbse' check (tc_format in ('cbse', 'state'));

create table if not exists public.certificate (
  id            bigint generated always as identity primary key,
  school_id     bigint not null default public.current_school_id() references public.school(id) on delete cascade,
  student_id    bigint not null references public.student(id) on delete cascade,
  kind          text not null check (kind in ('transfer', 'bonafide', 'character')),
  format        text,
  number        text,
  content       jsonb not null,
  verify_token  text not null default encode(extensions.gen_random_bytes(18), 'hex'),
  status        text not null default 'issued' check (status in ('issued', 'cancelled')),
  copies        int not null default 0 check (copies >= 0),
  issued_by     bigint references public.staff(id) on delete set null,
  issued_at     timestamptz not null default now(),
  cancelled_at  timestamptz,
  cancel_reason text check (cancel_reason is null or char_length(cancel_reason) <= 300),
  unique (school_id, number),
  unique (verify_token)
);
create index if not exists idx_certificate_student on public.certificate (student_id);
create unique index if not exists uq_certificate_one_tc on public.certificate (student_id) where kind = 'transfer' and status = 'issued';

-- Number in the school's series for the kind and year; content frozen.
create or replace function public.certificate_guard() returns trigger
language plpgsql security definer set search_path = '' as $$
declare v_prefix text; v_last int;
begin
  if tg_op = 'INSERT' then
    v_prefix := case new.kind when 'transfer' then 'TC' when 'bonafide' then 'BC' else 'CC' end
                || '/' || to_char(now() at time zone 'Asia/Kolkata', 'YYYY') || '/';
    perform pg_advisory_xact_lock(hashtextextended('certificate:' || new.school_id || ':' || v_prefix, 0));
    select coalesce(max(substr(c.number, length(v_prefix) + 1)::int), 0) into v_last
      from public.certificate c where c.school_id = new.school_id and c.number like v_prefix || '%';
    new.number := v_prefix || lpad((v_last + 1)::text, 4, '0');
    new.status := 'issued'; new.copies := 0; new.cancelled_at := null; new.cancel_reason := null; new.issued_at := now();
    return new;
  end if;
  if new.content is distinct from old.content or new.number is distinct from old.number or new.kind is distinct from old.kind
     or new.student_id is distinct from old.student_id or new.verify_token is distinct from old.verify_token or new.school_id is distinct from old.school_id then
    raise exception 'An issued certificate cannot be changed';
  end if;
  if old.status = 'cancelled' and new.status = 'issued' then raise exception 'A cancelled certificate cannot be brought back'; end if;
  if new.status = 'cancelled' and old.status = 'issued' then new.cancelled_at := now(); end if;
  if new.copies < old.copies then raise exception 'Copies only go up'; end if;
  return new;
end $$;
drop trigger if exists trg_certificate_guard on public.certificate;
create trigger trg_certificate_guard before insert or update on public.certificate for each row execute function public.certificate_guard();

alter table public.certificate enable row level security;
drop policy if exists tenant_isolation on public.certificate;
create policy tenant_isolation on public.certificate as restrictive for all to authenticated
  using (school_id = public.current_school_id()) with check (school_id = public.current_school_id());
drop policy if exists certificate_read on public.certificate;
create policy certificate_read on public.certificate for select to authenticated using ((select app.is_admin_scope()));
drop policy if exists certificate_office on public.certificate;
create policy certificate_office on public.certificate for insert to authenticated with check ((select app.is_office()));
drop policy if exists certificate_office_update on public.certificate;
create policy certificate_office_update on public.certificate for update to authenticated using ((select app.is_office())) with check ((select app.is_office()));
grant select, insert, update on public.certificate to authenticated;
grant all on public.certificate to service_role;

drop trigger if exists trg_log_change on public.certificate;
create trigger trg_log_change after insert or update or delete on public.certificate for each row execute function public.log_change('Certificate');

-- Public check of a certificate from its QR code: only what proves it is
-- genuine, nothing more.
create or replace function public.verify_certificate(p_token text)
returns table (kind text, number text, student_name text, admission_no text, issued_on date, school_name text, school_place text, status text, copies int)
language sql stable security definer set search_path = '' as $$
  select c.kind, c.number, s.full_name, s.admission_no, (c.issued_at at time zone 'Asia/Kolkata')::date, sc.name, sc.place, c.status, c.copies
  from public.certificate c
  join public.student s on s.id = c.student_id
  join public.school sc on sc.id = c.school_id
  where c.verify_token = p_token and length(p_token) >= 32;
$$;
revoke all on function public.verify_certificate(text) from public;
grant execute on function public.verify_certificate(text) to anon, authenticated;

commit;
