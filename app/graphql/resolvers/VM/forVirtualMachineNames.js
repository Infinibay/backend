import {PrismaClient} from "@prisma/client"
const prisma = new PrismaClient();


const forVirtualMachineName = {
    Query: {


findVMName: async (root, input) => {
    try {
      const forFindVMName = await prisma.virtualMachine.findUnique({
        where: {
          virtualMachineName: input["input"]["virtualMachineName"],
        },
        select: {
          // id: true,
          virtualMachineName: true,
        },
      });
      if (forFindVMName) {
        console.log("duplicate");
        console.log(forFindVMName);
        return "true";
      } else {
        console.log("no found");
        return "false";
      }
    } catch (error) {
      console.log(error);
      return error;
    }
  },
},
}

export default forVirtualMachineName