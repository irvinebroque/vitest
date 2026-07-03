# @vitest/browser-playwright

[![NPM version](https://img.shields.io/npm/v/@vitest/browser-playwright?color=a1b858&label=)](https://npmx.dev/package/@vitest/browser-playwright)

Run your Vitest [browser tests](https://vitest.dev/guide/browser/) using [playwright](https://playwright.dev/docs/api/class-playwright) API. Note that Vitest does not use playwright as a test runner, but only as a browser provider.

We recommend using this package if you are already using playwright in your project or if you do not have any E2E tests yet.

## Installation

Install the package with your favorite package manager:

```sh
npm install -D @vitest/browser-playwright
# or
yarn add -D @vitest/browser-playwright
# or
pnpm add -D @vitest/browser-playwright
```

Then specify it in the `browser.provider` field of your Vitest configuration:

```ts
// vitest.config.ts
import { defineConfig } from 'vitest/config'
import { playwright } from '@vitest/browser-playwright'

export default defineConfig({
  test: {
    browser: {
      provider: playwright({
        // ...custom playwright options
      }),
      instances: [
        { browser: 'chromium' },
      ],
    },
  },
})
```

Then run Vitest in the browser mode:

```sh
npx vitest --browser
```

## Connecting To Remote Browsers

`connectOptions` connects to a browser over Playwright's own protocol and is passed to [`browserType.connect`](https://playwright.dev/docs/api/class-browsertype#browser-type-connect). Vitest forwards `launchOptions` to compatible Playwright servers through the `x-playwright-launch-options` header, matching Playwright's remote launch-server flow.

```ts
import { playwright } from '@vitest/browser-playwright'
import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    browser: {
      provider: playwright({
        connectOptions: {
          wsEndpoint: 'ws://127.0.0.1:9898',
        },
      }),
      instances: [{ browser: 'chromium' }],
    },
  },
})
```

`connectOverCDPOptions` connects to an existing Chromium browser over the Chrome DevTools Protocol and is passed to [`chromium.connectOverCDP`](https://playwright.dev/docs/api/class-browsertype#browser-type-connect-over-cdp). CDP is Chromium-only. `launchOptions` do not apply to CDP connections because Vitest is attaching to a browser that is already running.

```ts
import { playwright } from '@vitest/browser-playwright'
import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    browser: {
      provider: playwright({
        connectOverCDPOptions: {
          wsEndpoint: 'wss://example.com/devtools/browser',
          headers: {
            Authorization: `Bearer ${process.env.API_TOKEN}`,
          },
          timeout: 30_000,
        },
      }),
      instances: [{ browser: 'chromium' }],
    },
  },
})
```

Remote browsers sometimes cannot reach the local Vitest runner URL. Use `runner.resolveUrl` to rewrite the navigation URL, and `runner.waitForReady` to wait for the original runner URL or any tunnel/proxy before navigation.

```ts
provider: playwright({
  connectOverCDPOptions: {
    wsEndpoint: 'wss://example.com/devtools/browser',
  },
  runner: {
    resolveUrl: async ({ url }) => publicRunnerUrl(url),
    waitForReady: async ({ url }) => waitForLocalRunner(url),
  },
})
```

Some CDP services expose only a default browser context and reject `browser.newContext()`. Set `contextStrategy: 'reuse-default-on-failure'` to reuse `browser.contexts()[0]` when new context creation fails.

```ts
provider: playwright({
  connectOverCDPOptions: {
    wsEndpoint: 'wss://example.com/devtools/browser',
  },
  contextStrategy: 'reuse-default-on-failure',
})
```

[GitHub](https://github.com/vitest-dev/vitest/tree/main/packages/browser-playwright) | [Documentation](https://vitest.dev/config/browser/playwright)
