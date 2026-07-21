import { promisify } from 'node:util'
import { cwd } from 'node:process'
import { join, resolve } from 'node:path'
import { randomUUID } from 'node:crypto'
import { execFile } from 'node:child_process'
import { build } from 'rolldown'
import { BUILD_DIR, BUNDLE_NAME, ZIP_NAME } from './constants'
import { type ConnectConfig, readConnectConfig, type UnsavedScript } from './configSchema'
const execFileAsync = promisify(execFile)

type ScriptBuildOptions = {
  script: UnsavedScript
  options: {
    input: string
    output: {
      file: string
      minify: true
    }
    external: RegExp[]
  }
}

export type ScriptZip = {
  script: UnsavedScript
  zip: string
}

type PackageResult = {
  scripts: ScriptZip[]
  config: ConnectConfig
}

export async function packageScripts(): Promise<PackageResult> {
  const start = Date.now()
  const config = await readConnectConfig()
  const { scripts } = config
  const builds = scripts.map((s) => getScriptBuildConfiguration(s))
  await build(builds.map((b) => b.options))
  const zips: ScriptZip[] = []
  for (const buildOptions of builds) {
    // oxlint-disable-next-line no-await-in-loop
    const zip = await compressCodeBundle(buildOptions.options.output.file)
    zips.push({
      script: buildOptions.script,
      zip,
    })
  }
  const end = Date.now()
  const duration = ((end - start) / 1000).toFixed(2)
  console.log(`Created ${zips.length} zips in ${duration}s`)
  return {
    scripts: zips,
    config,
  }
}

function getScriptBuildConfiguration(script: UnsavedScript): ScriptBuildOptions {
  const uuid = randomUUID()
  const file = join(BUILD_DIR, uuid, BUNDLE_NAME)
  return {
    script,
    options: {
      input: script.entrypoint,
      output: {
        file,
        minify: true,
      },
      external: [/^node:/],
    },
  }
}

async function compressCodeBundle(path: string): Promise<string> {
  const workdir = resolve(cwd(), path, '..')
  await execFileAsync('zip', ['-q', '-r', ZIP_NAME, BUNDLE_NAME], { cwd: workdir })
  return join(workdir, ZIP_NAME)
}
