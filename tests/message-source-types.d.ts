import type { MessageSourceMap } from '@deepseek-ai/dsh-llm'

declare module '@deepseek-ai/dsh-llm' {
  interface MessageSourceMap {
    'prepare-test-context': { kind: 'prepare-test-context'; form: 'instructions' }
    'subagent-test': { kind: 'subagent-test'; form: 'notice'; summary: string }
  }
}

export type TestMessageSourceKind = keyof Pick<
  MessageSourceMap,
  'prepare-test-context' | 'subagent-test'
>
