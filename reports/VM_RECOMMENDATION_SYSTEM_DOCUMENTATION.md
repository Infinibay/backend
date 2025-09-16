# Sistema de Recomendaciones de VM - Documentación Completa

## Resumen del Sistema

El sistema de recomendaciones de Infinibay analiza el estado de las máquinas virtuales y genera recomendaciones automáticas para mejorar el rendimiento, seguridad y mantenimiento. El sistema consta de 10 verificadores especializados que analizan diferentes aspectos de las VMs.

## Arquitectura

### Clase Base: BaseRecommendationChecker

Todas las recomendaciones heredan de esta clase base que proporciona:

- **Interfaces comunes**: `RecommendationContext`, `RecommendationResult`
- **Utilidades compartidas**: Parsing de fechas, cálculo de días transcurridos
- **Métodos abstractos**: `getName()`, `getCategory()`, `analyze()`

### Contexto de Entrada (RecommendationContext)

```typescript
interface RecommendationContext {
  machineConfig?: Machine;
  latestSnapshot?: VMHealthSnapshot;
  recentMetrics?: SystemMetrics[];
  recentProcesses?: ProcessSnapshot[];
  recentPorts?: PortUsage[];
  vmFilters?: VMNWFilter[];
  vmPorts?: VmPort[];
  fwRules?: FWRule[];
  departmentFilters?: DepartmentNWFilter[];
}
```

### Formato de Respuesta (RecommendationResult)

```typescript
interface RecommendationResult {
  type: string;           // Tipo de recomendación (ej: 'DISK_SPACE_LOW')
  text: string;           // Descripción del problema
  actionText: string;     // Acción recomendada
  data: RecommendationData; // Datos adicionales específicos
}
```

---

## 1. DiskSpaceChecker

### Propósito
Monitorea el uso del espacio en disco y alerta sobre niveles críticos o de advertencia.

### Entrada Requerida
- `latestSnapshot.diskSpace` (JSON string o object)

### Análisis Realizado
1. **Parsing de datos**: Convierte JSON string a objeto si es necesario
2. **Extracción de métricas**: Busca propiedades `used`/`usedGB` y `total`/`totalGB`
3. **Cálculo de porcentaje**: `(usado / total) * 100`
4. **Evaluación de umbrales**:
   - **Crítico**: > 95% de uso
   - **Advertencia**: > 85% de uso

### Formato de Entrada
```json
{
  "C:": {
    "used": 85.6,
    "total": 100.0,
    "usedGB": 85.6,
    "totalGB": 100.0
  }
}
```

### Respuesta
```typescript
{
  type: 'DISK_SPACE_LOW',
  text: 'Disk C: is 86% full (85.6 GB used of 100.0 GB)',
  actionText: 'Free up disk space on C: drive by removing unnecessary files',
  data: {
    drive: 'C:',
    usedGB: 85.6,
    totalGB: 100.0,
    usagePercent: 86,
    severity: 'medium' // 'critical' si > 95%
  }
}
```

---

## 2. ResourceOptimizationChecker

### Propósito
Identifica procesos con alto consumo de CPU/RAM y sugiere optimizaciones agrupando por aplicación.

### Entrada Requerida
- `latestSnapshot.applicationInventory` (JSON con procesos)

### Análisis Complejo
1. **Agrupación por aplicación**:
   ```typescript
   // Agrupa procesos por nombre normalizado (sin extensión)
   const processGroups = processes.reduce((groups, process) => {
     const appName = normalizeAppName(process.name);
     groups[appName] = groups[appName] || [];
     groups[appName].push(process);
     return groups;
   }, {});
   ```

2. **Cálculo de métricas agregadas**:
   ```typescript
   const aggregated = {
     processCount: group.length,
     totalCpu: group.reduce((sum, p) => sum + p.cpu, 0),
     totalMemory: group.reduce((sum, p) => sum + p.memory, 0),
     maxCpu: Math.max(...group.map(p => p.cpu)),
     maxMemory: Math.max(...group.map(p => p.memory))
   };
   ```

