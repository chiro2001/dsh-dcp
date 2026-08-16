import { describe, expect, it } from 'vitest'
import { Session, SessionId } from '@deepseek-ai/dsh-session'
import { CommandId } from '@deepseek-ai/dsh-commands'
import { reduceDcpState } from '../../src/protocol/replay.js'

describe('manual mode replay (M3)', () => {
  it('derives manual mode from successful command lifecycle pairs', () => {
    const session = Session.create(SessionId('manual-replay'))
    session.append('command/run', {
      commandId: CommandId('cmd-1'),
      name: 'dcp',
      args: ' manual on ',
      source: { kind: 'user' },
    })
    session.append('command/done', { commandId: CommandId('cmd-1'), kind: 'success' })

    expect(reduceDcpState([...session.events]).manualMode).toBe(true)

    session.append('command/run', {
      commandId: CommandId('cmd-2'),
      name: 'dcp',
      args: 'manual off',
      source: { kind: 'user' },
    })
    session.append('command/done', { commandId: CommandId('cmd-2'), kind: 'success' })
    expect(reduceDcpState([...session.events]).manualMode).toBe(false)

    // A failed command does not change state.
    session.append('command/run', {
      commandId: CommandId('cmd-3'),
      name: 'dcp',
      args: 'manual on',
      source: { kind: 'user' },
    })
    session.append('command/done', {
      commandId: CommandId('cmd-3'),
      kind: 'error',
      text: 'nope',
    })
    expect(reduceDcpState([...session.events]).manualMode).toBe(false)
  })
})
