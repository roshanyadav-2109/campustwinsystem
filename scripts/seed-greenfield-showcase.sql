-- Presentable sample data for the fictional Greenfield Public School (Pune) in
-- Eternity Desk, Alumni and Finance, used for the screenshots on the Eternity
-- site. Removes end-to-end test leftovers (names carrying a number stamp) and
-- adds realistic records. Touches only the Greenfield organisation.
begin;

create temp table g on commit drop as select 'b6642535-9023-42ea-971f-478fc0aafe0c'::uuid as org;

-- ------------------------------------------------------------ Desk
delete from desk.ticket  where org_id = (select org from g);              -- messages cascade
delete from desk.article where org_id = (select org from g) and title ~ ' [0-9]{5}$';
delete from desk.category where org_id = (select org from g) and name ~ ' [0-9]{5}$';
update desk.series set current = 0 where org_id = (select org from g);
update desk.settings set display_name = 'Greenfield Public School' where org_id = (select org from g);

create temp table t_in (k int, subject text, description text, kind text, cat text, priority text,
  requester text, email text, source text, age interval, reply_after interval, final text, done_after interval) on commit drop;
insert into t_in values
 (1, 'Bus 4 reaching Baner stop 20 minutes late', 'For the past week bus 4 has reached the Baner stop around 7:20 instead of 7:00. Children are missing assembly.', 'complaint', 'Transport', 'high', 'Sunita Kulkarni', 'sunita.k@example.com', 'web', '2 days', '3 hours', 'in_progress', null),
 (2, 'Transfer certificate for Class 9 student', 'We are relocating to Bengaluru in December. Please issue a transfer certificate for Aditya Kulkarni, Class 9 A.', 'request', 'Admissions', 'normal', 'Mahesh Kulkarni', 'mahesh.k@example.com', 'web', '9 days', '5 hours', 'resolved', '3 days'),
 (3, 'Fee receipt for October not received', 'Paid the October instalment by UPI on 4 October but the receipt has not come through.', 'request', 'Fees and payments', 'normal', 'Rekha Menon', 'rekha.menon@example.com', 'web', '6 days', '2 hours', 'resolved', '1 day'),
 (4, 'Re-evaluation of Class 10 science paper', 'My daughter''s marks in the half-yearly science paper do not match the answers she wrote. We request a re-evaluation.', 'grievance', 'Academics', 'high', 'Farida Sayed', 'farida.sayed@example.com', 'web', '1 day', null, 'open', null),
 (5, 'Parent portal login not working', 'The parent portal says my phone number is not registered.', 'request', 'Login and technical', 'normal', 'Vivek Joshi', 'vivek.joshi@example.com', 'web', '3 days', '4 hours', 'waiting', null),
 (6, 'Water cooler on second floor not working', 'The cooler near the Class 7 rooms has not worked since Monday.', 'complaint', 'Facilities', 'normal', 'Neha Bhattacharya', null, 'agent', '12 days', '1 hour', 'resolved', '2 days'),
 (7, 'Bonafide certificate for passport application', 'Need a bonafide certificate for Ishaan Rao, Class 6 B, for a passport application.', 'request', 'Admissions', 'normal', 'Kavya Rao', 'kavya.rao@example.com', 'web', '5 hours', null, 'open', null),
 (8, 'Unit test marks entered incorrectly', 'Mathematics unit test marks for roll number 14 in Class 8 C show 12 instead of 21.', 'grievance', 'Academics', 'normal', 'Prakash Iyer', 'prakash.iyer@example.com', 'web', '15 days', '6 hours', 'resolved', '2 days'),
 (9, 'Sibling concession on tuition fee', 'Both our children study at Greenfield. Is a sibling concession available?', 'request', 'Fees and payments', 'low', 'Anjali Deshpande', 'anjali.d@example.com', 'web', '20 days', '1 day', 'closed', '2 days'),
 (10, 'Canteen serving cold lunch', 'Several children say the lunch served after 1 pm is cold.', 'complaint', 'Facilities', 'normal', 'Sunil Gaikwad', 'sunil.g@example.com', 'agent', '30 hours', '2 hours', 'in_progress', null);

