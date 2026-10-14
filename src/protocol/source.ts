/** DCP owns its producer kind; durable legacy records remain readable. */
declare module '@deepseek-ai/dsh-llm' {
  interface MessageSourceMap {
    'dsh-dcp': { kind: 'dsh-dcp' }
  }
}

export function isDcpSource(source: unknown): boolean {
  if (source === null || typeof source !== 'object') return false
  const record = source as Record<string, unknown>
  return record.kind === 'dsh-dcp' || (record.kind === 'plugin' && record.plugin === 'dsh-dcp')
}
