/**
 * dsh-dcp v0.1 configuration: schema, defaults, and validation.
 *
 * @module dsh-dcp/config
 */

import z from '@deepseek-ai/schemastery'

export interface DcpCompressConfig {
  enabled: boolean
  mode: 'range'
  maxRangesPerCall: number
  minNetSavingsTokens: number
  retainRecentTurns: number
  protectUserMessages: boolean
  protectTags: boolean
  protectedTools: string[]
  protectedSources: string[]
}

export interface DcpReferencesConfig {
  transport: 'marker' | 'context-tool'
  maxAliasEntries: number
  excerptChars: number
}

export interface DcpNudgeConfig {
  enabled: boolean
  maxRatio: number
  minRatio: number
  frequencySteps: number
  iterationThreshold: number
}

export interface DcpManualModeConfig {
  default: boolean
  automaticStrategies: boolean
}

export interface DcpDeduplicationConfig {
  enabled: boolean
  protectedTools: string[]
}

export interface DcpPurgeErrorsConfig {
  enabled: boolean
  turns: number
  protectedTools: string[]
}

export interface DcpStrategiesConfig {
  deduplication: DcpDeduplicationConfig
  purgeErrors: DcpPurgeErrorsConfig
}

export interface DcpSubagentsConfig {
  enableCompressionInChild: boolean
  readChildSession: boolean
}

export interface DcpConfig {
  enabled: boolean
  debug: boolean
  compress: DcpCompressConfig
  references: DcpReferencesConfig
  nudge: DcpNudgeConfig
  manualMode: DcpManualModeConfig
  strategies: DcpStrategiesConfig
  protectedFilePatterns: string[]
  subagents: DcpSubagentsConfig
}

export const DCP_CONFIG_DEFAULTS: DcpConfig = {
  enabled: true,
  debug: false,
  compress: {
    enabled: true,
    mode: 'range',
    maxRangesPerCall: 3,
    minNetSavingsTokens: 256,
    retainRecentTurns: 2,
    protectUserMessages: false,
    protectTags: true,
    protectedTools: ['subagent', 'skill', 'todo_write'],
    protectedSources: ['subagent-report', 'subagent-settled'],
  },
  references: {
    transport: 'marker',
    maxAliasEntries: 32,
    excerptChars: 80,
  },
  nudge: {
    enabled: true,
    maxRatio: 0.8,
    minRatio: 0.6,
    frequencySteps: 8,
    iterationThreshold: 12,
  },
  manualMode: {
    default: false,
    automaticStrategies: true,
  },
  strategies: {
    deduplication: {
      enabled: true,
      protectedTools: [],
    },
    purgeErrors: {
      enabled: false,
      turns: 4,
      protectedTools: [],
    },
  },
  protectedFilePatterns: [],
  subagents: {
    enableCompressionInChild: false,
    readChildSession: false,
  },
}

const positiveInt = z.number().step(1).min(1)
const stringArray = z.array(z.string()).max(64)

