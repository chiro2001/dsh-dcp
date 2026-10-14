"""Deterministic event-ledger replay.

Reads a JSONL stream of ledger events and writes a JSON report containing
exact integer-cent balances plus accepted / rejected / duplicate counts.

Usage: python3 ledger.py INPUT_JSONL OUTPUT_JSON
"""

import json
import re
import sys
from datetime import datetime, timezone

MONEY_RE = re.compile(r"^(0|[1-9][0-9]*)(?:\.([0-9]{1,2}))?$")
OCCURRED_RE = re.compile(r"^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}Z$")
VALID_CURRENCIES = ("USD", "EUR")
VALID_KINDS = ("post", "reverse")


def parse_amount_cents(raw):
    """Exact integer cents for a positive decimal string, else None.

    Only canonical decimal strings with at most two fractional digits are
    accepted; floats, scientific notation, signs, whitespace, empty strings
    and "NaN" all fail.  Money never touches binary floating point.
    """
    if not isinstance(raw, str):
        return None
    match = MONEY_RE.match(raw)
    if match is None:
        return None
    whole = int(match.group(1))
    frac = match.group(2) or ""
    frac = (frac + "00")[:2]
    cents = whole * 100 + int(frac)
    if cents <= 0:
        return None
    return cents


def parse_occurred_at(raw):
    """Return (raw, datetime) for a canonical UTC timestamp, else None."""
    if not isinstance(raw, str):
        return None
    if OCCURRED_RE.match(raw) is None:
        return None
    try:
        parsed = datetime.strptime(raw, "%Y-%m-%dT%H:%M:%SZ").replace(tzinfo=timezone.utc)
    except ValueError:
        return None
    return raw, parsed


def classify(event, valid_posts):
    """Return ('accept', payload) or ('reject', None) for one unique event."""
    if not isinstance(event, dict):
        return "reject", None

    event_id = event.get("event_id")
    if not isinstance(event_id, str) or not event_id:
        return "reject", None

    account_id = event.get("account_id")
    if not isinstance(account_id, str) or not account_id:
        return "reject", None

    currency = event.get("currency")
    if currency not in VALID_CURRENCIES:
        return "reject", None

    kind = event.get("kind")
    if kind not in VALID_KINDS:
        return "reject", None

    occurred = parse_occurred_at(event.get("occurred_at"))
    if occurred is None:
        return "reject", None
    occurred_raw, occurred_dt = occurred

    payload = {"account_id": account_id, "currency": currency,
               "occurred_raw": occurred_raw, "occurred_dt": occurred_dt,
               "event_id": event_id}

    if kind == "post":
        cents = parse_amount_cents(event.get("amount"))
        if cents is None:
            return "reject", None
        payload["type"] = "post"
        payload["cents"] = cents
        return "accept", payload

    # kind == "reverse": own amount is ignored; target must exist and match.
    target_id = event.get("reverses")
    if not isinstance(target_id, str) or not target_id:
        return "reject", None
    target = valid_posts.get(target_id)
    if target is None:
        return "reject", None
    if target["account_id"] != account_id or target["currency"] != currency:
        return "reject", None
    if target["occurred_dt"] > occurred_dt:
        return "reject", None
    payload["type"] = "reverse"
    payload["target_id"] = target_id
    payload["target_cents"] = target["cents"]
    return "accept", payload


def replay(events):
    balances = {}
    accepted = 0
    rejected = 0
    duplicates = 0
    seen = set()
    unique = []

    # Deduplicate by nonempty string event_id before any other processing.
    for event in events:
        event_id = event.get("event_id") if isinstance(event, dict) else None
        if isinstance(event_id, str) and event_id:
            if event_id in seen:
                duplicates += 1
                continue
            seen.add(event_id)
        unique.append(event)

    # Pass 1: resolve every valid post, independent of delivery order, so that
    # reversals can be matched against the complete set of input posts.
    valid_posts = {}
    for event in unique:
        if not isinstance(event, dict) or event.get("kind") != "post":
            continue
        verdict, payload = classify(event, {})
        if verdict == "accept" and payload["type"] == "post":
            valid_posts[payload["event_id"]] = payload

    # Pass 2: classify every unique event now that all posts are known.
    classifications = []
    for event in unique:
        verdict, payload = classify(event, valid_posts)
        classifications.append((event, verdict, payload))

    # Each post may be reversed at most once: earliest reverse occurred_at
    # wins, then the lexicographically smallest reverse event_id.
    winner_by_target = {}
    for event, verdict, payload in classifications:
        if verdict != "accept" or payload["type"] != "reverse":
            continue
        key = (payload["occurred_raw"], payload["event_id"])
        current = winner_by_target.get(payload["target_id"])
        if current is None or key < current:
            winner_by_target[payload["target_id"]] = key
    winning_reverse_ids = {key[1] for key in winner_by_target.values()}

    # Apply accepted posts and only the winning reversal for each post.
    for event, verdict, payload in classifications:
        if verdict != "accept":
            rejected += 1
            continue
        account = balances.setdefault(payload["account_id"], {})
        currency = payload["currency"]
        if payload["type"] == "post":
            account[currency] = account.get(currency, 0) + payload["cents"]
            accepted += 1
        elif payload["event_id"] in winning_reverse_ids:
            account[currency] = account.get(currency, 0) - payload["target_cents"]
            accepted += 1
        else:
            # A valid reverse of an already-reversed post is not applied; the
            # event is still counted exactly once as rejected.
            rejected += 1

    return dict(balances=balances, accepted=accepted, rejected=rejected,
                duplicates=duplicates)


if __name__ == "__main__":
    with open(sys.argv[1]) as fh:
        events = [json.loads(line) for line in fh if line.strip()]
    with open(sys.argv[2], "w") as fh:
        json.dump(replay(events), fh, sort_keys=True)
