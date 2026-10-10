import { describe, expect, test, vi } from 'vitest'
import { type TerrosClient } from '@terros-inc/sdk'
import { findAlertAuthor } from './alerts.ts'

const clientWith = (profile: () => Promise<unknown>) => ({ user: { profile } }) as unknown as TerrosClient

describe('findAlertAuthor', () => {
  test('prefers the owner, then the closer, without reading the profile', async () => {
    const profile = vi.fn()
    const client = clientWith(profile)
    expect(
      await findAlertAuthor(client, { owner: { userId: 'U.o' as never }, closer: { userId: 'U.c' as never } })
    ).toBe('U.o')
    expect(await findAlertAuthor(client, { closer: { userId: 'U.c' as never } })).toBe('U.c')
    expect(profile).not.toHaveBeenCalled()
  })

  test('falls back to the integration user', async () => {
    const client = clientWith(async () => ({ user: { userId: 'U.me' } }))
    expect(await findAlertAuthor(client, {})).toBe('U.me')
  })

  test('is undefined when the profile cannot be read', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    const client = clientWith(async () => {
      throw new Error('denied')
    })
    expect(await findAlertAuthor(client, {})).toBeUndefined()
  })
})
