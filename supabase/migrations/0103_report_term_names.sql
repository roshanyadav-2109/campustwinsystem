-- The frozen report card also keeps each term's name (year-end PDF columns).
begin;
create or replace function public.report_term_names(p_scheme bigint) returns jsonb
language sql stable security definer set search_path = '' as $$
  select coalesce(jsonb_object_agg(t.term::text, t.name), '{}'::jsonb) from public.report_scheme_term t where t.scheme_id = p_scheme;
$$;
create or replace function public.report_card_add_term_names() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  new.snapshot := new.snapshot || jsonb_build_object('term_names', public.report_term_names(new.scheme_id));
  return new;
end $$;
drop trigger if exists trg_report_card_term_names on public.report_card;
create trigger trg_report_card_term_names before insert on public.report_card for each row execute function public.report_card_add_term_names();
commit;
