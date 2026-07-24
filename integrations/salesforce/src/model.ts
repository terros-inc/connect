export type SalesforceLeadAddRequest = {
  FirstName: string
  LastName: string
  Email: string
  Company: string
  Street?: string
  City?: string
  State?: string
  PostalCode?: string
  Phone?: string
  Latitude_Longitude__latitude__s?: number
  Latitude_Longitude__longitude__s?: number
  Lead_Type__c?: string
  Spotio_ID__c?: string
  Lead_Setter__c?: string
  Closer__c?: string
}

export type SalesforceLeadAddResponse = {
  id: string
  success: boolean
  errors: { errorCode?: string }[]
}
