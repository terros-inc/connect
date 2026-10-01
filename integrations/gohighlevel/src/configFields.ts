// One definition of every install config field. terros.json's configSchema for each script is built from this list
// (configFields.test.ts fails if they drift), and handlers call checkConfig with the script they are.

type FieldType = 'string' | 'number' | 'mapping'

type ConfigField = {
  name: string
  type: FieldType
  description: string
  dataType?: 'None' | 'Account' | 'User' | 'Event'
  /** The script cannot do its job without it. */
  required?: boolean
}

const switchHelp = 'Blank or false: run normally. Any other text, including a typo, counts as true.'

export const configFields = {
  locationId: {
    name: 'locationId',
    type: 'string',
    description: 'GoHighLevel location (sub-account) ID. Required.',
    required: true,
  },
  pipelineId: {
    name: 'pipelineId',
    type: 'string',
    description: 'GoHighLevel pipeline ID that opportunities are created in. Required.',
    required: true,
  },
  calendarId: {
    name: 'calendarId',
    type: 'string',
    description: 'GoHighLevel calendar ID whose appointments are synced. Required.',
    required: true,
  },
  stageMappings: {
    name: 'stageMappings',
    type: 'mapping',
    dataType: 'None',
    description:
      'Optional. Key: a Terros workflow stage. Value: the GoHighLevel pipeline stage name. ' +
      'Outgoing (Account Sync): a key equal to the Terros stage NAME picks the GoHighLevel stage; with no match the Terros stage name is used as is. ' +
      'Incoming (Opportunity Webhook): the GoHighLevel stage name is looked up among the values and its key is sent to Terros, so use a Terros stage ID as the key ' +
      '(or a name listed in the workflow integration mappings). With no match the GoHighLevel stage name is sent, and Terros ignores it unless the workflow integration mappings know it.',
  },
  contactFieldMappings: {
    name: 'contactFieldMappings',
    type: 'mapping',
    dataType: 'Account',
    description:
      'Optional. Key: a Terros account field (for example account.owner.email) or custom field ID (CF.…). Value: a GoHighLevel merge field such as {{ contact.owner_email }}.',
  },
  opportunityStages: {
    name: 'opportunityStages',
    type: 'string',
    description:
      'Optional. Comma-separated Terros stage names, for example Appointment Set, Contract Signed. An account entering one of them gets a GoHighLevel opportunity if it has none. Case is ignored. Blank means Appointment Set.',
  },
  opportunityIdFieldId: {
    name: 'opportunityIdFieldId',
    type: 'string',
    description:
      'Optional. Terros custom field ID (CF.…) that receives the GoHighLevel opportunity ID. A value not starting with CF. is ignored with a warning.',
  },
  alertWebhookUrl: {
    name: 'alertWebhookUrl',
    type: 'string',
    description:
      'Optional. URL that receives a JSON POST when a sync needs attention (Account Sync: an account in an opportunity stage has no closer; Appointment Sync: an appointment create or change was refused). A failed delivery is only logged.',
  },
  alertRecipients: {
    name: 'alertRecipients',
    type: 'string',
    description:
      'Optional. Comma-separated emails. Only copied into the alert webhook JSON as recipients; this integration sends no email, so the receiver of alertWebhookUrl must act on them.',
  },
  disabled: {
    name: 'disabled',
    type: 'string',
    description: `Kill switch. Type true to make this script do nothing. ${switchHelp}`,
  },
  dryRun: {
    name: 'dryRun',
    type: 'string',
    description: `Type true to log what this script would write without writing anything. ${switchHelp}`,
  },
} satisfies Record<string, ConfigField>

type FieldName = keyof typeof configFields

export const scriptFieldNames = {
  accountSync: [
    'locationId',
    'pipelineId',
    'stageMappings',
    'contactFieldMappings',
    'opportunityStages',
    'opportunityIdFieldId',
    'alertWebhookUrl',
    'alertRecipients',
    'disabled',
    'dryRun',
  ],
  opportunityWebhook: ['locationId', 'stageMappings', 'disabled', 'dryRun'],
  appointmentSync: ['locationId', 'calendarId', 'alertWebhookUrl', 'alertRecipients', 'disabled', 'dryRun'],
  appointmentWebhook: ['locationId', 'calendarId', 'disabled', 'dryRun'],
} as const satisfies Record<string, readonly FieldName[]>

export type ScriptKey = keyof typeof scriptFieldNames

/** The configSchema entry list for a script, in the shape terros.json declares. */
export function configSchemaFor(script: ScriptKey): Omit<ConfigField, 'required'>[] {
  return scriptFieldNames[script].map((name) => {
    const { required: _required, ...field } = configFields[name] as ConfigField
    return field
  })
}

/** Keys earlier installs may still hold. Nothing reads them and the platform keeps unknown keys, so they are harmless. */
const unusedKeys = ['goHighLevelCompanyId', 'teamPipelines']

/**
 * Logs config problems for a script without changing what it does. Returns the problems so tests can assert them.
 * A key another script reads is fine here, since installs may share one set of values across scripts.
 */
export function checkConfig(script: ScriptKey, config: Record<string, unknown>): string[] {
  const problems: string[] = []
  for (const name of scriptFieldNames[script]) {
    const field: ConfigField = configFields[name]
    const value = config[name]
    if (field.required && (typeof value !== 'string' || !value.trim())) problems.push(`Missing required config ${name}`)
  }
  for (const key of Object.keys(config)) {
    if (key in configFields) continue
    problems.push(
      unusedKeys.includes(key)
        ? `Config key ${key} is not used by any GoHighLevel script and is ignored`
        : `Unknown config key ${key} is ignored`
    )
  }
  for (const problem of problems) console.log(problem)
  return problems
}
