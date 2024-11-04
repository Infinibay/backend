import { PrismaClient, Prisma } from "@prisma/client";

const prisma = new PrismaClient();

const createApplications = async (prisma: Prisma.TransactionClient | PrismaClient) => {
  // Slack
  await prisma.application.create({
    data: {
      name: "Slack",
      description: "Slack is a collaboration hub that can replace email, IM and phones.",
      os: ["windows"] as string[], // Ensure this is a simple array of strings
      installCommand: {
        "windows": "winget install -e --silent --accept-source-agreements --accept-package-agreements --id=SlackTechnologies.Slack",
      } as Prisma.JsonObject, // Ensure this is a JSON object
      parameters: {} // Add an empty object or appropriate default values
    }
  });
  // Microsoft.Office
  await prisma.application.create({
    data: {
      name: "Microsoft Office",
      description: "Microsoft Office is a suite of productivity software.",
      os: ["windows"] as string[], // Ensure this is a simple array of strings
      installCommand: {
        "windows": "winget install -e --silent --accept-source-agreements --accept-package-agreements --id Microsoft.Office",
      } as Prisma.JsonObject, // Ensure this is a JSON object
      parameters: {} // Add an empty object or appropriate default values
    }
  });
};

export default createApplications;