export const Config = z.object({
  enabled: z.boolean().default(DCP_CONFIG_DEFAULTS.enabled),
  debug: z.boolean().default(DCP_CONFIG_DEFAULTS.debug),
  compress: z
    .object({
      enabled: z.boolean().default(DCP_CONFIG_DEFAULTS.compress.enabled),
      mode: z.union([z.const('range')]).default(DCP_CONFIG_DEFAULTS.compress.mode),
      maxRangesPerCall: positiveInt.default(DCP_CONFIG_DEFAULTS.compress.maxRangesPerCall),
      minNetSavingsTokens: positiveInt.default(
        DCP_CONFIG_DEFAULTS.compress.minNetSavingsTokens,
      ),
      retainRecentTurns: positiveInt.default(DCP_CONFIG_DEFAULTS.compress.retainRecentTurns),
      protectUserMessages: z
        .boolean()
        .default(DCP_CONFIG_DEFAULTS.compress.protectUserMessages),
      protectTags: z.boolean().default(DCP_CONFIG_DEFAULTS.compress.protectTags),
      protectedTools: stringArray.default(DCP_CONFIG_DEFAULTS.compress.protectedTools),
      protectedSources: stringArray.default(DCP_CONFIG_DEFAULTS.compress.protectedSources),
    })
    .default(DCP_CONFIG_DEFAULTS.compress),
  references: z
    .object({
      transport: z
        .union([z.const('marker'), z.const('context-tool')])
        .default(DCP_CONFIG_DEFAULTS.references.transport),
      maxAliasEntries: positiveInt.default(DCP_CONFIG_DEFAULTS.references.maxAliasEntries),
      excerptChars: positiveInt.default(DCP_CONFIG_DEFAULTS.references.excerptChars),
    })
    .default(DCP_CONFIG_DEFAULTS.references),
  nudge: z
    .object({
      enabled: z.boolean().default(DCP_CONFIG_DEFAULTS.nudge.enabled),
      maxRatio: z.number().min(0).max(1).default(DCP_CONFIG_DEFAULTS.nudge.maxRatio),
      minRatio: z.number().min(0).max(1).default(DCP_CONFIG_DEFAULTS.nudge.minRatio),
      frequencySteps: positiveInt.default(DCP_CONFIG_DEFAULTS.nudge.frequencySteps),
      iterationThreshold: positiveInt.default(DCP_CONFIG_DEFAULTS.nudge.iterationThreshold),
    })
    .default(DCP_CONFIG_DEFAULTS.nudge),
  manualMode: z
    .object({
      default: z.boolean().default(DCP_CONFIG_DEFAULTS.manualMode.default),
      automaticStrategies: z
        .boolean()
        .default(DCP_CONFIG_DEFAULTS.manualMode.automaticStrategies),
    })
    .default(DCP_CONFIG_DEFAULTS.manualMode),
  strategies: z
    .object({
      deduplication: z
        .object({
          enabled: z.boolean().default(DCP_CONFIG_DEFAULTS.strategies.deduplication.enabled),
          protectedTools: stringArray.default(
            DCP_CONFIG_DEFAULTS.strategies.deduplication.protectedTools,
          ),
        })
        .default(DCP_CONFIG_DEFAULTS.strategies.deduplication),
      purgeErrors: z
        .object({
          enabled: z.boolean().default(DCP_CONFIG_DEFAULTS.strategies.purgeErrors.enabled),
          turns: positiveInt.default(DCP_CONFIG_DEFAULTS.strategies.purgeErrors.turns),
          protectedTools: stringArray.default(
            DCP_CONFIG_DEFAULTS.strategies.purgeErrors.protectedTools,
          ),
        })
        .default(DCP_CONFIG_DEFAULTS.strategies.purgeErrors),
    })
    .default(DCP_CONFIG_DEFAULTS.strategies),
  protectedFilePatterns: stringArray.default(DCP_CONFIG_DEFAULTS.protectedFilePatterns),
  subagents: z
    .object({
      enableCompressionInChild: z
        .boolean()
        .default(DCP_CONFIG_DEFAULTS.subagents.enableCompressionInChild),
      readChildSession: z.boolean().default(DCP_CONFIG_DEFAULTS.subagents.readChildSession),
    })
    .default(DCP_CONFIG_DEFAULTS.subagents),
})

/** Resolve user input through the schema and enforce cross-field constraints. */
export function resolveConfig(input: unknown): DcpConfig {
  const resolved = Config(input as never) as DcpConfig
  if (resolved.nudge.minRatio >= resolved.nudge.maxRatio) {
    throw new Error('dcp config: nudge.minRatio must be strictly below nudge.maxRatio')
  }
  if (resolved.compress.minNetSavingsTokens <= 0) {
    throw new Error('dcp config: compress.minNetSavingsTokens must be positive')
  }
  const raw = (input ?? {}) as Record<string, unknown>
  const references = raw.references as Record<string, unknown> | undefined
  if (references?.transport !== undefined && references.transport !== 'marker') {
    throw new Error('dcp config: references.transport only supports "marker" in v0.1')
  }
  const subagents = raw.subagents as Record<string, unknown> | undefined
  if (subagents?.enableCompressionInChild === true || subagents?.readChildSession === true) {
    throw new Error(
      'dcp config: subagents.enableCompressionInChild/readChildSession are unsupported in v0.1',
    )
  }
  return resolved
}

const VALID_KEYS = new Set([
  'enabled',
  'debug',
  'compress',
  'compress.enabled',
  'compress.mode',
  'compress.maxRangesPerCall',
  'compress.minNetSavingsTokens',
  'compress.retainRecentTurns',
  'compress.protectUserMessages',
  'compress.protectTags',
  'compress.protectedTools',
  'compress.protectedSources',
  'references',
  'references.transport',
  'references.maxAliasEntries',
  'references.excerptChars',
  'nudge',
  'nudge.enabled',
  'nudge.maxRatio',
  'nudge.minRatio',
  'nudge.frequencySteps',
  'nudge.iterationThreshold',
  'manualMode',
  'manualMode.default',
  'manualMode.automaticStrategies',
  'strategies',
  'strategies.deduplication',
  'strategies.deduplication.enabled',
  'strategies.deduplication.protectedTools',
  'strategies.purgeErrors',
  'strategies.purgeErrors.enabled',
  'strategies.purgeErrors.turns',
  'strategies.purgeErrors.protectedTools',
  'protectedFilePatterns',
  'subagents',
  'subagents.enableCompressionInChild',
  'subagents.readChildSession',
])

function collectKeyPaths(value: Record<string, unknown>, prefix = ''): string[] {
  const keys: string[] = []
  for (const key of Object.keys(value)) {
    const full = prefix ? `${prefix}.${key}` : key
    keys.push(full)
    const child = value[key]
    if (child !== null && typeof child === 'object' && !Array.isArray(child)) {
      keys.push(...collectKeyPaths(child as Record<string, unknown>, full))
    }
  }
  return keys
}

/** Unknown-key validation for human-authored config documents. */
export function unknownConfigKeys(input: Record<string, unknown>): string[] {
  return collectKeyPaths(input).filter((key) => !VALID_KEYS.has(key))
}