3. **Evaluación de umbrales**:
   - **CPU Alto**: Total > 25% o máximo > 15%
   - **RAM Alta**: Total > 1GB o máximo > 512MB
   - **Múltiples instancias**: > 5 procesos del mismo tipo

### Formato de Entrada
```json
{
  "processes": [
    {
      "name": "chrome.exe",
      "cpu": 12.5,
      "memory": 256000,
      "pid": 1234
    }
  ]
}
```

### Respuesta
```typescript
{
  type: 'RESOURCE_OPTIMIZATION',
  text: 'Chrome is using high resources: 45.2% CPU across 8 processes',
  actionText: 'Consider closing unnecessary Chrome tabs or processes',
  data: {
    appName: 'chrome',
    processCount: 8,
    totalCpuPercent: 45.2,
    totalMemoryMB: 1024,
    maxCpuPercent: 15.3,
    maxMemoryMB: 256,
    severity: 'medium'
  }
}
```

---

## 3. DiskIOBottleneckChecker

### Propósito
Detecta cuellos de botella en operaciones de entrada/salida de disco.

### Entrada Requerida
- `recentMetrics` (SystemMetrics con diskIOStats)

### Análisis Realizado
1. **Extracción de métricas I/O**: Lee/escribe por segundo, tiempo de acceso
2. **Cálculo de promedios**: Sobre múltiples snapshots recientes
3. **Detección de umbrales**:
   - **IOPS Alto**: > 100 operaciones/segundo
   - **Latencia Alta**: > 50ms tiempo promedio
   - **Throughput Alto**: > 50MB/s transferencia

### Formato de Entrada
```json
{
  "diskIOStats": {
    "reads_per_sec": 85.2,
    "writes_per_sec": 45.1,
    "avg_disk_queue_length": 2.5,
    "avg_disk_response_time": 45.2
  }
}
```

### Respuesta
```typescript
{
  type: 'DISK_IO_BOTTLENECK',
  text: 'High disk I/O detected: 130 IOPS with 45ms average response time',
  actionText: 'Consider optimizing disk usage or upgrading storage',
  data: {
    avgIOPS: 130.3,
    avgResponseTime: 45.2,
    avgQueueLength: 2.5,
    severity: 'medium'
  }
}
```

---

## 4. PortConflictChecker

### Propósito
Analiza conflictos de seguridad de red detectando puertos abiertos sin protección adecuada.

### Entrada Requerida
- `recentPorts`: Puertos activos en la VM
- `vmFilters`: Filtros de red aplicados
- `fwRules`: Reglas de firewall configuradas

### Análisis Complejo de Seguridad

#### 1. Detección de Puertos Sin Cobertura
```typescript
const uncoveredPorts = activePorts.filter(port => {
  // Verifica si el puerto tiene reglas de firewall que lo cubran
  const coveredByRules = fwRules.some(rule =>
    rule.direction === 'in' &&
    (rule.port === port.port || rule.portRange?.includes(port.port))
  );
  return !coveredByRules;
});
```

#### 2. Análisis de Discrepancias de Protocolo
```typescript
const protocolMismatches = activePorts.filter(port => {
  const matchingRule = fwRules.find(rule => rule.port === port.port);
  return matchingRule && matchingRule.protocol !== port.protocol;
});
```

#### 3. Evaluación de Riesgo por Tipo de Puerto
```typescript
const riskAssessment = {
  'critical': [22, 23, 135, 445, 3389], // SSH, Telnet, RPC, SMB, RDP
  'high': [21, 25, 53, 80, 443],        // FTP, SMTP, DNS, HTTP, HTTPS
  'medium': [8080, 8443, 9090]          // Web alternos
};
```

### Formato de Entrada
```json
{
  "recentPorts": [
    {
      "port": 3389,
      "protocol": "tcp",
      "isListening": true,
      "processName": "svchost.exe"
    }
  ],
  "fwRules": [
    {
      "port": 3389,
      "protocol": "tcp",
      "direction": "in",
      "action": "allow"
    }
  ]
}
```

