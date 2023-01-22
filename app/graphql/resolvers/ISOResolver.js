import forCreateISO from './ISO/create';
import forAllSO from './ISO/allISO';
import ISOById from './ISO/ISOById';
import forDeleteISO from './ISO/delete';
const forISOexport =  [
    forCreateISO,
    forAllSO,
    ISOById,
    forDeleteISO 
]

export default forISOexport;