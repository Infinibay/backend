# Plan de Integración: infinization → backend

## Resumen Ejecutivo

Este documento detalla el plan para integrar `infinization` en el backend de Infinibay, reemplazando `libvirt-node` y consolidando la gestión de VMs.

### Qué Reemplaza infinization

| Componente Actual | Reemplazo con infinization | Beneficio |
|-------------------|-------------------------|-----------|
| `@infinibay/libvirt-node` | `Infinization` class | API unificada, sin binding nativo |
| XML generation manual | `QemuCommandBuilder` | Type-safe, validación integrada |
| Cron `UpdateVmStatus` | `HealthMonitor` + `EventHandler` | Tiempo real via QMP |
| `LibvirtNWFilterService` | `NftablesService` | Firewall moderno (nftables vs iptables) |
| Storage manual | `QemuImgService` | Snapshots, resize, convert |
| Sin monitoreo de crashes | `HealthMonitor` | Detección automática + cleanup |

---

## Fase 1: Preparación (Sin cambios funcionales)

### 1.1 Agregar infinization como dependencia

```bash
# En backend/
npm install file:../infinization
```

**Archivo**: `package.json`
```json
{
  "dependencies": {
    "@infinibay/infinization": "file:../infinization"
  }
}
```

### 1.2 Crear servicio singleton de Infinization

**Nuevo archivo**: `app/services/InfinizationService.ts`

```typescript
import { Infinization, PrismaAdapter } from '@infinibay/infinization'
import { prisma } from '../utils/prisma'
import { getEventManager } from './EventManager'

let infinizationInstance: Infinization | null = null

export async function getInfinization(): Promise<Infinization> {
  if (!infinizationInstance) {
    infinizationInstance = new Infinization({
      prismaClient: prisma,
      eventManager: getEventManager(),
      diskDir: process.env.INFINIZATION_DISK_DIR || '/var/lib/infinization/disks',
      qmpSocketDir: process.env.INFINIZATION_SOCKET_DIR || '/var/run/infinization',
      pidfileDir: process.env.INFINIZATION_PID_DIR || '/var/run/infinization/pids',
      healthMonitorInterval: 30000,
      autoStartHealthMonitor: true
    })
    await infinizationInstance.initialize()
  }
  return infinizationInstance
}

export async function shutdownInfinization(): Promise<void> {
  if (infinizationInstance) {
    await infinizationInstance.shutdown()
    infinizationInstance = null
  }
}
```

### 1.3 Actualizar EventManager para compatibilidad

**Archivo**: `app/services/EventManager.ts`

Agregar método `emitCRUD` si no existe:
```typescript
emitCRUD(resource: string, action: string, id: string, data?: unknown): void {
  this.dispatchEvent(resource, action, { id, ...data })
}
```

---

## Fase 2: Migración de Operaciones de VM

### 2.1 Mapeo de APIs: libvirt-node → infinization

| Operación | libvirt-node | infinization |
|-----------|--------------|-----------|
| Crear VM | `VirtualMachine.defineXml()` + `vm.create()` | `infinization.createVM(config)` |
| Iniciar VM | `domain.create()` | `infinization.startVM(vmId)` |
| Apagar VM (graceful) | `domain.shutdown()` | `infinization.stopVM(vmId, {graceful: true})` |
| Apagar VM (force) | `domain.destroy()` | `infinization.stopVM(vmId, {force: true})` |
| Reiniciar VM | `domain.shutdown()` + `domain.create()` | `infinization.restartVM(vmId)` |
| Suspender VM | `domain.suspend()` | `infinization.suspendVM(vmId)` |
| Reanudar VM | `domain.resume()` | `infinization.resumeVM(vmId)` |
| Reset hardware | `domain.reset()` | `infinization.resetVM(vmId)` |
| Estado VM | `domain.getState()` | `infinization.getVMStatus(vmId)` |
| Destruir VM | `domain.destroy()` + `domain.undefine()` | `infinization.stopVM()` + cleanup manual |

### 2.2 Migrar VMOperationsService

**Archivo**: `app/services/VMOperationsService.ts`

#### Antes (libvirt-node):
```typescript
async startMachine(machineId: string) {
  const conn = await getLibvirtConnection()
  const domain = VirtualMachine.lookupByName(conn, machine.internalName)
  const result = domain.create()
  await prisma.machine.update({ where: { id: machineId }, data: { status: 'running' } })
}
```

#### Después (infinization):
```typescript
async startMachine(machineId: string) {
  const infinization = await getInfinization()
  const result = await infinization.startVM(machineId)
  if (!result.success) {
    throw new Error(result.error || 'Failed to start VM')
  }
  // DB update handled by infinization via PrismaAdapter
}
```

