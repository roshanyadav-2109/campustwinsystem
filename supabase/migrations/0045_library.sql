-- =============================================================================
-- Migration 0045 — Library
--   library_book    : the catalogue (one row per title/accession number)
--   library_issue   : a book lent to a student or a staff member
--   library_setting : loan period, limits and the fine per day (single row)
--   library_book_stock (view) : each book with copies out / copies available
--
-- Read access
--   * book, setting : every signed-in user
--   * issue         : principal/office (everything); a student or guardian sees
--                     the student's own rows; a staff member sees their own rows
-- Write access: office only (the office is the librarian). Principal reads.
-- Idempotent: safe to run more than once. Creates new objects only.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- Catalogue
-- ---------------------------------------------------------------------------
create table if not exists public.library_book (
  id            bigint generated always as identity primary key,
  accession_no  text not null unique,             -- e.g. 'B-00123'
  title         text not null,
  author        text not null,
  publisher     text,
  isbn          text,
  category      text not null,                    -- Fiction, Science, Reference ...
  language      text,
  shelf         text,
  copies_total  int not null default 1 check (copies_total >= 0),
  is_active     boolean not null default true,
  added_by      bigint references public.staff(id) on delete set null,
  created_at    timestamptz not null default now()
);

create index if not exists idx_library_book_category on public.library_book(category);
create index if not exists idx_library_book_title    on public.library_book(title);
create index if not exists idx_library_book_added_by on public.library_book(added_by);

-- ---------------------------------------------------------------------------
-- Issues (loans). Exactly one of student_id / staff_id is set.
-- ---------------------------------------------------------------------------
create table if not exists public.library_issue (
  id           bigint generated always as identity primary key,
  book_id      bigint not null references public.library_book(id) on delete restrict,
  student_id   bigint references public.student(id) on delete cascade,
  staff_id     bigint references public.staff(id) on delete cascade,
  issued_on    date not null,
  due_on       date not null,
  returned_on  date,
  fine_amount  numeric(10,2) not null default 0 check (fine_amount >= 0),
  fine_paid    boolean not null default false,
  issued_by    bigint references public.staff(id) on delete set null,
  returned_to  bigint references public.staff(id) on delete set null,
  note         text,
  created_at   timestamptz not null default now(),
  constraint library_issue_one_member check (num_nonnulls(student_id, staff_id) = 1),
  constraint library_issue_due_after_issue check (due_on >= issued_on),
  constraint library_issue_return_after_issue check (returned_on is null or returned_on >= issued_on)
);

create index if not exists idx_library_issue_book     on public.library_issue(book_id);
create index if not exists idx_library_issue_student  on public.library_issue(student_id);
create index if not exists idx_library_issue_staff    on public.library_issue(staff_id);
create index if not exists idx_library_issue_open     on public.library_issue(due_on) where returned_on is null;
create index if not exists idx_library_issue_open_book on public.library_issue(book_id) where returned_on is null;
create index if not exists idx_library_issue_fine_due on public.library_issue(returned_on)
  where returned_on is not null and fine_amount > 0 and not fine_paid;

-- ---------------------------------------------------------------------------
-- Settings (always exactly one row, id = 1)
-- ---------------------------------------------------------------------------
create table if not exists public.library_setting (
  id                 smallint primary key default 1 check (id = 1),
  loan_days_student  int not null default 14 check (loan_days_student between 1 and 365),
  loan_days_staff    int not null default 30 check (loan_days_staff between 1 and 365),
  max_books_student  int not null default 2  check (max_books_student between 0 and 50),
  max_books_staff    int not null default 5  check (max_books_staff between 0 and 50),
  fine_per_day       numeric(6,2) not null default 2 check (fine_per_day >= 0),
  updated_at         timestamptz not null default now()
);

insert into public.library_setting (id) values (1) on conflict do nothing;

-- ---------------------------------------------------------------------------
-- RLS
-- ---------------------------------------------------------------------------
alter table public.library_book    enable row level security;
alter table public.library_issue   enable row level security;
alter table public.library_setting enable row level security;

-- Catalogue: everyone reads, office writes.
drop policy if exists library_book_read   on public.library_book;
drop policy if exists library_book_insert on public.library_book;
drop policy if exists library_book_update on public.library_book;
drop policy if exists library_book_delete on public.library_book;
create policy library_book_read on public.library_book
  for select to authenticated using (true);
