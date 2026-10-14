export type ToolAnnotationHints = { readOnlyHint: boolean; destructiveHint: boolean }

/** Every route is a POST, so a tool is read-only only when its route ends in a read verb. */
export function getToolAnnotations(readOnly: boolean): ToolAnnotationHints {
  return { readOnlyHint: readOnly, destructiveHint: !readOnly }
}
