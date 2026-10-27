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

Turn on developer mode in Terros first at <https://app.terros.com/integration/cli>
(it needs the `user:developer` permission; ask your company admin if you can't
turn it on). Then authenticate before running Terros API commands:

```sh
terros auth login
```

The CLI opens a browser-based device login flow. Confirm that the code shown in
your browser matches the code printed in the terminal, then finish signing in.

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

## MCP Server

After signing in with `terros auth login`, start the MCP server with:

```sh
terros mcp
```

The server communicates over stdio and exposes the Terros API endpoints as
tools, using names such as `account_get` and `search`. Tool arguments follow the
API's JSON schemas. The server exits with an error if no saved login is available
or the login cannot be refreshed. Sign in separately before starting it.

For an MCP client that accepts `mcpServers` configuration:

```json
{
  "mcpServers": {
    "terros": {
      "command": "terros",
      "args": ["mcp"]
    }
  }
}
```

Standard output is reserved for MCP messages; errors are written to standard error.

## API Request Log

Users with internal access can list a company's recent API requests, newest
first, from the last seven days:

```sh
terros api log --companyId <companyId> [--endpoint /account/add] [--errorsOnly] [--since 2026-01-01T00:00:00Z] [--limit 25]
```

Each request includes its timestamp, endpoint, user, stored status, latency,
error type and message, and a redacted, truncated request body. Typed errors
are stored with status 200, so use `--errorsOnly` to find them. If `--since` is
older than seven days, the CLI prints the effective clipped start time.

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

Show parameters for a command (and any subcommands nested below it):

```sh
terros <command> [<subcommand> ...] help
```

Use `--depth` to show additional nested object type detail. The default depth is
one layer:

```sh
terros <command> [<subcommand> ...] help --depth 2
```

## Run a Command

Pass parameters as flags:

```sh
terros <command> [<subcommand> ...] --name "Acme Inc." --active true
```

Parameter values are validated based on the Terros API schema. Supported values
include strings, numbers, booleans, arrays, and JSON objects.

Pass `null` to clear a nullable parameter, for example `--value null`. `terros preference update` requires
`--value` (or `value` in `--inputFile`), so clearing a preference always takes an explicit `--value null`.

Examples:

```sh
terros <command> [<subcommand> ...] --count 10
terros <command> [<subcommand> ...] --active true
terros <command> [<subcommand> ...] --ids id_1,id_2,id_3
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
node dist/index.js help
```

The published `terros` executable loads the compiled code from `dist/index.js`,
so run `pnpm build` after changing TypeScript files.

## Troubleshooting

If a command says the CLI is not authorized, sign in again:

```sh
terros auth login
```

If a token cannot be refreshed, the saved login may have expired. Run
`terros auth login` to create a new session.

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

If the CLI says to update, install the latest version and retry:

```sh
npm install -g @terros-inc/cli
```
