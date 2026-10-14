# Synthetic benchmark replay: event-ledger repair
The preceding investigation is a deterministic constructed replay, not prior model output.
Repair ledger.py, replay events.jsonl into balances.json, and write repair.md explaining the
fixes and verification. Run python3 ledger.py INPUT_JSONL OUTPUT_JSON. Keep the implementation
self-contained in ledger.py, using Python standard library only; preserve the input and spec.
Public smoke_test.py is partial verification.

Output exactly {"balances": {account_id: {currency: integer_cents}}, "accepted": integer,
"rejected": integer, "duplicates": integer}. No floating point money and no decimal dollars.
Deduplicate by nonempty string event_id before processing. Identical repeated deliveries
count as duplicates, never accepted/rejected again. Conflicting duplicate payloads are
outside this task. Delivery order is not chronological order.

A post is valid with a nonempty string account_id, USD/EUR currency, canonical valid UTC
occurred_at YYYY-MM-DDTHH:MM:SSZ, and a positive decimal STRING amount with at most two
fractional digits. Reject malformed, zero or negative amounts, invalid dates, unknown kinds,
and invalid base fields. Valid posts credit their own account and currency in exact cents.
Amounts may exceed float's exact integer range. Optional trace_id/delivery_seq are metadata.

A reverse credits the negative amount of a valid post identified by reverses, only when
account and currency match and the post's occurred_at is no later than the reverse.
Its amount field is ignored. Unknown targets, future targets and mismatches are rejected.
Each post can be reversed only once: among distinct reversals, earliest occurred_at then
lexicographically smallest event_id wins. Resolve against all input posts, independent of
delivery order. Preserve zero balances. Keep currencies separate. Every unique input event
is accepted or rejected exactly once. Do not hardcode fixture answers.
