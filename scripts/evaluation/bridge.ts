import { createInterface } from 'node:readline'
import type { Readable, Writable } from 'node:stream'
import type { TerminalResult } from './harness.js'

/** Correlated local IPC; commands execute only through Harbor's environment.exec. */
export function createTerminalBridge(input: Readable, output: Writable) {
  const reader = createInterface({ input, crlfDelay: Infinity })
  const pending = new Map<
    number,
    {
      resolve(value: TerminalResult): void
      reject(reason: Error): void
      dispose(): void
    }
  >()
  let nextId = 0
  let closed = false
  const close = (reason = new Error('Terminal bridge closed')) => {
    if (closed) return
    closed = true
    for (const request of pending.values()) {
      request.dispose()
      request.reject(reason)
    }
    pending.clear()
    reader.close()
    input.off('error', onError)
    output.off('error', onError)
  }
  const onError = (error: Error) => close(error)
  input.on('error', onError)
  output.on('error', onError)
  reader.on('close', () => close(new Error('Terminal controller stream ended')))
  reader.on('line', (line) => {
    let frame: Record<string, unknown>
    try {
      const parsed: unknown = JSON.parse(line)
      if (typeof parsed !== 'object' || parsed === null) return
      frame = parsed as Record<string, unknown>
    } catch {
      return // Unrelated diagnostic lines never resolve a tool call.
    }
    if (typeof frame.id !== 'number' || !Number.isSafeInteger(frame.id)) return
    const request = pending.get(frame.id)
    if (!request) return // Ignore late, duplicate and unrelated responses.
    pending.delete(frame.id)
    request.dispose()
    if (frame.kind === 'error') {
      request.reject(
        new Error(typeof frame.message === 'string' ? frame.message : 'Container exec failed'),
      )
    } else if (
      frame.kind === 'result' &&
      typeof frame.stdout === 'string' &&
      typeof frame.stderr === 'string' &&
      typeof frame.returnCode === 'number' &&
      Number.isSafeInteger(frame.returnCode)
    ) {
      request.resolve({
        stdout: frame.stdout,
        stderr: frame.stderr,
        returnCode: frame.returnCode,
      })
    } else request.reject(new Error('Invalid terminal response protocol'))
  })

  return {
    terminal(
      command: string,
      timeoutSec: number,
      signal?: AbortSignal,
    ): Promise<TerminalResult> {
      if (closed) return Promise.reject(new Error('Terminal bridge closed'))
      if (signal?.aborted) return Promise.reject(new Error('Terminal request aborted'))
      if (typeof command !== 'string' || !Number.isFinite(timeoutSec) || timeoutSec <= 0)
        return Promise.reject(new Error('Invalid terminal request'))
      return new Promise((resolve, reject) => {
        const id = ++nextId
        const fail = (error: Error) => {
          const request = pending.get(id)
          if (!request) return
          pending.delete(id)
          request.dispose()
          reject(error)
        }
        const abort = () => fail(new Error('Terminal request aborted by caller'))
        const timer = setTimeout(
          () => fail(new Error('Terminal request timed out')),
          timeoutSec * 1000,
        )
        pending.set(id, {
          resolve,
          reject,
          dispose: () => {
            clearTimeout(timer)
            signal?.removeEventListener('abort', abort)
          },
        })
        signal?.addEventListener('abort', abort, { once: true })
        try {
          output.write(
            `${JSON.stringify({ kind: 'exec', id, command, timeoutSec })}\n`,
            (error) => {
              if (error) fail(error)
            },
          )
        } catch (error) {
          fail(error instanceof Error ? error : new Error('Terminal output stream failed'))
        }
      })
    },
    close: () => close(),
  }
}