### 2.3 Migrar CreateMachineService

**Archivo**: `app/utils/VirtManager/createMachineService.ts`

#### Cambios principales:

1. **Eliminar**: XML generation, StoragePool/StorageVol creation
2. **Reemplazar con**: `infinization.createVM(config)`

```typescript
import { getInfinization } from '../../services/InfinizationService'
import { VMCreateConfig } from '@infinibay/infinization'

async create(machine: Machine, username: string, password: string, productKey?: string) {
  const infinization = await getInfinization()

  const config: VMCreateConfig = {
    vmId: machine.id,
    name: machine.name,
    internalName: machine.internalName,
    os: machine.os,
    cpuCores: machine.cpuCores,
    ramGB: machine.ramGB,
    disks: [{ sizeGB: machine.diskSizeGB }],
    bridge: 'virbr0',
    displayType: 'spice',
    displayPort: await this.findAvailablePort(),
    displayPassword: this.generatePassword(),
    gpuPciAddress: machine.gpuPciAddress || undefined,

    // Unattended installation
    unattendedInstall: {
      vmId: machine.id,
      os: machine.os as any,
      username,
      password,
      applications: await this.getApplicationsForMachine(machine.id),
      scripts: await this.getScriptsForMachine(machine.id)
    }
  }

  const result = await infinization.createVM(config)

  if (!result.success) {
    throw new Error('VM creation failed')
  }

  return {
    tapDevice: result.tapDevice,
    qmpSocketPath: result.qmpSocketPath,
    pid: result.pid,
    diskPaths: result.diskPaths
  }
}
```

### 2.4 Migrar MachineCleanupService

**Archivo**: `app/services/cleanup/machineCleanupService.ts`

```typescript
async cleanupVM(machineId: string) {
  const infinization = await getInfinization()

  // 1. Stop VM if running
  try {
    await infinization.stopVM(machineId, { graceful: false, force: true })
  } catch (e) {
    // VM might already be stopped
  }

  // 2. Get disk paths from DB before cleanup
  const config = await prisma.machineConfiguration.findUnique({
    where: { machineId }
  })

  // 3. Clean up disks manually (infinization doesn't delete disks)
  if (config?.diskPaths) {
    for (const diskPath of config.diskPaths as string[]) {
      await fs.promises.unlink(diskPath).catch(() => {})
    }
  }

  // 4. Clean up firewall (infinization's NftablesService)
  const nftables = infinization.getNftablesService()
  await nftables.removeVMChain(machineId)

  // 5. DB cleanup
  await prisma.$transaction([
    prisma.machineConfiguration.delete({ where: { machineId } }),
    prisma.machineApplication.deleteMany({ where: { machineId } }),
    prisma.firewallRule.deleteMany({ where: { ruleSet: { entityId: machineId } } }),
    prisma.firewallRuleSet.deleteMany({ where: { entityId: machineId } }),
    prisma.machine.delete({ where: { id: machineId } })
  ])
}
```

---

## Fase 3: Migración de Firewall

### 3.1 Transición de nwfilter a nftables

| Aspecto | LibvirtNWFilterService | NftablesService |
|---------|----------------------|-----------------|
| Tecnología | libvirt nwfilter (iptables) | nftables nativo |
| Scope | Por VM | Por VM con herencia de dept |
| Performance | Rebuild completo | Incremental |
| Layer | L3-L4 | L2-L4 |

### 3.2 Migrar FirewallManager

**Archivo**: `app/services/firewall/FirewallManager.ts`

```typescript
// Antes: usa LibvirtNWFilterService
import { LibvirtNWFilterService } from './LibvirtNWFilterService'

// Después: usa NftablesService de infinization
import { getInfinization } from '../InfinizationService'

class FirewallManager {
  async ensureFirewallForVM(vmId: string, departmentId: string) {
    const infinization = await getInfinization()
    const nftables = infinization.getNftablesService()

    // Get TAP device from config
    const config = await prisma.machineConfiguration.findUnique({
      where: { machineId: vmId }
    })

    if (!config?.tapDeviceName) {
      throw new Error('VM has no TAP device configured')
    }

    // Get rules from DB
    const deptRules = await this.getDepartmentRules(departmentId)
    const vmRules = await this.getVMRules(vmId)

    // Apply via nftables
    await nftables.applyRules(vmId, config.tapDeviceName, deptRules, vmRules)
  }
}
```

### 3.3 Eliminar archivos obsoletos

