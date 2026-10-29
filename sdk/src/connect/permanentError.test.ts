import { PermanentError } from './permanentError.ts'

describe('PermanentError', () => {
  it('reports name PermanentError so a thrown script is a terminal Lambda FunctionError, not a retry', () => {
    const cause = new Error('vendor returned 404')

    try {
      throw new PermanentError('Account has no location', { cause })
    } catch (error) {
      expect(error).toBeInstanceOf(PermanentError)
      if (!(error instanceof PermanentError)) return
      // Node.js Lambda sets FunctionError errorType from error.name and errorMessage from error.message.
      expect({ errorType: error.name, errorMessage: error.message }).toEqual({
        errorType: 'PermanentError',
        errorMessage: 'Account has no location',
      })
      expect(error.cause).toBe(cause)
      expect(error.stack?.split('\n')[0]).toBe('PermanentError: Account has no location')
    }
  })
})
