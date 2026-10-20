import { main } from './main'

main(process.argv.slice(2)).catch((error: unknown) => {
  console.error(error instanceof Error ? (error.cause ?? error.message) : error)
  process.exitCode = 1
})