do $$
declare r record; v_id bigint; v_org uuid := (select org from g); v_at timestamptz;
begin
  for r in select * from t_in order by age desc loop
    v_at := now() - r.age;
    insert into desk.ticket (org_id, subject, description, kind, category_id, priority, requester_name, requester_email, source, created_at)
    values (v_org, r.subject, r.description, r.kind,
            (select id from desk.category where org_id = v_org and name = r.cat), r.priority,
            r.requester, r.email, r.source, v_at)
    returning id into v_id;
    insert into desk.message (org_id, ticket_id, author_kind, author_name, body, internal, created_at)
    values (v_org, v_id, 'requester', r.requester, r.description, false, v_at);
    if r.reply_after is not null then
      insert into desk.message (org_id, ticket_id, author_kind, author_name, body, internal, created_at)
      values (v_org, v_id, 'agent', 'Front office', 'Thank you for writing in. We are looking into this and will update you here.', false, v_at + r.reply_after);
      update desk.ticket set first_response_at = v_at + r.reply_after where id = v_id;
    end if;
    if r.k = 4 then
      insert into desk.message (org_id, ticket_id, author_kind, author_name, body, internal, created_at)
      values (v_org, v_id, 'agent', 'Front office', 'Forwarded to the science department head for the answer sheet.', true, v_at + interval '2 hours');
    end if;
    if r.final = 'waiting' then update desk.ticket set status = 'waiting' where id = v_id; end if;
    if r.final = 'in_progress' then update desk.ticket set status = 'in_progress' where id = v_id; end if;
    if r.final in ('resolved', 'closed') then
      update desk.ticket set status = r.final, resolved_at = v_at + r.done_after where id = v_id;
    end if;
  end loop;
end $$;

insert into desk.article (org_id, title, body, category_id, published)
select (select org from g), a.title, a.body, (select id from desk.category c where c.org_id = (select org from g) and c.name = a.cat), true
from (values
  ('How to download a fee receipt', 'Sign in to the parent portal, open Fees, and choose Download next to the instalment. Receipts appear within an hour of payment.', 'Fees and payments'),
  ('Applying for a transfer certificate', 'Raise a request with the student''s name, class and reason for leaving. The office issues the certificate within three working days once dues are clear.', 'Admissions'),
  ('Bus routes and timings', 'Routes, stops and pick-up times are listed under Transport in the parent portal. Changes are announced a week in advance.', 'Transport'),
  ('Resetting your parent portal password', 'Choose Forgot password on the sign-in page and enter the phone number registered with the school.', 'Login and technical')
) as a(title, body, cat)
where not exists (select 1 from desk.article x where x.org_id = (select org from g) and x.title = a.title);

-- ------------------------------------------------------------ Alumni
delete from alum.member where org_id = (select org from g) and full_name ~ ' [0-9]{5}$';
update alum.event    set title = 'Annual alumni reunion', venue = 'School auditorium, Greenfield Public School, Pune',
                         description = 'An evening with batchmates and teachers, followed by dinner on the lawns.' where org_id = (select org from g) and title ~ ' [0-9]{5}$';
update alum.campaign set title = 'New library wing' where org_id = (select org from g) and title ~ ' [0-9]{5}$';
update alum.post     set title = 'Reunion registrations are open', body = 'The annual reunion is on 25 December in the school auditorium. Register from the Events page so we can plan seating and dinner.'
                     where org_id = (select org from g) and title ~ ' [0-9]{5}$';

