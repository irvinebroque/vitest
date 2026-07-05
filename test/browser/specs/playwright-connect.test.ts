import type { TestContext } from 'vitest'
import { fileURLToPath } from 'node:url'
import { playwright } from '@vitest/browser-playwright'
import { x } from 'tinyexec'
import { expect, test } from 'vitest'
import { Cli } from '../../test-utils/cli'
import { provider } from '../settings'
import { runBrowserTests, runInlineBrowserTests } from './utils'

let cdpPort = 9899

async function launchCdpBrowser(onTestFinished: TestContext['onTestFinished']) {
  const { chromium } = await import('playwright')
  const port = cdpPort++
  const browser = await chromium.launch({
    headless: true,
    args: [
      `--remote-debugging-port=${port}`,
      '--remote-debugging-address=127.0.0.1',
    ],
  })
  onTestFinished(async () => {
    await browser.close().catch(() => {})
  })
  return `http://127.0.0.1:${port}`
}

const basicTest = {
  'basic.test.ts': `
    import { expect, test } from 'vitest'

    test('runs in chromium via cdp', () => {
      expect(document.createElement('div') instanceof HTMLDivElement).toBe(true)
    })
  `,
}

test.runIf(provider.name === 'playwright')('[playwright] runs in connect mode', async ({ onTestFinished }) => {
  const cliPath = fileURLToPath(new URL('./cli.js', import.meta.resolve('@playwright/test')))
  const subprocess = x(process.execPath, [
    cliPath,
    'run-server',
    '--port',
    '9898',
    '--host',
    '127.0.0.1',
    '--unsafe',
  ]).process
  const cli = new Cli({
    stdin: subprocess.stdin,
    stdout: subprocess.stdout,
    stderr: subprocess.stderr,
  })
  let setDone: (value?: unknown) => void
  const isDone = new Promise(resolve => (setDone = resolve))
  subprocess.on('exit', () => setDone())
  onTestFinished(async () => {
    subprocess.kill('SIGILL')
    await isDone
  })

  await cli.waitForStdout('Listening on ws://127.0.0.1:9898')

  const result = await runBrowserTests(
    {
      root: './fixtures/playwright-connect',
      browser: {
        instances: [
          {
            browser: 'chromium',
            name: 'chromium',
            provider: playwright({
              connectOptions: {
                wsEndpoint: 'ws://127.0.0.1:9898',
              },
              launchOptions: {
                args: [`--user-agent=VitestLaunchOptionsTester`],
              },
            }),
          },
        ],
      },
    },
    ['basic.test.js'],
  )

  expect(result.stderr).toMatchInlineSnapshot(`""`)
  expect(result.errorTree()).toMatchInlineSnapshot(`
    {
      "basic.test.js": {
        "[playwright] Run basic test in browser via connect mode": "passed",
        "[playwright] Run browser-only test in browser via connect mode": "passed",
        "[playwright] applies launch options from connect header": "passed",
      },
    }
  `)
})

test.runIf(provider.name === 'playwright')('[playwright] runs in connectOverCDP mode', async ({ onTestFinished }) => {
  const wsEndpoint = await launchCdpBrowser(onTestFinished)

  const result = await runInlineBrowserTests(
    basicTest,
    {
      browser: {
        provider: playwright({
          connectOverCDPOptions: {
            wsEndpoint,
          },
        }),
        instances: [{ browser: 'chromium' }],
      },
    },
  )

  expect(result.stderr).toMatchInlineSnapshot(`""`)
  expect(result.testTree()).toMatchInlineSnapshot(`
    {
      "basic.test.ts": {
        "runs in chromium via cdp": "passed",
      },
    }
  `)
})

test.runIf(provider.name === 'playwright')('[playwright] rejects connectOverCDP for non-chromium browsers', async () => {
  const result = await runInlineBrowserTests(
    basicTest,
    {
      browser: {
        provider: playwright({
          connectOverCDPOptions: {
            wsEndpoint: 'http://127.0.0.1:1',
          },
        }),
        instances: [{ browser: 'firefox' }],
      },
    },
    { fails: true },
  )

  expect(result.stderr.match(/connectOverCDPOptions can only be used with the chromium browser\./)?.[0]).toMatchInlineSnapshot(`"connectOverCDPOptions can only be used with the chromium browser."`)
})

