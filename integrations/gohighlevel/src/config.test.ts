import { resolveGoHighLevelStageName, resolveTerrosStageName } from './config.ts'

describe('GoHighLevel config', () => {
  test('maps a Terros stage to a GoHighLevel stage', () => {
    expect(resolveGoHighLevelStageName(' Activity ', { activity: 'Lead' })).toBe('Lead')
  })

  test('maps a GoHighLevel stage back to a Terros stage', () => {
    expect(resolveTerrosStageName(' lead ', { Activity: 'Lead' })).toBe('Activity')
  })

  test('uses the same trimmed stage name when no mapping is configured', () => {
    expect(resolveGoHighLevelStageName(' Appointment Set ')).toBe('Appointment Set')
    expect(resolveTerrosStageName(' Appointment Set ')).toBe('Appointment Set')
  })
})
