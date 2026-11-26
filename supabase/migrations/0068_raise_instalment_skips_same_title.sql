-- Raising an instalment skips students who already have a bill with the same
-- title this year (for example "Term 1 fees" raised by hand before the school
-- set up instalments), instead of failing on the one-title-per-student rule.
-- This lets a school move to instalments part-way through a year.
begin;

create or replace function public.raise_instalment(p_instalment bigint, p_class bigint default null, p_section bigint default null)
returns int language plpgsql security definer set search_path = '' as $$
declare
  ins public.fee_instalment;
  v_school bigint; v_year bigint; v_first boolean; v_cum_prev numeric; v_cum numeric;
  v_actor bigint; v_made int := 0;
  st record; h record; c record;
  v_inv bigint; v_charges numeric; v_applicable numeric; v_off numeric; v_total numeric;
begin
  select * into ins from public.fee_instalment where id = p_instalment;
  if not found then raise exception 'Instalment not found'; end if;
  v_school := ins.school_id; v_year := ins.academic_year_id;
  -- Office of this school, or the system (scheduled raising has no user).
  if auth.uid() is not null and not (app.is_office() and public.current_school_id() = v_school) then
    raise exception 'Only the school office can raise fees';
  end if;
  v_actor := case when auth.uid() is null then null else app.my_staff_id() end;
  v_first := not exists (select 1 from public.fee_instalment x where x.academic_year_id = v_year and x.seq < ins.seq);
  select coalesce(sum(share_pct), 0) into v_cum_prev from public.fee_instalment x where x.academic_year_id = v_year and x.seq < ins.seq;
  v_cum := v_cum_prev + ins.share_pct;
  perform set_config('fees.bulk', 'on', true);
  create temp table if not exists _lines (head_id bigint, amount numeric, kind text, label text) on commit drop;

  for st in
    select e.student_id, e.section_id, sec.class_id
    from public.student_enrollment e
    join public.section sec on sec.id = e.section_id
    where e.academic_year_id = v_year and e.status <> 'transferred' and sec.school_id = v_school
      and (p_class is null or sec.class_id = p_class) and (p_section is null or e.section_id = p_section)
      and not exists (select 1 from public.fee_invoice i where i.student_id = e.student_id and i.academic_year_id = v_year and i.status <> 'cancelled'
                      and (i.instalment_id = ins.id or lower(btrim(i.title)) = lower(btrim(ins.name))))
  loop
    -- charge lines: cumulative rounding keeps the year exact
    truncate pg_temp._lines;
    for h in
      select fs.fee_head_id, fs.amount, fh.charge
      from public.fee_structure fs join public.fee_head fh on fh.id = fs.fee_head_id
      where fs.academic_year_id = v_year and fs.class_id = st.class_id and fh.is_active and fs.amount > 0
    loop
      if h.charge = 'once' then
        if v_first then insert into pg_temp._lines values (h.fee_head_id, round(h.amount, 2), 'charge', null); end if;
      else
        insert into pg_temp._lines values (h.fee_head_id, round(h.amount * v_cum / 100, 2) - round(h.amount * v_cum_prev / 100, 2), 'charge', null);
      end if;
    end loop;
    delete from pg_temp._lines where amount <= 0;
    select coalesce(sum(amount), 0) into v_charges from pg_temp._lines;
    if v_charges <= 0 then continue; end if;

    -- automatic sibling concessions, stored on the student (unless removed)
    if public.sibling_rank(st.student_id, v_year) >= 2 then
      insert into public.student_concession (school_id, student_id, concession_type_id, academic_year_id, is_auto, note)
      select v_school, st.student_id, t.id, v_year, true, 'Given automatically: second child or later'
      from public.fee_concession_type t
      where t.school_id = v_school and t.active and t.auto_rule = 'sibling'
      on conflict (student_id, concession_type_id, academic_year_id) do nothing;
    end if;

    -- concessions
    for c in
      select t.name, t.kind, t.value, t.head_ids
      from public.student_concession sc join public.fee_concession_type t on t.id = sc.concession_type_id
      where sc.student_id = st.student_id and sc.academic_year_id = v_year and sc.status = 'active' and t.active
      order by t.id
    loop
      select coalesce(sum(amount), 0) into v_applicable from pg_temp._lines
       where kind = 'charge' and (c.head_ids is null or head_id = any(c.head_ids));
      v_off := case when c.kind = 'percent' then round(v_applicable * c.value / 100, 2)
                    else round(c.value * v_cum / 100, 2) - round(c.value * v_cum_prev / 100, 2) end;
      v_off := least(v_off, v_applicable);
      if v_off > 0 then insert into pg_temp._lines values (null, v_off, 'concession', c.name); end if;
    end loop;

    select greatest(0, coalesce(sum(case when kind = 'concession' then -amount else amount end), 0)) into v_total from pg_temp._lines;
    insert into public.fee_invoice (school_id, student_id, section_id, academic_year_id, title, amount, paid_amount, due_date, status, created_by, instalment_id)
    values (v_school, st.student_id, st.section_id, v_year, ins.name, v_total, 0, ins.due_date, public.fee_status(v_total, 0), v_actor, ins.id)
    returning id into v_inv;
    insert into public.fee_invoice_line (invoice_id, fee_head_id, amount, kind, label, school_id)
    select v_inv, head_id, amount, kind, label, v_school from pg_temp._lines;
    v_made := v_made + 1;
  end loop;

  perform set_config('fees.bulk', 'off', true);
  if p_class is null and p_section is null then update public.fee_instalment set raised_at = now() where id = ins.id; end if;
  return v_made;
end $$;
revoke all on function public.raise_instalment(bigint, bigint, bigint) from public, anon;
grant execute on function public.raise_instalment(bigint, bigint, bigint) to authenticated, service_role;

commit;
