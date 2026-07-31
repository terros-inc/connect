import { createSign } from 'node:crypto'
import { type AccountWebhook, wrapConnectHandler } from '@terros-inc/sdk'

type EnvelopeResult = { envelopeId: string; status: string }

export const handler = wrapConnectHandler<AccountWebhook, EnvelopeResult>(async (input) => {
  const payload = input.context.payload
  const scriptConfig = input.context.config.scriptConfig || {}
  const secrets = input.context.config.secrets || {}

  if (payload.action === 'remove') {
    console.log('Skipping DocuSign send for Account remove')
    throw Error('Account removed: not firing')
  }

  const account = payload.data
  if (!account) {
    console.log('Missing account payload data', JSON.stringify(payload.data))
    throw Error('Missing account data')
  }

  const dsIntegrationKey = secrets.dsIntegrationKey
  const dsUserId = secrets.dsUserId
  const dsPrivateKey = secrets.dsPrivateKey
  if (!dsIntegrationKey || !dsUserId || !dsPrivateKey) {
    console.log('Missing DocuSign auth secrets')
    throw Error('Missing DocuSign auth secrets (dsIntegrationKey, dsUserId, dsPrivateKey)')
  }

  const accountId = String(account.id || '')
  if (!accountId) {
    console.log('Missing account id', JSON.stringify(account))
    throw Error('Missing account id')
  }

  // fieldMappings is a Connect "mapping" config field (install UI "Add Mapping" rows).
  //   key   = Terros account field ref (CF.* or a dotted path like account.resident.email)
  //   value = DocuSign target: reserved tokens signer.email / signer.name / cc.email / cc.name,
  //           OR a template tab Data Label
  // Everything inferred from the account flows through this one editor.
  const fieldMappings: Record<string, string> =
    (scriptConfig as { fieldMappings?: Record<string, string> }).fieldMappings || {}
  const recipient: Record<string, string | undefined> = {}
  const textTabs: { tabLabel: string; value: string; locked: string }[] = []
  for (const [fieldRef, target] of Object.entries(fieldMappings)) {
    const value = resolveField(account, fieldRef)
    if (target.startsWith('signer.') || target.startsWith('cc.')) {
      recipient[target] = value
    } else {
      textTabs.push({ tabLabel: target, value: value || '', locked: 'true' })
    }
  }

  const signerEmail = recipient['signer.email']
  if (!signerEmail) {
    console.log(`Missing signer.email mapping for account ${accountId}`)
    throw Error('Missing signer.email mapping')
  }

  const templateRoles: Record<string, unknown>[] = [
    {
      roleName: scriptConfig.signerRoleName,
      email: signerEmail,
      name: recipient['signer.name'] || scriptConfig.signerRoleName,
      tabs: { textTabs },
    },
  ]

  const ccEmail = recipient['cc.email']
  if (scriptConfig.ccRoleName && ccEmail) {
    templateRoles.push({
      roleName: scriptConfig.ccRoleName,
      email: ccEmail,
      name: recipient['cc.name'] || scriptConfig.ccRoleName,
    })
  }

  const assertion = buildJwt(scriptConfig, dsIntegrationKey, dsUserId, dsPrivateKey)
  const tokenUrl = `https://${scriptConfig.dsAuthServer}/oauth/token`
  const tokenBody = new URLSearchParams({ grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion })

  const tokenRes = await fetch(tokenUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: tokenBody,
  })
  if (!tokenRes.ok) {
    const text = await tokenRes.text()
    console.log(`DocuSign auth failed: ${tokenRes.status} ${tokenRes.statusText} ${text}`)
    throw Error('DocuSign auth failed')
  }
  const { access_token } = (await tokenRes.json()) as { access_token: string }

  const envRes = await fetch(`${scriptConfig.dsBaseUri}/restapi/v2.1/accounts/${scriptConfig.dsAccountId}/envelopes`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${access_token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      templateId: scriptConfig.templateId,
      status: 'sent',
      customFields: { textCustomFields: [{ name: 'terrosAccountId', value: accountId, show: 'false' }] },
      templateRoles,
    }),
  })
  if (!envRes.ok) {
    const text = await envRes.text()
    console.log(`DocuSign envelope create failed: ${envRes.status} ${envRes.statusText} ${text}`)
    throw Error('DocuSign envelope create failed')
  }
  const envelope = (await envRes.json()) as { envelopeId: string; status: string }

  console.log(`Created DocuSign envelope ${envelope.envelopeId} for account ${accountId}`)

  return { envelopeId: envelope.envelopeId, status: envelope.status }
})

function resolveField(account: Record<string, unknown>, ref: string): string | undefined {
  if (!ref) return undefined
  const key = String(ref).trim()
  if (!key) return undefined
  if (key.startsWith('CF.')) {
    const customFieldMap = account.customFieldMap as Record<string, string> | undefined
    return customFieldMap?.[key]
  }
  const path = removePayloadPrefix(key)
  return path.split('.').reduce<unknown>((value, k) => {
    if (!value) return undefined
    return (value as Record<string, unknown>)[k]
  }, account) as string | undefined
}

function removePayloadPrefix(source: string): string {
  if (source.startsWith('account.')) return source.slice('account.'.length)
  if (source.startsWith('payload.')) return source.slice('payload.'.length)
  if (source.startsWith('data.')) return source.slice('data.'.length)
  return source
}

function buildJwt(
  scriptConfig: Record<string, string>,
  dsIntegrationKey: string,
  dsUserId: string,
  dsPrivateKey: string
): string {
  const b64url = (b: Buffer): string => b.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
  const now = Math.floor(Date.now() / 1000)
  const head = b64url(Buffer.from(JSON.stringify({ alg: 'RS256', typ: 'JWT' })))
  const claims = b64url(
    Buffer.from(
      JSON.stringify({
        iss: dsIntegrationKey,
        sub: dsUserId,
        aud: scriptConfig.dsAuthServer,
        iat: now,
        exp: now + 3600,
        scope: 'signature impersonation',
      })
    )
  )
  const s = createSign('RSA-SHA256')
  s.update(`${head}.${claims}`)
  // Normalize the PEM: if the secret was stored JSON-escaped and the platform
  // handed back literal "\n" text instead of real newlines, convert them.
  // Also strips any surrounding quotes/whitespace. Without this, OpenSSL throws
  // ERR_OSSL_UNSUPPORTED because it can't decode a single-line blob.
  const pem = normalizePem(dsPrivateKey)
  return `${head}.${claims}.${b64url(s.sign(pem))}`
}

function normalizePem(key: string): string {
  if (!key) throw Error('Missing dsPrivateKey secret')
  let str = String(key).trim()
  if (str.startsWith('"') && str.endsWith('"')) str = str.slice(1, -1)
  str = str.replace(/\\n/g, '\n')
  return str
}
