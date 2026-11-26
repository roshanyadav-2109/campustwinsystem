-- The institution's own details, printed on certificates, letters and receipts:
-- board and affiliation number, board school code, UDISE+ code, contact
-- details and who signs. Edited by the office in Settings, Institution profile.
alter table public.school add column if not exists affiliation_board text check (affiliation_board is null or char_length(affiliation_board) <= 60);
alter table public.school add column if not exists affiliation_no text check (affiliation_no is null or char_length(affiliation_no) <= 40);
alter table public.school add column if not exists board_school_code text check (board_school_code is null or char_length(board_school_code) <= 20);
alter table public.school add column if not exists udise_code text check (udise_code is null or udise_code ~ '^[0-9]{11}$');
alter table public.school add column if not exists phone text check (phone is null or char_length(phone) <= 40);
alter table public.school add column if not exists email text check (email is null or char_length(email) <= 120);
alter table public.school add column if not exists website text check (website is null or char_length(website) <= 120);
alter table public.school add column if not exists signatory_name text check (signatory_name is null or char_length(signatory_name) <= 80);
alter table public.school add column if not exists signatory_title text check (signatory_title is null or char_length(signatory_title) <= 60);
