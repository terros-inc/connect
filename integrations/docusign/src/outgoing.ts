import { createSign } from 'node:crypto'
import { type AccountWebhook, type AccountWebhookData, type CustomFieldMap, wrapConnectHandler } from '@terros-inc/sdk'

type EnvelopeResult = { envelopeId: string; status: string }

type DocusignScriptConfig = {
  ccRoleName?: string
  dsAccountId?: string
  dsAuthServer?: string
  dsBaseUri?: string
  fieldMappings?: Record<string, string>
  signerRoleName?: string
  templateId?: string
}

export const handler = wrapConnectHandler<AccountWebhook, EnvelopeResult>(async (input) => {
  const payload = input.context.payload
  const scriptConfig: DocusignScriptConfig = input.context.config.scriptConfig || {}
  const secrets = input.context.config.secrets || {}

  if (payload.action === 'remove') {
    console.log('Skipping Docusign send for Account remove')
    throw Error('Account removed: not firing')
  }

  const account = payload.data
  if (!account) {
    console.log('Missing account payload data', JSON.stringify(payload.data?.id))
    throw Error('Missing account data')
  }

  const { dsIntegrationKey, dsUserId, dsPrivateKey } = secrets
  if (!dsIntegrationKey) throw Error('Missing Docusign auth secret: dsIntegrationKey')
  if (!dsUserId) throw Error('Missing Docusign auth secret: dsUserId')
  if (!dsPrivateKey) throw Error('Missing Docusign auth secret: dsPrivateKey')

  const { dsAuthServer, dsBaseUri, dsAccountId, templateId, signerRoleName } = scriptConfig
  if (!dsAuthServer) throw Error('Missing Docusign script config: dsAuthServer')
  if (!dsBaseUri) throw Error('Missing Docusign script config: dsBaseUri')
  if (!dsAccountId) throw Error('Missing Docusign script config: dsAccountId')
  if (!templateId) throw Error('Missing Docusign script config: templateId')
  if (!signerRoleName) throw Error('Missing Docusign script config: signerRoleName')

  const accountId = String(account.id || '')
  if (!accountId) {
    console.log('Missing account id', JSON.stringify(account))
    throw Error('Missing account id')
  }

  const fieldMappings = scriptConfig.fieldMappings || {}
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

  const assertion = buildJwt(dsAuthServer, dsIntegrationKey, dsUserId, dsPrivateKey)
  const tokenUrl = `https://${dsAuthServer.replace(/\/+$/, '')}/oauth/token`
  const tokenBody = new URLSearchParams({ grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion })

  const tokenRes = await fetch(tokenUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: tokenBody,
  })
  if (!tokenRes.ok) {
    const text = await tokenRes.text()
    console.log(`Docusign auth failed: ${tokenRes.status} ${tokenRes.statusText} ${text}`)
    throw Error('Docusign auth failed')
  }
  const { access_token } = (await tokenRes.json()) as { access_token: string }

  const envRes = await fetch(`${dsBaseUri.replace(/\/+$/, '')}/restapi/v2.1/accounts/${dsAccountId}/envelopes`, {
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
    console.log(`Docusign envelope create failed: ${envRes.status} ${envRes.statusText} ${text}`)
    throw Error('Docusign envelope create failed')
  }
  const envelope = (await envRes.json()) as { envelopeId: string; status: string }

  console.log(`Created Docusign envelope ${envelope.envelopeId} for account ${accountId}`)

  return { envelopeId: envelope.envelopeId, status: envelope.status }
})

function resolveField(account: AccountWebhookData, ref: string): string | undefined {
  if (!ref) return undefined
  const key = String(ref).trim()
  if (!key) return undefined
  if (key.startsWith('CF.')) {
    const customFields = account.customFields as CustomFieldMap | undefined
    const value = customFields?.[key as keyof CustomFieldMap]
    return value === null || value === undefined ? undefined : String(value)
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

function buildJwt(dsAuthServer: string, dsIntegrationKey: string, dsUserId: string, dsPrivateKey: string): string {
  const b64url = (b: Buffer): string => b.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
  const now = Math.floor(Date.now() / 1000)
  const head = b64url(Buffer.from(JSON.stringify({ alg: 'RS256', typ: 'JWT' })))
  const claims = b64url(
    Buffer.from(
      JSON.stringify({
        iss: dsIntegrationKey,
        sub: dsUserId,
        aud: dsAuthServer.replace(/\/+$/, ''),
        iat: now,
        exp: now + 3600,
        scope: 'signature impersonation',
      })
    )
  )
  const s = createSign('RSA-SHA256')
  s.update(`${head}.${claims}`)
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
