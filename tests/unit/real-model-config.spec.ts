import { describe, expect, it } from 'vitest'
import { readRealModelConfig } from '../../scripts/real-model-config.js'

const TEST_ONLY_API_KEY = 'TEST_ONLY_KEY_DO_NOT_USE'

function expectErrorWithoutKey(run: () => unknown, key: string): string {
  let error: unknown
  try {
    run()
  } catch (caught) {
    error = caught
  }
  expect(error).toBeDefined()
  const message = error instanceof Error ? error.message : String(error)
  expect(message).not.toContain(key)
  return message
}

function readWithBaseUrl(baseUrl: string) {
  return readRealModelConfig({
    DSH_DCP_LLM_API_KEY_ENV: 'DCP_TEST_API_KEY',
    DCP_TEST_API_KEY: TEST_ONLY_API_KEY,
    DSH_DCP_LLM_BASE_URL: baseUrl,
  })
}

describe('real model test configuration', () => {
  it('uses official DeepSeek defaults, prefers its key, and skips with only the legacy key', () => {
    expect(readRealModelConfig({})).toBeUndefined()
    expect(readRealModelConfig({ OPENCODE_GO_API_KEY: TEST_ONLY_API_KEY })).toBeUndefined()
    expect(readRealModelConfig({ DEEPSEEK_API_KEY: TEST_ONLY_API_KEY })).toEqual({
      apiKeyEnv: 'DEEPSEEK_API_KEY',
      apiKey: TEST_ONLY_API_KEY,
      baseUrl: 'https://api.deepseek.com/v1',
      model: 'deepseek-flash',
      provider: 'deepseek',
      thinking: 'disabled',
    })
    expect(
      readRealModelConfig({
        DEEPSEEK_API_KEY: TEST_ONLY_API_KEY,
        OPENCODE_GO_API_KEY: TEST_ONLY_API_KEY,
      })?.apiKeyEnv,
    ).toBe('DEEPSEEK_API_KEY')
    expect(
      readRealModelConfig({
        DEEPSEEK_API_KEY: TEST_ONLY_API_KEY,
        DSH_DCP_LLM_THINKING: 'enabled',
      })?.thinking,
    ).toBe('enabled')
  })

  it('loads an explicitly selected key env and applies model, provider, URL, and thinking overrides', () => {
    expect(
      readRealModelConfig({
        DSH_DCP_LLM_API_KEY_ENV: 'DEEPSEEK_API_KEY',
        DEEPSEEK_API_KEY: TEST_ONLY_API_KEY,
        DSH_DCP_LLM_BASE_URL: 'https://api.deepseek.com/v1///',
        DSH_DCP_LLM_MODEL: 'deepseek-flash',
        DSH_DCP_LLM_PROVIDER: 'deepseek',
        DSH_DCP_LLM_THINKING: 'disabled',
      }),
    ).toEqual({
      apiKeyEnv: 'DEEPSEEK_API_KEY',
      apiKey: TEST_ONLY_API_KEY,
      baseUrl: 'https://api.deepseek.com/v1',
      model: 'deepseek-flash',
      provider: 'deepseek',
      thinking: 'disabled',
    })
  })

  it('accepts safe environment identifiers and rejects malformed names without exposing keys', () => {
    expect(
      readRealModelConfig({
        DSH_DCP_LLM_API_KEY_ENV: 'DCP_TEST_KEY_2',
        DCP_TEST_KEY_2: TEST_ONLY_API_KEY,
      })?.apiKeyEnv,
    ).toBe('DCP_TEST_KEY_2')

    for (const apiKeyEnv of ['BAD-KEY', 'BAD.KEY', '2BAD_KEY', 'HAS SPACE']) {
      const message = expectErrorWithoutKey(
        () =>
          readRealModelConfig({
            DSH_DCP_LLM_API_KEY_ENV: apiKeyEnv,
            OPENCODE_GO_API_KEY: TEST_ONLY_API_KEY,
          }),
        TEST_ONLY_API_KEY,
      )
      expect(message.length).toBeGreaterThan(0)
    }
  })

  it('fails clearly when an explicitly selected key is missing instead of skipping or falling back', () => {
    const message = expectErrorWithoutKey(
      () =>
        readRealModelConfig({
          DSH_DCP_LLM_API_KEY_ENV: 'DEEPSEEK_API_KEY',
          OPENCODE_GO_API_KEY: TEST_ONLY_API_KEY,
        }),
      TEST_ONLY_API_KEY,
    )
    expect(message).toContain('DEEPSEEK_API_KEY')
  })

  it('requires explicit key binding for OpenCode and other nonofficial origins', () => {
    const message = expectErrorWithoutKey(
      () =>
        readRealModelConfig({
          OPENCODE_GO_API_KEY: TEST_ONLY_API_KEY,
          DSH_DCP_LLM_BASE_URL: 'https://opencode.ai/zen/go/v1',
        }),
      TEST_ONLY_API_KEY,
    )
    expect(message.length).toBeGreaterThan(0)

    expectErrorWithoutKey(
      () =>
        readRealModelConfig({
          DEEPSEEK_API_KEY: TEST_ONLY_API_KEY,
          DSH_DCP_LLM_BASE_URL: 'https://gateway.example.test/v1',
        }),
      TEST_ONLY_API_KEY,
    )
    expect(message).toContain('DSH_DCP_LLM_API_KEY_ENV')
  })

  it('requires explicit key binding for a nondefault official DeepSeek port', () => {
    const message = expectErrorWithoutKey(
      () =>
        readRealModelConfig({
          DEEPSEEK_API_KEY: TEST_ONLY_API_KEY,
          DSH_DCP_LLM_BASE_URL: 'https://api.deepseek.com:8443/v1',
        }),
      TEST_ONLY_API_KEY,
    )
    expect(message).toContain('DSH_DCP_LLM_API_KEY_ENV')

    expect(
      readRealModelConfig({
        DSH_DCP_LLM_API_KEY_ENV: 'DEEPSEEK_API_KEY',
        DEEPSEEK_API_KEY: TEST_ONLY_API_KEY,
        DSH_DCP_LLM_BASE_URL: 'https://api.deepseek.com:8443/v1',
      }),
    ).toMatchObject({
      apiKeyEnv: 'DEEPSEEK_API_KEY',
      baseUrl: 'https://api.deepseek.com:8443/v1',
      provider: 'deepseek',
    })
  })

  it('allows HTTPS and loopback HTTP URLs and removes trailing slashes', () => {
    expect(readWithBaseUrl('https://api.deepseek.com/v1///')?.baseUrl).toBe(
      'https://api.deepseek.com/v1',
    )
    expect(readWithBaseUrl('http://localhost:8317/v1/')?.baseUrl).toBe(
      'http://localhost:8317/v1',
    )
    expect(readWithBaseUrl('http://127.0.0.1:8317/v1///')?.baseUrl).toBe(
      'http://127.0.0.1:8317/v1',
    )
    expect(readWithBaseUrl('http://[::1]:8317/v1/')?.baseUrl).toBe('http://[::1]:8317/v1')
  })

  it('rejects unsafe URLs and invalid thinking values without exposing the API key', () => {
    for (const baseUrl of [
      'http://gateway.example.test/v1',
      'https://user:password@gateway.example.test/v1',
      'https://gateway.example.test/v1?token=bad',
      'https://gateway.example.test/v1#fragment',
      'file:///tmp/model',
      'not a URL',
    ]) {
      expectErrorWithoutKey(() => readWithBaseUrl(baseUrl), TEST_ONLY_API_KEY)
    }

    expectErrorWithoutKey(
      () =>
        readRealModelConfig({
          OPENCODE_GO_API_KEY: TEST_ONLY_API_KEY,
          DSH_DCP_LLM_THINKING: 'sometimes',
        }),
      TEST_ONLY_API_KEY,
    )
  })
})