test.runIf(provider.name === 'playwright')('[playwright] rejects connectOptions with connectOverCDPOptions', async () => {
  const result = await runInlineBrowserTests(
    basicTest,
    {
      browser: {
        provider: playwright({
          connectOptions: {
            wsEndpoint: 'ws://127.0.0.1:1',
          },
          connectOverCDPOptions: {
            wsEndpoint: 'http://127.0.0.1:1',
          },
        }),
        instances: [{ browser: 'chromium' }],
      },
    },
    { fails: true },
  )

  expect(result.stderr.match(/Cannot use both connectOptions and connectOverCDPOptions\./)?.[0]).toMatchInlineSnapshot(`"Cannot use both connectOptions and connectOverCDPOptions."`)
})

test.runIf(provider.name === 'playwright')('[playwright] applies runner hooks before navigation', async ({ onTestFinished }) => {
  const wsEndpoint = await launchCdpBrowser(onTestFinished)
  const events: string[] = []

  const result = await runInlineBrowserTests(
    {
      'runner-url.test.ts': `
        import { expect, test } from 'vitest'

        test('receives the resolved runner url', () => {
          const params = new URL(window.top!.location.href).searchParams
          expect([params.get('resolved'), params.get('ready')]).toMatchInlineSnapshot(\`
            [
              "true",
              "true",
            ]
          \`)
        })
      `,
    },
    {
      browser: {
        provider: playwright({
          connectOverCDPOptions: {
            wsEndpoint,
          },
          runner: {
            async waitForReady(context) {
              events.push(`wait:${context.browserName}:${context.parallel}:${context.url.includes('/__vitest_test__/')}`)
              await new Promise(resolve => setTimeout(resolve, 10))
              events.push('ready')
            },
            resolveUrl(context) {
              events.push(`resolve:${context.browserName}:${events.includes('ready')}:${context.sessionId.length > 0}`)
              const url = new URL(context.url)
              url.searchParams.set('resolved', 'true')
              url.searchParams.set('ready', String(events.includes('ready')))
              return url.toString()
            },
          },
        }),
        instances: [{ browser: 'chromium' }],
      },
    },
  )

  expect(result.stderr).toMatchInlineSnapshot(`""`)
  expect(result.testTree()).toMatchInlineSnapshot(`
    {
      "runner-url.test.ts": {
        "receives the resolved runner url": "passed",
      },
    }
  `)
  expect(events).toMatchInlineSnapshot(`
    [
      "wait:chromium:false:true",
      "ready",
      "resolve:chromium:true:true",
    ]
  `)
})

test.runIf(provider.name === 'playwright')('[playwright] can reuse the default CDP context when newContext fails', async ({ onTestFinished }) => {
  const wsEndpoint = await launchCdpBrowser(onTestFinished)

  const result = await runInlineBrowserTests(
    {
      'first.test.ts': `
        import { expect, test } from 'vitest'

        test('runs in the first page', () => {
          expect(document.body instanceof HTMLBodyElement).toBe(true)
        })
      `,
      'second.test.ts': `
        import { expect, test } from 'vitest'

        test('runs in the second page', () => {
          expect(document.body instanceof HTMLBodyElement).toBe(true)
        })
      `,
    },
    {
      maxWorkers: 2,
      browser: {
        fileParallelism: true,
        provider: playwright({
          connectOverCDPOptions: {
            wsEndpoint,
          },
          contextOptions: {
            storageState: './missing-storage-state.json',
          },
          contextStrategy: 'reuse-default-on-failure',
        }),
        instances: [{ browser: 'chromium' }],
      },
    },
  )

  expect(result.stderr).toMatchInlineSnapshot(`""`)
  expect(result.testTree()).toMatchInlineSnapshot(`
    {
      "first.test.ts": {
        "runs in the first page": "passed",
      },
      "second.test.ts": {
        "runs in the second page": "passed",
      },
    }
  `)
})
