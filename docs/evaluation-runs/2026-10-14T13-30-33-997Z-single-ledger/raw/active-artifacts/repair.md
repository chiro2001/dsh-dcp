# Ledger repair report

## Scope

- Repaired `/work/ledger.py`; it stays self-contained and uses only the Python
  standard library (`json`, `re`, `sys`, `datetime`).
- Replayed `/work/events.jsonl` (4096 delivery lines) into `/work/balances.json`
  with `python3 ledger.py events.jsonl balances.json`.
- `spec.md`, `events.jsonl` and `smoke_test.py` were **not** modified (original
  mtimes and checksums preserved).
- No fixture answer is hardcoded: `ledger.py` contains no account names,
  amounts, or expected counts from the smoke fixture or the input file.

## Defects found in the delivered implementation

| # | Defect | Consequence |
|---|--------|-------------|
| 1 | `value = float(e['amount'])` | Binary floating point money: precision loss and failure for amounts beyond `float`'s exact integer range. |
| 2 | No `event_id` dedup | Repeated deliveries were credited again; `duplicates` was always `0`. |
| 3 | No validation | Malformed events, bad accounts/currencies/dates, zero/negative amounts, unknown kinds all accepted. |
| 4 | Every event treated as a credit; `reverse` merely negated its own amount | Reversals were not tied to the post named by `reverses`; target/currency/timestamp rules ignored; repeated reversals double-counted; `rejected` was always `0`. |
| 5 | Single delivery-order pass | Results depended on delivery order, which is explicitly not chronological. |

## Fixes

- **Exact money.** Amounts are parsed only from canonical decimal **strings** by
  a regex (`^(0|[1-9][0-9]*)(?:\.([0-9]{1,2}))?$`) into integer cents via
  `whole * 100 + int(frac_padded_to_2)`. No float/decimal arithmetic anywhere;
  this is exact for arbitrarily large values (the input contains
  `999999999999.99`).
- **Dedup first.** One pass buckets deliveries by nonempty string `event_id`.
  Every repeat delivery increments `duplicates` and is skipped, so it is never
  accepted or rejected again.
- **Validation.** A unique event is rejected unless it has a nonempty string
  `event_id` and `account_id`, currency in `USD`/`EUR`, kind in `post`/`reverse`,
  and a canonical UTC `occurred_at` matching `YYYY-MM-DDTHH:MM:SSZ` that is also
  a real calendar date. Posts additionally require a positive decimal string
  amount with at most two fractional digits (`0.00`, `-1.00`, `NaN`, `1.001`
  and `9.999` are rejected).
- **Reversals.** Pass 1 registers every valid post regardless of delivery order.
  Pass 2 classifies each unique event: a reverse is accepted only when its
  `reverses` names a valid post with matching `account_id` and `currency` and
  the post's `occurred_at` is no later than the reverse's. The reverse's own
  `amount` is ignored; it credits the negative of the target's exact cents.
- **Single reversal per post.** Among all accepted distinct reversals of a post,
  the winner is the smallest `(occurred_at, event_id)` tuple — earliest
  timestamp, then lexicographically smallest `event_id`. Only the winner moves
  money; other valid reversals of an already-reversed post are counted once as
  rejected. All resolution is done against the complete input set, independent
  of delivery order.
- **Accounting.** Every unique input event is accepted xor rejected exactly
  once, and every repeated delivery is a duplicate, so
  `accepted + rejected + duplicates == number of delivery lines`.

## Verification performed

1. `python3 ledger.py events.jsonl balances.json` runs clean and produces output
   with exactly the contract keys `balances`, `accepted`, `rejected`,
   `duplicates`; re-running is idempotent.
2. **Public smoke test:** `python3 smoke_test.py` prints `SMOKE PASS` (also with
   `python3 -I smoke_test.py` under isolated mode).
3. **Independent cross-check:** a separate from-scratch reference reimplementation
   (using `fractions.Fraction` and an independently written strict string
   parser, sharing no code with `ledger.py`) produced an identical result —
   all balances and all three counts matched exactly. This rules out shared-bug
   agreement.
4. **Delivery-order independence:** replaying the input under 6 different
   shuffles produced byte-identical results.
5. **Accounting identity:** `3747 accepted + 133 rejected + 216 duplicates =
   4096` delivery lines. `216` also equals the number of extra deliveries beyond
   the first for each `event_id`.
6. **Integer-only output:** recursive walk confirms every balance and count is a
   Python `int` (no bools, no floats), and currencies remain separate
   (`USD`, `EUR`) across 19 accounts.
7. **Rejection breakdown:** 125 invalid post amounts (`9.999` ×121, `1.001`,
   `NaN`, `0.00`, `-1.00`), 6 unknown reverse targets, 1 reverse
   account/currency mismatch — 133 unique rejections, each counted once.
8. **Tie-break check:** the input has one post with two distinct valid
   reversals (`2026-01-01T00:00:03Z` / `evt-739514884a1269787a76` vs
   `2026-01-01T00:00:11Z` / `evt-09d105a8c6c0fd5320c4`); the earliest wins and
   the loser is rejected exactly once.
9. **Randomized property tests:** 200 generated streams mixing duplicates,
   malformed events, unknown/mismatched/future reverses and huge amounts all
   satisfied `accepted + rejected + duplicates == len(events)`,
   `duplicates == len(events) - unique_ids`, and integer-only balances.

## Result

`balances.json`: `accepted = 3747`, `rejected = 133`, `duplicates = 216`,
19 accounts with `USD`/`EUR` balances in integer cents. The public smoke fixture
is only a partial check; the items above cover the full contract.
