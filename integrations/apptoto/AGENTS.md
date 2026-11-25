# Apptoto integration

This package contains the Apptoto appointment sync and webhook handlers. Its standard Connect app layout is `package.json`, `tsconfig.json`, `vitest.config.ts`, `src/` and `terros.json`.

`terros.json` holds the app ID and script declarations. Keep the outgoing and incoming handlers' config schemas aligned where they share install settings. Apptoto API calls use HTTP Basic authentication with the configured username and API key against `https://api.apptoto.com`; incoming webhooks must validate the configured query token because Apptoto does not sign webhook requests.

Wrap handlers with `wrapConnectHandler` from `@terros-inc/sdk`. Tests use Vitest globals, live beside the code in `src/*.test.ts`, load workspace dependencies from source and must not call live Apptoto APIs. Follow the testing rules in the root `AGENTS.md`.

Type-check with `pnpm exec tsc --noEmit` here (`build` runs `tsc`). The integration version is the `package.json` version; bump it before publishing because a deployed version cannot be republished, while a draft can be re-uploaded. Publish only through the manual `publish-integrations.yml` workflow. Merging does not publish.
