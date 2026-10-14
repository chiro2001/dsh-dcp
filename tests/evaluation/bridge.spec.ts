import { PassThrough } from 'node:stream'
import { afterEach, describe, expect, it } from 'vitest'
import { createTerminalBridge } from '../../scripts/evaluation/bridge.js'

type ExecRequest = {
  kind: 'exec'
  id: number
  command: string
  timeoutSec: number
}

type ResponseFrame =
  | {
      kind: 'result'
      id: number
      stdout: string
      stderr: string
      returnCode: number
    }
  | { kind: 'error'; id: number; message: string }

type Observed<T> =
  { state: 'resolved'; value: T } | { state: 'rejected'; error: unknown } | { state: 'pending' }

function observe<T>(promise: Promise<T>, milliseconds = 15): Promise<Observed<T>> {
  return Promise.race([
    promise.then(
      (value): Observed<T> => ({ state: 'resolved', value }),
      (error): Observed<T> => ({ state: 'rejected', error }),
    ),
    new Promise<Observed<T>>((resolve) =>
      setTimeout(() => resolve({ state: 'pending' }), milliseconds),
    ),
  ])
}

function createController() {
  const input = new PassThrough()
  const output = new PassThrough()
  const bridge = createTerminalBridge(input, output)
  let outputBuffer = ''
  const requests: ExecRequest[] = []
  const requestWaiters: Array<(request: ExecRequest) => void> = []

  output.on('data', (chunk: Buffer | string) => {
    outputBuffer += chunk.toString()
    while (true) {
      const newline = outputBuffer.indexOf('\n')
      if (newline < 0) break
      const line = outputBuffer.slice(0, newline)
      outputBuffer = outputBuffer.slice(newline + 1)
      const request = JSON.parse(line) as ExecRequest
      const waiter = requestWaiters.shift()
      if (waiter) waiter(request)
      else requests.push(request)
    }
  })

  return {
    input,
    output,
    bridge,
    nextRequest(): Promise<ExecRequest> {
      const request = requests.shift()
      if (request) return Promise.resolve(request)
      return new Promise((resolve) => requestWaiters.push(resolve))
    },
    respond(frame: ResponseFrame): void {
      input.write(`${JSON.stringify(frame)}\n`)
    },
  }
}

const controllers: ReturnType<typeof createController>[] = []

function controller() {
  const current = createController()
  controllers.push(current)
  return current
}

afterEach(() => {
  for (const current of controllers.splice(0)) current.bridge.close()
})

describe('evaluation terminal bridge', () => {
  it('routes out-of-order results only to the request with the matching id', async () => {
    const current = controller()
    const first = current.bridge.terminal('first command', 8)
    const second = current.bridge.terminal('second command', 13)
    const [firstRequest, secondRequest] = await Promise.all([
      current.nextRequest(),
      current.nextRequest(),
    ])

    expect(firstRequest).toMatchObject({
      kind: 'exec',
      command: 'first command',
      timeoutSec: 8,
    })
    expect(secondRequest).toMatchObject({
      kind: 'exec',
      command: 'second command',
      timeoutSec: 13,
    })
    expect(firstRequest.id).not.toBe(secondRequest.id)

    current.respond({
      kind: 'result',
      id: secondRequest.id,
      stdout: 'second stdout',
      stderr: 'second stderr',
      returnCode: 7,
    })
    await expect(second).resolves.toEqual({
      stdout: 'second stdout',
      stderr: 'second stderr',
      returnCode: 7,
    })

    current.respond({
      kind: 'result',
      id: firstRequest.id,
      stdout: 'first stdout',
      stderr: '',
      returnCode: 0,
    })
    await expect(first).resolves.toEqual({
      stdout: 'first stdout',
      stderr: '',
      returnCode: 0,
    })
  })

  it('never treats a diagnostic line or an unrelated response id as a successful result', async () => {
    const current = controller()
    const call = current.bridge.terminal('echo expected', 2)
    const request = await current.nextRequest()

    current.input.write('agent startup diagnostic\n')
    current.respond({
      kind: 'result',
      id: request.id + 1000,
      stdout: 'wrong request',
      stderr: '',
      returnCode: 0,
    })

    const beforeCorrectResponse = await observe(call)
    if (beforeCorrectResponse.state === 'resolved') {
      throw new Error('a non-correlated stdout line resolved the terminal call')
    }
    if (beforeCorrectResponse.state === 'rejected') {
      expect(String(beforeCorrectResponse.error)).toMatch(/protocol|json|line|id|response/i)
      return
    }

    current.respond({
      kind: 'result',
      id: request.id,
      stdout: 'expected',
      stderr: '',
      returnCode: 0,
    })
    await expect(call).resolves.toEqual({ stdout: 'expected', stderr: '', returnCode: 0 })
  })

  it('rejects a pending request when the controller stream ends', async () => {
    const current = controller()
    const call = current.bridge.terminal('wait for controller', 20)
    await current.nextRequest()

    current.input.end()

    await expect(call).rejects.toThrow(/closed|close|eof|ended|end|stream/i)
  })

  it('does not turn malformed JSON into a fabricated success or leave the request hanging', async () => {
    const current = controller()
    const call = current.bridge.terminal('wait for a valid frame', 20)
    await current.nextRequest()

    current.input.write('{ this is not JSON }\n')
    current.input.end()

    await expect(call).rejects.toThrow()
  })

  it('times out only the expired request and ignores its late response', async () => {
    const current = controller()
    const expired = current.bridge.terminal('slow command', 0.03)
    const expiredRequest = await current.nextRequest()
    await expect(expired).rejects.toThrow(/timeout|timed out/i)

    const next = current.bridge.terminal('fast command', 2)
    const nextRequest = await current.nextRequest()
    current.respond({
      kind: 'result',
      id: expiredRequest.id,
      stdout: 'late output',
      stderr: '',
      returnCode: 0,
    })
    current.respond({
      kind: 'result',
      id: nextRequest.id,
      stdout: 'fast output',
      stderr: '',
      returnCode: 0,
    })

    await expect(next).resolves.toEqual({ stdout: 'fast output', stderr: '', returnCode: 0 })
  })

  it('rejects an abort and rejects all pending work when closed', async () => {
    const current = controller()
    const abortController = new AbortController()
    const aborted = current.bridge.terminal('abort me', 10, abortController.signal)
    const abortRequest = await current.nextRequest()
    abortController.abort(new Error('caller cancelled'))
    await expect(aborted).rejects.toThrow(/abort|cancel/i)

    const pending = current.bridge.terminal('close me', 10)
    await current.nextRequest()
    current.bridge.close()
    await expect(pending).rejects.toThrow(/closed|close|shutdown/i)

    current.respond({
      kind: 'result',
      id: abortRequest.id,
      stdout: 'must not revive an aborted call',
      stderr: '',
      returnCode: 0,
    })
    await expect(current.bridge.terminal('after close', 1)).rejects.toThrow(
      /closed|close|shutdown/i,
    )
  })

  it('rejects an explicit tool error instead of synthesizing returnCode zero', async () => {
    const current = controller()
    const call = current.bridge.terminal('failing command', 3)
    const request = await current.nextRequest()

    current.respond({ kind: 'error', id: request.id, message: 'container exec failed' })

    await expect(call).rejects.toThrow('container exec failed')
  })
})
