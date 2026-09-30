# Terros Connect

TypeScript SDK, CLI and integrations for the Terros Sales platform. pnpm workspace (`pnpm-workspace.yaml`):

- `sdk` - `@terros-inc/sdk`, API client and `wrapConnectHandler` for integration handlers
- `cli` - `@terros-inc/cli`, the `terros` command, including `terros connect publish`
- `packages/connect-common` - private shared package, a dependency of `sdk` and `cli`
- `integrations/*` - one Connect app each (airtable, docusign, gohighlevel, jobnimbus, salesforce, zoho)

## Setup and commands

- Node 24 (`.nvmrc`). Run `corepack enable` once so the pnpm version pinned in `package.json` (12.4.0) is used automatically. Verified with `corepack pnpm` install, lint, build and test.
- Install `pnpm install --frozen-lockfile`; lint `pnpm lint`; format `pnpm format` (oxfmt, config in `.oxfmtrc.json`).
- Build and test everything: `pnpm -r build`, `pnpm -r test` (CI runs lint, test, then build).
- One package: `pnpm --filter <package name> test` or run the script from its directory. Integration tests need the SDK built; their `pretest` does that.
- Type-check an integration with `pnpm exec tsc --noEmit` in its directory (its `build` script is `tsc`). There is no root type-check script.

## Integrations

Each `integrations/<name>` has `package.json`, `tsconfig.json`, `vitest.config.ts`, `src/` and `terros.json`. Use `integrations/gohighlevel` as the reference layout.

`terros.json` holds the `appId` and a `scripts` array. Each script declares `name`, `entrypoint`, `type`, `configSchema`, `authSchema`, `permissions` and optionally `slug`. Script types: `incoming` (webhook), `outgoing` (needs `dataType`), `scheduled` (needs `cron`). The schema is `cli/src/connect/configSchema.ts`.

Handlers are wrapped with `wrapConnectHandler` from `@terros-inc/sdk`, which supplies the Terros client.

Tests are vitest (globals on) in `src/*.test.ts` beside the code and cover pure helpers, not live API calls.

## Publishing

- An integration's version is its `package.json` `version`. Bump it before publishing; a version already deployed cannot be republished (the CLI errors). A version still in `draft` can be re-uploaded.
- Publish with `pnpm run publish` from the integration directory (plain `pnpm publish` is pnpm's own command), which runs `terros connect publish`. It bundles with rolldown and does not type-check, so run `tsc --noEmit` first.
- Merging to main does not publish. `publish-integrations.yml` is manual (`workflow_dispatch`) and its integration list is hardcoded, so a new integration must be added to it.
- `sdk` and `cli` publish to npm through the manual `publish.yml` workflow.