### Respuesta
```typescript
{
  type: 'PORT_CONFLICT',
  text: 'Critical port 3389 (RDP) is exposed without proper network filtering',
  actionText: 'Apply network filter to restrict RDP access to authorized networks',
  data: {
    port: 3389,
    protocol: 'tcp',
    riskLevel: 'critical',
    processName: 'svchost.exe',
    hasFirewallRule: true,
    hasNetworkFilter: false,
    severity: 'high'
  }
}
```

---

## 5. OverProvisionedChecker

### Propósito
Detecta recursos sobreasignados analizando patrones de uso a lo largo del tiempo.

### Entrada Requerida
- `recentMetrics`: Métricas de sistema de los últimos días
- `machineConfig`: Configuración de recursos asignados

### Análisis Temporal Complejo

#### 1. Análisis de Tendencias de CPU
```typescript
const cpuAnalysis = {
  samples: recentMetrics.length,
  avgUsage: metrics.reduce((sum, m) => sum + m.cpuUsagePercent, 0) / metrics.length,
  maxUsage: Math.max(...metrics.map(m => m.cpuUsagePercent)),
  lowUsagePeriods: metrics.filter(m => m.cpuUsagePercent < 10).length,
  utilizationRate: (avgUsage / configuredCores) * 100
};
```

#### 2. Análisis de Memoria
```typescript
const memoryAnalysis = {
  avgUsagePercent: (avgUsedMemory / totalMemory) * 100,
  peakUsagePercent: (maxUsedMemory / totalMemory) * 100,
  wastedMemoryGB: (totalMemory - avgUsedMemory) / (1024 * 1024),
  efficiencyScore: avgUsagePercent / 100
};
```

#### 3. Criterios de Sobreprovisionamiento
- **CPU**: Uso promedio < 25% durante > 80% del tiempo
- **RAM**: Uso promedio < 40% con picos < 60%
- **Periodo**: Análisis mínimo de 48 horas de datos

### Respuesta
```typescript
{
  type: 'OVER_PROVISIONED',
  text: 'VM has 8 CPU cores but averages only 15% usage over 7 days',
  actionText: 'Consider reducing CPU allocation to 4 cores to optimize resource usage',
  data: {
    resourceType: 'cpu',
    currentAllocation: 8,
    recommendedAllocation: 4,
    avgUsagePercent: 15.2,
    analysisHours: 168,
    potentialSavings: '50% CPU reduction',
    severity: 'medium'
  }
}
```

---

## 6. UnderProvisionedChecker

### Propósito
Identifica recursos insuficientes que causan degradación de rendimiento.

### Entrada Requerida
- `recentMetrics`: Métricas recientes de sistema
- `machineConfig`: Configuración actual de recursos

### Análisis de Rendimiento

#### 1. Detección de Cuellos de Botella de CPU
```typescript
const cpuBottleneck = {
  highUsagePeriods: metrics.filter(m => m.cpuUsagePercent > 80).length,
  sustainedHighUsage: consecutiveHighUsage > 30, // 30 minutos
  loadAverageSpikes: metrics.filter(m => m.loadAverage?.['1min'] > cores).length
};
```

#### 2. Análisis de Presión de Memoria
```typescript
const memoryPressure = {
  highUsagePercent: (usedMemory / totalMemory) * 100 > 85,
  swapUsage: swapUsed > 0,
  availableMemoryLow: availableMemory < (totalMemory * 0.1)
};
```

#### 3. Criterios de Subprovisionamiento
- **CPU**: > 80% uso durante > 50% del tiempo
- **RAM**: > 85% uso con swap activo
- **Disco**: Cola de I/O > 2.0 consistentemente

### Respuesta
```typescript
{
  type: 'UNDER_PROVISIONED',
  text: 'VM experiencing memory pressure: 92% RAM usage with 2GB swap active',
  actionText: 'Increase RAM allocation from 8GB to 12GB to improve performance',
  data: {
    resourceType: 'memory',
    currentAllocationGB: 8,
    recommendedAllocationGB: 12,
    avgUsagePercent: 92.1,
    swapUsageGB: 2.1,
    pressureDurationHours: 48,
    severity: 'high'
  }
}
```

