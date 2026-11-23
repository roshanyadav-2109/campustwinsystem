-- =============================================================================
-- Migration 0048 — Institution registry
--
-- Turns the `school` row into the per-institution registry the company manages:
-- a subdomain slug, branding, plan, which modules are switched on, the hosting
-- tier, status, and usage limits. For the shared tier this IS the registry; the
-- dedicated tier (separate databases) gets a central registry in Phase 5.
--
-- Branding moves OFF build-time env (src/lib/school.ts) and onto these columns,
-- read at runtime per institution. Module switches gate the nav and every page.
-- =============================================================================

alter table public.school add column if not exists slug text;
alter table public.school add column if not exists short_name text;
alter table public.school add column if not exists place text;
alter table public.school add column if not exists monogram text;
alter table public.school add column if not exists logo_url text;
alter table public.school add column if not exists login_image_url text;
alter table public.school add column if not exists login_video_id text;
alter table public.school add column if not exists primary_color text not null default '#0F6CBD';
alter table public.school add column if not exists plan text not null default 'standard';
alter table public.school add column if not exists tier text not null default 'shared';
alter table public.school add column if not exists status text not null default 'active';
alter table public.school add column if not exists max_users integer;
alter table public.school add column if not exists max_twin_messages integer;
-- Which paid modules are switched on. Core modules (dashboard, attendance,
-- marks, students, announcements, calendar, schedule, reports, progress, leave,
-- allotments, promotion, manage, details) are always on and not listed here.
alter table public.school add column if not exists modules jsonb not null default
  '{"twin":true,"fees":true,"library":true,"homework":true,"admissions":true,"hr":true,"transport":false}'::jsonb;

-- Backfill a slug for every existing institution from its name (lowercase,
-- alphanumeric, collapsed to single hyphens), then make it unique + required.
update public.school
   set slug = coalesce(nullif(slug,''),
       trim(both '-' from regexp_replace(lower(name), '[^a-z0-9]+', '-', 'g')))
 where slug is null or slug = '';

create unique index if not exists school_slug_key on public.school (slug);
alter table public.school alter column slug set not null;

alter table public.school add constraint school_tier_check   check (tier in ('shared','dedicated')) not valid;
alter table public.school add constraint school_status_check check (status in ('active','suspended')) not valid;
alter table public.school validate constraint school_tier_check;
alter table public.school validate constraint school_status_check;
