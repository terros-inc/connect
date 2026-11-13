# Terros CLI

Command-line interface for the Terros Sales platform.

## Requirements

- Node.js 24 or newer
- A Terros account with access to the platform

## Install

Install the CLI globally with your package manager:

```sh
npm install -g @terros-inc/cli
```

After installation, verify that the `terros` command is available:

```sh
terros help
```

Print the installed CLI version with:

```sh
terros -v
```

## Sign In

Authenticate before running Terros API commands:

```sh
terros auth login
```

The CLI prints a sign-in code and opens the Terros sign-in page in your browser
(or prints its address if it can't). Type the code from your terminal on that
page, then finish signing in. Only approve a sign-in you started yourself, and
never enter a code or open a sign-in link someone else sent you.

To print the current API access token (for usage in scripts):

```sh
terros auth token
```

To show who the CLI is signed in as (and whether it is impersonating someone):

```sh
$ terros whoami
jane@acme-solar
user:          U.example (Jane)
company:       C.example (Acme Solar)
impersonating: no
```

In scripts: `terros whoami | awk '$1 == "user:" { print $2 }'` prints the user ID.

## AI Clients

Connect an AI client (Claude, ChatGPT, Cursor, VS Code and other MCP clients) to
the hosted Terros MCP server rather than the CLI. Add it as a remote
(Streamable HTTP) MCP server with this address, keeping the `/mcp` path, and
sign in with your Terros account when the client asks:

```text
https://mcp.terros.com/mcp
```

Setup steps for each client (Claude Code, Claude, ChatGPT, Cursor and VS Code)
are in [Use Terros with AI](https://docs.terros.com/docs/info/mcp). For a
client that accepts `mcpServers` configuration, such as Cursor (not yet tested
with Terros):

```json
{
  "mcpServers": {
    "terros": {
      "url": "https://mcp.terros.com/mcp"
    }
  }
}
```

Calls run with your Terros permissions and are read-only unless the address
asks for writes (`https://mcp.terros.com/mcp?writes=enabled`). An AI agent
that can run shell commands can also use the CLI itself, as in
[Run a Command](#run-a-command).

### Migrating from `terros mcp`

CLI 3.0.0 removed `terros mcp`, the local stdio MCP server. A client still
configured with `"command": "terros", "args": ["mcp"]` now fails to start the
server, with a message on standard error pointing to the hosted address.
Replace that entry with the `url` entry above.

The hosted server names its per-endpoint tools as `terros mcp` did
(`account_get`), but by default it lists three tools that search, describe
and call them; add `?tools=endpoints` to the address for one tool per
endpoint. Terros staff tools and impersonation are not available on the hosted
production server yet. Until they are, staff who need them through MCP, or
anyone who needs the local server while migrating, can run it from CLI 2,
which stays on npm:

```json
{
  "mcpServers": {
    "terros": {
      "command": "npx",
      "args": ["-y", "@terros-inc/cli@2", "mcp"]
    }
  }
}
```

## API Request Log

Users with internal access can list a company's recent API requests, newest
first, from the last seven days:

```sh
terros api log --companyId <companyId> [--endpoint /account/add] [--errorsOnly] [--since 2026-01-01T00:00:00Z] [--limit 25]
```

Each request includes its timestamp, endpoint, user, stored status, latency,
error type and message, and a redacted, truncated request body. Typed errors
are stored with status 200, so use `--errorsOnly` to find them. `--since`
defaults to the last day; if it is older than seven days, the CLI prints the
effective clipped start time. `--limit` takes 1 to 100 and defaults to 25.

`terros api log` runs the `apiHistory start` query, waits for it and prints only
the requests. Use `terros apiHistory start` instead to filter by `--userId` or to
see the whole response. Either command waits up to two minutes; when it times
out it prints the query ID, and `terros apiHistory status --queryId <queryId>`
resumes it.

## Find Commands

Each API command follows its endpoint's full path, one word per path segment, at
any depth:

```sh
terros <command> [<subcommand> ...] [parameters]
```

For example (made-up paths):

| Endpoint              | Command                     |
| --------------------- | --------------------------- |
| `/bed/list`           | `terros bed list`           |
| `/garden/bed/list`    | `terros garden bed list`    |
| `/garden/bed/tag/add` | `terros garden bed tag add` |
| `/search`             | `terros search`             |

Single-segment API endpoints are direct commands:

```sh
terros search --query "Jane Doe"
```

Two endpoints that would map to the same command (for example `/garden/bed/list`
and `/garden/bed/list/`) make the CLI exit with an error that names both paths.
A path segment named `help` is rejected the same way, because `help` is reserved
for help text. An endpoint that would land on a built-in command such as
`terros auth login` or `terros connect publish` makes that built-in command, its
help, every group listing (such as `terros auth help`) and endpoint commands
exit with an error naming both. Other built-in commands still run, unless two
endpoints collide or a path uses `help`, which stops every command. A schema
that cannot be loaded at all lets every built-in command and its group help run.

CLI 2.0.0 changed command names; see [CHANGELOG.md](CHANGELOG.md) for the
renamed commands.

List available commands:

```sh
terros help
```

List the subcommands at any level:

```sh
terros <command> help
terros <command> <subcommand> help
```

Show parameters for a command (and any subcommands nested below it), with an
example command when the API documents one:

```sh
terros <command> [<subcommand> ...] help
```

`--help` and `-h` anywhere on the line print the same help and never run the
command.

Use `--depth` with `help` to show additional nested object type detail. The
default depth is one layer. It only changes help output: running a command with
`--depth` fails with an unknown parameter error.

```sh
terros <command> [<subcommand> ...] help --depth 2
```

## Run a Command

Pass parameters as flags:

```sh
terros <command> [<subcommand> ...] --name "Acme Inc." --active true
```

Parameter values are validated based on the Terros API schema. Supported values
include strings, numbers, booleans, arrays, and JSON objects. Pass an array as
one JSON value, quoted for your shell, as in the `--ids` example below. Scalar arrays
also accept comma-separated values such as `--ids id_1,id_2` or a repeated flag.
Arrays of objects or other structured values use the JSON-array form. Parameter
help lists the accepted syntax beside each array and the allowed values for enum arrays. If you
pass multiple bare words after an array flag on a recognized API command, the
CLI suggests comma-separated syntax for scalar items or a shell-quoted JSON array for structured items instead of
reporting an unknown command. For enum arrays, the hint lists the schema's allowed
values and identifies invalid entries. Suggestions include only valid entries and
are omitted when none remain. When a value matches no member of a mixed
union, the error lists all possibilities, including literal choices and object fields.

Pass `null` to clear a nullable parameter, for example `--value null`. `terros preference update` requires
`--value` (or `value` in `--inputFile`), so clearing a preference always takes an explicit `--value null`.

Examples:

```sh
terros <command> [<subcommand> ...] --count 10
terros <command> [<subcommand> ...] --active true
terros <command> [<subcommand> ...] --ids '["id_1","id_2","id_3"]'
terros <command> [<subcommand> ...] --metadata '{"source":"cli"}'
```

Responses are printed as formatted JSON.

To send a large request body, such as a whole workflow, put it in a JSON file
and pass `--inputFile` (`-` reads standard input). Flags still work alongside
it and override the file's fields:

```sh
terros workflow get --workflowId WF.example > workflow.json
# edit workflow.json, then preview the change before saving it
terros workflow update --inputFile workflow.json --dryRun
```

## Call an Unlisted Endpoint

`terros api call` sends one request to an API path, including one the API
schema does not list (so no command exists for it), and prints the JSON
response:

```sh
terros api call /account/get --body '{"accountId":"A.example"}'
terros api call /account/note/add --inputFile note.json --body '{"note":"Called back"}'
echo '{"accountId":"A.example"}' | terros api call /account/get --inputFile -
```

It sends a `POST` with the `--body` JSON object, `--inputFile`'s (`-` reads
standard input), or both, `--body` fields winning; with neither it sends `{}`.
Request fields go in the body, not in flags, since without a schema the CLI
cannot tell what they are.

The request goes where the other commands' requests go, with the same
sign-in: the signed-in user (or `TERROS_API_KEY`), acting as
`TERROS_IMPERSONATE` when set, to `TERROS_API_ENDPOINT` or production. Pass a
path, not a URL. The command exits 1 on an HTTP, network or API error, and
never prints the access token.

## Act as Another User

Terros staff can run CLI commands as another user by setting
`TERROS_IMPERSONATE` to that user's `userId`. Look the user up by name first:

```sh
terros search --query "Jane Admin"
```

The same name can exist in several companies. Keep the `User` result whose
company matches the request; its `userId` is the ID to use (for example
`U.example`). Then confirm who you are:

```sh
TERROS_IMPERSONATE=U.example terros whoami
```

Never guess an ID such as `U:jane`; always take it from a search result.

For a customer's question, act as one of their admins or the affected user:
reads are scoped to the acting user's company, so as yourself another
company's records look missing or empty. Use the staff login only for internal
endpoints such as entitlements and feature flags; a command that takes
`--companyId` is no reason to stay as staff. `terros help` repeats this, and a
staff command that is not impersonating prints a hint on standard error when it
gets `NotFound`, `NotAuthorized` or an empty list.

## Issue an API Key

`terros apikey restricted add` issues an API key owned by the acting user, so
with `TERROS_IMPERSONATE` it is that user's key, in their company. The acting
user needs the `apikey:manage` permission. `--allowedPermissions` (at least
one) and `--expiresAt` (UTC milliseconds) are required, and the API refuses a
request without them, so the command only issues restricted keys.

The API issues a key only to a sign-in that grants the `sensitive:manage`
scope, which `terros auth login` does not ask for. Auth0 grants that scope only
to a sign-in from the last few minutes, and refreshing a sign-in does not add it
back. So the command first explains why and asks you to sign in again in the
browser, for `offline_access sensitive:manage` and the Terros API
(`https://api.tantalim.com`), prompting on standard error. Because Auth0 approves
the code from a browser that is still signed in without a new sign-in, the
command opens the sign-out page (`https://auth.terros.com/v2/logout`) before the
sign-in page: sign out, then approve the code. It uses that sign-in
for this one request only: it is kept in memory, not saved, and your saved login
from `terros auth login` stays as it was. `TERROS_IMPERSONATE` and
`TERROS_API_ENDPOINT` apply as usual. If the sign-in does not grant
`sensitive:manage`, usually because the approval reused an earlier browser
sign-in, the command stops with an error naming the scope and sends nothing:
sign out at `https://auth.terros.com/v2/logout` and run it again. The API
also requires `sensitive:manage` for `/apikey/add`, so if that path is ever
offered as `terros apikey add`, it signs in the same way.

The response is the only time the key is returned, and it goes to standard
output only, never to standard error. Pipe it straight into a secret store
rather than printing it, for example a key restricted to `company:read` that
expires in 7 days:

```sh
TERROS_IMPERSONATE=U.example terros apikey restricted add \
  --allowedPermissions company:read \
  --expiresAt $(( ($(date +%s) + 7 * 24 * 3600) * 1000 )) \
  --description "Load test target" \
  | jq -r .apiKey \
  | aws secretsmanager put-secret-value --secret-id <secret name> --secret-string file:///dev/stdin
```

The command is not offered as a hosted MCP tool, so a key never passes through
chat.

## Local Development

Install dependencies:

```sh
pnpm install
```

Build the CLI:

```sh
pnpm build
```

Run the CLI locally:

```sh
node cli.js help
```

The published `terros` executable loads the compiled code from `dist/index.mjs`,
so run `pnpm build` after changing TypeScript files.

### CLI smoke checks

From the repository root, build and run the authenticated discovery check separately from unit tests:

```sh
pnpm --filter @terros-inc/cli fetch-openapi
pnpm --filter @terros-inc/cli... build
pnpm --filter @terros-inc/cli smoke
```

Supply an authorized staging API key through `TERROS_API_KEY` and set
`TERROS_API_ENDPOINT` to the staging API base URL. The key must belong to a
Terros-internal user with access to `/openapi`. Without a non-whitespace key,
the check prints `SKIP` and exits successfully. With a key, an explicit endpoint
is required; the harness does not default to production.

The check runs the built CLI's `account get --help` in a temporary home directory
and requires both the backend OpenAPI cache containing `/account/get` and full-path
command help. Bundled schema fallback cannot pass it. The loader's profile lookup
is part of discovery; the check does not execute an account command. The temporary
home is removed afterward, and the check does not use a saved CLI login.
Failures print the error message and any CLI stderr with every occurrence of the
supplied key replaced by `[REDACTED]`, then exit with code 1.

After building, run the invalid-key check separately:

```sh
pnpm --filter @terros-inc/cli smoke:auth
```

Set `TERROS_API_ENDPOINT` explicitly. This check needs no secret: it runs the
built CLI's `whoami` with a dummy invalid key in a temporary home directory,
then removes that directory. It requires a normal non-zero exit, a clear
authentication error as the last stderr line, and no stack trace on stdout or
stderr. Failures print the error and CLI stderr with the dummy key redacted.

The separate [CLI smoke workflow](../.github/workflows/cli-smoke.yml) runs only
on default-branch pushes or manual runs of that branch. All PR runs skip it.
The job declares the `staging` GitHub environment, checks its `TERROS_API_KEY`
secret before checking out code, and skips the remaining steps successfully if
the key is missing or whitespace-only. It fixes the endpoint to the staging API
and passes the key only to the configuration check and discovery step. The
invalid-key step shares the secret-dependent setup and step gates, so it also
skips without the staging secret even though its script runs independently
without one. An admin must create the `staging` environment and its secret using
a staging key owned by a
Terros-internal user. The existing `terros` environment's key is for production
publishing and must not be reused. This check does not gate npm publishing.

## Troubleshooting

If a command says your Terros session has expired or you're not signed in, sign
in again:

```sh
terros auth login
```

Errors print without a stack trace. To see the full error with its cause and
stack trace, run the command with `TERROS_DEBUG=1`.

### New API endpoints

The CLI reads its API commands from the live API document at
`https://docs.terros.com/openapi/terros.yml`, so endpoints added after your CLI
version was released appear without updating it. It checks for a changed
document at most every five minutes, with a request that downloads nothing when
the document is unchanged and gives up after 300 ms, so a slow or offline
network does not hold a command up. When it cannot reach the document, it uses
the last copy it downloaded, or the copy bundled with
the CLI. Internal users signed in without impersonation get the internal
schema instead, cached for 24 hours.

If an endpoint or parameter was recently added and the CLI does not recognize
it, the CLI refreshes the API schema and retries once. To refresh it manually,
run:

```sh
terros api refresh
```

To call an endpoint the schema still does not list, use
[`terros api call`](#call-an-unlisted-endpoint).

If the CLI says to update, install the latest version and retry:

```sh
npm install -g @terros-inc/cli
```
