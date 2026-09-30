begin;

create function pg_temp.assert_true(condition boolean, message text) returns void language plpgsql as $$
begin if condition is distinct from true then raise exception 'Assertion failed: %', message; end if; end;
$$;

create function pg_temp.expect_reason_error(actor text, main_id uuid, detail_id uuid, expected text)
returns void language plpgsql as $$
declare message text;
begin
  begin perform app_private.failure_reason_snapshot(actor, main_id, detail_id);
  exception when others then message := sqlerrm; end;
  if message is null or position(expected in message) = 0 then raise exception 'Expected %, got %', expected, coalesce(message, '<no error>'); end if;
end;
$$;

select pg_temp.assert_true((select count(*) = 10 from public.rejection_reasons where reason_kind = 'main'), 'ten workbook main reasons seeded');
select pg_temp.assert_true((select count(*) = 35 from public.rejection_reasons where reason_kind = 'detail'), '35 workbook detailed reasons seeded');
select pg_temp.assert_true((select count(*) = 17 from public.rejection_reasons where reason_kind = 'detail' and actor = 'candidate'), '17 candidate withdrawal details seeded');
select pg_temp.assert_true((select count(*) = 18 from public.rejection_reasons where reason_kind = 'detail' and actor = 'company'), '18 company rejection details seeded');

select pg_temp.assert_true(
  app_private.failure_reason_snapshot('candidate', md5('rejection-reason:c1')::uuid, md5('rejection-reason:c1_1')::uuid) ->> 'detail_th' = 'เงินเดือนต่ำกว่าความคาดหวัง',
  'snapshot keeps workbook Thai wording'
);
select pg_temp.expect_reason_error('candidate', null, null, 'REJECTION_REASON_REQUIRED');
select pg_temp.expect_reason_error('company', md5('rejection-reason:c1')::uuid, md5('rejection-reason:c1_1')::uuid, 'REJECTION_REASON_INVALID');
select pg_temp.expect_reason_error('candidate', md5('rejection-reason:c1')::uuid, md5('rejection-reason:c2_1')::uuid, 'REJECTION_REASON_INVALID');
update public.rejection_reasons set active = false where reason_id = md5('rejection-reason:c1_1')::uuid;
select pg_temp.expect_reason_error('candidate', md5('rejection-reason:c1')::uuid, md5('rejection-reason:c1_1')::uuid, 'REJECTION_REASON_INVALID');

rollback;
