import { getInfinization } from '../InfinizationService'
import { type NodeExecutor } from './NodeExecutor'

/**
 * Executes VM verbs against THIS host's in-process infinization instance —
 * byte-for-byte the single-node path. Resolves the (cached) instance lazily per
 * call, exactly as the call sites did before the routing seam was introduced.
 *
 * Kept separate from NodeExecutor.ts so the verb-wire types/classes a node agent
 * needs (`RemoteNodeExecutor`, `VM_VERB_METHODS`) can be imported without pulling
 * in the backend's Prisma-backed InfinizationService singleton.
 */
type E = NodeExecutor

export class LocalNodeExecutor implements NodeExecutor {
  async createVM (...a: Parameters<E['createVM']>): Promise<Awaited<ReturnType<E['createVM']>>> {
    return (await getInfinization()).createVM(...a)
  }

  async startVM (...a: Parameters<E['startVM']>): Promise<Awaited<ReturnType<E['startVM']>>> {
    return (await getInfinization()).startVM(...a)
  }

  async stopVM (...a: Parameters<E['stopVM']>): Promise<Awaited<ReturnType<E['stopVM']>>> {
    return (await getInfinization()).stopVM(...a)
  }

  async restartVM (...a: Parameters<E['restartVM']>): Promise<Awaited<ReturnType<E['restartVM']>>> {
    return (await getInfinization()).restartVM(...a)
  }

  async resetVM (...a: Parameters<E['resetVM']>): Promise<Awaited<ReturnType<E['resetVM']>>> {
    return (await getInfinization()).resetVM(...a)
  }

  async suspendVM (...a: Parameters<E['suspendVM']>): Promise<Awaited<ReturnType<E['suspendVM']>>> {
    return (await getInfinization()).suspendVM(...a)
  }

  async resumeVM (...a: Parameters<E['resumeVM']>): Promise<Awaited<ReturnType<E['resumeVM']>>> {
    return (await getInfinization()).resumeVM(...a)
  }

  async destroyVM (...a: Parameters<E['destroyVM']>): Promise<Awaited<ReturnType<E['destroyVM']>>> {
    return (await getInfinization()).destroyVM(...a)
  }

  async getVMStatus (...a: Parameters<E['getVMStatus']>): Promise<Awaited<ReturnType<E['getVMStatus']>>> {
    return (await getInfinization()).getVMStatus(...a)
  }

  async attachToRunningVM (...a: Parameters<E['attachToRunningVM']>): Promise<Awaited<ReturnType<E['attachToRunningVM']>>> {
    return (await getInfinization()).attachToRunningVM(...a)
  }

  async guestExec (...a: Parameters<E['guestExec']>): Promise<Awaited<ReturnType<E['guestExec']>>> {
    return (await getInfinization()).guestExec(...a)
  }
}
