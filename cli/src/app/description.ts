type TiptapText = { type: 'text'; text: string }
type TiptapParagraph = { type: 'paragraph'; content: TiptapText[] }
export type TiptapDoc = { type: 'doc'; content: TiptapParagraph[] }

/** Plain text to a Tiptap doc: blank lines separate paragraphs, other line breaks become spaces. */
export function textToTiptapDoc(text: string): TiptapDoc {
  const paragraphs = text
    .split(/\r?\n\s*\r?\n/)
    .map((paragraph) => paragraph.trim().replace(/\s*\r?\n\s*/g, ' '))
    .filter((paragraph) => paragraph !== '')
  // Tiptap rejects empty text nodes, so an empty description is one empty paragraph.
  if (paragraphs.length === 0) return { type: 'doc', content: [{ type: 'paragraph', content: [] }] }
  return {
    type: 'doc',
    content: paragraphs.map((paragraph) => ({ type: 'paragraph', content: [{ type: 'text', text: paragraph }] })),
  }
}
