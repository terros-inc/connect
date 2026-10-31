import { getPreferredName, type UserProfileSuccess } from '@terros-inc/sdk'
import { buildTerrosClient } from '../api/query'

export const whoamiCommand = {
  description:
    'Show who the CLI is signed in as, and whether it is impersonating someone. To act as another user, set TERROS_IMPERSONATE=<userId>; `TERROS_IMPERSONATE=<userId> terros whoami` confirms it.',
  async run(): Promise<void> {
    // /user/profile, not /user/get: only the profile carries the company name for the user@company line.
    // Impersonation is the client's TERROS_IMPERSONATE header, so the real user needs a second call without it.
    const [profile, realProfile] = await Promise.all([
      buildTerrosClient().call<UserProfileSuccess>('user/profile', {}),
      process.env.TERROS_IMPERSONATE
        ? buildTerrosClient({ impersonateUserId: '' }).call<UserProfileSuccess>('user/profile', {})
        : undefined,
    ])
    console.log(formatWhoami(profile, realProfile))
  },
}

/** Terse `key: value` lines, so `awk '$1 == "user:" { print $2 }'` prints the user ID. */
export function formatWhoami(profile: UserProfileSuccess, realProfile?: UserProfileSuccess): string {
  const name = getPreferredName(profile.user)
  // The API ignores an impersonation header naming the signed-in user, so compare the users it answered with.
  const impersonating = realProfile !== undefined && realProfile.user.userId !== profile.user.userId
  const lines = [
    `${toHandle(name, profile.user.userId)}@${toHandle(profile.company.name, profile.company.companyId)}`,
    `user:          ${describe(profile.user.userId, name)}`,
    `company:       ${describe(profile.company.companyId, profile.company.name)}`,
    `impersonating: ${impersonating ? 'yes' : 'no'}`,
  ]
  if (impersonating) {
    lines.push(
      `real-user:     ${describe(realProfile.user.userId, getPreferredName(realProfile.user))}`,
      `real-company:  ${describe(realProfile.company.companyId, realProfile.company.name)}`
    )
  }
  return lines.join('\n')
}

function describe(id: string, name: string | undefined): string {
  return name?.trim() ? `${id} (${name.trim()})` : id
}

function toHandle(name: string | undefined, fallback: string): string {
  const handle = (name ?? '')
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
  return handle || fallback
}
