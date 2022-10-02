export function CreateVm (parent: any, args: any, context: any, info: any) {
  // TODO: This is totally wrong. It should validate the values, it shouuld create the vm 
  // using VirSh service and then save it in the database
  const vm = context.prisma.virtualMachine.create({
    data: {
      name: args.name,
      description: args.description,
      vcpu: args.vcpu,
      ram: args.ram,
      os: args.os,
      version: args.version,
    },
    });
  return vm;
}