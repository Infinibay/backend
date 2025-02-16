import { PrismaClient } from "@prisma/client";
import bcrypt from "bcrypt";
import dotenv from "dotenv";
import { installNetworkFilters } from '../scripts/installation/networkFilters';
import createApplications from './seeds/applications';

import installCallbacks from '../app/utils/modelsCallbacks';

dotenv.config();

const prisma = new PrismaClient();

const DEFAULT_ADMIN_EMAIL = process.env.DEFAULT_ADMIN_EMAIL || "admin@example.com";
const DEFAULT_ADMIN_PASSWORD = process.env.DEFAULT_ADMIN_PASSWORD || "password";
async function createAdminUser() {
  const password = await bcrypt.hash(DEFAULT_ADMIN_PASSWORD, 10);
  try {
    await prisma.user.upsert({
      where: {
        email: DEFAULT_ADMIN_EMAIL
      },
      update: {
        password,
        firstName: "Admin",
        lastName: "User",
        role: "ADMIN",
        deleted: false,
      },
      create: {
        email: DEFAULT_ADMIN_EMAIL,
        password,
        firstName: "Admin",
        lastName: "User",
        role: "ADMIN",
        deleted: false,
      },
    });
    console.log("Admin user created/updated successfully");
  } catch (error) {
    console.error("Error creating admin user:", error);
  }
}

async function createDefaultDepartment() {
  try {
    await prisma.department.create({
      data: {
        name: "Default",
      },
    });
    console.log("Default department created successfully");
  } catch (error) {
    console.error("Error creating default department:", error);
  }
}

async function createDefaultMachineTemplateCategory() {
  try {
    const defaultCategory = await prisma.machineTemplateCategory.create({
      data: {
        name: "Default Category",
        description: "Default category for machine templates",
      },
    });
    console.log("Default machine template category created successfully");
    return defaultCategory;
  } catch (error) {
    console.error("Error creating default machine template category:", error);
    return null;
  }
}

async function updateMachineTemplates(defaultCategoryId: string) {
  try {
    await prisma.machineTemplate.updateMany({
      where: { categoryId: null },
      data: { categoryId: defaultCategoryId },
    });
    console.log("Machine templates updated successfully");
  } catch (error) {
    console.error("Error updating machine templates:", error);
  }
}

async function createDefaultMachineTemplate(defaultCategoryId: string) {
  try {
    const existingTemplates = await prisma.machineTemplate.findMany();
    if (existingTemplates.length === 0) {
      await prisma.machineTemplate.create({
        data: {
          name: "Basic",
          description: "A basic machine template.",
          cores: 6,
          ram: 24,
          storage: 70,
          categoryId: defaultCategoryId,
        }
      });
      console.log("Default machine template created successfully");
    }
  } catch (error) {
    console.error("Error creating default machine template:", error);
  }
}

async function main() {
  try {
    installCallbacks(prisma);
    await prisma.$transaction(async (transactionPrisma) => {
      // First install network filters
      await installNetworkFilters();

      // Then create admin user and departments
      await createAdminUser();
      await createDefaultDepartment();
      const defaultCategory = await createDefaultMachineTemplateCategory();
      if (defaultCategory) {
        await updateMachineTemplates(defaultCategory.id);
        await createDefaultMachineTemplate(defaultCategory.id);
      }
      await createApplications(transactionPrisma);
    });
    console.log("Seeding completed successfully");
  } catch (error) {
    console.error("Error during seeding:", error);
    process.exit(1);
  } finally {
    await prisma.$disconnect();
  }
}

main();
