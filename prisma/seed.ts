import { PrismaClient } from "@prisma/client";
import bcrypt from "bcrypt";

const prisma = new PrismaClient();

async function main() {
  const password = await bcrypt.hash("password", 10);

  await prisma.user.create({
    data: {
      email: "admin@example.com",
      password: password,
      firstName: "Admin",
      lastName: "User",
      role: "ADMIN",
      deleted: false,
      // Add other fields as necessary
    },
  });
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });