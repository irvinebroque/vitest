import { expect, test } from 'vitest'
import { instances, runInlineBrowserTests } from './utils'

test('marks browser RPC websocket with the internal subprotocol', async () => {
  const result = await runInlineBrowserTests(
    {
      'rpc-protocol.test.ts': `
        import { client } from '@vitest/browser/client'
        import { expect, test } from 'vitest'

        test('uses the browser RPC protocol', () => {
          expect(client.ws.protocol).toBe('vitest-browser-rpc')
        })
      `,
    },
    {
      browser: {
        instances: [instances[0]],
      },
    },
  )

  expect(result.stderr).toBe('')
  expect(result.testTree()).toMatchInlineSnapshot(`
    {
      "rpc-protocol.test.ts": {
        "uses the browser RPC protocol": "passed",
      },
    }
  `)
})
