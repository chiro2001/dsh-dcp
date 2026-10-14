/** Public deterministic workload. The reference is host-only, never an agent file. */
import { createHash } from 'node:crypto'
import { Session, SessionId, type SessionEvent } from '@deepseek-ai/dsh-session'
import { MessageId, ToolCallId } from '@deepseek-ai/dsh-llm/brand'
import {
  createAssistantMessage,
  createToolResultMessage,
  createUserMessage,
} from '@deepseek-ai/dsh-llm/message'
import { buildStepMarkerMessage } from '../../src/refs/marker.js'

export const SCENARIO_REFERENCE_IMPLEMENTATION = String.raw`import json, re, sys
from datetime import datetime

def replay(events):
    seen, unique, duplicates = set(), [], 0
    rejected = 0
    for e in events:
        key = e.get('event_id')
        if not isinstance(key, str) or not key:
            rejected += 1
            continue
        if key in seen:
            duplicates += 1
            continue
        seen.add(key)
        unique.append(e)
    balances, posts, reversals = {}, {}, []
    accepted = 0
    def valid_base(e):
        if not isinstance(e.get('account_id'), str) or not e['account_id']:
            return False
        if e.get('currency') not in ('USD', 'EUR'):
            return False
        stamp = e.get('occurred_at')
        if not isinstance(stamp, str) or not re.fullmatch(r'\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z', stamp):
            return False
        try:
            datetime.strptime(stamp, '%Y-%m-%dT%H:%M:%SZ')
        except ValueError:
            return False
        return True
    def add(e, cents):
        account = balances.setdefault(e['account_id'], {})
        currency = e['currency']
        account[currency] = account.get(currency, 0) + cents
    for e in unique:
        if not valid_base(e):
            rejected += 1
            continue
        if e.get('kind') == 'reverse':
            reversals.append(e)
            continue
        amount = e.get('amount')
        if e.get('kind') != 'post' or not isinstance(amount, str) or not re.fullmatch(r'\d+(?:\.\d{1,2})?', amount):
            rejected += 1
            continue
        whole, _, fraction = amount.partition('.')
        cents = int(whole) * 100 + int((fraction + '00')[:2])
        if cents <= 0:
            rejected += 1
            continue
        posts[e['event_id']] = (e, cents)
        add(e, cents)
        accepted += 1
    reversed_ids = set()
    for e in sorted(reversals, key=lambda x: (x['occurred_at'], x['event_id'])):
        target = e.get('reverses')
        post = posts.get(target) if isinstance(target, str) else None
        if post is None or target in reversed_ids:
            rejected += 1
            continue
        origin, cents = post
        if origin['account_id'] != e['account_id'] or origin['currency'] != e['currency'] or origin['occurred_at'] > e['occurred_at']:
            rejected += 1
            continue
        reversed_ids.add(target)
        add(e, -cents)
        accepted += 1
    return dict(balances=balances, accepted=accepted, rejected=rejected, duplicates=duplicates)

if __name__ == '__main__':
    with open(sys.argv[1]) as f:
        result = replay([json.loads(line) for line in f if line.strip()])
    with open(sys.argv[2], 'w') as f:
        json.dump(result, f, sort_keys=True)
`

const spec = `# Synthetic benchmark replay: event-ledger repair
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
`

const buggy = `import json, sys

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
`

const smoke = `import json, subprocess, sys, tempfile
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
    src.write_text(''.join(json.dumps(e)+'\\n' for e in rows))
    subprocess.run([sys.executable, '-I', 'ledger.py', str(src), str(dst)], check=True)
    actual = json.loads(dst.read_text())
    expected = dict(balances={'smoke': {'USD': 10, 'EUR': 100}}, accepted=4, rejected=3, duplicates=1)
    assert actual == expected, 'ledger violates precision/dedup/reversal contract'
print('SMOKE PASS')
`

interface LedgerEvent {
  event_id: string
  account_id: string
  kind: 'post' | 'reverse'
  currency: string
  amount: string
  reverses: string
  occurred_at: string
  delivery_seq: number
  trace_id: string
}

