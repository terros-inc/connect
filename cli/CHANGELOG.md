# Changelog

Release notes for `@terros-inc/cli`. Each version's entry is its release notes.

## 2.1.0

### New: `terros app add` and `terros app update`

Create and edit a Terros Connect app from the CLI instead of the web developer pages. Both need the `app:manage`
permission.

- `terros app add --name "Acme CRM" [--description <text>] [--documentation <markdown>]` creates the app in your
  current company, in `development` status, and prints its app ID. If `terros.json` in the current directory has no
  `appId`, the new ID is saved there; an existing `appId` is never replaced.
- `terros app update [--appId <appId>] [--name <name>] [--description <text>] [--status <status>] [--logo <image>]`
  changes the app and prints it. `--appId` defaults to the `appId` in `terros.json`. It takes the fields the API requires
  from the stored app, so you never pass `companyId` or `permissions`. `--logo` uploads a local `.png`, `.jpg`, `.gif`, `.webp` or
  `.svg` image. The API's own rules still apply: publishing needs an approved review and a deployed current version,
  and its error is printed as it is.
- `--description` takes plain text; blank lines separate paragraphs.

### Other changes

- `terros <command> <subcommand> help` lists a built-in command's parameters when it declares them.
- `terros auth login` says why it failed instead of failing silently.

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
