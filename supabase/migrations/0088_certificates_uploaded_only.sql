-- Certificates are made by the office outside CampusTwin and uploaded as files
-- (owner decision, 27 Nov 2026). Uploaded or imported certificates may leave
-- the number empty, and a student may have more than one transfer certificate
-- on file (an original and a duplicate, say). The "one original TC" rule stays
-- only for certificates issued through CampusTwin.
begin;
drop index if exists public.uq_certificate_one_tc;
create unique index uq_certificate_one_tc on public.certificate (student_id) where kind = 'transfer' and status = 'issued' and source = 'issued';
alter table public.certificate alter column number drop not null;

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
      if new.issued_on is null then raise exception 'Enter the date of issue'; end if;
      new.number := nullif(btrim(coalesce(new.number, '')), '');
    end if;
    return new;
  end if;
  if new.content is distinct from old.content or new.number is distinct from old.number or new.kind is distinct from old.kind
     or new.student_id is distinct from old.student_id or new.verify_token is distinct from old.verify_token or new.school_id is distinct from old.school_id
     or new.source is distinct from old.source or new.issued_on is distinct from old.issued_on then
    raise exception 'An issued certificate cannot be changed';
  end if;
  if new.file_key is distinct from old.file_key and old.file_key is not null then raise exception 'This certificate already has a file'; end if;
  if old.status = 'cancelled' and new.status = 'issued' then raise exception 'A cancelled certificate cannot be brought back'; end if;
  if new.status = 'cancelled' and old.status = 'issued' then new.cancelled_at := now(); end if;
  if new.copies < old.copies then raise exception 'Copies only go up'; end if;
  return new;
end $$;
commit;