export function createScenarioFiles(
  options: { eventCount?: number } = {},
): Record<string, string> {
  const count = options.eventCount ?? 4096
  if (!Number.isSafeInteger(count) || count < 16 || count > 8192)
    throw new Error('eventCount must be an integer from 16 to 8192')
  const rows: LedgerEvent[] = []
  const add = (overrides: Partial<LedgerEvent> = {}) => {
    const i = rows.length
    const digest = createHash('sha256').update(`ledger-event-v1:${i}`).digest('hex')
    rows.push({
      event_id: `evt-${digest.slice(0, 20)}`,
      account_id: `acct-${String(i % 17).padStart(3, '0')}`,
      kind: 'post',
      currency: i % 3 === 0 ? 'EUR' : 'USD',
      amount: `${Math.floor((i * 7919 + 11) / 100)}.${String((i * 7919 + 11) % 100).padStart(2, '0')}`,
      reverses: '',
      occurred_at: new Date(Date.UTC(2026, 0, 1) + i * 1000).toISOString().replace('.000', ''),
      delivery_seq: i,
      trace_id: digest.slice(20, 52),
      ...overrides,
    })
  }
  add({ event_id: 'first', account_id: 'account-a', currency: 'USD', amount: '10.05' })
  add({ event_id: 'second', account_id: 'account-a', currency: 'USD', amount: '0.10' })
  add({ ...rows[1]!, delivery_seq: 2 })
  add({
    kind: 'reverse',
    reverses: 'first',
    account_id: 'account-a',
    currency: 'USD',
    amount: '0.00',
  })
  add({ event_id: 'euro', account_id: 'account-a', currency: 'EUR', amount: '3.25' })
  add({
    kind: 'reverse',
    reverses: 'euro',
    account_id: 'account-a',
    currency: 'USD',
    amount: '0.00',
  })
  add({ kind: 'reverse', reverses: 'unknown-post', amount: '0.00' })
  add({ amount: '1.001' })
  add({ amount: 'NaN' })
  add({ account_id: 'account-b', currency: 'USD', amount: '2.67' })
  add({ account_id: 'account-a', currency: 'USD', amount: '0.01' })
  add({
    kind: 'reverse',
    reverses: 'first',
    account_id: 'account-a',
    currency: 'USD',
    amount: '0.00',
  })
  add({ amount: '0.00' })
  add({ amount: '-1.00' })
  add({ account_id: 'account-b', currency: 'EUR', amount: '0.29' })
  add({ account_id: 'account-a', currency: 'USD', amount: '999999999999.99' })
  for (let i = 16; i < count; i++) {
    if (i % 19 === 0) add({ ...rows[i - 1]!, delivery_seq: i })
    else if (i % 23 === 0) {
      const target = rows.findLast((e) => e.kind === 'post' && e.amount !== 'NaN')!
      add({
        kind: 'reverse',
        reverses: target.event_id,
        account_id: target.account_id,
        currency: target.currency,
        amount: '0.00',
      })
    } else if (i % 31 === 0) add({ amount: '9.999' })
    else add()
  }
  return {
    'spec.md': spec,
    'ledger.py': buggy,
    'events.jsonl': rows.map((e) => JSON.stringify(e)).join('\n') + '\n',
    'smoke_test.py': smoke,
  }
}

