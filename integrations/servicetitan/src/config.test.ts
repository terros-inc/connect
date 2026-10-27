import { parseConfig, parseSecrets } from './config.ts'

const required = { jobTypeId: '1001', cancelReasonId: '9001', serviceTitanJobId: 'CF.servicetitanjob' }
it.each(['jobTypeId', 'cancelReasonId', 'serviceTitanJobId'])(
  'rejects missing %s before any customer is created',
  (field) => {
    const raw: Record<string, string> = { ...required }
    delete raw[field]
    expect(() => parseConfig(raw)).toThrow(field)
  }
)
it.each(['abc', '0', '-1', '1.5', 'Infinity', '9007199254740992'])(
  'rejects invalid numeric config %s instead of sending a bad tenant ID',
  (value) => {
    expect(() => parseConfig({ ...required, customFieldSetter: value })).toThrow('customFieldSetter')
    expect(() => parseConfig({ ...required, teamToBusinessUnitMap: { 'Example team': value } })).toThrow(
      'teamToBusinessUnitMap'
    )
  }
)
it('parses string IDs and mapping values so business units are sent as numbers', () => {
  expect(parseConfig({ ...required, teamToBusinessUnitMap: { 'Example team': '3001' } })).toMatchObject({
    jobTypeId: 1001,
    cancelReasonId: 9001,
    teamToBusinessUnitMap: { 'Example team': 3001 },
  })
  expect(() => parseConfig({ ...required, serviceTitanJobId: 'wrong' })).toThrow('serviceTitanJobId')
})
// A typo must not fall through as off: that would write to ServiceTitan during a dry-run pilot.
it('defaults dryRun to false and rejects anything other than true or false', () => {
  expect(parseConfig(required).dryRun).toBe(false)
  expect(parseConfig({ ...required, dryRun: '' }).dryRun).toBe(false)
  expect(parseConfig({ ...required, dryRun: ' false ' }).dryRun).toBe(false)
  expect(parseConfig({ ...required, dryRun: 'true' }).dryRun).toBe(true)
  expect(parseConfig({ ...required, dryRun: true }).dryRun).toBe(true)
  expect(() => parseConfig({ ...required, dryRun: 'yes' })).toThrow('dryRun')
})
it('refuses incomplete credentials and malformed tenant IDs before authenticating', () => {
  expect(() => parseSecrets({})).toThrow('appKey')
  expect(() => parseSecrets({ appKey: 'key', clientId: 'client', clientSecret: 'secret', tenantId: 'tenant' })).toThrow(
    'tenantId'
  )
})
