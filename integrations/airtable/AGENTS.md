# Airtable integration

This integration follows the standard layout: `package.json`, `tsconfig.json`, `vitest.config.ts`, `src/` and `terros.json`. Use `integrations/gohighlevel` as the reference layout.

`terros.json` holds the `appId` and scripts. Each script declares `name`, `entrypoint`, `type`, `configSchema`, `authSchema`, `permissions` and optionally `slug`. Script types are `incoming` (webhook), `outgoing` (needs `dataType`) and `scheduled` (needs `cron`); their schema is `cli/src/connect/configSchema.ts`.

Wrap handlers with `wrapConnectHandler` from `@terros-inc/sdk`; it supplies the Terros client. Tests use Vitest globals, live beside the code in `src/*.test.ts`, load workspace dependencies from source and must not call live vendor APIs. Follow the testing rules in the root `AGENTS.md`.

Type-check with `pnpm exec tsc --noEmit` here (`build` runs `tsc`). The integration version is the `package.json` version; bump it before publishing because a deployed version cannot be republished, while a draft can be re-uploaded. Publish only through the manual `publish-integrations.yml` workflow. It bundles without type-checking, merging does not publish, and its integration list is hardcoded.