export function buildScenarioPrefix(files: Record<string, string>): readonly SessionEvent[] {
  const session = Session.create(SessionId('synthetic-ledger-prefix-v1'))
  const rows = files['events.jsonl']!.trimEnd().split('\n')
  let messageNumber = 0
  const user = (text: string) => ({
    ...createUserMessage({ content: [{ type: 'text', text }], source: { kind: 'user' } }),
    id: MessageId(`fixture-user-${++messageNumber}`),
  })
  const assistant = (content: Parameters<typeof createAssistantMessage>[0]['content']) => ({
    ...createAssistantMessage({
      content,
      source: { provider: 'synthetic-benchmark', model: 'deterministic-fixture' },
    }),
    id: MessageId(`fixture-assistant-${++messageNumber}`),
  })
  const start = (turn: number, text: string) => {
    session.append('turn/start', { turn })
    session.append('step/start', { turn, step: 1 })
    const marker = buildStepMarkerMessage(`m${String(turn).padStart(4, '0')}`, turn, 1)
    session.append(
      'user/message',
      { ...marker, id: MessageId(`fixture-marker-${turn}`) },
      { surfaceOp: 'append' },
    )
    session.append('user/message', user(text), { surfaceOp: 'append' })
  }
  const text = (turn: number, step: number, value: string) => {
    session.append(
      'assistant/message',
      { turn, step, stream: [], message: assistant([{ type: 'text', text: value }]) },
      { surfaceOp: 'append' },
    )
  }
  const tool = (turn: number, step: number, command: string, stdout: string) => {
    const callId = ToolCallId(`fixture-tool-${turn}-${step}`)
    const args = JSON.stringify({ command, timeoutSec: 30 })
    session.append(
      'assistant/message',
      {
        turn,
        step,
        stream: [],
        message: assistant([
          { type: 'tool-call', id: callId, name: 'terminal', arguments: args },
        ]),
      },
      { surfaceOp: 'append' },
    )
    const call = session.append('tool/call', {
      turn,
      step,
      callId,
      name: 'terminal',
      arguments: args,
    })
    const result = createToolResultMessage({
      callId,
      content: [{ type: 'text', text: JSON.stringify({ stdout, stderr: '', returnCode: 0 }) }],
      isError: false,
    })
    session.append(
      'tool/result',
      { turn, step, message: { ...result, id: MessageId(`fixture-result-${turn}-${step}`) } },
      { surfaceOp: 'append', sourceEventSeqs: [call.seq] },
    )
    session.append('step/end', { turn, step })
  }
  start(
    1,
    `${spec}\nInvestigation phase: inspect the delivered ledger in pages and establish the input contract. This phase ends at diagnosis; implementation remains open.`,
  )
  let step = 1
  for (let offset = 0; offset < rows.length; offset += 64) {
    if (step > 1) session.append('step/start', { turn: 1, step })
    tool(
      1,
      step,
      `sed -n ${offset + 1},${offset + 64}p events.jsonl`,
      rows.slice(offset, offset + 64).join('\n'),
    )
    step++
  }
  session.append('step/start', { turn: 1, step })
  text(
    1,
    step,
    'Constructed investigation replay complete: repeated event IDs, invalid precision, cross-currency/unknown reversals and large amounts are present. Delivery order and occurrence order must be handled separately. No implementation has been repaired.',
  )
  session.append('step/end', { turn: 1, step })
  session.append('turn/end', { turn: 1, reason: { kind: 'completed' } })
  start(
    2,
    'Confirm the current implementation and public verification contract. Do not implement yet.',
  )
  tool(
    2,
    1,
    'cat ledger.py spec.md smoke_test.py',
    `${files['ledger.py']}\n${spec}\n${files['smoke_test.py']}`,
  )
  session.append('step/start', { turn: 2, step: 2 })
  text(
    2,
    2,
    'Inspection confirms float arithmetic, missing deduplication, no original-post reversal resolution and no rejected-event validation. Public smoke includes 0.10+0.20, a duplicate and two reversals of the same post. The investigation phase is closed; code repair and full replay remain open. The smoke result is not asserted here: the runner checks it independently before any model request.',
  )
  session.append('step/end', { turn: 2, step: 2 })
  session.append('turn/end', { turn: 2, reason: { kind: 'completed' } })
  start(
    3,
    'Retain the spec and task goal. Prepare to implement the ledger repair after this investigation.',
  )
  text(
    3,
    1,
    'Open work: repair ledger.py using exact integer cents and deterministic post/reversal rules, run smoke, produce balances.json from all input events, and document the fixes in repair.md. Input/spec must remain unchanged; no final task success is claimed.',
  )
  session.append('step/end', { turn: 3, step: 1 })
  session.append('turn/end', { turn: 3, reason: { kind: 'completed' } })
  return session
    .snapshotEvents()
    .map((event) => ({ ...event, time: Date.UTC(2026, 9, 14) + Number(event.seq) }))
}

