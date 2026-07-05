import type { OTELCarrier } from '../../utils/traces'
import type { TestProject } from '../project'
import type { BrowserServerStateSession } from '../types/browser'
import { createDefer } from '@vitest/utils/helpers'

export class BrowserSessions {
  private sessions = new Map<string, BrowserServerStateSession>()
  private destroyTimers = new Map<string, NodeJS.Timeout>()

  public sessionIds: Set<string> = new Set()

  getSession(sessionId: string): BrowserServerStateSession | undefined {
    return this.sessions.get(sessionId)
  }

  destroySession(sessionId: string): void {
    this.cancelDestroySession(sessionId)
    this.sessions.delete(sessionId)
  }

  scheduleDestroySession(sessionId: string, timeout = 2_000): void {
    if (!this.sessions.has(sessionId) || this.destroyTimers.has(sessionId)) {
      return
    }

    const timer = setTimeout(() => {
      this.destroyTimers.delete(sessionId)
      this.sessions.delete(sessionId)
    }, timeout).unref()
    this.destroyTimers.set(sessionId, timer)
  }

  cancelDestroySession(sessionId: string): void {
    const timer = this.destroyTimers.get(sessionId)
    if (!timer) {
      return
    }
    clearTimeout(timer)
    this.destroyTimers.delete(sessionId)
  }

  createSession(
    sessionId: string,
    project: TestProject,
    pool: { reject: (error: Error) => void },
    options?: { otelCarrier?: OTELCarrier; url?: string },
  ): Promise<void> {
    // this promise waits until the orchestrator is ready to accept RPC calls
    const defer = createDefer<void>()
    let isConnected = false
    let isReady = false
    const timeout = setTimeout(() => {
      defer.reject(new Error(`Failed to connect to the browser session "${sessionId}" [${project.name}] within the timeout. connected=${isConnected}, ready=${isReady}, browser=${project.config.browser?.name ?? '<unknown>'}, url=${options?.url ?? '<unknown>'}.`))
    }, project.vitest.config.browser.connectTimeout ?? 60_000).unref()

    const resolveIfReady = () => {
      if (!isConnected || !isReady) {
        return
      }
      defer.resolve()
      clearTimeout(timeout)
    }

    this.sessions.set(sessionId, {
      project,
      otelCarrier: options?.otelCarrier,
      // assigned by the pool on the session's first run, freed when it disconnects
      concurrencyId: 0,
      connected: () => {
        this.cancelDestroySession(sessionId)
        isConnected = true
        resolveIfReady()
      },
      ready: () => {
        this.cancelDestroySession(sessionId)
        isReady = true
        resolveIfReady()
      },
      // this fails the whole test run and cancels the pool
      fail: (error: Error) => {
        defer.resolve()
        clearTimeout(timeout)
        pool.reject(error)
      },
    })
    return defer
  }
}
