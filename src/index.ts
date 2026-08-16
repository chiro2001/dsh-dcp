/**
 * dsh-dcp 插件入口（M0 占位）。
 *
 * M0 阶段只做宿主契约实验（tests/contract/），本文件保留最小可构建入口；
 * M1 按修订版 PLAN §5/§13 注册 systemPrompt section、compress 工具、
 * dcp/dcp-compress 命令、agent/pre-step 策略与 settings namespace。
 */

import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'

export const name = 'dsh-dcp'

export const inject: string[] = []

export const Config = z.object({
  enabled: z.boolean().default(true),
  debug: z.boolean().default(false),
})

export function apply(ctx: Context): void {
  // M1: 真实注册逻辑
  void ctx
}
