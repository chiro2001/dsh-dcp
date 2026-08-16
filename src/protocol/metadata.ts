/**
 * DCP checkpoint source metadata: encode/decode, fail-closed versioning.
 *
 * @module dsh-dcp/protocol/metadata
 */

import {
  isCompactCheckpointSource,
  type CompactionCheckpointSource,
  type CompactionId,
} from '@deepseek-ai/dsh-compaction'

export const DCP_PROTOCOL_VERSION = 1

export interface DcpDiagnostic {
  seq?: number
  code: string
  message: string
}

export interface DcpCheckpointMetaV1 {
  v: 1
  kind: 'summary' | 'expansion'
  blockRef: `b${number}`
  mode: 'range' | 'message'
  topic: string
  startRef: string
  endRef?: string
  authorMessageId: string
  compressCallId: string
  consumedBlockRefs: string[]
  protectedKinds: string[]
  recompressedFrom?: `b${number}`
}

export type DcpCheckpointSourceV1 = CompactionCheckpointSource & {
  dcp: DcpCheckpointMetaV1
}

const BLOCK_REF = /^b([1-9]\d*)$/

function isBlockRef(value: unknown): value is `b${number}` {
  return typeof value === 'string' && BLOCK_REF.test(value)
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((entry) => typeof entry === 'string')
}

export function encodeDcpCheckpointSource(
  compactionId: CompactionId,
  meta: DcpCheckpointMetaV1,
): DcpCheckpointSourceV1 {
  return {
    kind: 'plugin',
    plugin: 'compact',
    compactionId,
    dcp: { ...meta },
  }
}

export function isDcpCheckpointSource(source: unknown): source is DcpCheckpointSourceV1 {
  return decodeDcpMeta(source).ok
}

export function decodeDcpMeta(
  source: unknown,
): { ok: true; meta: DcpCheckpointMetaV1 } | { ok: false; diagnostic: DcpDiagnostic } {
  if (
    source === null ||
    typeof source !== 'object' ||
    Array.isArray(source) ||
    !isCompactCheckpointSource(source as never)
  ) {
    return {
      ok: false,
      diagnostic: {
        code: 'NOT_COMPACT_SOURCE',
        message: 'source is not a compaction checkpoint',
      },
    }
  }
  const record = source as Record<string, unknown>
  const dcp = record.dcp
  if (dcp === null || typeof dcp !== 'object' || Array.isArray(dcp)) {
    return {
      ok: false,
      diagnostic: { code: 'MISSING_DCP_META', message: 'checkpoint source lacks dcp metadata' },
    }
  }
  const meta = dcp as Record<string, unknown>
  if (meta.v !== DCP_PROTOCOL_VERSION) {
    return {
      ok: false,
      diagnostic: {
        code: 'UNSUPPORTED_VERSION',
        message: `dcp metadata version ${String(meta.v)} is not supported (expected ${DCP_PROTOCOL_VERSION})`,
      },
    }
  }
  if (meta.kind !== 'summary' && meta.kind !== 'expansion') {
    return {
      ok: false,
      diagnostic: { code: 'INVALID_KIND', message: `invalid dcp kind ${String(meta.kind)}` },
    }
  }
  if (!isBlockRef(meta.blockRef)) {
    return {
      ok: false,
      diagnostic: {
        code: 'INVALID_BLOCK_REF',
        message: 'dcp blockRef must be b<positive integer>',
      },
    }
  }
  if (meta.mode !== 'range' && meta.mode !== 'message') {
    return {
      ok: false,
      diagnostic: { code: 'INVALID_MODE', message: `invalid dcp mode ${String(meta.mode)}` },
    }
  }
  if (typeof meta.topic !== 'string' || meta.topic.length === 0 || meta.topic.length > 200) {
    return {
      ok: false,
      diagnostic: {
        code: 'INVALID_TOPIC',
        message: 'dcp topic must be a non-empty string <= 200 chars',
      },
    }
  }
  if (
    typeof meta.startRef !== 'string' ||
    meta.startRef.length === 0 ||
    meta.startRef.length > 32
  ) {
    return {
      ok: false,
      diagnostic: {
        code: 'INVALID_START_REF',
        message: 'dcp startRef must be a non-empty string',
      },
    }
  }
  if (
    meta.endRef !== undefined &&
    (typeof meta.endRef !== 'string' || meta.endRef.length === 0)
  ) {
    return {
      ok: false,
      diagnostic: { code: 'INVALID_END_REF', message: 'dcp endRef must be a non-empty string' },
    }
  }
  if (typeof meta.authorMessageId !== 'string' || meta.authorMessageId.length === 0) {
    return {
      ok: false,
      diagnostic: {
        code: 'INVALID_AUTHOR',
        message: 'dcp authorMessageId must be a non-empty string',
      },
    }
  }
  if (typeof meta.compressCallId !== 'string' || meta.compressCallId.length === 0) {
    return {
      ok: false,
      diagnostic: {
        code: 'INVALID_CALL',
        message: 'dcp compressCallId must be a non-empty string',
      },
    }
  }
  if (!isStringArray(meta.consumedBlockRefs) || !meta.consumedBlockRefs.every(isBlockRef)) {
    return {
      ok: false,
      diagnostic: {
        code: 'INVALID_CONSUMED',
        message: 'dcp consumedBlockRefs must be an array of b<id>',
      },
    }
  }
  if (!isStringArray(meta.protectedKinds)) {
    return {
      ok: false,
      diagnostic: {
        code: 'INVALID_PROTECTED',
        message: 'dcp protectedKinds must be a string array',
      },
    }
  }
  if (meta.recompressedFrom !== undefined && !isBlockRef(meta.recompressedFrom)) {
    return {
      ok: false,
      diagnostic: {
        code: 'INVALID_RECOMPRESSED',
        message: 'dcp recompressedFrom must be b<id>',
      },
    }
  }

  return {
    ok: true,
    meta: {
      v: 1,
      kind: meta.kind,
      blockRef: meta.blockRef,
      mode: meta.mode,
      topic: meta.topic,
      startRef: meta.startRef,
      ...(meta.endRef === undefined ? {} : { endRef: meta.endRef }),
      authorMessageId: meta.authorMessageId,
      compressCallId: meta.compressCallId,
      consumedBlockRefs: [...meta.consumedBlockRefs],
      protectedKinds: [...meta.protectedKinds],
      ...(meta.recompressedFrom === undefined
        ? {}
        : { recompressedFrom: meta.recompressedFrom }),
    },
  }
}
