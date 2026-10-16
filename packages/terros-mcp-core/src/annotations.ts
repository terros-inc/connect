export type ToolAnnotationHints = { readOnlyHint: boolean; destructiveHint: boolean }

/** MCP hints from the catalog classification: every route is a POST, so the HTTP method says nothing. */
export function getToolAnnotations(operation: { readOnly: boolean; destructive: boolean }): ToolAnnotationHints {
  return { readOnlyHint: operation.readOnly, destructiveHint: operation.destructive }
}
