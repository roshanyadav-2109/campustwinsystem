-- The payment log stays unchangeable; deleting is already impossible for
-- signed-in people (read-only access), and must stay possible for clean-up
-- by the service (removing a test payment with its log).
begin;
drop trigger if exists trg_payment_event_append_only on public.payment_event;
create trigger trg_payment_event_append_only before update on public.payment_event for each row execute function public.payment_event_append_only();
commit;
