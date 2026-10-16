# Tool-mode evaluation

A scripted, repeatable comparison of the ways `@terros-inc/mcp-core` can expose the API to an AI client:

| Config                   | What the client sees                                                                                                      |
| ------------------------ | ------------------------------------------------------------------------------------------------------------------------- |
| `endpoints (all)`        | One tool per operation (`createMcpServer` default)                                                                        |
| `toolsets (field sales)` | One tool per operation, only in the toolsets a field-sales connection would enable (`FIELD_SALES_TOOLSETS` in `tasks.ts`) |
| `meta`                   | `terros_search_tools`, `terros_describe_tool`, `terros_call`                                                              |

Run it against any OpenAPI document (defaults to `cli/terros.yml`, which `pnpm --dir cli fetch-openapi` downloads):

```sh
node eval/run.ts [path/to/openapi.yml]
```

`eval.test.ts` runs the same tasks in CI and fails if a mode stops completing them.

## What it does

Each task in `tasks.ts` is a short request ("List my appointments today", "Log a knock at 123 Example St", "Find the account at 123 Example St", ...) written as the operations an agent must reach, the arguments it sends, and, for meta mode, the search queries it tries in order: the task's own words first, then a rewording. The harness starts a real MCP server over an in-memory transport, backed by a mocked API client, and plays the task:

- per-endpoint configs: `tools/list`, then `tools/call` on each operation; it fails if the tool is not listed.
- meta: `terros_search_tools` with each query until the operation appears in the results, then `terros_describe_tool`, then `terros_call`.

A task succeeds when every call succeeds (including server-side input validation), the mocked API received exactly the expected routes and arguments, and the last result has the expected text.

## What it measures

- **Correctness**: success, and for meta the searches that did not list the needed operation.
- **Tool calls**: each is one model turn, so more calls means more model latency.
- **Tokens** (estimated as characters / 4): the tool definitions the client puts in context, and the input tokens for the whole task, counting the tool definitions plus the transcript so far on every turn, with no prompt caching.
- **Latency**: server build time, cold and warm, and the median time per task against a mock API that answers instantly. Model and network time are not included.
- **Search output format**: the compact one-line format against the same results as JSON.

## What it does not show

The agent is scripted: it always picks the right operation once it is listed. So the eval shows whether the operation can be found and called, not whether a model chooses it from 87 tools or writes these queries. That needs live clients; the checklist is in the Sales repository's hosted MCP docs (TECH-6014).
