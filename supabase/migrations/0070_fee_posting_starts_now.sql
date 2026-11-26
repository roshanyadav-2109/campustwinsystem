-- Payments recorded before fees were linked to Finance are not posted (the
-- books' opening balances already cover them). 0 marks "not for posting".
update public.fee_payment set fin_voucher_id = 0 where fin_voucher_id is null;
