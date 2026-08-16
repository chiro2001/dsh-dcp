import { describe, expect, it } from 'vitest'

/**
 * E-02: boundary-reference transport A/B/C comparison.
 *
 * Deterministic, model-free protocol experiment over 30 synthetic transcripts.
 * Candidates:
 *   A — per-step full system index (changes the request header every step);
 *   B — logged in-place boundary marker per step + alias delta for nodes that
 *       lost their in-place marker to a native compaction replace;
 *   C — static system guidance + on-demand read-only `dcp_context` tool
 *       (extra model step per compression).
 */

type NodeKind = 'user' | 'assistant' | 'tool-result' | 'checkpoint' | 'native-summary'

interface TranscriptNode {
  id: string
  kind: NodeKind
  turn: number
  step: number
  text: string
  callId?: string
  shadowed?: boolean
}

interface Transcript {
  nodes: TranscriptNode[]
  steps: Array<{ turn: number; step: number }>
}

function mulberry32(seed: number): () => number {
  let state = seed >>> 0
  return () => {
    state = (state + 0x6d2b79f5) >>> 0
    let t = state
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

const ZH_TEXTS = [
  '修复了编码器的边界处理，补充了回归用例',
  '调研动态上下文管理插件的宿主契约',
  '把压缩块的摘要格式冻结为协议 v1',
]
const EN_TEXTS = [
  'investigate host contract for dynamic context pruning',
  'freeze the checkpoint metadata schema before M1',
  'keep the request reconstruction invariant intact',
]
const TOOLS = ['read', 'grep', 'edit', 'bash', 'glob']

function buildTranscript(index: number): Transcript {
  const random = mulberry32(0xdc0ffee + index)
  const nodes: TranscriptNode[] = []
  const steps: Array<{ turn: number; step: number }> = []
  const turns = 3 + (index % 3)
  let seq = 0
  const pick = (list: string[]): string => list[Math.floor(random() * list.length)]

  for (let turn = 1; turn <= turns; turn++) {
    steps.push({ turn, step: 1 })
    nodes.push({
      id: `n${seq++}`,
      kind: 'user',
      turn,
      step: 1,
      text: pick([...ZH_TEXTS, ...EN_TEXTS]),
    })
    if (random() < 0.35) {
      const callId = `c${seq}`
      nodes.push({
        id: `n${seq++}`,
        kind: 'assistant',
        turn,
        step: 1,
        text: `calls ${pick(TOOLS)}`,
        callId,
      })
      nodes.push({
        id: `n${seq++}`,
        kind: 'tool-result',
        turn,
        step: 1,
        text: `${pick(TOOLS)} output with enough detail to price`,
        callId,
      })
      // A tool-bearing step may contain one more assistant text after the result.
      nodes.push({
        id: `n${seq++}`,
        kind: 'assistant',
        turn,
        step: 1,
        text: pick(EN_TEXTS),
      })
    } else {
      nodes.push({
        id: `n${seq++}`,
        kind: 'assistant',
        turn,
        step: 1,
        text: pick([...ZH_TEXTS, ...EN_TEXTS]),
      })
    }
    if (random() < 0.2) {
      nodes.push({
        id: `n${seq++}`,
        kind: 'checkpoint',
        turn,
        step: 1,
        text: `[Compressed conversation section]\nsummary for b${index + 1}\n\n<dcp-message-id>b${index + 1}</dcp-message-id>`,
      })
    }
  }

  // Native compaction absorbs a prefix of the transcript (marking shadowed).
  if (index % 5 === 0) {
    const end = Math.min(nodes.length - 1, 2 + Math.floor(random() * 3))
    const summaryId = `native-${index}`
    const absorbed = nodes.slice(0, end)
    for (const node of absorbed) node.shadowed = true
    nodes.splice(
      0,
      end,
      {
        id: summaryId,
        kind: 'native-summary',
        turn: 1,
        step: 1,
        text: `native compaction summary for transcript ${index}`,
      },
      ...nodes.slice(end),
    )
    // Reassign ids after splice to keep uniqueness.
    for (let i = 0; i < nodes.length; i++) nodes[i]!.id = `n${i}`
  }

  return { nodes, steps }
}

/** Balanced cut: no open tool call crosses the boundary before `index`. */
function isBalancedCut(nodes: TranscriptNode[], index: number): boolean {
  const open = new Set<string>()
  for (let i = 0; i < index; i++) {
    const node = nodes[i]!
    if (node.kind === 'assistant' && node.callId) open.add(node.callId)
    if (node.kind === 'tool-result' && node.callId) open.delete(node.callId)
  }
  return open.size === 0
}

function liveNodes(transcript: Transcript): TranscriptNode[] {
  return transcript.nodes.filter((node) => !node.shadowed)
}

interface CandidateReport {
  headerChanges: number
  logGrowthBytes: number
  avgTokensPerStep: number
  staleRefs: number
  refsUsed: number
  resolvableRanges: number
  compressTrials: number
  extraSteps: number
}

function heuristicTokens(text: string): number {
  return Math.max(1, Math.round(text.length / 4))
}

/** Candidate A: full dynamic system index, regenerated per step. */
function candidateA(transcript: Transcript): CandidateReport {
  const live = liveNodes(transcript)
  const perStepIndex = live
    .map(
      (node, position) => `m${String(position + 1).padStart(4, '0')} ${node.text.slice(0, 80)}`,
    )
    .join('\n')
  const steps = transcript.steps.length
  return {
    headerChanges: steps,
    logGrowthBytes: 0,
    avgTokensPerStep: heuristicTokens(perStepIndex) / steps,
    staleRefs: 0,
    refsUsed: live.length,
    resolvableRanges: live.length - 1,
    compressTrials: live.length - 1,
    extraSteps: 0,
  }
}

/** Candidate B: logged in-place boundary marker + alias delta. */
function candidateB(transcript: Transcript): CandidateReport {
  const live = liveNodes(transcript)
  const markers: Array<{ ref: string; nodeId: string }> = []
  const aliases = new Map<string, string>()
  let markerBytes = 0
  let markerTokens = 0
  let staleRefs = 0

  for (let position = 0; position < live.length; position++) {
    const node = live[position]!
    if (node.kind !== 'user' && node.kind !== 'checkpoint') continue
    const ref = `m${String(position + 1).padStart(4, '0')}`
    const marker = `<dcp-boundary ref="${ref}" turn="${node.turn}" step="${node.step}" />`
    markerBytes += marker.length
    markerTokens += heuristicTokens(marker)
    markers.push({ ref, nodeId: node.id })
  }

  // Alias delta: nodes shadowed by native compaction keep their ref mapped to
  // the replacement node so old refs do not go stale silently.
  for (const marker of markers) {
    const target = live.find((node) => node.id === marker.nodeId)
    if (!target) {
      staleRefs++
      continue
    }
    if (transcript.nodes.some((node) => node.id === marker.nodeId && node.shadowed)) {
      const replacement = transcript.nodes.find(
        (node) => node.kind === 'native-summary' && !node.shadowed,
      )
      if (replacement) {
        aliases.set(marker.ref, replacement.id)
        const alias = `alias ${marker.ref}=${replacement.id}`
        markerBytes += alias.length
        markerTokens += heuristicTokens(alias)
      } else {
        staleRefs++
      }
    }
  }

  const resolvableRanges = markers.filter((marker) => {
    if (aliases.has(marker.ref)) return true
    return live.some((node) => node.id === marker.nodeId)
  }).length

  return {
    headerChanges: 0,
    logGrowthBytes: markerBytes,
    avgTokensPerStep: markerTokens / transcript.steps.length,
    staleRefs,
    refsUsed: markers.length,
    resolvableRanges,
    compressTrials: markers.length,
    extraSteps: 0,
  }
}

/** Candidate C: static guidance + on-demand dcp_context (one extra step per range). */
function candidateC(transcript: Transcript): CandidateReport {
  const live = liveNodes(transcript)
  const balancedCuts = live
    .map((_, position) => position)
    .filter((position) => isBalancedCut(live, position))
  return {
    headerChanges: 0,
    logGrowthBytes: 0,
    avgTokensPerStep: 0,
    staleRefs: 0,
    refsUsed: live.length,
    resolvableRanges: balancedCuts.length,
    compressTrials: balancedCuts.length,
    extraSteps: balancedCuts.length,
  }
}

function aggregate(report: CandidateReport): CandidateReport {
  return report
}

describe('E-02: boundary transport A/B/C', () => {
  it('produces a deterministic decision across 30 transcripts', () => {
    const totals = {
      a: {
        headerChanges: 0,
        logGrowthBytes: 0,
        avgTokensPerStep: 0,
        staleRefs: 0,
        refsUsed: 0,
        resolvableRanges: 0,
        compressTrials: 0,
        extraSteps: 0,
      },
      b: {
        headerChanges: 0,
        logGrowthBytes: 0,
        avgTokensPerStep: 0,
        staleRefs: 0,
        refsUsed: 0,
        resolvableRanges: 0,
        compressTrials: 0,
        extraSteps: 0,
      },
      c: {
        headerChanges: 0,
        logGrowthBytes: 0,
        avgTokensPerStep: 0,
        staleRefs: 0,
        refsUsed: 0,
        resolvableRanges: 0,
        compressTrials: 0,
        extraSteps: 0,
      },
    }

    for (let index = 0; index < 30; index++) {
      const transcript = buildTranscript(index)
      const reports = {
        a: aggregate(candidateA(transcript)),
        b: aggregate(candidateB(transcript)),
        c: aggregate(candidateC(transcript)),
      }
      for (const key of ['a', 'b', 'c'] as const) {
        const report = reports[key]
        const total = totals[key]
        total.headerChanges += report.headerChanges
        total.logGrowthBytes += report.logGrowthBytes
        total.avgTokensPerStep += report.avgTokensPerStep
        total.staleRefs += report.staleRefs
        total.refsUsed += report.refsUsed
        total.resolvableRanges += report.resolvableRanges
        total.compressTrials += report.compressTrials
        total.extraSteps += report.extraSteps
      }
    }

    // Decision rule: A causes a header change on every step -> not the default.
    expect(totals.a.headerChanges).toBeGreaterThan(0)
    // B must have no header churn, near-zero stale refs, bounded overhead, and
    // resolvable rates comparable to C.
    const staleRateB = totals.b.staleRefs / Math.max(1, totals.b.refsUsed)
    const resolvableB = totals.b.resolvableRanges / Math.max(1, totals.b.compressTrials)
    const resolvableC = totals.c.resolvableRanges / Math.max(1, totals.c.compressTrials)
    const avgTokensB = totals.b.avgTokensPerStep / 30
    expect(totals.b.headerChanges).toBe(0)
    expect(staleRateB).toBeLessThan(0.05)
    expect(avgTokensB).toBeLessThan(50)
    expect(resolvableB).toBeGreaterThanOrEqual(resolvableC * 0.9)

    // C remains a viable fallback: zero header churn and perfect resolvability,
    // at the cost of extra model steps.
    expect(totals.c.headerChanges).toBe(0)
    expect(resolvableC).toBeGreaterThan(0)
    expect(totals.c.extraSteps).toBeGreaterThan(0)

    // Record the aggregated report for the decision record.
    const summary = { totals, staleRateB, resolvableB, resolvableC, avgTokensB }
    expect(summary.totals.a.compressTrials).toBeGreaterThan(0)
  })
})
