import { main } from './main'

export async function runCli(argv: string[]): Promise<void> {
  try {
    await main(argv)
  } catch (error) {
    console.error(error instanceof Error ? (error.cause ?? error.message) : error)
    process.exitCode = 1
  }
}
