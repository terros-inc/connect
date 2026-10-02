import manifest from '../terros.json' with { type: 'json' }
import { isOpportunityStage } from './outgoing.ts'
import { checkConfig, configSchemaFor, scriptFieldNames, type ScriptKey } from './configFields.ts'
import { isSwitchOn, toGhlStage, toTerrosStage } from './config.ts'
import { splitList } from './alerts.ts'

const scriptNames: Record<ScriptKey, string> = {
  accountSync: 'GoHighLevel Account Sync',
  opportunityWebhook: 'GoHighLevel Opportunity Webhook',
  appointmentSync: 'GoHighLevel Appointment Sync',
  appointmentWebhook: 'GoHighLevel Appointment Webhook',
  resync: 'GoHighLevel Resync',
}

// HQ Energy's install config, with every id and URL replaced by a placeholder. Keep its shape: the point of this
// fixture is that a later change cannot start rejecting or reinterpreting what HQ has saved.
const hqConfig = {
  goHighLevelCompanyId: 'company-id',
  contactFieldMappings: {
    'CF.custom-field-1': '{{ contact.custom_one }}',
    'account.owner.email': '{{ contact.owner_email }}',
  },
  pipelineId: 'pipeline-id',
  opportunityIdFieldId: 'CF.opportunity-id',
  locationId: 'location-id',
  stageMappings: {
    'S.shown': 'Shown',
    'S.cancelled-appt': 'Cancelled Appt/No Show',
    'S.declined': 'Declined Proposal',
    'S.follow-up': 'Follow-up/Nurture',
    'S.signed': 'Contract Signed',
    'S.cancelled-contract': 'Cancelled Contract',
    'S.installed': 'Installed',
  },
  opportunityStages: 'Appointment Set, Contract Signed',
  teamPipelines: { 'T.team-one': 'pipeline-one', 'T.team-two': 'pipeline-two', 'T.team-three': 'pipeline-three' },
  dryRun: '',
  alertWebhookUrl: 'https://alerts.example.com/hook',
}

describe('config fields', () => {
  test.each(Object.keys(scriptNames) as ScriptKey[])('terros.json declares the shared fields for %s', (key) => {
    const script = manifest.scripts.find((candidate) => candidate.name === scriptNames[key])
    expect(script?.configSchema).toEqual(configSchemaFor(key))
  })

  test('every terros.json script has a field list', () => {
    expect(manifest.scripts.map((script) => script.name).sort()).toEqual(Object.values(scriptNames).sort())
    expect(Object.keys(scriptFieldNames).sort()).toEqual(Object.keys(scriptNames).sort())
  })

  test('a shared field has the same declaration in every script that uses it', () => {
    const declarations = new Map<string, string>()
    for (const script of manifest.scripts) {
      for (const field of script.configSchema) {
        const json = JSON.stringify(field)
        expect(declarations.get(field.name) ?? json).toBe(json)
        declarations.set(field.name, json)
      }
    }
  })
})

describe("HQ Energy's saved config", () => {
  test('has no missing or unknown keys apart from the two unused ones', () => {
    expect(checkConfig('accountSync', hqConfig)).toEqual([
      'Config key goHighLevelCompanyId is not used by any GoHighLevel script and is ignored',
      'Config key teamPipelines is not used by any GoHighLevel script and is ignored',
    ])
  })

  test('keeps running with its switches off', () => {
    expect(isSwitchOn('disabled', undefined)).toBe(false)
    expect(isSwitchOn('dryRun', hqConfig.dryRun)).toBe(false)
  })

  test('still reads its opportunity stages and stage mappings the same way', () => {
    expect(splitList(hqConfig.opportunityStages)).toEqual(['Appointment Set', 'Contract Signed'])
    expect(isOpportunityStage('contract signed', hqConfig.opportunityStages)).toBe(true)
    expect(isOpportunityStage('Shown', hqConfig.opportunityStages)).toBe(false)
    // Incoming sends the stage ID key to Terros; outgoing never matches an ID key, so the Terros stage name is used.
    expect(toTerrosStage('Cancelled Appt/No Show', hqConfig.stageMappings)).toBe('S.cancelled-appt')
    expect(toGhlStage('Shown', hqConfig.stageMappings)).toBe('Shown')
  })

  test('works for the other scripts too', () => {
    // One shared install config can carry keys another script reads; none of them is a missing required key.
    for (const script of Object.keys(scriptNames) as ScriptKey[]) {
      const missing = checkConfig(script, { ...hqConfig, calendarId: 'calendar-id' }).filter((problem) =>
        problem.startsWith('Missing')
      )
      expect(missing).toEqual([])
    }
  })
})

describe('checkConfig', () => {
  test('reports missing required keys', () => {
    expect(checkConfig('appointmentWebhook', { locationId: ' ' })).toEqual([
      'Missing required config locationId',
      'Missing required config calendarId',
    ])
  })

  test('reports unknown keys but not keys another script reads', () => {
    expect(
      checkConfig('appointmentWebhook', { locationId: 'l', calendarId: 'c', pipelineId: 'p', stageMapping: {} })
    ).toEqual(['Unknown config key stageMapping is ignored'])
  })
})

describe('isSwitchOn', () => {
  test.each(['', ' ', 'false', 'FALSE', 'no', 'off', '0'])('%j is off', (value) => {
    expect(isSwitchOn('dryRun', value)).toBe(false)
  })

  test.each(['true', ' True ', 'yes', 'on', '1'])('%j is on', (value) => {
    expect(isSwitchOn('dryRun', value)).toBe(true)
  })

  test('any other text is on, so a typo holds the script back instead of letting it write', () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {})
    expect(isSwitchOn('disabled', 'ture')).toBe(true)
    expect(error).toHaveBeenCalledWith('Config disabled is "ture", expected true or false; treating it as true')
    error.mockRestore()
  })
})
