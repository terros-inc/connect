# Changelog

Release notes for `@terros-inc/cli`. Each version's entry is its release notes.

## 3.0.0

### BREAKING: `terros mcp` removed; use the hosted MCP server

`terros mcp`, the local stdio MCP server, is removed: `terros mcp` → the hosted Terros MCP server at
`https://mcp.terros.com/mcp` (keep the `/mcp` path), which AI clients add as a remote MCP server and sign in to with a
Terros account. `terros mcp` now exits with an error on standard error that gives the hosted address, so a client
configuration that still starts it fails with that message rather than reading help text as protocol messages. Setup
and migration: [AI Clients](README.md#ai-clients).

The hosted server's tools are read-only unless the connection enables writes, and Terros staff tools and
impersonation are not on hosted production yet. Until they are, CLI 2 still serves the local server:
`npx -y @terros-inc/cli@2 mcp`.

Every other command, sign-in and the API commands generated from the OpenAPI document are unchanged.

## 2.1.0

This release also carries the changes listed under 2.0.1, which was not published.

### New: API commands follow the live API document

Endpoints added to the public API after a CLI version was released now appear in that version. The CLI revalidates
`https://docs.terros.com/openapi/terros.yml` with its `ETag` at most every five minutes, giving up after 300 ms so a slow
or offline network does not hold a command up, and right away when a command or parameter is missing or on
`terros api refresh`, with a two-second timeout. When the document cannot be fetched or is not a usable OpenAPI
document, it uses the last downloaded copy, then the bundled one. The staff internal schema is unchanged.

### Bug fix: refresh and retry when API commands or parameters are missing

The CLI refreshes the API schema and retries once when an endpoint or parameter is missing. If the schema cannot be fetched, it directs the user to retry or update the CLI instead of reporting a false refresh success. Built-in command typos do not trigger a refresh, and `terros api refresh` can recover from a stale schema collision.

## 2.0.1

### Bug fix: built-in commands no longer hide an endpoint that lands on them

In 2.0.0 a built-in command (`terros auth login`, `terros connect publish`, `terros mcp`, ...) ran before any
endpoint was checked against it, so an endpoint path that maps to the same command was silently hidden whenever the
built-in was run. Now, before a built-in command or its help runs, the CLI loads the API schema and fails with an
error naming the endpoint and the built-in command. It fails the same way when two endpoint paths map to one command
or a path uses `help`, since such a schema could hide an endpoint behind any built-in.

In 2.0.0 a built-in group's help (`terros auth help`, `terros connect`) also printed its subcommands with a
successful exit after logging any of these collisions. It now fails with the collision error. Group help lists the
endpoint commands under that group as well, so it fails on any collision in the schema, not only one in its own group.

Only the built-in command being run is checked: an endpoint that lands on `terros connect publish` does not stop
`terros auth login`. A schema that cannot be loaded at all still lets every built-in command run, so
`terros auth login` works without one.

### Bug fixes: help and parameter parsing (#101, #102, #103, #105)

- Help for a built-in command shows its description and the flags it accepts (`terros api log help` lists
  `--companyId`, `--endpoint`, `--errorsOnly`, `--since` and `--limit`) instead of `Parameters: none`.
- Endpoint help shows a field's description when the schema puts it beside a `$ref`, and prints a union of identical
  types once (`string` rather than `string | string | string`).
- Enum and string-literal parameters accept a plain value, a comma-separated list or a JSON array, not only a quoted
  JSON string. An unknown value fails before the request and lists the valid values.
- A string parameter, an id in a list included, takes a JSON-quoted value too: `--companyIds '"C.example"'` sends
  `C.example` like `--companyIds C.example`, instead of the quoted text the API rejected with `Invalid input`.
- Command output and MCP tool results leave out presigned avatar and icon upload URLs (`uploadAvatarUrl`,
  `uploadIconUrl`), which only the apps' image editors use.
- A union parameter with a list member (`number | "Warn" | string[]`) takes a plain value as the matching member
  instead of wrapping it in a list, and a `|` inside a nested type or a quoted literal no longer splits the union
  (#102).
- A list whose item union reduces to a single enum is shown as `("a" | "b")[]` and accepts `a,b`, instead of
  rejecting every value (#103).
- `null` clears a nullable parameter (`--value null`). `terros preference update` now requires `--value` (or `value`
  in `--inputFile`), so a forgotten flag can no longer clear a preference: clearing one takes `--value null` (#105).
- A negative number after a flag is that flag's value: `--boundingBox.top.longitude -124.5` no longer fails with
  `Unknown parameter(s): --1, --2, --4`, so `--flag=-124.5` is no longer needed.

### Additions (#100, #104)

- `--inputFile <path>` (`-` reads standard input) on every API command sends a JSON request body from a file; flags
  override its fields (#100).
- `terros whoami` shows the user and company the CLI is signed in as, and whether it is impersonating (#104). With a
  saved login, concurrent API calls in one process now share a single token refresh.

## 2.0.0

### BREAKING: API commands follow the full endpoint path

API commands are now named from every segment of the endpoint path, at any depth, instead of only the last two
segments. There are no aliases for the old names: scripts and agents that call a renamed command must switch to the
new name.

The rule, with made-up paths:

| Endpoint              | Before (1.x)      | After (2.0.0)               |
| --------------------- | ----------------- | --------------------------- |
| `/bed/list`           | `terros bed list` | `terros bed list` (same)    |
| `/garden/bed/list`    | `terros bed list` | `terros garden bed list`    |
| `/garden/bed/tag/add` | `terros tag add`  | `terros garden bed tag add` |
| `/search`             | `terros search`   | `terros search` (same)      |

One- and two-segment endpoints keep their names. Every endpoint with three or more segments is renamed.

Renamed commands in the public API document (`https://docs.terros.com/openapi/terros.yml`) when 2.0.0 was prepared:

| Before (1.x)            | After (2.0.0)                       |
| ----------------------- | ----------------------------------- |
| `terros event add`      | `terros calendar event add`         |
| `terros event get`      | `terros calendar event get`         |
| `terros event list`     | `terros calendar event list`        |
| `terros event remove`   | `terros calendar event remove`      |
| `terros event update`   | `terros calendar event update`      |
| `terros event upsert`   | `terros calendar event upsert`      |
| `terros app get`        | `terros connect app get`            |
| `terros version add`    | `terros connect app version add`    |
| `terros version get`    | `terros connect app version get`    |
| `terros version update` | `terros connect app version update` |
| `terros script add`     | `terros connect script add`         |
| `terros member add`     | `terros team member add`            |
| `terros member remove`  | `terros team member remove`         |
| `terros member update`  | `terros team member update`         |

Commands that only staff accounts load from the internal API document are renamed by the same rule.

### Other changes

- Help works at every level: `terros <command> help`, `terros <command> <subcommand> help`, and so on down to the
  endpoint, whose help lists its parameters.
- Nested endpoints that shared a command name under the old two-segment naming (for example `/bed/list` and
  `/garden/bed/list`) are both available; before, one silently replaced the other.
- Two endpoint paths that map to the same command (for example `/garden/bed/list` and `/garden/bed/list/`), or a
  path segment named `help`, now fail with an error naming the paths. A staff account's internal API document that
  fails this way falls back to the bundled document, as other unreadable internal documents already did.
- An endpoint that lands on a built-in command (`terros auth login`, `terros connect publish`, ...) makes help and
  endpoint commands fail with an error naming both. The built-in command itself still runs, since built-in commands
  never load the API schema.
- Extra words after a command (`terros garden bed list extra`) are now an unknown-command error instead of being
  ignored.

### Bug fix: MCP lists every tool of a former collision pair

`terros mcp` used to drop one tool of each pair of nested endpoints that shared a command name under the old
two-segment naming (for example `/bed/list` and `/garden/bed/list`); only one of the two was listed. It now lists
both. MCP tool names are unchanged: they still come from the full route (`bed_list`, `garden_bed_list`,
`account_get`).
