import type { TestProject } from 'vitest/node'
import type { FileSpecification } from '../../../packages/vitest/src/runtime/runner/types'
import { describe, expect, test, vi } from 'vitest'
import { BrowserPool } from '../../../packages/vitest/src/node/pools/browser'

interface Deferred<T = void> {
  promise: Promise<T>
  resolve: (value?: T | PromiseLike<T>) => void
  reject: (error: unknown) => void
}

function deferred<T = void>(): Deferred<T> {
  let resolve!: (value?: T | PromiseLike<T>) => void
  let reject!: (error: unknown) => void
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise as (value?: T | PromiseLike<T>) => void
    reject = rejectPromise
  })
  return { promise, resolve, reject }
}

async function tick() {
  await Promise.resolve()
  await Promise.resolve()
}

function files(count: number): FileSpecification[] {
  return Array.from({ length: count }, (_, index) => ({
    filepath: `/test-${index}.test.ts`,
  }))
}

function createBrowserProject(readySessionIds: string[] = []) {
  const orchestrators = new Map<string, any>()
  const testerRuns = new Map<string, Deferred[]>()
  const sessions = new Map<string, { concurrencyId: number }>()
  const openRequests: (Deferred & { sessionId: string })[] = []
  let activeOpenPages = 0
  let maxActiveOpenPages = 0

  function addSession(sessionId: string) {
    const runs: Deferred[] = []
    testerRuns.set(sessionId, runs)
    sessions.set(sessionId, { concurrencyId: 0 })

    const orchestrator = {
      createTesters: vi.fn(() => {
        const run = deferred()
        runs.push(run)
        return run.promise
      }),
      cleanupTesters: vi.fn(() => Promise.resolve()),
      $close: vi.fn(),
    }
    orchestrators.set(sessionId, orchestrator)
    return orchestrator
  }

  for (const sessionId of readySessionIds) {
    addSession(sessionId)
  }

  const openPage = vi.fn((sessionId: string) => {
    activeOpenPages += 1
    maxActiveOpenPages = Math.max(maxActiveOpenPages, activeOpenPages)

    const request = deferred() as Deferred & { sessionId: string }
    request.sessionId = sessionId
    const resolve = request.resolve
    const reject = request.reject

    request.resolve = (value) => {
      activeOpenPages -= 1
      addSession(sessionId)
      resolve(value)
    }
    request.reject = (error) => {
      activeOpenPages -= 1
      reject(error)
    }
    openRequests.push(request)
    return request.promise
  })

  const project = {
    name: 'browser',
    config: {
      browser: {
        isolate: true,
        sessionStartupConcurrency: undefined,
      },
      inspector: {
        waitForDebugger: false,
      },
    },
    browser: {
      provider: {
        name: 'test',
      },
      state: {
        orchestrators,
      },
    },
    _browserReadySessions: new Set(readySessionIds),
    vitest: {
      isCancelling: false,
      _browserSessions: {
        sessionIds: new Set<string>(),
        getSession: (sessionId: string) => sessions.get(sessionId),
      },
      _traces: {
        startContextSpan: () => ({
          span: {
            setAttributes: vi.fn(),
            end: vi.fn(),
          },
          context: {},
        }),
        getContextCarrier: vi.fn(),
        $: vi.fn((_name: string, _options: unknown, callback: () => unknown) => callback()),
      },
    },
    getProvidedContext: () => ({}),
    _openBrowserPage: openPage,
  } as unknown as TestProject

  return {
    project,
    addSession,
    getMaxActiveOpenPages: () => maxActiveOpenPages,
    openPage,
    openRequests,
    orchestrators,
    testerRuns,
  }
}

describe('BrowserPool', () => {
  test('limits concurrent session startup and waits for completed work before ramping', async () => {
    const context = createBrowserProject()
    const pool = new BrowserPool(context.project, {
      maxWorkers: 4,
      sessionStartupConcurrency: 2,
    })

    const runPromise = pool.runTests('run', files(5))
    await tick()

    expect(context.openPage).toHaveBeenCalledTimes(2)

    context.openRequests[0].resolve()
    context.openRequests[1].resolve()
    await tick()
    expect(context.openPage).toHaveBeenCalledTimes(2)
    expect([...context.testerRuns.values()].reduce((count, runs) => count + runs.length, 0)).toBe(2)

    const resolvedRuns = new Set<Deferred>()
    const firstRun = [...context.testerRuns.values()][0][0]
    resolvedRuns.add(firstRun)
    firstRun.resolve()
    await tick()

    expect(context.openPage).toHaveBeenCalledTimes(4)
    expect(context.getMaxActiveOpenPages()).toBe(2)

    context.openRequests[2].resolve()
    context.openRequests[3].resolve()
    await tick()

    expect([...context.testerRuns.values()].reduce((count, runs) => count + runs.length, 0)).toBe(5)
    for (const runs of context.testerRuns.values()) {
      for (const run of runs) {
        if (!resolvedRuns.has(run)) {
          resolvedRuns.add(run)
          run.resolve()
        }
      }
    }

    await expect(runPromise).resolves.toBeUndefined()
  })

  test('waits for opening sessions before resolving', async () => {
    const context = createBrowserProject(['ready'])
    const readyOrchestrator = context.orchestrators.get('ready')
    const pool = new BrowserPool(context.project, {
      maxWorkers: 2,
      sessionStartupConcurrency: 1,
    })
    let resolved = false

    const runPromise = pool.runTests('run', files(2)).then(() => {
      resolved = true
    })
    await tick()

    expect(readyOrchestrator.createTesters).toHaveBeenCalledTimes(1)
    expect(context.openPage).toHaveBeenCalledTimes(1)

    context.testerRuns.get('ready')![0].resolve()
    await tick()
    expect(readyOrchestrator.createTesters).toHaveBeenCalledTimes(2)

    context.testerRuns.get('ready')![1].resolve()
    await tick()
    expect(resolved).toBe(false)

    context.openRequests[0].resolve()
    await runPromise
    expect(resolved).toBe(true)
  })

  test('rejects when a session fails to open', async () => {
    const context = createBrowserProject()
    const pool = new BrowserPool(context.project, {
      maxWorkers: 2,
      sessionStartupConcurrency: 1,
    })
    const error = new Error('failed to open')
    const runPromise = pool.runTests('run', files(1))
    await tick()

    const rejection = expect(runPromise).rejects.toThrow(error)
    context.openRequests[0].reject(error)

    await rejection
  })
})
