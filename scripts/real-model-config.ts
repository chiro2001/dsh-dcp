/** Explicit credential binding for optional real-model tests and probes. */
export interface RealModelConfig {
  apiKeyEnv: string
  apiKey: string
  baseUrl: string
  model: string
  provider: string
  thinking?: 'enabled' | 'disabled'
}

export function readRealModelConfig(
  env: NodeJS.ProcessEnv = process.env,
): RealModelConfig | undefined {
  const explicitKeyEnv = env.DSH_DCP_LLM_API_KEY_ENV
  const apiKeyEnv = explicitKeyEnv ?? 'DEEPSEEK_API_KEY'
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(apiKeyEnv)) {
    throw new Error('DSH_DCP_LLM_API_KEY_ENV must name a valid environment variable')
  }

  let url: URL
  try {
    url = new URL(env.DSH_DCP_LLM_BASE_URL ?? 'https://api.deepseek.com/v1')
  } catch {
    throw new Error('DSH_DCP_LLM_BASE_URL must be a valid URL')
  }
  const loopback = ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)
  if (
    (url.protocol !== 'https:' && !(url.protocol === 'http:' && loopback)) ||
    url.username ||
    url.password ||
    url.search ||
    url.hash
  ) {
    throw new Error(
      'DSH_DCP_LLM_BASE_URL requires HTTPS or loopback HTTP, without userinfo, query, or hash',
    )
  }
  if (url.origin !== 'https://api.deepseek.com' && explicitKeyEnv === undefined) {
    throw new Error('Set DSH_DCP_LLM_API_KEY_ENV explicitly for a non-DeepSeek-official origin')
  }
  const thinking = env.DSH_DCP_LLM_THINKING ?? 'disabled'
  if (thinking !== undefined && thinking !== 'enabled' && thinking !== 'disabled') {
    throw new Error('DSH_DCP_LLM_THINKING must be enabled or disabled')
  }
  const apiKey = env[apiKeyEnv]?.trim()
  if (!apiKey) {
    if (explicitKeyEnv !== undefined)
      throw new Error(`Real-model credential ${apiKeyEnv} is missing`)
    return undefined
  }
  const model = (env.DSH_DCP_LLM_MODEL ?? 'deepseek-flash').trim()
  const provider = (env.DSH_DCP_LLM_PROVIDER ?? 'deepseek').trim()
  if (!model || !provider) throw new Error('Real-model model and provider must not be empty')
  return {
    apiKeyEnv,
    apiKey,
    baseUrl: url.href.replace(/\/+$/, ''),
    model,
    provider,
    ...(thinking === undefined ? {} : { thinking }),
  }
}
