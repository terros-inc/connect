import { wrapConnectHandler } from '@terros-inc/sdk'

type AirtableSyncPayload = {
  data: {
    id: string
    name: string
    accessStatus?: string
    kind?: string
    maxUsers?: number
  }
}

export default wrapConnectHandler<AirtableSyncPayload>(async (input) => {
  const { payload, config } = input.context
  const { accessKey } = config.secrets

  const body = {
    performUpsert: {
      fieldsToMergeOn: ['Name', 'TerrosId'],
    },
    records: [
      {
        fields: {
          TerrosId: payload.data.id,
          Name: payload.data.name,
          'Terros State': payload.data.accessStatus || payload.data.kind,
          MaxUsers: payload.data.maxUsers,
        },
      },
    ],
  }

  const response = await fetch('https://api.airtable.com/v0/appdkCHwnSvxEDpTd/tbl0FTceajLjffjZG', {
    method: 'PATCH',
    headers: {
      Authorization: `Bearer ${accessKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  })

  if (!response.ok) {
    console.error(`Airtable request failed with status ${response.status}`)
    throw Error(`Failed to update Airtable: ${response.status} ${response.statusText}`)
  }
})
