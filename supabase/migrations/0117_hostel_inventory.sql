-- Hostel (switched on per institution: module "hostel") and inventory.
-- Hostel: hostels, rooms with a number of beds, allocations; a bed cannot be
-- given twice and a student cannot hold two beds at once.
-- Inventory: items and an append-only list of movements (received, issued,
-- returned, adjusted); stock can never go below zero.
begin;
create table if not exists public.hostel (
  id        bigint generated always as identity primary key,
  school_id bigint not null default public.current_school_id() references public.school(id) on delete cascade,
  name      text not null check (char_length(name) between 1 and 60),
  kind      text not null default 'mixed' check (kind in ('boys', 'girls', 'mixed')),
  warden    text check (warden is null or char_length(warden) <= 80),
  unique (school_id, name)
);
create table if not exists public.hostel_room (
  id        bigint generated always as identity primary key,
  school_id bigint not null default public.current_school_id() references public.school(id) on delete cascade,
  hostel_id bigint not null references public.hostel(id) on delete cascade,
  name      text not null check (char_length(name) between 1 and 30),
  beds      smallint not null check (beds between 1 and 40),
  unique (hostel_id, name)
);
create table if not exists public.hostel_allocation (
  id         bigint generated always as identity primary key,
  school_id  bigint not null default public.current_school_id() references public.school(id) on delete cascade,
  room_id    bigint not null references public.hostel_room(id) on delete restrict,
  bed_no     smallint not null check (bed_no >= 1),
  student_id bigint not null references public.student(id) on delete cascade,
  from_date  date not null default (now() at time zone 'Asia/Kolkata')::date,
  to_date    date,
  check (to_date is null or to_date >= from_date)
);
create unique index if not exists uq_hostel_bed_active on public.hostel_allocation (room_id, bed_no) where to_date is null;
create unique index if not exists uq_hostel_student_active on public.hostel_allocation (student_id) where to_date is null;

create table if not exists public.inventory_item (
  id        bigint generated always as identity primary key,
  school_id bigint not null default public.current_school_id() references public.school(id) on delete cascade,
  name      text not null check (char_length(name) between 1 and 80),
  category  text check (category is null or char_length(category) <= 40),
  unit      text not null default 'piece' check (char_length(unit) <= 20),
  min_stock numeric(10,2) not null default 0 check (min_stock >= 0),
  stock     numeric(10,2) not null default 0 check (stock >= 0),
  unique (school_id, name)
);
create table if not exists public.inventory_move (
  id         bigint generated always as identity primary key,
  school_id  bigint not null default public.current_school_id() references public.school(id) on delete cascade,
  item_id    bigint not null references public.inventory_item(id) on delete restrict,
  kind       text not null check (kind in ('received', 'issued', 'returned', 'adjusted')),
  qty        numeric(10,2) not null check (qty <> 0),
  person     text check (person is null or char_length(person) <= 80),
  note       text check (note is null or char_length(note) <= 200),
  by_staff   bigint references public.staff(id) on delete set null,
  at         timestamptz not null default now()
);
create index if not exists idx_inventory_move_item on public.inventory_move (item_id, at desc);

do $$ declare t text; begin
  foreach t in array array['hostel', 'hostel_room', 'hostel_allocation', 'inventory_item', 'inventory_move'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('drop policy if exists tenant_isolation on public.%I', t);
    execute format('create policy tenant_isolation on public.%I as restrictive for all to authenticated using (school_id = (select public.current_school_id())) with check (school_id = (select public.current_school_id()))', t);
    execute format('drop policy if exists ops_read on public.%I', t);
    execute format('create policy ops_read on public.%I for select to authenticated using ((select app.is_admin_scope()))', t);
    execute format('drop policy if exists ops_write on public.%I', t);
    execute format('create policy ops_write on public.%I for all to authenticated using ((select app.is_office())) with check ((select app.is_office()))', t);
    execute format('revoke all on public.%I from anon', t);
    execute format('grant select, insert, update, delete on public.%I to authenticated', t);
    execute format('revoke truncate, trigger, references on public.%I from authenticated', t);
    execute format('grant all on public.%I to service_role', t);
  end loop;
end $$;
-- the movement list is append-only; stock is kept by the database only
revoke update, delete on public.inventory_move from authenticated;
revoke insert, update on public.inventory_item from authenticated;
grant insert (name, category, unit, min_stock), update (name, category, unit, min_stock) on public.inventory_item to authenticated;

create or replace function public.hostel_guard() returns trigger
language plpgsql security definer set search_path = '' as $$
declare r public.hostel_room;
begin
  if tg_table_name = 'hostel_room' then
    if not exists (select 1 from public.hostel h where h.id = new.hostel_id and h.school_id = new.school_id) then raise exception 'That hostel is not at this institution'; end if;
    if tg_op = 'UPDATE' and new.beds < old.beds and exists (select 1 from public.hostel_allocation a where a.room_id = new.id and a.to_date is null and a.bed_no > new.beds) then
      raise exception 'A student is in a bed above %; move them first', new.beds;
    end if;
  else
    select * into r from public.hostel_room where id = new.room_id;
    if r.school_id is distinct from new.school_id or not exists (select 1 from public.student s where s.id = new.student_id and s.school_id = new.school_id) then
      raise exception 'That record belongs to another institution';
    end if;
    if new.bed_no > r.beds then raise exception 'Room % has only % beds', r.name, r.beds; end if;
  end if;
  return new;
end $$;
drop trigger if exists trg_hostel_room_guard on public.hostel_room;
create trigger trg_hostel_room_guard before insert or update on public.hostel_room for each row execute function public.hostel_guard();
drop trigger if exists trg_hostel_allocation_guard on public.hostel_allocation;
create trigger trg_hostel_allocation_guard before insert or update on public.hostel_allocation for each row execute function public.hostel_guard();

create or replace function public.inventory_apply() returns trigger
language plpgsql security definer set search_path = '' as $$
declare v_change numeric; v_new numeric;
begin
  if not exists (select 1 from public.inventory_item i where i.id = new.item_id and i.school_id = new.school_id) then raise exception 'That item is not at this institution'; end if;
  v_change := case new.kind when 'received' then abs(new.qty) when 'returned' then abs(new.qty) when 'issued' then -abs(new.qty) else new.qty end;
  select stock + v_change into v_new from public.inventory_item where id = new.item_id for update;
  if v_new < 0 then raise exception 'Not enough in stock (% left)', v_new - v_change; end if;
  update public.inventory_item set stock = v_new where id = new.item_id;
  new.by_staff := coalesce(new.by_staff, app.my_staff_id());
  return new;
end $$;
drop trigger if exists trg_inventory_apply on public.inventory_move;
create trigger trg_inventory_apply before insert on public.inventory_move for each row execute function public.inventory_apply();

-- Greenfield (a demo institution) gets the hostel to try it
update public.school set module_overrides = coalesce(module_overrides, '{}'::jsonb) || '{"hostel": true}'::jsonb where slug = 'greenfield' and is_sample;
commit;
