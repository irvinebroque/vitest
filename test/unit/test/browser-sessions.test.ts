import type { TestProject } from 'vitest/node'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { BrowserSessions } from '../../../packages/vitest/src/node/browser/sessions'

function createProject(connectTimeout = 100) {
  return {
    name: 'browser',
    config: {
      browser: {
        name: 'chromium',
      },
    },
    vitest: {
      config: {
        browser: { connectTimeout },
      },
    },
  } as TestProject
}

describe('BrowserSessions', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  test('resolves only after the session is connected and ready', async () => {
    const sessions = new BrowserSessions()
    const promise = sessions.createSession('session-id', createProject(), { reject() {} })
    const session = sessions.getSession('session-id')
    expect(session).toBeDefined()

    let resolved = false
    promise.then(() => {
      resolved = true
    })

    session!.ready()
    expect(resolved).toBe(false)

    session!.connected()
    await promise
    expect(resolved).toBe(true)
  })

  describe('timeouts and failures', () => {
    test('times out if the session connects but never becomes ready', async () => {
      const sessions = new BrowserSessions()
      const promise = sessions.createSession('session-id', createProject(), { reject() {} }, { url: 'http://localhost/__vitest_test__/?sessionId=session-id' })

      const session = sessions.getSession('session-id')
      expect(session).toBeDefined()

      const timeoutError = expect(promise).rejects.toThrowError(
        'Failed to connect to the browser session "session-id" [browser] within the timeout. connected=true, ready=false, browser=chromium, url=http://localhost/__vitest_test__/?sessionId=session-id.',
      )

      session!.connected()
      await vi.advanceTimersByTimeAsync(101)

      await timeoutError
    })

    test('times out if the session never connects', async () => {
      const sessions = new BrowserSessions()
      const promise = sessions.createSession('session-id', createProject(), { reject() {} })

      const timeoutError = expect(promise).rejects.toThrowError(
        'Failed to connect to the browser session "session-id" [browser] within the timeout. connected=false, ready=false, browser=chromium, url=<unknown>.',
      )

      await vi.advanceTimersByTimeAsync(101)

      await timeoutError
    })

    test('keeps a disconnected session available during the reconnect grace period', async () => {
      const sessions = new BrowserSessions()
      sessions.createSession('session-id', createProject(), { reject() {} }).catch(() => {})

      sessions.scheduleDestroySession('session-id', 100)
      await vi.advanceTimersByTimeAsync(99)
      expect(sessions.getSession('session-id')).toBeDefined()

      sessions.getSession('session-id')!.connected()
      await vi.advanceTimersByTimeAsync(1)
      expect(sessions.getSession('session-id')).toBeDefined()
    })

    test('destroys a disconnected session after the reconnect grace period', async () => {
      const sessions = new BrowserSessions()
      sessions.createSession('session-id', createProject(), { reject() {} }).catch(() => {})

      sessions.scheduleDestroySession('session-id', 100)
      await vi.advanceTimersByTimeAsync(100)

      expect(sessions.getSession('session-id')).toBeUndefined()
    })

    test('fails the pool without waiting for the connect timeout', async () => {
      const sessions = new BrowserSessions()
      const poolReject = vi.fn()
      const promise = sessions.createSession('session-id', createProject(), { reject: poolReject })

      const session = sessions.getSession('session-id')
      expect(session).toBeDefined()

      const error = new Error('browser failed')
      session!.fail(error)

      await expect(promise).resolves.toBeUndefined()
      expect(poolReject).toHaveBeenCalledExactlyOnceWith(error)

      await vi.advanceTimersByTimeAsync(101)
      expect(poolReject).toHaveBeenCalledTimes(1)
    })
  })
})
