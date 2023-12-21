import forCreateISO from './mutations/createISO'
import forAllSO from './queries/allISO'
import ISOById from './queries/ISOById'
import forUpdateISO from './mutations/updateISO'
import forDeleteISO from './mutations/deleteISO'

const forISOexport = [
  forUpdateISO,
  forCreateISO,
  forAllSO,
  ISOById,
  forDeleteISO
]

export default forISOexport;
