-- apply_late_fees: a signed-in office that passes no school (or another
-- school) is refused. Before, "p_school = current_school_id()" was NULL when
-- p_school was NULL, so the guard did not fire and every school with late fees
-- switched on was processed. Only the nightly job (no signed-in user) may run
-- all schools at once.
create or replace function public.apply_late_fees_guard(p_school bigint) returns void
language plpgsql stable security definer set search_path = '' as $$
begin
  if auth.uid() is not null and (p_school is null or p_school is distinct from public.current_school_id() or not coalesce(app.is_office(), false)) then
    raise exception 'Only the school office can apply late fees for its own school';
  end if;
end $$;
revoke all on function public.apply_late_fees_guard(bigint) from public, anon, authenticated;

create or replace function public.apply_late_fees(p_school bigint default null)
returns int language plpgsql security definer set search_path = '' as $$
declare
  ru public.fee_late_rule; v_today date := (now() at time zone 'Asia/Kolkata')::date;
  inv record; v_want numeric; v_line record; v_changed int := 0; v_total int := 0; v_sum numeric;
begin
  perform public.apply_late_fees_guard(p_school);
  perform set_config('audit.quiet', 'on', true);
  for ru in select * from public.fee_late_rule r where r.enabled and (p_school is null or r.school_id = p_school) loop
    v_changed := 0; v_sum := 0;
    for inv in
      select i.id, i.due_date from public.fee_invoice i
      where i.school_id = ru.school_id and i.status in ('due', 'part')
        and (ru.applies_from is null or i.due_date >= ru.applies_from)
        and v_today - i.due_date > ru.grace_days
    loop
      v_want := public.late_fee_for(inv.due_date, v_today, ru.grace_days, ru.kind, ru.amount, ru.max_amount);
      select id, amount, waived into v_line from public.fee_invoice_line where invoice_id = inv.id and kind = 'late_fee' order by id limit 1;
      if v_line.id is null then
        if v_want > 0 then
          insert into public.fee_invoice_line (invoice_id, amount, kind, label, school_id) values (inv.id, v_want, 'late_fee', 'Late fee', ru.school_id);
          v_changed := v_changed + 1; v_sum := v_sum + v_want;
        end if;
      elsif not v_line.waived and v_line.amount <> v_want and v_want > 0 then
        update public.fee_invoice_line set amount = v_want where id = v_line.id;
        v_changed := v_changed + 1; v_sum := v_sum + (v_want - v_line.amount);
      end if;
      v_line := null;
    end loop;
    if v_changed > 0 then
      insert into public.audit_log (school_id, actor_id, actor_name, action, entity, label, fields)
      values (ru.school_id, auth.uid(), coalesce((select full_name from public.profile where id = auth.uid()), 'Eternity or system'),
              'changed', 'Late fees', format('%s invoices, %s added', v_changed, to_char(v_sum, 'FM99,99,99,990.00')), '{}');
    end if;
    v_total := v_total + v_changed;
  end loop;
  perform set_config('audit.quiet', 'off', true);
  return v_total;
end $$;
revoke all on function public.apply_late_fees(bigint) from public, anon;
grant execute on function public.apply_late_fees(bigint) to authenticated, service_role;
