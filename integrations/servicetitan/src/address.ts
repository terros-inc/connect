export function toState(state = ''): string {
  const trimmedState = state.toLowerCase().trim()
  switch (trimmedState) {
    case 'alabama':
      return 'AL'
    case 'alaska':
      return 'AK'
    case 'arizona':
      return 'AZ'
    case 'arkansas':
      return 'AR'
    case 'california':
      return 'CA'
    case 'colorado':
      return 'CO'
    case 'connecticut':
      return 'CT'
    case 'delaware':
      return 'DE'
    case 'florida':
      return 'FL'
    case 'georgia':
      return 'GA'
    case 'hawaii':
      return 'HI'
    case 'idaho':
      return 'ID'
    case 'illinois':
      return 'IL'
    case 'indiana':
      return 'IN'
    case 'iowa':
      return 'IA'
    case 'kansas':
      return 'KS'
    case 'kentucky':
      return 'KY'
    case 'louisiana':
      return 'LA'
    case 'maine':
      return 'ME'
    case 'maryland':
      return 'MD'
    case 'massachusetts':
      return 'MA'
    case 'michigan':
      return 'MI'
    case 'minnesota':
      return 'MN'
    case 'mississippi':
      return 'MS'
    case 'missouri':
      return 'MO'
    case 'montana':
      return 'MT'
    case 'nebraska':
      return 'NE'
    case 'nevada':
      return 'NV'
    case 'new hampshire':
      return 'NH'
    case 'new jersey':
      return 'NJ'
    case 'new mexico':
      return 'NM'
    case 'new york':
      return 'NY'
    case 'north carolina':
      return 'NC'
    case 'north dakota':
      return 'ND'
    case 'ohio':
      return 'OH'
    case 'oklahoma':
      return 'OK'
    case 'oregon':
      return 'OR'
    case 'pennsylvania':
      return 'PA'
    case 'rhode island':
      return 'RI'
    case 'south carolina':
      return 'SC'
    case 'south dakota':
      return 'SD'
    case 'tennessee':
      return 'TN'
    case 'texas':
      return 'TX'
    case 'utah':
      return 'UT'
    case 'vermont':
      return 'VT'
    case 'virginia':
      return 'VA'
    case 'washington':
      return 'WA'
    case 'west virginia':
      return 'WV'
    case 'wisconsin':
      return 'WI'
    case 'wyoming':
      return 'WY'
    case 'district of columbia':
      return 'DC'
    default:
      return trimmedState.slice(0, 2).toUpperCase()
  }
}

export function toZip(zip = ''): string {
  if (zip.includes('-')) return zip.split('-')[0]!
  return zip.trim()
}
