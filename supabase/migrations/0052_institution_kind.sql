-- What kind of institution a tenant is, so the console can say "College"
-- instead of treating every tenant as a school. Campuses are still identified by
-- university_id; this column describes what each campus or institution teaches.
alter table public.school
  add column if not exists kind text not null default 'school'
  check (kind in ('school', 'college'));

-- Sample data created by scripts/seed-sample.mjs.
update public.school set kind = 'college'
where (slug, code) in (
  ('meridian', 'MIT'), ('lakeview', 'LCA'),
  ('westbridge-north', 'WBN'), ('westbridge-city', 'WBC'), ('westbridge-health', 'WBH')
);
