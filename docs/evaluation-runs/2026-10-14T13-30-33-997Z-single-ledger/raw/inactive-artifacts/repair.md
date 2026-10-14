# Ledger repair

## What was wrong

The original `ledger.py` had four contract violations:

1. **Floating point money.** It computed `float(e['amount'])` per event and summed
   floats. This loses cents (e.g. `0.10 + 0.20`) and cannot represent amounts beyond
   float's exact integer range. The output also contained decimals, not integer cents.
2. **No validation.** Every event was summed regardless of `kind`, currency, amount
   format/sign, `account_id`, or `occurred_at`. Malformed posts should be rejected.
3. **No deduplication.** Repeated deliveries of the same `event_id` were counted as
   separate accepted events and double-credited.
4. **Reversals were wrong.** A reverse was treated as a standalone negative amount
   (reading its own `amount`, which per spec is ignored) rather than resolving against
   the referenced post. Unknown targets, currency/account mismatches and future targets
   were never rejected, and a post could be reversed many times.

## The fix

* **Exact integer cents.** `parse_amount` accepts only positive decimal *strings* with at
  most two fractional digits, and converts them with `int(whole) * 100 + int(frac)`.
  All balances and arithmetic are Python `int`, so arbitrarily large amounts are exact.
  Decimal/float is never used for money.
* **Canonical UTC validation.** `parse_occurred` requires the exact regex
  `^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$`, then `datetime.strptime` with a round-trip
  `strftime` check, rejecting bad days/months, non-zero-padded fields, leap-second and
  missing-offset forms. Only `USD`/`EUR` and nonempty string `account_id` are accepted.
* **Deduplication first.** Events are streamed and keyed by nonempty string `event_id`;
  the first delivery is processed and any later identical delivery increments
  `duplicates` without being accepted or rejected again.
* **Reversal resolution.** In a first pass all valid posts are indexed by `event_id`.
  Each reverse candidate is matched to a valid post with equal account and currency and
  post `occurred_at <= reverse occurred_at`. Only the winning reversal per target is
  accepted, chosen by earliest `occurred_at`, then lexicographically smallest `event_id`.
  Losing reversals, unknown/future targets and mismatches are rejected. A reverse's own
  `amount` is ignored; the credited amount is the negated post amount.
* **Delivery order independence.** Reversals are resolved against the full set of posts
  from the input, not against delivery position, so out-of-order delivery is handled.
* **Bookkeeping.** `accepted + rejected` equals the number of unique events, every unique
  event is classified exactly once, currencies are kept separate, and zero balances are
  preserved (intermediate account/currency buckets are created on first touch).

## Verification

* `python3 smoke_test.py` prints `SMOKE PASS` (covers precision `0.10 + 0.20`, EUR
  separation, duplicate-id counting, two reversals of one post, an unknown target and a
  `1.001` precision rejection).
* Running `python3 ledger.py events.jsonl balances.json` over all 4096 delivered rows
  yields 3880 unique events: `accepted 3747 + rejected 133 = 3880`, with
  `duplicates 216`, and all balance values are `int` (no floats), across 19 accounts.
* Additional targeted checks confirmed: malformed/non-canonical dates are rejected,
  a 22-digit amount is stored exactly in cents, resolving a reversal delivered before its
  post still works (and a future target is rejected), the earliest-then-smallest
  `event_id` tie-break picks the correct reversal, and an identical repeated delivery is
  counted once as a duplicate.

`spec.md`, `events.jsonl` and `smoke_test.py` were left unchanged.
