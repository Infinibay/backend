/**
 * Verificar las reglas de firewall creadas en la base de datos
 */

import 'reflect-metadata';
import { PrismaClient } from '@prisma/client';

async function checkCreatedRules() {
  const prisma = new PrismaClient();

  try {
    console.log('=== VERIFICANDO REGLAS CREADAS EN LA BASE DE DATOS ===\n');

    // 1. Buscar filtros para el departamento Development/Developers
    console.log('1. Buscando filtros para Development/Developers...');
    const filters = await prisma.nWFilter.findMany({
      where: {
        OR: [
          { name: { contains: 'Development', mode: 'insensitive' } },
          { name: { contains: 'Developer', mode: 'insensitive' } },
          { type: 'DEPARTMENT' }
        ]
      },
      include: {
        rules: true,
        departments: true
      }
    });

    console.log(`Encontrados ${filters.length} filtros:`)
    filters.forEach(filter => {
      console.log(`  - ID: ${filter.id}`);
      console.log(`    Nombre: ${filter.name}`);
      console.log(`    Tipo: ${filter.type}`);
      console.log(`    Descripción: ${filter.description}`);
      console.log(`    Reglas: ${filter.rules.length}`);
      console.log(`    Departamentos: ${filter.departments.length}`);
      console.log('');
    });

    // 2. Mostrar todas las reglas en detalle
    console.log('2. Reglas de firewall encontradas:');
    let totalRules = 0;
    for (const filter of filters) {
      if (filter.rules.length > 0) {
        console.log(`\nFiltro: ${filter.name} (${filter.rules.length} reglas)`);
        filter.rules.forEach((rule, index) => {
          console.log(`  Regla ${index + 1}:`);
          console.log(`    - ID: ${rule.id}`);
          console.log(`    - Acción: ${rule.action}`);
          console.log(`    - Dirección: ${rule.direction}`);
          console.log(`    - Protocolo: ${rule.protocol}`);
          console.log(`    - Puerto src: ${rule.srcPortStart}-${rule.srcPortEnd}`);
          console.log(`    - Puerto dst: ${rule.dstPortStart}-${rule.dstPortEnd}`);
          console.log(`    - Prioridad: ${rule.priority}`);
          console.log(`    - Comentario: ${rule.comment}`);
          console.log(`    - Creado: ${rule.createdAt}`);
          totalRules++;
        });
      }
    }

    // 3. Verificar reglas creadas hoy
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const todayRules = await prisma.fWRule.findMany({
      where: {
        createdAt: {
          gte: today
        }
      },
      include: {
        nwFilter: true
      }
    });

    console.log(`\n3. Reglas creadas hoy: ${todayRules.length}`);
    todayRules.forEach(rule => {
      console.log(`  - Filtro: ${rule.nwFilter.name}`);
      console.log(`    Regla: ${rule.action} ${rule.direction} ${rule.protocol}:${rule.dstPortStart || 'any'}`);
      console.log(`    Hora: ${rule.createdAt}`);
    });

    console.log(`\n=== RESUMEN ===`);
    console.log(`Total filtros encontrados: ${filters.length}`);
    console.log(`Total reglas en filtros: ${totalRules}`);
    console.log(`Reglas creadas hoy: ${todayRules.length}`);

  } catch (error: any) {
    console.error('❌ Error:', error.message);
  } finally {
    await prisma.$disconnect();
  }
}

checkCreatedRules();