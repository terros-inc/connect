import { toGhlStage, toTerrosStage } from './config.ts'

describe('GoHighLevel config', () => {
  test('maps a Terros stage to a GoHighLevel stage', () => {
    expect(toGhlStage(' Activity ', { activity: 'Lead' })).toBe('Lead')
  })

  test('maps a GoHighLevel stage back to a Terros stage', () => {
    expect(toTerrosStage(' lead ', { Activity: 'Lead' })).toBe('Activity')
  })

  test('uses the same trimmed stage name when no mapping is configured', () => {
    expect(toGhlStage(' Appointment Set ')).toBe('Appointment Set')
    expect(toTerrosStage(' Appointment Set ')).toBe('Appointment Set')
  })
})