insert into alum.member (org_id, full_name, email, batch_year, programme, company, job_title, higher_studies, city, country, status, show_in_directory, source)
select (select org from g), m.* from (values
  ('Ananya Bose',        'ananya.bose@example.com',     2014::smallint, 'Science',  'Larsen and Toubro',          'Site engineer',          null,                       'Pune',      'India', 'verified', true, 'import'),
  ('Farhan Qureshi',     'farhan.q@example.com',        2011::smallint, 'Science',  'KEM Hospital',               'Paediatrician',          'MD, Paediatrics',          'Mumbai',    'India', 'verified', true, 'import'),
  ('Ishita Verma',       'ishita.verma@example.com',    2016::smallint, 'Commerce', 'Verma Design Studio',        'Founder',                null,                       'Bengaluru', 'India', 'verified', true, 'self'),
  ('Vikram Joshi',       'vikram.joshi@example.com',    2009::smallint, 'Arts',     'Greenfield Public School',   'History teacher',        'B.Ed',                     'Pune',      'India', 'verified', true, 'import'),
  ('Meghna Patil',       'meghna.patil@example.com',    2018::smallint, 'Science',  null,                         null,                     'M.Tech, IIT Bombay',       'Mumbai',    'India', 'verified', true, 'self'),
  ('Rahul Deshmukh',     'rahul.d@example.com',         2013::smallint, 'Commerce', 'HDFC Bank',                  'Relationship manager',   null,                       'Nagpur',    'India', 'verified', true, 'import'),
  ('Sana Khan',          'sana.khan@example.com',       2015::smallint, 'Science',  'Infosys',                    'Senior software engineer', null,                     'Hyderabad', 'India', 'verified', true, 'self'),
  ('Aditya Nair',        'aditya.nair@example.com',     2012::smallint, 'Commerce', 'Nair and Associates',        'Chartered accountant',   'CA',                       'Pune',      'India', 'verified', true, 'import'),
  ('Pooja Shinde',       'pooja.shinde@example.com',    2017::smallint, 'Arts',     'The Indian Express',         'Reporter',               null,                       'Delhi',     'India', 'verified', true, 'self'),
  ('Karan Malhotra',     'karan.m@example.com',         2010::smallint, 'Science',  'Tata Motors',                'Design engineer',        null,                       'Pune',      'India', 'verified', true, 'import'),
  ('Tanvi Kulkarni',     'tanvi.k@example.com',         2019::smallint, 'Science',  null,                         null,                     'MSc, University of Edinburgh', 'Edinburgh', 'United Kingdom', 'verified', true, 'self'),
  ('Nikhil Sawant',      'nikhil.sawant@example.com',   2014::smallint, 'Commerce', 'Sawant Sports',              'Owner',                  null,                       'Kolhapur',  'India', 'verified', true, 'import')
) as m(full_name, email, batch_year, programme, company, job_title, higher_studies, city, country, status, show_in_directory, source)
where not exists (select 1 from alum.member x where x.org_id = (select org from g) and x.email = m.email);

insert into alum.job (org_id, title, company, location, apply_url, description, closes_on, status, member_id)
select (select org from g), j.title, j.company, j.location, j.url, j.descr, current_date + j.days, 'open',
       (select id from alum.member where org_id = (select org from g) and full_name = j.poster)
from (values
  ('Graduate engineer trainee', 'Larsen and Toubro', 'Pune', 'mailto:ananya.bose@example.com', 'Civil and mechanical graduates of 2026. Referrals welcome.', 30, 'Ananya Bose'),
  ('Audit associate', 'Nair and Associates', 'Pune', 'mailto:aditya.nair@example.com', 'For B.Com graduates preparing for CA Inter.', 21, 'Aditya Nair'),
  ('Junior designer', 'Verma Design Studio', 'Bengaluru', 'mailto:ishita.verma@example.com', 'Brand and packaging design. Portfolio required.', 45, 'Ishita Verma')
) as j(title, company, location, url, descr, days, poster)
where not exists (select 1 from alum.job x where x.org_id = (select org from g) and x.title = j.title);

-- ------------------------------------------------------------ Finance: party names
update fin.party p set name = n.name
from (select id, row_number() over (order by id) rn from fin.party
      where org_id = (select org from g) and name ~ '^Asha Patel [0-9]{5}$') a
join (values (1, 'Lakeshore Caterers'), (2, 'Pune Chess Academy'), (3, 'Kulkarni Coaching Classes'), (4, 'Asha Patel')) as n(rn, name) using (rn)
where p.id = a.id and p.org_id = (select org from g);
update fin.party p set name = n.name
from (select id, row_number() over (order by id) rn from fin.party
      where org_id = (select org from g) and name ~ '^Mumbai Book Co [0-9]{5}$') a
join (values (1, 'Mumbai Book Company'), (2, 'Deccan Lab Supplies')) as n(rn, name) using (rn)
where p.id = a.id and p.org_id = (select org from g);

commit;
