# Changelog

Release notes for `@terros-inc/cli`. Each version's entry is its release notes.

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
- MCP tool names are unchanged (`terros mcp` still names tools from the full route, such as `account_get`).
