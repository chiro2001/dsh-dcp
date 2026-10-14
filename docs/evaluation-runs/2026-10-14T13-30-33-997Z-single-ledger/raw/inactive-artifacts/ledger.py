import json
import sys
import re
from datetime import datetime, timezone

CURRENCIES = {"USD", "EUR"}
OCCURRED_RE = re.compile(r"^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$")

def parse_amount(raw):
    """Return integer cents for a canonical positive money string, else None."""
    if not isinstance(raw, str):
        return None
    if not re.match(r"^\d+(\.\d{1,2})?$", raw):
        return None
    if "." in raw:
        whole, frac = raw.split(".")
    else:
        whole, frac = raw, ""
    if len(frac) == 1:
        frac += "0"
    cents = int(whole) * 100 + int(frac or "0")
    if cents <= 0:
        return None
    return cents

def parse_occurred(raw):
    if not isinstance(raw, str) or not OCCURRED_RE.match(raw):
        return None
    try:
        dt = datetime.strptime(raw, "%Y-%m-%dT%H:%M:%SZ")
    except ValueError:
        return None
    try:
        if dt.strftime("%Y-%m-%dT%H:%M:%SZ") != raw:
            return None
    except ValueError:
        return None
    return dt.replace(tzinfo=timezone.utc)

def valid_post(e):
    if not isinstance(e, dict):
        return None
    account = e.get("account_id")
    if not isinstance(account, str) or not account:
        return None
    if e.get("currency") not in CURRENCIES:
        return None
    dt = parse_occurred(e.get("occurred_at"))
    if dt is None:
        return None
    cents = parse_amount(e.get("amount"))
    if cents is None:
        return None
    return account, e.get("currency"), dt, cents

def base_ok(e):
    """Common structural validation needed before kind dispatch."""
    if not isinstance(e, dict):
        return False
    if e.get("kind") not in ("post", "reverse"):
        return False
    return True

def reverse_fields(e):
    account = e.get("account_id")
    if not isinstance(account, str) or not account:
        return None
    if e.get("currency") not in CURRENCIES:
        return None
    dt = parse_occurred(e.get("occurred_at"))
    if dt is None:
        return None
    target = e.get("reverses")
    if not isinstance(target, str) or not target:
        return None
    return account, e.get("currency"), dt, target

def replay(events):
    balances = {}
    accepted = 0
    rejected = 0
    duplicates = 0

    # Deduplicate by nonempty string event_id, first delivery wins.
    seen = set()
    unique = []
    for e in events:
        eid = e.get("event_id") if isinstance(e, dict) else None
        if not isinstance(eid, str) or not eid:
            # Missing/invalid event_id cannot be deduplicated: reject once.
            unique.append(e)
            continue
        if eid in seen:
            duplicates += 1
            continue
        seen.add(eid)
        unique.append(e)

    # First pass: validate posts, collect posts by event_id.
    posts = {}          # event_id -> (account, currency, dt, cents)
    post_ok = {}        # index -> bool
    for i, e in enumerate(unique):
        if not base_ok(e):
            post_ok[i] = False
            continue
        if e.get("kind") == "post":
            parsed = valid_post(e)
            if parsed is None:
                post_ok[i] = False
            else:
                post_ok[i] = True
                eid = e.get("event_id")
                if isinstance(eid, str) and eid and eid not in posts:
                    posts[eid] = parsed
        else:
            post_ok[i] = None  # reverse, decided later

    # Collect valid reverse candidates and resolve winners per post.
    winners = {}        # target_id -> (dt, event_id, index)
    rev_ok = {}
    rev_target = {}
    for i, e in enumerate(unique):
        if post_ok.get(i) is not None:
            continue
        parsed = reverse_fields(e)
        if parsed is None:
            rev_ok[i] = False
            continue
        account, currency, dt, target = parsed
        post = posts.get(target)
        if post is None:
            rev_ok[i] = False
            continue
        p_account, p_currency, p_dt, _p_cents = post
        if account != p_account or currency != p_currency or p_dt > dt:
            rev_ok[i] = False
            continue
        eid = e.get("event_id")
        rev_ok[i] = True
        rev_target[i] = target
        key = (dt, eid if isinstance(eid, str) else "")
        cur = winners.get(target)
        if cur is None or key < cur[0]:
            winners[target] = (key, i)

    winning_index = {}
    for target, (_key, idx) in winners.items():
        winning_index[idx] = target

    # Second pass: apply accepted events.
    for i, e in enumerate(unique):
        if post_ok.get(i) is False:
            rejected += 1
            continue
        if post_ok.get(i) is True:
            account, currency, _dt, cents = valid_post(e)
            balances.setdefault(account, {})
            balances[account][currency] = balances[account].get(currency, 0) + cents
            accepted += 1
            continue
        # reverse
        if not rev_ok.get(i):
            rejected += 1
            continue
        if i not in winning_index:
            rejected += 1
            continue
        target = rev_target[i]
        p_account, p_currency, _p_dt, p_cents = posts[target]
        balances.setdefault(p_account, {})
        balances[p_account][p_currency] = balances[p_account].get(p_currency, 0) - p_cents
        accepted += 1

    return dict(balances=balances, accepted=accepted, rejected=rejected, duplicates=duplicates)

if __name__ == '__main__':
    with open(sys.argv[1]) as f:
        events = [json.loads(line) for line in f if line.strip()]
    result = replay(events)
    with open(sys.argv[2], 'w') as f:
        json.dump(result, f, sort_keys=True)
