import { PrismaClient } from '@prisma/client'
import { FirewallSimplifierService } from '../app/services/FirewallSimplifierService'

async function testFirewall () {
  const prisma = new PrismaClient()

  try {
    // Get a machine
    const machine = await prisma.machine.findFirst({
      select: { id: true, name: true, firewallTemplates: true }
    })

    if (!machine) {
      console.log('No machines found')
      return
    }

    console.log(`Testing firewall for VM: ${machine.name} (${machine.id})`)
    console.log(`FirewallTemplates in DB: ${JSON.stringify(machine.firewallTemplates)}`)

    // Test the firewall service
    const service = new FirewallSimplifierService(prisma)

    try {
      const state = await service.getVMFirewallState(machine.id)
      console.log('✅ Firewall state retrieved successfully:', JSON.stringify(state, null, 2))
    } catch (error) {
      console.error('❌ Error getting firewall state:', error)
    }

    // Test available templates
    try {
      const templates = service.getAvailableTemplates()
      console.log('✅ Available templates:', templates.length)
    } catch (error) {
      console.error('❌ Error getting templates:', error)
    }
  } catch (error) {
    console.error('Database error:', error)
  } finally {
    await prisma.$disconnect()
  }
}

testFirewall()