- `app/services/firewall/LibvirtNWFilterService.ts` → DELETE
- `app/services/firewall/NwFilterFactory.ts` → DELETE (si existe)

---

## Fase 4: Migración de Snapshots

### 4.1 Actualizar SnapshotService

**Archivo**: `app/services/SnapshotService.ts`

```typescript
import { SnapshotManager } from '@infinibay/infinization'

class SnapshotService {
  private snapshotManager = new SnapshotManager()

  async createSnapshot(vmId: string, name: string, description?: string) {
    const config = await prisma.machineConfiguration.findUnique({
      where: { machineId: vmId }
    })

    const diskPath = (config?.diskPaths as string[])?.[0]
    if (!diskPath) throw new Error('No disk found')

    await this.snapshotManager.createSnapshot({
      imagePath: diskPath,
      name,
      description
    })
  }

  async listSnapshots(vmId: string) {
    const config = await prisma.machineConfiguration.findUnique({
      where: { machineId: vmId }
    })
    const diskPath = (config?.diskPaths as string[])?.[0]
    return this.snapshotManager.listSnapshots(diskPath)
  }

  async revertSnapshot(vmId: string, snapshotName: string) {
    // VM must be stopped first
    const infinization = await getInfinization()
    await infinization.stopVM(vmId, { force: true })

    const config = await prisma.machineConfiguration.findUnique({
      where: { machineId: vmId }
    })
    const diskPath = (config?.diskPaths as string[])?.[0]

    await this.snapshotManager.revertSnapshot(diskPath, snapshotName)
  }

  async deleteSnapshot(vmId: string, snapshotName: string) {
    const config = await prisma.machineConfiguration.findUnique({
      where: { machineId: vmId }
    })
    const diskPath = (config?.diskPaths as string[])?.[0]

    await this.snapshotManager.deleteSnapshot(diskPath, snapshotName)
  }
}
```

---

## Fase 5: Eliminar Dependencias de libvirt-node

### 5.1 Archivos a eliminar

| Archivo | Razón |
|---------|-------|
| `app/utils/libvirt.ts` | Singleton de conexión libvirt |
| `app/services/LibvirtConnectionPool.ts` | Pool de conexiones |
| `app/services/firewall/LibvirtNWFilterService.ts` | Reemplazado por NftablesService |
| `app/crons/UpdateVmStatus.ts` | Reemplazado por HealthMonitor |
| `lib/libvirt-node/` | Bindings nativos ya no necesarios |
| `__mocks__/libvirt-node.js` | Mocks de tests |

### 5.2 Archivos a modificar

| Archivo | Cambio |
|---------|--------|
| `app/services/VMOperationsService.ts` | Usar infinization |
| `app/utils/VirtManager/createMachineService.ts` | Usar infinization.createVM() |
| `app/utils/VirtManager/index.ts` | Eliminar imports libvirt |
| `app/services/cleanup/machineCleanupService.ts` | Usar infinization |
| `app/services/SnapshotService.ts` | Usar SnapshotManager |
| `app/services/firewall/FirewallManager.ts` | Usar NftablesService |
| `app/services/networkService.ts` | Evaluar si se necesita |
| `app/graphql/resolvers/machine/resolver.ts` | Verificar cambios de API |
| `package.json` | Eliminar @infinibay/libvirt-node |

### 5.3 Actualizar package.json

```json
{
  "dependencies": {
    // ELIMINAR:
    // "@infinibay/libvirt-node": "file:lib/libvirt-node/..."

    // AGREGAR:
    "@infinibay/infinization": "file:../infinization"
  }
}
```

---

## Fase 6: Migración de Estado y Eventos

### 6.1 Eliminar cron UpdateVmStatus

**Archivo a eliminar**: `app/crons/UpdateVmStatus.ts`

El `HealthMonitor` de infinization maneja esto automáticamente:
- Detecta VMs caídas via PID check
- Sincroniza estado via QMP events
- Limpia recursos huérfanos

### 6.2 Suscribirse a eventos de infinization

**Archivo**: `app/index.ts` (o donde se inicializa el servidor)

```typescript
import { getInfinization } from './services/InfinizationService'

async function setupInfinizationEvents() {
  const infinization = await getInfinization()
  const healthMonitor = infinization.getHealthMonitor()

  healthMonitor.on('crash', async (event) => {
    console.log(`VM ${event.vmId} crashed`)
    // Notificar via WebSocket
    await eventManager.dispatchEvent('vms', 'crash', {
      id: event.vmId,
      pid: event.pid,
      timestamp: event.detectedAt
    })
  })

  healthMonitor.on('cleanup-alert', async (alert) => {
    console.error(`Cleanup failed for VM ${alert.vmId}:`, alert.failedResources)
    // Alertar administradores
  })
}
```

