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

The CLI opens a browser-based device login flow. Confirm that the code shown in
your browser matches the code printed in the terminal, then finish signing in.

To print the current API access token (for usage in scripts):

```sh
terros auth token
```

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

## Find Commands

Terros CLI uses the pattern:

```sh
terros <command> <subcommand> [parameters]
```

Single-segment API endpoints are direct commands. For example:

```sh
terros search --query "Jane Doe"
```

Nested endpoints use their last two segments, such as `terros event list` for
`/calendar/event/list`. If that command name is also the first segment of
another endpoint, the parent segment is prefixed instead. For example, `/program/user/list` becomes
`terros programUser list` so it does not replace `terros user list`.

List available commands:

```sh
terros help
```

List subcommands for a command:

```sh
terros <command> help
```

Show parameters for a subcommand:

```sh
terros <command> <subcommand> help
```

Use `--depth` to show additional nested object type detail. The default depth is
one layer:

```sh
terros <command> <subcommand> help --depth 2
```

## Run a Command

Pass parameters as flags:

```sh
terros <command> <subcommand> --name "Acme Inc." --active true
```

Parameter values are validated based on the Terros API schema. Supported values
include strings, numbers, booleans, arrays, and JSON objects.

Examples:

```sh
terros <command> <subcommand> --count 10
terros <command> <subcommand> --active true
terros <command> <subcommand> --ids id_1,id_2,id_3
terros <command> <subcommand> --metadata '{"source":"cli"}'
```

Responses are printed as formatted JSON.

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
