import { Prisma, PrismaClient } from '@prisma/client';
import fs from 'fs';
import path from 'path';
import yaml from 'js-yaml';

function collectTemplateFiles(rootDir: string): Array<{ filePath: string; fileName: string }> {
  // fileName is the path relative to rootDir (POSIX-style separators) so
  // it stays portable and stable across OSes. ScriptManager joins it to
  // TEMPLATES_DIR directly.
  const results: Array<{ filePath: string; fileName: string }> = [];
  const walk = (dir: string) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        walk(full);
      } else if (entry.isFile() && (entry.name.endsWith('.yaml') || entry.name.endsWith('.json'))) {
        const rel = path.relative(rootDir, full).split(path.sep).join('/');
        results.push({ filePath: full, fileName: rel });
      }
    }
  };
  walk(rootDir);
  return results;
}

export default async function createScripts(prisma: Prisma.TransactionClient | PrismaClient) {
  console.log('Seeding template scripts...');

  const templatesDir = path.join(__dirname, '..', '..', 'scripts', 'templates');

  // Check if templates directory exists
  if (!fs.existsSync(templatesDir)) {
    console.warn('Templates directory not found, skipping script seeding');
    return;
  }

  const templateFiles = collectTemplateFiles(templatesDir);

  for (const { filePath, fileName } of templateFiles) {
    try {
      const content = fs.readFileSync(filePath, 'utf-8');

      // Parse YAML/JSON
      const parsed = fileName.endsWith('.yaml')
        ? yaml.load(content) as any
        : JSON.parse(content);

      // Extract metadata
      const scriptData = {
        name: parsed.name,
        description: parsed.description || null,
        fileName: fileName,
        category: parsed.category || null,
        tags: parsed.tags || [],
        os: parsed.os.map((o: string) => o.toUpperCase()), // Convert to enum values
        shell: parsed.shell.toUpperCase(), // Convert to enum value
        createdById: null // System template (no creator)
      };

      // Upsert script (update if exists, create if not)
      await prisma.script.upsert({
        where: { fileName: fileName },
        update: scriptData,
        create: scriptData
      });

      console.log(`Seeded template script: ${parsed.name}`);
    } catch (error) {
      console.error(`Failed to seed script ${fileName}:`, error);
      // Continue with other scripts even if one fails
    }
  }

  console.log('Template scripts seeded successfully');
}
