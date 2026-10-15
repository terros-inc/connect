# Releasing

How to release `@terros-inc/cli` and `@terros-inc/sdk` to npm, how integration publishing differs, and how
`@terros-inc/mcp-core` reaches its other consumer without a release.

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

## `@terros-inc/mcp-core`: not published, pinned by commit

`packages/terros-mcp-core` is the one OpenAPI-to-MCP tool generator. It stays `private` and is never published to npm
or GitHub Packages.

- The CLI bundles it from the workspace (`workspace:^`), so `terros` and `terros mcp` always use the `mcp-core` on the
  same commit, and a CLI release needs nothing else.
- The hosted MCP service in `terros-inc/sales` (`apps/mcp`) installs it as a git dependency pinned to a commit on this
  repository's `main`: `github:terros-inc/connect#<commit sha>&path:packages/terros-mcp-core`. This repository is
  public, so no token is needed. How to bump that pin is in the Sales `apps/mcp/README.md`.

Two things in `packages/terros-mcp-core/package.json` exist only for that git install, so keep them:

- `dependencies` use plain semver ranges, not `catalog:`. pnpm resolves a git dependency's `dependencies` in the
  consumer's workspace, where this catalog does not exist. Keep them in step with the catalog in
  `pnpm-workspace.yaml`. `devDependencies` can stay `catalog:`.
- `prepack: pnpm build`. The repository does not commit `dist/`, so pnpm has to build the package when it installs it.
  pnpm runs `prepack` for a git dependency whose entry file is missing, after installing this workspace's dependencies.
  The consumer must allow that build (Sales lists the pinned spec in `allowBuilds`).

Pin only commits on `main`. A branch commit can disappear when the branch is deleted or force-pushed.

### Breaking changes

A change is breaking when it removes or renames an export (`parseEndpoints`, `loadEndpoints`, `createMcpServer`,
`buildTools` and their types), changes a function's options, or changes generated tool names or input schemas, since
MCP clients store tool names.

1. Make the change in `packages/terros-mcp-core` and adapt the CLI in the same PR, so `main` always has one
   implementation that the CLI uses. Say in the PR that it breaks the Sales consumer.
2. Merge it. Sales is not affected: it keeps its pinned commit.
3. In one Sales PR, move the pin to the new `main` commit, update `pnpm-lock.yaml`, adapt `apps/mcp`, and let Sales CI
   build and test it. To roll back, revert that Sales PR; the old commit is still on `main`.

Never copy `mcp-core` into Sales to ship a fix sooner. Merge the fix here and move the Sales pin.

### OpenAPI documents are not part of `mcp-core`

The Sales API owns the OpenAPI documents. `mcp-core` contains no spec, so a spec change never needs an `mcp-core`
change or a new Sales pin, and moving the pin never changes which endpoints exist.

- CLI: `terros` and `terros mcp` read the `terros.yml` bundled at publish time (`prepack` downloads
  `https://docs.terros.com/openapi/terros.yml`), or the internal document from the API for staff. A new public endpoint
  reaches CLI users with the next CLI release.
- Hosted MCP service: the Sales service passes the OpenAPI document to `mcp-core`, so the document comes from the Sales
  repository and its deploys, not from this one.

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
