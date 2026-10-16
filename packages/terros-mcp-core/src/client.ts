/** Calls one API route as the signed-in user. Every tool mode executes through this client. */
export type ApiClient = {
  call<Success>(route: string, input: object): Promise<Success>
}
