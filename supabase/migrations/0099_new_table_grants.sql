-- Defence in depth: Supabase gives signed-in users every right on new tables
-- by default. Row rules already block what they must, but each table created
-- tonight now carries exactly the rights it needs, and nobody can TRUNCATE.
begin;
do $$ declare t text; begin
  foreach t in array array['notification_setting','notification_template','notification','notification_delivery','notification_event_type',
                           'notification_event_channel','notification_outbox','payment_gateway_setting','payment_order',
                           'report_scheme','report_scheme_term','report_scheme_component','report_grade_band','report_coscholastic_area',
                           'report_scheme_assignment','report_coscholastic_grade','report_remark','report_lock','report_card'] loop
    execute format('revoke truncate, trigger, references on public.%I from anon, authenticated', t);
    execute format('revoke all on public.%I from anon', t);
  end loop;
end $$;
-- read-only for signed-in users (written by the database itself)
revoke insert, update, delete on public.notification, public.notification_delivery, public.notification_event_type from authenticated;
commit;
