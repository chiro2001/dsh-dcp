import json, subprocess, sys, tempfile
from pathlib import Path

def event(key, kind='post', amount='0.10', currency='USD', reverses=''):
    return dict(event_id=key, account_id='smoke', kind=kind, amount=amount,
        currency=currency, reverses=reverses, occurred_at='2026-01-01T00:00:00Z')
rows = [event('a'), event('b', amount='0.20'), event('a'),
    event('eur', amount='1.00', currency='EUR'), event('r1', 'reverse', '0', reverses='b'),
    event('r2', 'reverse', '0', reverses='b'), event('missing', 'reverse', '0', reverses='unknown'),
    event('precision', amount='1.001')]
with tempfile.TemporaryDirectory() as tmp:
    src, dst = Path(tmp)/'input.jsonl', Path(tmp)/'output.json'
    src.write_text(''.join(json.dumps(e)+'\n' for e in rows))
    subprocess.run([sys.executable, 'ledger.py', str(src), str(dst)], check=True)
    actual = json.loads(dst.read_text())
    expected = dict(balances={'smoke': {'USD': 10, 'EUR': 100}}, accepted=4, rejected=3, duplicates=1)
    assert actual == expected, 'ledger violates precision/dedup/reversal contract'
print('SMOKE PASS')
