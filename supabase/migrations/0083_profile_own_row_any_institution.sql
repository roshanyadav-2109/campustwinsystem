-- A person can always read their own login row, whichever institution's
-- website they are on (their last-used institution may be another one of
-- their memberships). Everything else in profile stays per institution.
drop policy if exists tenant_isolation on public.profile;
create policy tenant_isolation on public.profile as restrictive for all to authenticated
  using (id = auth.uid() or school_id = public.current_school_id())
  with check (id = auth.uid() or school_id = public.current_school_id());
