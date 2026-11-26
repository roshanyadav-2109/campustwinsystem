-- Sample schools only (Greenfield 8, Riverside 9, St. Aldric 10): transport is
-- charged per bus route instead of a "Transport" fee head on every student.
-- Bills already raised are not touched. The real school (1) is excluded.
begin;
update public.route r set annual_fee = 14000
 where r.school_id in (8, 9, 10) and r.annual_fee = 0;
update public.fee_head h set is_active = false
 where h.school_id in (8, 9, 10) and h.name = 'Transport' and h.is_active;
commit;
