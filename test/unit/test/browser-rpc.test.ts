import type { Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { createServer } from 'node:http'
import { MockerRegistry } from '@vitest/mocker'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import { WebSocket } from 'ws'
import { BROWSER_RPC_PROTOCOL } from '../../../packages/browser/src/constants'
import { setupBrowserRpc } from '../../../packages/browser/src/node/rpc'

let server: Server

beforeEach(async () => {
  server = createServer()
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
})

afterEach(async () => {
  await new Promise<void>((resolve, reject) => {
    server.close((error) => {
      if (error) {
        reject(error)
      }
      else {
        resolve()
      }
    })
  })
})

test('accepts browser RPC clients with the internal subprotocol', async () => {
  const { connect } = setupTestRpcServer()
  const ws = await connect(BROWSER_RPC_PROTOCOL)

  expect(ws.protocol).toBe(BROWSER_RPC_PROTOCOL)
  ws.close()
})

test('accepts legacy browser RPC clients without a subprotocol', async () => {
  const { connect } = setupTestRpcServer()
  const ws = await connect()

  expect(ws.protocol).toBe('')
  ws.close()
})

function setupTestRpcServer() {
  const connected = vi.fn()
  const scheduleDestroySession = vi.fn()
  const state = {
    testers: new Map(),
    orchestrators: new Map(),
  }
  const project = {
    config: {
      deps: {},
    },
    browser: {
      state,
      provider: {},
    },
  }
  const vitest = {
    config: {
      api: { token: '0' },
    },
    _browserSessions: {
      sessionIds: new Set(['session-id']),
      getSession: () => ({ connected }),
      scheduleDestroySession,
    },
    getProjectByName: () => project,
    onCancel: () => () => {},
    state: {
      catchError: vi.fn(),
    },
  }
  setupBrowserRpc({
    vite: {
      httpServer: server,
      config: {
        root: '/',
        cacheDir: '/node_modules/.vite',
      },
      moduleGraph: {
        getModuleById: vi.fn(),
      },
      pluginContainer: {
        resolveId: vi.fn(),
      },
    },
    vitest,
    removeCDPHandler: vi.fn(),
    ensureCDPHandler: vi.fn(),
    parseErrorStacktrace: vi.fn(() => []),
  } as any, new MockerRegistry())

  const { port } = server.address() as AddressInfo
  const url = `ws://127.0.0.1:${port}/__vitest_browser_api__?type=orchestrator&rpcId=session-id&sessionId=session-id&projectName=&method=run&token=0`

  return {
    connect(protocol?: string) {
      return new Promise<WebSocket>((resolve, reject) => {
        const ws = protocol ? new WebSocket(url, protocol) : new WebSocket(url)
        ws.on('open', () => resolve(ws))
        ws.on('error', reject)
      })
    },
    connected,
    scheduleDestroySession,
  }
}