/** Injected only after the agent has stopped, through the isolated verifier's stdin. */
export function buildScenarioVerifier(files: Record<string, string>): string {
  const rows = files['events.jsonl']!.trim()
    .split('\n')
    .map((line) => JSON.parse(line) as LedgerEvent)
  const probe = (event_id: string, overrides: Partial<LedgerEvent> = {}): LedgerEvent => ({
    ...rows[0]!,
    event_id,
    account_id: 'probe',
    currency: 'USD',
    kind: 'post',
    amount: '0.10',
    reverses: '',
    occurred_at: '2026-01-01T00:00:00Z',
    ...overrides,
  })
  const cases = [
    { name: 'full-input', rows },
    { name: 'delivery-order', rows: [...rows].reverse() },
    { name: 'repeated-delivery', rows: [...rows.slice(0, 48), ...rows.slice(0, 48)] },
    {
      name: 'large-exact-cents',
      rows: [
        probe('large', { amount: '9007199254740993.01' }),
        probe('fraction', { amount: '0.29' }),
      ],
    },
    {
      name: 'reversal-order-and-targets',
      rows: [
        probe('later', {
          kind: 'reverse',
          reverses: 'original',
          occurred_at: '2026-01-01T00:00:02Z',
        }),
        probe('original', { amount: '2.67' }),
        probe('earliest', {
          kind: 'reverse',
          reverses: 'original',
          occurred_at: '2026-01-01T00:00:01Z',
        }),
        probe('unknown', { kind: 'reverse', reverses: 'absent' }),
        probe('future', { amount: '5.00', occurred_at: '2026-01-01T00:00:10Z' }),
        probe('too-early', { kind: 'reverse', reverses: 'future' }),
      ],
    },
    {
      name: 'invalid-fields',
      rows: [
        probe('precision', { amount: '1.001' }),
        probe('not-a-number', { amount: 'NaN' }),
        probe('zero', { amount: '0.00' }),
        probe('negative', { amount: '-1.00' }),
        probe('date', { occurred_at: '2026-02-31T00:00:00Z' }),
        probe('account', { account_id: '' }),
        probe('currency', { currency: 'XXX' }),
      ],
    },
    {
      name: 'currency-and-account-isolation',
      rows: [
        probe('usd', { amount: '1.23' }),
        probe('eur', { currency: 'EUR', amount: '4.56' }),
        probe('wrong-currency', { kind: 'reverse', reverses: 'eur' }),
        probe('wrong-account', { kind: 'reverse', reverses: 'usd', account_id: 'other' }),
      ],
    },
  ]
  const bundle = {
    reference: SCENARIO_REFERENCE_IMPLEMENTATION,
    cases,
    hashes: Object.fromEntries(
      ['events.jsonl', 'spec.md', 'smoke_test.py'].map((name) => [
        name,
        createHash('sha256').update(files[name]!).digest('hex'),
      ]),
    ),
  }
  const encoded = Buffer.from(JSON.stringify(bundle)).toString('base64')
  return `import base64, hashlib, json, subprocess, sys, tempfile
from pathlib import Path
bundle = json.loads(base64.b64decode('${encoded}'))
scope = {'__name__': 'hidden_scenario_reference'}
exec(bundle['reference'], scope)
checks = []
def check(name, passed):
    checks.append(dict(name=name, passed=bool(passed)))
def valid_shape(result):
    return (isinstance(result, dict) and set(result) == {'balances', 'accepted', 'rejected', 'duplicates'}
        and all(type(result.get(k)) is int for k in ('accepted','rejected','duplicates'))
        and isinstance(result.get('balances'), dict)
        and all(isinstance(v, dict) and all(type(cents) is int for cents in v.values()) for v in result['balances'].values()))
def unchanged():
    return all(Path(name).is_file() and hashlib.sha256(Path(name).read_bytes()).hexdigest() == digest for name, digest in bundle['hashes'].items())
check('immutable-inputs-before-verification', unchanged())
try:
    delivered = json.loads(Path('balances.json').read_text())
    check('delivered-balances', valid_shape(delivered) and delivered == scope['replay'](bundle['cases'][0]['rows']))
except Exception:
    check('delivered-balances', False)
check('repair-notes', Path('repair.md').is_file() and bool(Path('repair.md').read_text().strip()))
try:
    smoke = subprocess.run([sys.executable, '-I', 'smoke_test.py'], capture_output=True, timeout=10)
    check('public-smoke', smoke.returncode == 0)
except Exception:
    check('public-smoke', False)
with tempfile.TemporaryDirectory() as tmp:
    for i, case in enumerate(bundle['cases']):
        try:
            src, dst = Path(tmp)/('input-'+str(i)), Path(tmp)/('output-'+str(i))
            src.write_text(''.join(json.dumps(e)+'\\n' for e in case['rows']))
            result = subprocess.run([sys.executable, '-I', 'ledger.py', str(src), str(dst)], capture_output=True, timeout=15)
            actual = json.loads(dst.read_text()) if result.returncode == 0 else None
            check(case['name'], valid_shape(actual) and actual == scope['replay'](case['rows']))
        except Exception:
            check(case['name'], False)
check('immutable-inputs-after-verification', unchanged())
passed = all(item['passed'] for item in checks)
print(json.dumps(dict(passed=passed, total=len(checks), checks=checks)))
sys.exit(0 if passed else 1)
`
}

/** Reference qualification with large scripts on stdin, never in a single argv. */
export function buildScenarioQualification(files: Record<string, string>): string {
  const encoded = Buffer.from(buildScenarioVerifier(files)).toString('base64')
  return `import base64, tempfile, subprocess, sys
from pathlib import Path
code = base64.b64decode('${encoded}').decode()
# Qualification uses only the trusted reference, never the mounted buggy candidate.
scope = {}
exec(code.split("checks = []")[0], scope)
with tempfile.TemporaryDirectory() as tmp:
    work = Path(tmp)
    for name in ('spec.md','events.jsonl','smoke_test.py'):
        (work/name).write_bytes(Path(name).read_bytes())
    (work/'ledger.py').write_text(scope['bundle']['reference'])
    subprocess.run([sys.executable, '-I', str(work/'ledger.py'), str(work/'events.jsonl'), str(work/'balances.json')], check=True)
    (work/'repair.md').write_text('Reference qualification only.')
    result = subprocess.run([sys.executable, '-I', '-'], input=code, text=True, cwd=tmp, capture_output=True)
    sys.exit(result.returncode)
`
}
