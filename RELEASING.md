# Releasing

How to release `@terros-inc/cli` and `@terros-inc/sdk` to npm, and how integration publishing differs.

A green **Publish to npm** run does not mean the release is live. The workflow uses npm staged publishing, so each
run only stages the version. Someone in the `terros-inc` npm organization has to approve it on npmjs.com before
anyone can install it.

## npm packages: `@terros-inc/cli` and `@terros-inc/sdk`

### 1. Bump the version

Change `version` in `cli/package.json` or `sdk/package.json`, open a PR, and merge it to `main` before you publish.
The workflow publishes whatever version is in the package's `package.json` on `main`. npm does not accept a version
that has already been published.

For the CLI, add the version's entry to `cli/CHANGELOG.md` in the same PR; that entry is the release notes. A change
that renames or removes commands is breaking: bump the major version and mark it **BREAKING**, listing each old →
new command name.

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
`https://docs.terros.com/openapi/terros.yml` and rebuilds, so the published CLI bundles the spec that is live when you
publish, not a copy committed to the repository. The CLI only falls back to that bundled copy when it cannot fetch the
live spec, so a new endpoint does not need a release; see
[New API endpoints](cli/README.md#new-api-endpoints).

### 3. Approve the staged version

When the run succeeds, the version is only **staged**. The end of the publish step's log looks like this:

```text
✅ Staged package @terros-inc/cli@1.0.25
+ @terros-inc/cli@1.0.25 (staged with id <stage id>)
```

A member of the `terros-inc` npm organization has to approve it. Open the package's versions page and approve the
staged version:

- CLI: https://www.npmjs.com/package/@terros-inc/cli?activeTab=versions
- SDK: https://www.npmjs.com/package/@terros-inc/sdk?activeTab=versions

Whoever runs the workflow (a person or a bot) must hand the approver this link, along with the package and version
that was staged. Until someone approves it,
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
