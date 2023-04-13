import forCreateISO from './mutations/createISO.js'
import forAllSO from './queries/allISO.js'
import ISOById from './queries/ISOById.js'
import forUpdateISO from './mutations/updateISO.js'
import forDeleteISO from './mutations/deleteISO.js'
const forISOexport = [forUpdateISO, forCreateISO, forAllSO, ISOById, forDeleteISO]

export default forISOexport
