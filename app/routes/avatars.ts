import { Router } from 'express';
import { promises as fs } from 'fs';
import path from 'path';
import { SUPPORTED_AVATAR_EXTENSIONS, AVATARS_DIR } from '../utils/avatarValidation';

const router = Router();

interface AvatarResponse {
  id: string;
  name: string;
  url: string;
  path: string;
  isDefault: boolean;
}


/**
 * GET /api/avatars
 * Returns list of available avatar files from the public/images/avatars/ directory
 */
router.get('/', async (_req, res) => {
  try {
    // Check if directory exists
    try {
      await fs.access(AVATARS_DIR);
    } catch (error) {
      console.warn(`Avatars directory not found: ${AVATARS_DIR}`);
      return res.json([]);
    }

    // Read directory contents
    const files = await fs.readdir(AVATARS_DIR);

    // Filter for image files and process them
    const avatars: AvatarResponse[] = files
      .filter(file => {
        // Validate filename doesn't contain path traversal characters
        if (file.includes('..') || file.includes('/') || file.includes('\\')) {
          return false;
        }

        const ext = path.extname(file).toLowerCase();
        return SUPPORTED_AVATAR_EXTENSIONS.includes(ext);
      })
      .map((file) => {
        const ext = path.extname(file);
        const nameWithoutExt = path.basename(file, ext);

        return {
          id: file, // Use full filename as ID to avoid duplicates
          name: nameWithoutExt,
          url: `/api/avatars/image/${file}`, // URL to serve the image through backend API endpoint
          path: `images/avatars/${file}`, // Storage-safe canonical path for GraphQL mutations
          isDefault: file === 'man.svg' // Mark man.svg as default
        };
      })
      .sort((a, b) => a.name.localeCompare(b.name)); // Sort alphabetically

    // Ensure man.svg is marked as default, or set first as default if no default exists
    const defaultAvatar = avatars.find(avatar => avatar.isDefault);
    if (!defaultAvatar && avatars.length > 0) {
      avatars[0].isDefault = true;
    }

    console.log(`Found ${avatars.length} avatars in ${AVATARS_DIR}`);
    res.json(avatars);

  } catch (error) {
    console.error('Error reading avatars directory:', error);
    res.status(500).json({
      error: 'Failed to load avatars',
      message: error instanceof Error ? error.message : 'Unknown error'
    });
  }
});

/**
 * GET /api/avatars/image/:filename
 * Serves avatar images from the avatars directory
 */
router.get('/image/:filename', async (req, res) => {
  try {
    const filename = req.params.filename;

    console.log(`Avatar image request: ${filename}`);

    // Validate filename (security check)
    if (!filename || filename.includes('..') || filename.includes('/') || filename.includes('\\')) {
      return res.status(400).json({ error: 'Invalid filename' });
    }

    const ext = path.extname(filename).toLowerCase();
    if (!SUPPORTED_AVATAR_EXTENSIONS.includes(ext)) {
      return res.status(400).json({ error: 'Unsupported file type' });
    }

    const filePath = path.join(AVATARS_DIR, filename);

    // Check if file exists
    try {
      await fs.access(filePath);
    } catch (error) {
      console.warn(`Avatar file not found: ${filePath}`);
      return res.status(404).json({ error: 'Avatar not found' });
    }

    // Set appropriate content type
    let contentType = 'image/svg+xml'; // Default to SVG as most avatars are SVG
    switch (ext) {
      case '.png':
        contentType = 'image/png';
        break;
      case '.jpg':
      case '.jpeg':
        contentType = 'image/jpeg';
        break;
      case '.webp':
        contentType = 'image/webp';
        break;
      case '.gif':
        contentType = 'image/gif';
        break;
      case '.svg':
        contentType = 'image/svg+xml';
        break;
    }

    res.setHeader('Content-Type', contentType);
    res.setHeader('Cache-Control', 'public, max-age=86400'); // Cache for 24 hours

    console.log(`Serving avatar: ${filename} with content-type: ${contentType}`);

    // Stream the file
    const fileStream = require('fs').createReadStream(filePath);
    fileStream.pipe(res);

  } catch (error) {
    console.error('Error serving avatar image:', error);
    res.status(500).json({
      error: 'Failed to serve avatar',
      message: error instanceof Error ? error.message : 'Unknown error'
    });
  }
});

export default router;