---

## Fase 7: Tests y Validación

### 7.1 Tests unitarios a actualizar

| Test File | Cambio |
|-----------|--------|
| `__tests__/services/VMOperationsService.test.ts` | Mock infinization |
| `__tests__/services/SnapshotService.test.ts` | Mock SnapshotManager |
| `__tests__/services/firewall/*.test.ts` | Mock NftablesService |

### 7.2 Tests de integración

```typescript
describe('Infinization Integration', () => {
  it('should create and start a VM', async () => {
    const infinization = await getInfinization()
    const result = await infinization.createVM({
      vmId: 'test-vm',
      name: 'Test VM',
      // ...config
    })
    expect(result.success).toBe(true)
    expect(result.pid).toBeGreaterThan(0)
  })

  it('should stop a running VM', async () => {
    const result = await infinization.stopVM('test-vm')
    expect(result.success).toBe(true)
  })
})
```

---

## Orden de Ejecución

```
Fase 1: Preparación
├── 1.1 Agregar dependencia infinization
├── 1.2 Crear InfinizationService singleton
└── 1.3 Actualizar EventManager

Fase 2: Migración VM Operations (CRÍTICO)
├── 2.1 Migrar VMOperationsService
├── 2.2 Migrar CreateMachineService
├── 2.3 Migrar MachineCleanupService
└── 2.4 Probar operaciones básicas

Fase 3: Migración Firewall
├── 3.1 Migrar FirewallManager a NftablesService
├── 3.2 Eliminar LibvirtNWFilterService
└── 3.3 Probar reglas de firewall

Fase 4: Migración Snapshots
├── 4.1 Actualizar SnapshotService
└── 4.2 Probar create/list/revert/delete

Fase 5: Limpieza
├── 5.1 Eliminar archivos obsoletos
├── 5.2 Actualizar imports
└── 5.3 Eliminar libvirt-node de package.json

Fase 6: Estado y Eventos
├── 6.1 Eliminar cron UpdateVmStatus
├── 6.2 Configurar eventos de HealthMonitor
└── 6.3 Probar sincronización de estado

Fase 7: Tests
├── 7.1 Actualizar mocks
├── 7.2 Ejecutar tests unitarios
└── 7.3 Ejecutar tests de integración
```

---

## Rollback Strategy

Si algo falla durante la migración:

1. **Git revert**: Cada fase debe ser un commit separado
2. **Feature flag**: Usar variable de entorno para alternar
   ```typescript
   const useInfinization = process.env.USE_INFINIZATION === 'true'
   ```
3. **Mantener libvirt-node**: No eliminar hasta validación completa

---

## Estimación de Archivos

| Fase | Archivos Nuevos | Archivos Modificados | Archivos Eliminados |
|------|-----------------|---------------------|---------------------|
| 1 | 1 | 2 | 0 |
| 2 | 0 | 4 | 0 |
| 3 | 0 | 2 | 2 |
| 4 | 0 | 1 | 0 |
| 5 | 0 | 3 | 5 |
| 6 | 0 | 2 | 1 |
| **Total** | **1** | **14** | **8** |

---

## Consideraciones Especiales

### Hardware Updates

El `hardwareUpdateService.ts` actual hace:
1. Shutdown VM
2. Get XML, modify, undefine, redefine
3. Start VM

Con infinization, esto cambia a:
1. `infinization.stopVM(vmId)`
2. Update DB configuration (cpuCores, ramGB, etc.)
3. `infinization.startVM(vmId)` - reconstruye comando QEMU desde DB

**No se necesita XML** - infinization lee config de DB y genera comando QEMU.

### GPU Passthrough

infinization soporta GPU passthrough via:
```typescript
{
  gpuPciAddress: '0000:01:00.0',
  gpuRomfile: '/var/lib/infinization/roms/vbios.rom'
}
```

### Unattended Installation

Los managers de unattended (`UnattendedUbuntuManager`, etc.) siguen en el backend.
infinization los invoca via `backendServicesPath`:
```typescript
new UnattendedInstaller(config, {
  backendServicesPath: '/home/andres/infinibay/backend/app/services'
})
```

---

## Próximos Pasos

1. **Revisar este plan** - ¿Hay algo que falte?
2. **Crear branch de feature** - `feature/infinization-integration` ✓
3. **Ejecutar Fase 1** - Preparación sin cambios funcionales
4. **Tests manuales** - Crear VM de prueba con cada fase
5. **Code review** - Antes de merge a main
