import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { readDocumentation } from './publish'

test.each<{ files: Record<string, string>; documentation: string | undefined }>([
  { files: { 'DOCS.md': '# Docs', 'README.md': '# Readme' }, documentation: '# Docs' },
  { files: { 'README.md': '# Readme' }, documentation: '# Readme' },
  { files: {}, documentation: undefined },
  { files: { 'DOCS.md': ' \n', 'README.md': '' }, documentation: undefined },
])('readDocumentation returns $documentation', async ({ files, documentation }) => {
  const dir = mkdtempSync(join(tmpdir(), 'docs-'))
  for (const [name, content] of Object.entries(files)) writeFileSync(join(dir, name), content)
  await expect(readDocumentation(dir)).resolves.toBe(documentation)
  rmSync(dir, { recursive: true, force: true })
})
