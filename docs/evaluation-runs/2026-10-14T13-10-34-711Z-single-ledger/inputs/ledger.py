import json, sys

def replay(events):
    balances = {}
    for e in events:
        account = balances.setdefault(e['account_id'], {})
        currency = e['currency']
        value = float(e['amount'])
        if e['kind'] == 'reverse':
            value = -value
        account[currency] = account.get(currency, 0) + value
    return dict(balances=balances, accepted=len(events), rejected=0, duplicates=0)

if __name__ == '__main__':
    with open(sys.argv[1]) as f:
        events = [json.loads(line) for line in f if line.strip()]
    with open(sys.argv[2], 'w') as f:
        json.dump(replay(events), f, sort_keys=True)
