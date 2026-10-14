import '@chiro2001/dsh-dcp'
import { CompactionId, compactCheckpointSource } from '@deepseek-ai/dsh-compaction'
import { createUserMessage } from '@deepseek-ai/dsh-llm/message'
import type { MessageSourceMap } from '@deepseek-ai/dsh-llm'

const dcpSource: MessageSourceMap['dsh-dcp'] = { kind: 'dsh-dcp' }

export const dcpMarkerMessage = createUserMessage({
  content: [{ type: 'text', text: '<dcp-boundary ref="m0001" turn="1" step="1" />' }],
  source: dcpSource,
})

export const compactedMessage = createUserMessage({
  content: [{ type: 'text', text: 'native checkpoint' }],
  source: compactCheckpointSource(CompactionId('package-consumer-checkpoint')),
})
