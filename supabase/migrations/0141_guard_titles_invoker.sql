-- The title guard (0140) must run as the caller to see who is changing it.
begin;
create or replace function public.guard_top_titles() returns trigger
language plpgsql security invoker set search_path = '' as $$
begin
  if current_user = 'authenticated' and not coalesce(app.is_principal(), false)
     and ((tg_op <> 'INSERT' and old.access_type = any(app.top_types())) or (tg_op <> 'DELETE' and new.access_type = any(app.top_types()))) then
    raise exception 'Only the head of the institution can change this title';
  end if;
  return coalesce(new, old);
end $$;
commit;
