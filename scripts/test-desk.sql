-- Eternity Desk self-test. Acts as an admin, an agent and the admin of another
-- organisation (and as the server for requester actions) inside one
-- transaction that always ends with an exception. Success: 'DESK_TEST_PASSED'.
do $$
declare
  ua uuid; ub uuid; ud uuid;
  a uuid; b uuid; cat bigint; t1 bigint; t2 bigint; n int; v text; tok uuid; ts timestamptz;
begin
  select id into ua from auth.users order by created_at limit 1;
  select id into ub from auth.users where id <> ua order by created_at limit 1;
  select id into ud from auth.users where id not in (ua, ub) order by created_at limit 1;

  insert into core.organisation (name, kind) values ('Desk Test One', 'business') returning id into a;
  insert into core.organisation (name, kind) values ('Desk Test Two', 'business') returning id into b;
  insert into core.subscription (org_id, product_code, status) values (a, 'desk', 'active'), (b, 'desk', 'active');
  insert into core.membership (org_id, user_id, role) values (a, ua, 'owner'), (b, ud, 'owner')
    on conflict (org_id, user_id) do update set role = excluded.role;
  insert into desk.team (org_id, user_id, role) values (a, ub, 'agent');

  -- 1. admin sets up: settings and default categories
  perform set_config('request.jwt.claims', json_build_object('sub', ua, 'role', 'authenticated')::text, true);
  set local role authenticated;
  if desk.role(a) <> 'admin' then raise exception 'FAIL 1: owner is not desk admin'; end if;
  perform desk.setup(a);
  perform desk.setup(a);
  select count(*) into n from desk.category where org_id = a;
  if n <> 7 then raise exception 'FAIL 1: % categories', n; end if;
  select id into cat from desk.category where org_id = a and name = 'Transport';
  reset role;

  -- 2. a requester raises a ticket through the public form (the app's server inserts it)
  insert into desk.ticket (org_id, subject, description, kind, category_id, priority, requester_name, requester_email, source)
    values (a, 'Bus late every day', 'Route 4 is 30 minutes late.', 'complaint', cat, 'high', 'Parent One', 'PARENT@example.com', 'web')
    returning id, public_token into t1, tok;
  select number::text || '|' || status || '|' || requester_email into v from desk.ticket where id = t1;
  if v <> '1|open|parent@example.com' then raise exception 'FAIL 2: ticket %', v; end if;
  select count(*) into n from desk.ticket where id = t1 and respond_by = created_at + interval '8 hours' and resolve_by = created_at + interval '72 hours';
  if n <> 1 then raise exception 'FAIL 3: deadlines not set from priority'; end if;
  insert into desk.ticket (org_id, subject, description, kind, priority, requester_name) values (a, 'Hostel food', 'Quality has dropped.', 'grievance', 'low', 'Student')
    returning id into t2;
  select number::text || '|' || priority into v from desk.ticket where id = t2;
  if v <> '2|normal' then raise exception 'FAIL 4: grievance numbering or priority: %', v; end if;

  -- 5. agent: sees the queue, replies, adds an internal note, changes priority
  perform set_config('request.jwt.claims', json_build_object('sub', ub, 'role', 'authenticated')::text, true);
  set local role authenticated;
  if desk.role(a) <> 'agent' then raise exception 'FAIL 5: agent role wrong'; end if;
  select count(*) into n from desk.ticket where org_id = a;
  if n <> 2 then raise exception 'FAIL 5: agent sees % tickets', n; end if;
  insert into desk.message (org_id, ticket_id, author_kind, author_user_id, author_name, body, internal)
    values (a, t1, 'agent', ub, 'Agent', 'Checking with the transport team.', true);
  select count(*) into n from desk.ticket where id = t1 and first_response_at is null;
  if n <> 1 then raise exception 'FAIL 5: an internal note counted as the first response'; end if;
  insert into desk.message (org_id, ticket_id, author_kind, author_user_id, author_name, body)
    values (a, t1, 'agent', ub, 'Agent', 'We have spoken to the driver; it should improve from Monday.');
  select status into v from desk.ticket where id = t1 and first_response_at is not null;
  if v is distinct from 'in_progress' then raise exception 'FAIL 6: first reply did not record or move to in progress (%)', v; end if;
  begin
    insert into desk.message (org_id, ticket_id, author_kind, author_user_id, author_name, body) values (a, t1, 'requester', ub, 'Fake', 'Pretending');
    raise exception 'FAIL 7: agent posted as the requester';
  exception when insufficient_privilege then null;
  end;
  begin
    update desk.message set body = 'edited' where ticket_id = t1;
    raise exception 'FAIL 7: message edited';
  exception when insufficient_privilege then null;
  end;
  select respond_by into ts from desk.ticket where id = t1;
  update desk.ticket set priority = 'urgent', assignee_id = ub where id = t1;
  select count(*) into n from desk.ticket where id = t1 and respond_by = created_at + interval '2 hours' and resolve_by = created_at + interval '24 hours';
  if n <> 1 then raise exception 'FAIL 8: deadlines not recomputed for the new priority'; end if;
  begin
    update desk.ticket set number = 99 where id = t1;
    raise exception 'FAIL 8: ticket number changed';
  exception when raise_exception then
    if sqlerrm not like '%cannot be changed%' then raise; end if;
  end;
  update desk.ticket set status = 'resolved' where id = t1;
  select count(*) into n from desk.ticket where id = t1 and resolved_at is not null;
  if n <> 1 then raise exception 'FAIL 9: resolve time not recorded'; end if;
  begin
    delete from desk.ticket where id = t2;
    raise exception 'FAIL 9: ticket deleted';
  exception when insufficient_privilege then null;
  end;
  begin
    insert into desk.category (org_id, name) values (a, 'Agent category');
    raise exception 'FAIL 10: agent changed categories';
  exception when insufficient_privilege then null;
  end;
  reset role;

  -- 11. the requester replies (through the server, by token): the resolved ticket reopens
  insert into desk.message (org_id, ticket_id, author_kind, author_name, body)
    select org_id, id, 'requester', requester_name, 'It was late again today.' from desk.ticket where public_token = tok;
  select status into v from desk.ticket where id = t1;
  if v <> 'open' then raise exception 'FAIL 11: requester reply did not reopen (%)', v; end if;
  update desk.ticket set status = 'closed' where id = t1;
  begin
    insert into desk.message (org_id, ticket_id, author_kind, author_name, body) values (a, t1, 'requester', 'Parent One', 'Still?');
    raise exception 'FAIL 11: reply accepted on a closed ticket';
  exception when raise_exception then
    if sqlerrm not like '%closed%' then raise; end if;
  end;

  -- 12. another organisation and the public see nothing
  perform set_config('request.jwt.claims', json_build_object('sub', ud, 'role', 'authenticated')::text, true);
  set local role authenticated;
  select count(*) into n from desk.ticket where org_id = a;
  if n <> 0 then raise exception 'FAIL 12: other organisation sees % tickets', n; end if;
  select count(*) into n from desk.message where org_id = a;
  if n <> 0 then raise exception 'FAIL 12: other organisation sees messages'; end if;
  reset role;
  begin
    set local role anon;
    perform 1 from desk.ticket limit 1;
    raise exception 'FAIL 13: anon can read tickets';
  exception when insufficient_privilege then null;
  end;
  reset role;

  -- 14. agents can use the shared Google sign-in; removing the organisation cascades
  if core.login_for_email((select email from auth.users where id = ub)) is distinct from ub then raise exception 'FAIL 14: agent not recognised for sign-in'; end if;
  delete from core.organisation where id = a;
  select count(*) into n from desk.message where org_id = a;
  if n <> 0 then raise exception 'FAIL 14: messages left behind'; end if;

  raise exception 'DESK_TEST_PASSED';
end $$;
