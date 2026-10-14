# Terros Connect

TypeScript SDK, CLI and integrations for the Terros Sales platform. pnpm workspace (`pnpm-workspace.yaml`):

- `sdk` - `@terros-inc/sdk`, API client and `wrapConnectHandler` for integration handlers
- `cli` - `@terros-inc/cli`, the `terros` command, including `terros connect publish`
- `packages/connect-common` - private shared package, a dependency of `sdk` and `cli`
- `integrations/*` - one Connect app each (airtable, docusign, gohighlevel, jobnimbus, salesforce, zoho)

## Setup and commands

- Node 24 (`.nvmrc`). The pnpm version is pinned in `package.json`.
- Install `pnpm install --frozen-lockfile`; lint `pnpm lint`; format `pnpm format` (oxfmt, config in `.oxfmtrc.json`).
- Build and test everything: `pnpm -r build`, `pnpm -r test` (CI runs lint, test, then build).
- One package: `pnpm --filter <package name> test`, or run the script from its directory. Only `integrations/gohighlevel` has a `pretest` that builds the SDK; build it first (`pnpm --filter @terros-inc/sdk... build`) before testing another integration that needs it.
- Type-check an integration with `pnpm exec tsc --noEmit` in its directory (its `build` script is `tsc`). There is no root type-check script.

## Integrations

Each `integrations/<name>` has `package.json`, `tsconfig.json`, `vitest.config.ts`, `src/` and `terros.json`. Use `integrations/gohighlevel` as the reference layout.

`terros.json` holds the `appId` and a `scripts` array. Each script declares `name`, `entrypoint`, `type`, `configSchema`, `authSchema`, `permissions` and optionally `slug`. Script types: `incoming` (webhook), `outgoing` (needs `dataType`), `scheduled` (needs `cron`). The schema is `cli/src/connect/configSchema.ts`.

Handlers are wrapped with `wrapConnectHandler` from `@terros-inc/sdk`, which supplies the Terros client.

Tests are vitest (globals on) in `src/*.test.ts` beside the code and cover pure helpers, not live API calls. Only `gohighlevel` has tests so far.

## Publishing

- An integration's version is its `package.json` `version`. Bump it before publishing; a version already deployed cannot be republished (the CLI errors). A version still in `draft` can be re-uploaded.
- Integrations are published by the `publish-integrations.yml` workflow (`pnpm run publish` in the integration directory, i.e. `terros connect publish`), not from a developer machine. It bundles with rolldown and does not type-check, so run `tsc --noEmit` before merging.
- Merging to main does not publish. The workflow is manual (`workflow_dispatch`) and its integration list is hardcoded, so a new integration must be added to it.
- `sdk` and `cli` publish to npm through the manual `publish.yml` workflow. It only stages the version; a `terros-inc` npm org member must approve it on npmjs.com before it is live. See `RELEASING.md`.

## Customer data and confidentiality

- Never put real customer names, emails, domains, IDs, configurations, or any other PII or confidential data in code, fixtures, documentation, examples, commit messages, branch names, PR titles, or PR bodies.
- Use unmistakably fictional placeholders instead, such as `Acme Solar`, addresses under `example.test`, and generic IDs and configuration values.
- Before committing, search the entire repository for customer identifiers and replace every occurrence with neutral placeholder data.
