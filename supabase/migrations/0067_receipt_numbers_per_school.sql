-- Receipt numbers per school.
-- Receipts were numbered from one counter shared by every school, and that
-- counter restarted at 1 when the data moved to the live project, so the next
-- payment at a school with existing receipts collided with an old number and
-- failed. Each school now continues its own series for the year
-- (R-2026-000474 after R-2026-000473), taken under a per-school lock so two
-- receipts saved at the same moment never get the same number.
-- Existing receipts are not renumbered.
begin;

create or replace function public.fee_payment_before_insert()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
declare v_prefix text; v_last int;
begin
  select i.student_id into new.student_id from public.fee_invoice i
   where i.id = new.invoice_id and i.school_id = new.school_id;
  if new.student_id is null then
    raise exception 'Fee invoice % not found', new.invoice_id;
  end if;
  v_prefix := 'R-' || to_char(coalesce(new.paid_on, current_date), 'YYYY') || '-';
  perform pg_advisory_xact_lock(hashtextextended('fee_receipt:' || new.school_id || ':' || v_prefix, 0));
  select coalesce(max(substr(p.receipt_no, length(v_prefix) + 1)::int), 0) into v_last
    from public.fee_payment p
   where p.school_id = new.school_id and p.receipt_no like v_prefix || '%'
     and substr(p.receipt_no, length(v_prefix) + 1) ~ '^[0-9]+$';
  new.receipt_no := v_prefix || lpad((v_last + 1)::text, 6, '0');
  return new;
end $$;
revoke execute on function public.fee_payment_before_insert() from public, anon, authenticated;

commit;
