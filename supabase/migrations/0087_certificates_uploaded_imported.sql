-- Certificates that were not issued through CampusTwin: a scanned or PDF copy
-- uploaded for one student, or rows imported from the school's old register.
-- They keep the school's own number and date, may carry a file, appear in the
-- same list, and are checkable by QR like any other (shown as recorded by the
-- school). Issued ones keep CampusTwin numbering, which now ignores numbers in
-- any other style.
begin;
alter table public.certificate add column if not exists source text not null default 'issued' check (source in ('issued', 'uploaded', 'imported'));
alter table public.certificate add column if not exists file_key text check (file_key is null or char_length(file_key) <= 300);
alter table public.certificate add column if not exists issued_on date;

create or replace function public.certificate_guard() returns trigger
language plpgsql security definer set search_path = '' as $$
declare v_prefix text; v_last int;
begin
  if tg_op = 'INSERT' then
    new.status := 'issued'; new.copies := 0; new.cancelled_at := null; new.cancel_reason := null; new.issued_at := now();
    if new.source = 'issued' then
      v_prefix := case new.kind when 'transfer' then 'TC' when 'bonafide' then 'BC' else 'CC' end
                  || '/' || to_char(now() at time zone 'Asia/Kolkata', 'YYYY') || '/';
      perform pg_advisory_xact_lock(hashtextextended('certificate:' || new.school_id || ':' || v_prefix, 0));
      select coalesce(max(substr(c.number, length(v_prefix) + 1)::int), 0) into v_last
        from public.certificate c
       where c.school_id = new.school_id and c.number like v_prefix || '%'
         and substr(c.number, length(v_prefix) + 1) ~ '^[0-9]{1,9}$';
      new.number := v_prefix || lpad((v_last + 1)::text, 4, '0');
      new.issued_on := (now() at time zone 'Asia/Kolkata')::date;
    else
      if new.number is null or char_length(btrim(new.number)) = 0 then raise exception 'Enter the certificate number'; end if;
      if new.issued_on is null then raise exception 'Enter the date of issue'; end if;
      new.number := btrim(new.number);
    end if;
    return new;
  end if;
  if new.content is distinct from old.content or new.number is distinct from old.number or new.kind is distinct from old.kind
     or new.student_id is distinct from old.student_id or new.verify_token is distinct from old.verify_token or new.school_id is distinct from old.school_id
     or new.source is distinct from old.source or new.issued_on is distinct from old.issued_on then
    raise exception 'An issued certificate cannot be changed';
  end if;
  -- a file may be attached once to a certificate that has none
  if new.file_key is distinct from old.file_key and old.file_key is not null then raise exception 'This certificate already has a file'; end if;
  if old.status = 'cancelled' and new.status = 'issued' then raise exception 'A cancelled certificate cannot be brought back'; end if;
  if new.status = 'cancelled' and old.status = 'issued' then new.cancelled_at := now(); end if;
  if new.copies < old.copies then raise exception 'Copies only go up'; end if;
  return new;
end $$;

update public.certificate set issued_on = (issued_at at time zone 'Asia/Kolkata')::date where issued_on is null;

drop function if exists public.verify_certificate(text);
create function public.verify_certificate(p_token text)
returns table (kind text, number text, student_name text, admission_no text, issued_on date, school_name text, school_place text, status text, copies int, source text)
language sql stable security definer set search_path = '' as $$
  select c.kind, c.number, s.full_name, s.admission_no, c.issued_on, sc.name, sc.place, c.status, c.copies, c.source
  from public.certificate c
  join public.student s on s.id = c.student_id
  join public.school sc on sc.id = c.school_id
  where c.verify_token = p_token and length(p_token) >= 32;
$$;
revoke all on function public.verify_certificate(text) from public;
grant execute on function public.verify_certificate(text) to anon, authenticated;
commit;
