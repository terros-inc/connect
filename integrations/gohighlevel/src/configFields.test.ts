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
}

// Acme Solar's fictional install config. Keep its shape: the point of this fixture is that a later change cannot
// start rejecting or reinterpreting a representative saved config.
const acmeConfig = {
  goHighLevelCompanyId: 'company-id-placeholder',
  contactFieldMappings: {
    'CF.field-a': '{{ contact.field_a }}',
    'account.owner.email': '{{ contact.owner_email }}',
  },
  pipelineId: 'pipeline-id-placeholder',
  opportunityIdFieldId: 'CF.opportunity-id-placeholder',
  locationId: 'location-id-placeholder',
  stageMappings: {
    'stage-id-a': 'Stage A',
    'stage-id-b': 'Stage B',
    'stage-id-c': 'Stage C',
  },
  opportunityStages: 'Stage A, Stage B',
  teamPipelines: { 'team-id-a': 'pipeline-id-a', 'team-id-b': 'pipeline-id-b' },
  dryRun: '',
  alertWebhookUrl: 'https://alerts.example.test/hook',
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

describe("Acme Solar's placeholder config", () => {
  test('has no missing or unknown keys apart from the two unused ones', () => {
    expect(checkConfig('accountSync', acmeConfig)).toEqual([
      'Config key goHighLevelCompanyId is not used by any GoHighLevel script and is ignored',
      'Config key teamPipelines is not used by any GoHighLevel script and is ignored',
    ])
  })

  test('keeps running with its switches off', () => {
    expect(isSwitchOn('disabled', undefined)).toBe(false)
    expect(isSwitchOn('dryRun', acmeConfig.dryRun)).toBe(false)
  })

  test('still reads its opportunity stages and stage mappings the same way', () => {
    expect(splitList(acmeConfig.opportunityStages)).toEqual(['Stage A', 'Stage B'])
    expect(isOpportunityStage('stage b', acmeConfig.opportunityStages)).toBe(true)
    expect(isOpportunityStage('Stage C', acmeConfig.opportunityStages)).toBe(false)
    // Incoming sends the stage ID key to Terros; outgoing never matches an ID key, so the Terros stage name is used.
    expect(toTerrosStage('Stage B', acmeConfig.stageMappings)).toBe('stage-id-b')
    expect(toGhlStage('Stage A', acmeConfig.stageMappings)).toBe('Stage A')
  })

  test('works for the other scripts too', () => {
    // One shared install config can carry keys another script reads; none of them is a missing required key.
    for (const script of Object.keys(scriptNames) as ScriptKey[]) {
      const missing = checkConfig(script, { ...acmeConfig, calendarId: 'calendar-id-placeholder' }).filter((problem) =>
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
