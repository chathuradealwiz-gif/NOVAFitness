-- Stop a double-click recording a payment twice.
--
-- The dashboard disabled its submit button while saving, but `disabled` only
-- takes effect on the next React render: two clicks in the same tick both fired
-- the server action, and because insert_payment_period() derives the period from
-- the member's existing rows, the second insert silently started a *second*
-- month (30 Aug -> 29 Sep, then 30 Sep -> 29 Oct) and charged the member twice.
--
-- A client-side guard cannot close that race on its own -- a retried request or
-- a double-tap on a slow phone reaches the server as two independent calls. So
-- the form now sends a token generated once per filled-in form, and the database
-- refuses the second insert carrying the same token.
--
-- Nullable and unique-when-present: rows written before this migration, and any
-- other client that does not send a token, are unaffected. Two genuinely
-- separate payments always carry different tokens, so paying twice on purpose
-- (two months at once, say) still works.

alter table payments add column if not exists client_token uuid;

create unique index if not exists payments_client_token_key
  on payments (client_token)
  where client_token is not null;

comment on column payments.client_token is
  'Idempotency key from the form that recorded this payment; unique when present.';
