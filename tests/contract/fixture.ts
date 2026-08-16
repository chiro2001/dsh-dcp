import { Context, type Plugin } from '@deepseek-ai/cordis'
import SessionStore from '@deepseek-ai/dsh-session'
import * as sessionInvariant from '@deepseek-ai/dsh-session/invariant'
import * as agentLoopInvariant from '@deepseek-ai/dsh-agent-loop/invariant'
import * as compactionInvariant from '@deepseek-ai/dsh-compaction/invariant'
import InvariantRegistry from '@deepseek-ai/dsh-invariants'
import SessionProjectionRegistry from '@deepseek-ai/dsh-session-projection'
import TokenMeter from '@deepseek-ai/dsh-token-meter'

export interface ContractFixture {
  ctx: Context
  dispose(): Promise<void>
}

/**
 * Minimal host-composition fixture for M0 contract experiments:
 * session store + invariant companions + token meter + projection registry.
 */
export async function mountContractFixture(): Promise<ContractFixture> {
  const ctx = new Context()
  const disposers: Array<() => Promise<void>> = []

  async function mount(plugin: unknown, config?: unknown): Promise<void> {
    const fiber = ctx.plugin(plugin as Plugin, config as never)
    await fiber
    disposers.push(() => fiber.dispose())
  }

  await mount(InvariantRegistry)
  await mount(SessionStore)
  await mount(sessionInvariant as never)
  await mount(agentLoopInvariant as never)
  await mount(compactionInvariant as never)
  await mount(SessionProjectionRegistry)
  await mount(TokenMeter)

  return {
    ctx,
    dispose: async () => {
      await Promise.all(disposers.toReversed().map((dispose) => dispose()))
    },
  }
}
