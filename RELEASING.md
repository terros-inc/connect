# Releasing

How to release `@terros-inc/cli`, `@terros-inc/sdk` and `@terros-inc/mcp-core` to npm, and how integration publishing differs.

A green **Publish to npm** run does not mean the release is live. The workflow uses npm staged publishing, so each
run only stages the version. Someone in the `terros-inc` npm organization has to approve it on npmjs.com before
anyone can install it.

## npm packages: `@terros-inc/cli` and `@terros-inc/sdk`

### 1. Bump the version

Change `version` in `cli/package.json` or `sdk/package.json`, open a PR, and merge it to `main` before you publish.
The workflow publishes whatever version is in the package's `package.json` on `main`. npm does not accept a version
that has already been published.

### 2. Run the Publish to npm workflow

In GitHub, go to **Actions → Publish to npm** (`.github/workflows/publish.yml`), click **Run workflow**, choose the
`main` branch, and pick the package: `sdk` or `cli`. The default is `sdk`, so change it when you release the CLI.

The workflow only publishes from `main`:

- The job has `if: github.ref == 'refs/heads/main'`. If you start it from another branch the job is **skipped**, not
  failed, and nothing is published.
- The job runs in the `npm` GitHub environment, which only allows deployments from `main`.

The job installs dependencies, runs `pnpm -r build`, and then runs `pnpm stage publish --provenance` in the package
directory. It does not run lint or tests (the Compile workflow runs those on PRs and on `main`). It does not create a
git tag or a GitHub release.

The workflow uses npm trusted publishing: it gets an OIDC token from GitHub (`id-token: write`), so there is no npm
token secret. `--provenance` attaches a signed provenance statement to the package.

The package's `prepack` script runs during publish. For the CLI, `prepack` downloads the current OpenAPI spec from
`https://docs.terros.com/openapi/terros.yml` and rebuilds, so the published CLI's API commands match the spec that is
live when you publish, not a copy committed to the repository.

### 3. Approve the staged version

When the run succeeds, the version is only **staged**. The end of the publish step's log looks like this:

```text
✅ Staged package @terros-inc/cli@1.0.25
+ @terros-inc/cli@1.0.25 (staged with id <stage id>)
```

A member of the `terros-inc` npm organization has to approve it. On [npmjs.com](https://www.npmjs.com), open your
account's **Settings → Staged packages**, find the package and version, and approve it. Until someone approves it,
`npm view @terros-inc/cli version` still shows the previous version.

### 4. Verify the release

After approval, check that the new version is live:

```sh
npm view @terros-inc/cli version      # or @terros-inc/sdk
npm install -g @terros-inc/cli@<version>
terros --version
```

For the SDK, `npm view @terros-inc/sdk version` is enough. Both packages publish under the `latest` dist-tag
(`publishConfig.tag`).

### 5. Approver access

Approvers are members of the `terros-inc` npm organization. Membership is managed in that organization's member
settings on npmjs.com. Ask an organization owner if you need access.

## `@terros-inc/mcp-core`

`packages/terros-mcp-core` is the one OpenAPI-to-MCP tool generator. The CLI bundles it from the workspace
(`workspace:^`), so a CLI release never needs an `mcp-core` release. The hosted MCP service in `terros-inc/sales`
cannot import this workspace, so it installs a published version and pins it exactly.

Release it with the same steps as the CLI and SDK: bump `version` in `packages/terros-mcp-core/package.json`, merge to
`main`, run **Publish to npm** with the package `packages/terros-mcp-core`, approve the staged version, then check
`npm view @terros-inc/mcp-core version`. Its `prepack` only builds; it does not download a spec.

### Versioning and breaking changes

Use semver on the package's exports (`parseEndpoints`, `loadEndpoints`, `createMcpServer`, `buildTools` and their
types) and on the tools they generate. A change is breaking (major version) when it removes or renames an export,
changes a function's options, or changes generated tool names or input schemas, because MCP clients store tool names.

1. Make the change in `packages/terros-mcp-core` and adapt the CLI in the same PR, so `main` always has one
   implementation that the CLI uses.
2. Bump the major version and publish. The CLI can be released whenever it is ready; the order does not matter.
3. Sales keeps its exact pin until someone upgrades it in a Sales PR: change the version, update `pnpm-lock.yaml`,
   adapt `apps/mcp`, and let Sales CI build and test it. Sales then deploys through its own pipeline. To roll back,
   revert that Sales PR; the old version stays on npm.

Never fork or copy `mcp-core` into Sales to get a fix out sooner: publish a patch version and bump the Sales pin.

### OpenAPI documents are not part of `mcp-core` releases

The Sales API owns the OpenAPI documents. `mcp-core` contains no spec, so a spec change never needs an `mcp-core`
release, and an `mcp-core` release never changes which endpoints exist.

- CLI: `terros` and `terros mcp` read the `terros.yml` bundled at publish time (`prepack` downloads the live
  `https://docs.terros.com/openapi/terros.yml`), or the internal document from the API for staff. A new public endpoint
  reaches CLI users with the next CLI release.
- Hosted MCP service (Sales `apps/mcp`): loads the documents from the API at runtime, so a Sales API deploy is enough.

## Integrations: `publish-integrations.yml`

Integrations under `integrations/*` do **not** follow the npm process. They are published to the Terros platform,
not to npm, and there is no staging or approval step.

- In GitHub, go to **Actions → Publish Integrations** (`.github/workflows/publish-integrations.yml`), run it on
  `main`, and pick the integration.
- The workflow builds the workspace and runs `pnpm run publish` (`terros connect publish`) in the integration's
  directory. It uses the workspace's own CLI, not the version on npm, so you do not need an npm release first.
- It authenticates with the `TERROS_API_KEY` secret in the `terros` GitHub environment. That environment only allows
  deployments from `main`, so a run from another branch fails.
- The version is the integration's `package.json` `version`. A successful run marks that version `deployed`
  straight away. A version that is already deployed cannot be published again, so bump the version first. A version
  left in `draft` (for example after a failed run) can be published again.
- The list of integrations is hardcoded in the workflow, so a new integration has to be added to it.
