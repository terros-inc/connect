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
- One package: `pnpm --filter <package name> test`, or run the script from its directory. `cli`'s `pretest` downloads the OpenAPI document (`pnpm fetch-openapi`, with `curl`) into the git-ignored `cli/terros.yml` when it is missing; rerun `pnpm fetch-openapi` there to refresh it. Only `integrations/gohighlevel` has a `pretest` that builds the SDK; build it first (`pnpm --filter @terros-inc/sdk... build`) before testing another integration that needs it.
- Type-check an integration with `pnpm exec tsc --noEmit` in its directory (its `build` script is `tsc`). There is no root type-check script.

## Engineering approach

Think ambitiously, build economically. Before settling on a design, picture what solving the problem properly would look like, then build the nearest step in that direction that fully solves today's problem. Prefer the design with the fewest concepts over the smallest patch, and don't add abstractions, configuration or infrastructure for a need that doesn't exist yet.

## Integrations

Each `integrations/<name>` has `package.json`, `tsconfig.json`, `vitest.config.ts`, `src/` and `terros.json`. Use `integrations/gohighlevel` as the reference layout.

`terros.json` holds the `appId` and a `scripts` array. Each script declares `name`, `entrypoint`, `type`, `configSchema`, `authSchema`, `permissions` and optionally `slug`. Script types: `incoming` (webhook), `outgoing` (needs `dataType`), `scheduled` (needs `cron`). The schema is `cli/src/connect/configSchema.ts`.

Handlers are wrapped with `wrapConnectHandler` from `@terros-inc/sdk`, which supplies the Terros client.

Tests are vitest (globals on) in `src/*.test.ts` beside the code and cover pure helpers, not live API calls. Only `gohighlevel` has tests so far.

## Testing

Test in proportion to risk, as the Terros-wide [testing policy](https://github.com/terros-inc/terros-wiki/blob/main/engineering/testing.md) says: logic, mapping and parsing of external payloads, auth, idempotency and retries, and a regression test with each bug fix.
Don't test simple data objects, pass-throughs, routine wiring, help or message wording, or a new schema field, and there is no coverage target.
Each nontrivial test should name the realistic bug it prevents. Extend an existing test, or add one behavioral test, rather than a new file of mocks.

## Publishing

- An integration's version is its `package.json` `version`. Bump it before publishing; a version already deployed cannot be republished (the CLI errors). A version still in `draft` can be re-uploaded.
- Integrations are published by the `publish-integrations.yml` workflow (`pnpm run publish` in the integration directory, i.e. `terros connect publish`), not from a developer machine. It bundles with rolldown and does not type-check, so run `tsc --noEmit` before merging.
- Merging to main does not publish. The workflow is manual (`workflow_dispatch`) and its integration list is hardcoded, so a new integration must be added to it.
- `sdk` and `cli` publish to npm through the manual `publish.yml` workflow. It only stages the version; a `terros-inc` npm org member must approve it on npmjs.com before it is live. See `RELEASING.md`.

## Customer data and confidentiality

This repository is public: anything pushed here, PR text and its edit history included, is permanent public record.

- Never put customer or company names, people's names, Terros IDs (`C.`, `U.`, `Program.`, `Account.` and so on), emails, phone numbers, addresses, internal Slack or Linear links to customer cases, or customer business details into code, tests, fixtures, docs, commit messages, branch names, PR titles or bodies, or review comments.
- Use synthetic placeholders (`C.example`, `user@example.test`, "Acme Solar") and describe a real case generically ("a customer's CRM sync sent a false alert"). A Linear issue's real case (company, people, IDs, config) stays in Linear.
- Check before you push: `git config core.hooksPath .githooks` turns on `scripts/check-public-data.mjs` as a pre-push hook, and the `Public data` workflow runs it on every PR's commits, branch name, title and body. It refuses Terros IDs, emails, phone numbers and the customer names in `PUBLIC_DATA_DENYLIST` (kept privately, never committed here); it does not catch everything above, so still read your diff and PR text. In CI only the default branch's copy of the check ever gets that secret: `public-data-trusted.yml`, a `pull_request_target` job that reads the PR's commits as data and skips fork PRs, while `public-data.yml` (`pull_request`) runs the PR's own copy with no secret (`scripts/public-data-workflow.test.mjs` asserts this). Never give the secret to a step that runs PR code.
- The check reads every commit's message, author and committer, added lines (binary files as text) and file paths (renames too), merge commits included (what a merge adds beyond git's own merge of its parents). It flags a Terros ID by this exact rule: a prefix `C`, `U`, `Program`, `Account`, `Role`, `Group` or `Team`, not after a letter, digit, `_` or `.`; then `.` or `:`; then a key of 4 or more letters, digits, `_` or `-`, not followed by `(`, that names no placeholder (example, placeholder, sample, fake, test, dummy) and has a digit or mixes case with two or more capitals. So `C.example`, `Role.manager`, `Role.ADMIN`, `Team.teamId` and `Program.Status` pass; an all-lowercase or all-capital key without a digit passes too.
- The script is a copy of terros-inc/sergeant `packages/runner/container/check-public-data.mjs`; change it there and copy it here unchanged.
