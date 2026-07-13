export type LatLng = {
  latitude: number
  longitude: number
}

export type Address = {
  country: 'US' | 'CA' | 'PR'
  countrySubd: string
  line1: string
  line2: string
  locality: string
  oneLine: string
  postal1: string
  postal2?: string
  postal3?: string
  unitNbr?: string
}

export type SmallAddress = Pick<
  Address,
  'countrySubd' | 'line1' | 'locality' | 'postal1' | 'postal2' | 'postal3' | 'unitNbr'
> & {
  line2?: string
  oneLine?: string
  latlng: LatLng
}