---

## 7. OsUpdateChecker

### Propósito
Monitorea actualizaciones pendientes del sistema operativo Windows.

### Entrada Requerida
- `latestSnapshot.updateStatus` (JSON con información de Windows Update)

### Análisis Realizado
1. **Clasificación por severidad**: Críticas, importantes, recomendadas
2. **Identificación de actualizaciones de seguridad**
3. **Análisis de reinicio requerido**
4. **Cálculo de tamaño total de descarga**

### Formato de Entrada
```json
{
  "pending_updates": [
    {
      "title": "Security Update for Windows 10 (KB5021233)",
      "kb_number": "KB5021233",
      "is_security_update": true,
      "size_bytes": 512000000,
      "severity": "Critical"
    }
  ],
  "reboot_required": true,
  "automatic_updates_enabled": false
}
```

### Respuesta
```typescript
{
  type: 'OS_UPDATE_AVAILABLE',
  text: '5 critical security updates available requiring 2.1GB download',
  actionText: 'Install security updates immediately and schedule reboot',
  data: {
    totalUpdates: 5,
    securityUpdates: 3,
    criticalUpdates: 2,
    totalSizeMB: 2150,
    rebootRequired: true,
    automaticUpdatesEnabled: false,
    severity: 'critical'
  }
}
```

---

## 8. AppUpdateChecker

### Propósito
Rastrea actualizaciones disponibles para aplicaciones instaladas.

### Entrada Requerida
- `latestSnapshot.applicationInventory` (inventario de aplicaciones)

### Análisis Realizado
1. **Filtrado de aplicaciones actualizables**
2. **Priorización de actualizaciones de seguridad**
3. **Agrupación por fuente de actualización** (Windows Update, Store, etc.)
4. **Cálculo de beneficios vs esfuerzo**

### Formato de Entrada
```json
{
  "applications": [
    {
      "name": "Google Chrome",
      "current_version": "118.0.5993.88",
      "update_available": "119.0.6045.105",
      "is_security_update": true,
      "update_source": "Google Update",
      "update_size_bytes": 85000000
    }
  ]
}
```

### Respuesta
```typescript
{
  type: 'APP_UPDATE_AVAILABLE',
  text: 'Security update available for Google Chrome (current: 118.0.5993.88, available: 119.0.6045.105)',
  actionText: 'Update Google Chrome through Google Update to fix security vulnerabilities',
  data: {
    appName: 'Google Chrome',
    currentVersion: '118.0.5993.88',
    availableVersion: '119.0.6045.105',
    updateSource: 'Google Update',
    isSecurityUpdate: true,
    updateSizeMB: 81,
    severity: 'high'
  }
}
```

---

## 9. DefenderDisabledChecker

### Propósito
Verifica el estado de Windows Defender y sus componentes de protección.

### Entrada Requerida
- `latestSnapshot.defenderStatus` (estado completo de Defender)

### Análisis Realizado
1. **Estado de activación principal**
2. **Protección en tiempo real**
3. **Antigüedad de firmas de virus**
4. **Historial de escaneos**

### Formato de Entrada
```json
{
  "enabled": true,
  "real_time_protection": false,
  "signature_age_days": 5,
  "last_quick_scan": "2024-01-10T14:30:00Z",
  "last_full_scan": "2024-01-05T02:00:00Z",
  "engine_version": "1.1.20700.4"
}
```

### Respuesta
```typescript
{
  type: 'DEFENDER_DISABLED',
  text: 'Windows Defender real-time protection is disabled on VM-Server-01',
  actionText: 'Enable real-time protection on VM-Server-01 in Windows Security > Virus & threat protection settings',
  data: {
    realTimeProtectionDisabled: true,
    defenderEnabled: true,
    lastQuickScan: '2024-01-10T14:30:00Z',
    signatureAge: 5,
    severity: 'high'
  }
}
```

---

## 10. DefenderThreatChecker

### Propósito
Analiza amenazas detectadas por Windows Defender y evalúa el riesgo de seguridad.

