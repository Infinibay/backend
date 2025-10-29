import { Prisma, PrismaClient } from '@prisma/client';
import fs from 'fs';
import path from 'path';
import yaml from 'js-yaml';

export default async function createScripts(prisma: Prisma.TransactionClient | PrismaClient) {
  console.log('Seeding template scripts...');

  const templatesDir = path.join(__dirname, '..', '..', 'scripts', 'templates');

  // Check if templates directory exists
  if (!fs.existsSync(templatesDir)) {
    console.warn('Templates directory not found, skipping script seeding');
    return;
  }

  const templateFiles = fs.readdirSync(templatesDir)
    .filter(file => file.endsWith('.yaml') || file.endsWith('.json'));

  for (const file of templateFiles) {
    try {
      const filePath = path.join(templatesDir, file);
      const content = fs.readFileSync(filePath, 'utf-8');

      // Parse YAML/JSON
      const parsed = file.endsWith('.yaml')
        ? yaml.load(content) as any
        : JSON.parse(content);

      // Extract metadata
      const scriptData = {
        name: parsed.name,
        description: parsed.description || null,
        fileName: file,
        category: parsed.category || null,
        tags: parsed.tags || [],
        os: parsed.os.map((o: string) => o.toUpperCase()), // Convert to enum values
        shell: parsed.shell.toUpperCase(), // Convert to enum value
        createdById: null // System template (no creator)
      };

      // Upsert script (update if exists, create if not)
      await prisma.script.upsert({
        where: { fileName: file },
        update: scriptData,
        create: scriptData
      });

      console.log(`Seeded template script: ${parsed.name}`);
    } catch (error) {
      console.error(`Failed to seed script ${file}:`, error);
      // Continue with other scripts even if one fails
    }
  }

  console.log('Template scripts seeded successfully');
}
