-- Alumni directory privacy.
--
-- Before: a verified alumnus could select every listed alumnus's full row,
-- including email and phone, straight from the API (row security limits rows,
-- not columns). The directory screen never showed them, but the data was open.
--
-- Now: alumni can read only their own full record. The directory comes from
-- alum.directory(), which returns public fields only and applies the same
-- visibility rule as before (staff: every verified alumnus; members: verified
-- alumni who chose to be listed). Staff access is unchanged. Idempotent.
begin;

drop policy if exists member_read on alum.member;
create policy member_read on alum.member for select to authenticated using (
  alum.is_staff(org_id) or user_id = auth.uid());

create or replace function alum.directory(
  p_org uuid, p_q text default null, p_batch int default null, p_city text default null,
  p_limit int default 50, p_offset int default 0)
returns table (id bigint, full_name text, batch_year smallint, programme text, company text,
               job_title text, higher_studies text, city text, linkedin_url text, total bigint)
language plpgsql stable security definer set search_path = '' as $$
declare
  v_staff boolean := alum.is_staff(p_org);
  v_q text;
  v_city text;
begin
  if not v_staff and alum.role(p_org) is distinct from 'member' then
    return;
  end if;
  -- treat the search text literally (no LIKE wildcards from the user)
  v_q := nullif(replace(replace(replace(btrim(coalesce(p_q, '')), '\', '\\'), '%', '\%'), '_', '\_'), '');
  v_city := nullif(replace(replace(replace(btrim(coalesce(p_city, '')), '\', '\\'), '%', '\%'), '_', '\_'), '');
  return query
    select m.id, m.full_name, m.batch_year, m.programme, m.company, m.job_title, m.higher_studies,
           m.city, m.linkedin_url, count(*) over ()
    from alum.member m
    where m.org_id = p_org
      and m.status = 'verified'
      and (v_staff or m.show_in_directory)
      and (v_q is null or m.full_name ilike '%' || v_q || '%' or m.company ilike '%' || v_q || '%'
           or m.programme ilike '%' || v_q || '%' or m.job_title ilike '%' || v_q || '%')
      and (p_batch is null or m.batch_year = p_batch)
      and (v_city is null or m.city ilike '%' || v_city || '%')
    order by m.batch_year desc nulls last, m.full_name
    limit least(greatest(coalesce(p_limit, 50), 1), 200)
    offset greatest(coalesce(p_offset, 0), 0);
end $$;

revoke all on function alum.directory(uuid, text, int, text, int, int) from public, anon;
grant execute on function alum.directory(uuid, text, int, text, int, int) to authenticated, service_role;

commit;