### Entrada Requerida
- `latestSnapshot.defenderStatus` (con información de amenazas)

### Análisis Complejo de Amenazas

#### 1. Clasificación por Estado
```typescript
const threatClassification = {
  active: threats.filter(t => t.status?.toLowerCase() === 'active'),
  quarantined: threats.filter(t => t.status?.toLowerCase() === 'quarantined'),
  cleaned: threats.filter(t => t.status?.toLowerCase() === 'cleaned')
};
```

#### 2. Análisis de Severidad
```typescript
const severityAnalysis = {
  critical: threats.filter(t => t.severity_id >= 4),
  high: threats.filter(t => t.severity_id >= 3 && t.severity_id < 4),
  medium: threats.filter(t => t.severity_id >= 2 && t.severity_id < 3),
  low: threats.filter(t => t.severity_id < 2)
};
```

#### 3. Análisis Temporal
```typescript
const timelineAnalysis = threats.map(threat => ({
  name: threat.name || threat.threat_name,
  detectionTime: threat.detection_time || threat.detected_at,
  daysSince: calculateDaysSince(threat.detection_time),
  isRecent: calculateDaysSince(threat.detection_time) <= 7
}));
```

### Formato de Entrada
```json
{
  "threats_detected": 3,
  "recent_threats": [
    {
      "name": "Trojan:Win32/Wacatac.B!ml",
      "status": "quarantined",
      "severity_id": 4,
      "detection_time": "2024-01-15T09:30:00Z",
      "quarantine_time": "2024-01-15T09:31:00Z"
    }
  ]
}
```

### Respuesta
```typescript
{
  type: 'DEFENDER_THREAT',
  text: '1 threats quarantined by Windows Defender',
  actionText: 'Review quarantined threats and ensure they are properly removed',
  data: {
    quarantinedThreats: 1,
    totalThreats: 3,
    threatNames: ['Trojan:Win32/Wacatac.B!ml'],
    quarantineDates: ['2024-01-15T09:31:00Z'],
    severity: 'medium'
  }
}
```

---

## Utilidades Compartidas

### 1. Parsing de Fechas y Cálculo de Días
```typescript
parseAndCalculateDaysSince(dateString?: string): {
  isValid: boolean;
  daysSince: number;
  parsedDate?: Date;
}
```

### 2. Extracción de Datos de Disco
```typescript
extractDiskSpaceData(diskSpaceData: any): {
  drive: string;
  usedGB: number;
  totalGB: number;
  usagePercent: number;
}[]
```

### 3. Normalización de Nombres de Aplicación
```typescript
normalizeAppName(name: string): string {
  return name.toLowerCase()
    .replace(/\.exe$/, '')
    .replace(/[^a-z0-9]/g, '');
}
```

---

## Configuración de Umbrales

### Severidad de Recomendaciones
- **Critical**: Problemas que requieren acción inmediata (seguridad, espacio < 5%)
- **High**: Problemas importantes que afectan rendimiento o seguridad
- **Medium**: Optimizaciones recomendadas para mejor rendimiento
- **Low**: Sugerencias de mantenimiento preventivo

### Umbrales Configurables
```typescript
const THRESHOLDS = {
  diskSpace: { critical: 95, warning: 85 },
  cpuUsage: { high: 80, sustained: 50 },
  memoryUsage: { high: 85, critical: 95 },
  signatureAge: { warning: 3, critical: 7 },
  scanAge: { warning: 7, critical: 14 }
};
```

---

## Flujo de Ejecución

1. **VMRecommendationService.generateRecommendations()**
2. **Para cada checker**:
   - Validar datos de entrada requeridos
   - Ejecutar análisis específico
   - Generar recomendaciones con datos contextuales
3. **Agregación y filtrado** de resultados
4. **Almacenamiento** en base de datos con timestamp
5. **Notificación** a sistema de eventos en tiempo real

Este sistema proporciona un análisis integral y automatizado del estado de las VMs, permitiendo un mantenimiento proactivo y optimización continua de recursos.