create policy library_book_insert on public.library_book
  for insert to authenticated with check ((select app.is_office()));
create policy library_book_update on public.library_book
  for update to authenticated using ((select app.is_office())) with check ((select app.is_office()));
create policy library_book_delete on public.library_book
  for delete to authenticated using ((select app.is_office()));

-- Settings: everyone reads, office writes.
drop policy if exists library_setting_read   on public.library_setting;
drop policy if exists library_setting_insert on public.library_setting;
drop policy if exists library_setting_update on public.library_setting;
drop policy if exists library_setting_delete on public.library_setting;
create policy library_setting_read on public.library_setting
  for select to authenticated using (true);
create policy library_setting_insert on public.library_setting
  for insert to authenticated with check ((select app.is_office()));
create policy library_setting_update on public.library_setting
  for update to authenticated using ((select app.is_office())) with check ((select app.is_office()));
create policy library_setting_delete on public.library_setting
  for delete to authenticated using ((select app.is_office()));

-- Issues: principal/office read all; a student or guardian reads the student's
-- own rows (same meaning as app.owns_student(student_id), written with the
-- set-returning helper from 0004 so it runs once per query); a staff member
-- reads their own rows. Only the office writes.
drop policy if exists library_issue_read   on public.library_issue;
drop policy if exists library_issue_insert on public.library_issue;
drop policy if exists library_issue_update on public.library_issue;
drop policy if exists library_issue_delete on public.library_issue;
create policy library_issue_read on public.library_issue
  for select to authenticated using (
    (select app.is_admin_scope())
    or student_id in (select app.my_owned_students())
    or staff_id = (select app.my_staff_id())
  );
create policy library_issue_insert on public.library_issue
  for insert to authenticated with check ((select app.is_office()));
create policy library_issue_update on public.library_issue
  for update to authenticated using ((select app.is_office())) with check ((select app.is_office()));
create policy library_issue_delete on public.library_issue
  for delete to authenticated using ((select app.is_office()));

grant select, insert, update, delete on public.library_book    to authenticated;
grant select, insert, update, delete on public.library_issue   to authenticated;
grant select, insert, update, delete on public.library_setting to authenticated;

-- ---------------------------------------------------------------------------
-- Availability
-- A member may only read their own issue rows, so a plain count under their
-- rights would show every copy as available. This helper returns ONLY a number
-- per book (never who holds it); the view itself runs with the caller's rights.
-- ---------------------------------------------------------------------------
create or replace function app.library_out_counts()
returns table (book_id bigint, out_count bigint)
language sql stable security definer set search_path = public, pg_temp as $$
  select i.book_id, count(*) from public.library_issue i
  where i.returned_on is null
  group by i.book_id;
$$;
revoke all on function app.library_out_counts() from public, anon;
grant execute on function app.library_out_counts() to authenticated, service_role;

create or replace view public.library_book_stock
with (security_invoker = true) as
select
  b.id, b.accession_no, b.title, b.author, b.publisher, b.isbn, b.category,
  b.language, b.shelf, b.copies_total, b.is_active, b.created_at,
  coalesce(o.out_count, 0)::int                              as copies_out,
  greatest(b.copies_total - coalesce(o.out_count, 0), 0)::int as copies_available
from public.library_book b
left join app.library_out_counts() o on o.book_id = b.id;

revoke all on public.library_book_stock from anon;
grant select on public.library_book_stock to authenticated;

-- Catalogue totals and the category list, so the app never has to pull the
-- whole catalogue to count it. Both run with the caller's rights.
create or replace function public.library_totals()
returns table (titles bigint, copies bigint)
language sql stable set search_path = public, pg_temp as $$
  select count(*), coalesce(sum(copies_total), 0)::bigint
  from public.library_book where is_active;
$$;

create or replace function public.library_categories()
returns setof text
language sql stable set search_path = public, pg_temp as $$
  select distinct category from public.library_book order by 1;
$$;

revoke all on function public.library_totals()     from public, anon;
revoke all on function public.library_categories() from public, anon;
grant execute on function public.library_totals()     to authenticated, service_role;
grant execute on function public.library_categories() to authenticated, service_role;

notify pgrst, 'reload schema';
