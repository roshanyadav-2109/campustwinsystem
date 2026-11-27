-- Keep the database small while the product is built (owner, 27 Nov):
--   1. sample institutions keep only their last 45 days of daily and lecture
--      attendance and absence notices (marks, results and everything else stay);
--   2. nightly housekeeping: the scheduler's run log older than 3 days and
--      processed notification jobs older than 30 days are removed, so they
--      can never grow without limit.
-- The demo school (snm) is not touched.
delete from public.absence_notice a using public.school s
 where s.id = a.school_id and s.is_sample and a.on_date < (now() at time zone 'Asia/Kolkata')::date - 45;
delete from public.attendance_record a using public.school s
 where s.id = a.school_id and s.is_sample and a.on_date < (now() at time zone 'Asia/Kolkata')::date - 45;

create or replace function public.housekeeping() returns void
language plpgsql security definer set search_path = '' as $$
begin
  delete from cron.job_run_details where end_time < now() - interval '3 days';
  delete from public.notification_outbox where processed_at is not null and processed_at < now() - interval '30 days';
end $$;
revoke all on function public.housekeeping() from public, anon, authenticated;
select cron.unschedule(jobid) from cron.job where jobname = 'housekeeping';
select cron.schedule('housekeeping', '30 21 * * *', 'select public.housekeeping()');
select public.housekeeping();
analyze public.attendance_record;
