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

## Find Commands

Terros CLI uses the pattern:

```sh
terros <command> <subcommand> [parameters]
```

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
