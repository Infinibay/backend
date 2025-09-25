import { promises as fs } from 'fs';
import path from 'path';

// Define supported image extensions for avatars
export const SUPPORTED_AVATAR_EXTENSIONS = ['.svg', '.png', '.jpg', '.jpeg', '.webp', '.gif'];

// Avatar directory path relative to backend root
export const AVATARS_DIR = path.join(process.cwd(), 'public', 'images', 'avatars');

// Default avatar path - canonical storage format (using first available avatar)
export const DEFAULT_AVATAR_PATH = 'images/avatars/man.svg';

/**
 * Validates that the avatar path follows the correct format
 * Avatar paths should start with 'images/avatars/' and have valid extension
 */
export function validateAvatarPath(avatarPath: string): boolean {
  if (!avatarPath || typeof avatarPath !== 'string') {
    return false;
  }

  // Check if path starts with 'images/avatars/'
  if (!avatarPath.startsWith('images/avatars/')) {
    return false;
  }

  // Check for path traversal attempts
  if (avatarPath.includes('../') || avatarPath.includes('\\') || avatarPath.includes('..\\')) {
    return false;
  }

  // Extract filename and validate extension
  const filename = path.basename(avatarPath);
  return isValidAvatarExtension(filename);
}

/**
 * Checks if the avatar file actually exists in the public directory
 */
export async function avatarExists(avatarPath: string): Promise<boolean> {
  try {
    const fullPath = getAvatarFullPath(avatarPath);
    await fs.access(fullPath);
    return true;
  } catch {
    return false;
  }
}

/**
 * Converts relative avatar path to full file system path
 * Handles various input formats:
 * - 'images/avatars/file.svg' -> '/path/to/backend/public/images/avatars/file.svg'
 * - 'images/file.svg' -> '/path/to/backend/public/images/avatars/file.svg'
 * - 'file.svg' -> '/path/to/backend/public/images/avatars/file.svg'
 * - '/images/avatars/file.svg' -> '/path/to/backend/public/images/avatars/file.svg'
 */
export function getAvatarFullPath(avatarPath: string): string {
  let filename = avatarPath;

  // Strip leading slash if present
  if (filename.startsWith('/')) {
    filename = filename.substring(1);
  }

  // Handle different input formats and extract just the filename
  if (filename.startsWith('images/avatars/')) {
    filename = filename.substring('images/avatars/'.length);
  } else if (filename.startsWith('images/')) {
    filename = filename.substring('images/'.length);
  }

  // Now filename should be just the file name, construct full path
  return path.join(AVATARS_DIR, filename);
}

/**
 * Validates file extension against supported formats
 */
export function isValidAvatarExtension(filename: string): boolean {
  if (!filename || typeof filename !== 'string') {
    return false;
  }

  const ext = path.extname(filename).toLowerCase();
  return SUPPORTED_AVATAR_EXTENSIONS.includes(ext);
}

/**
 * Normalizes avatar path input to canonical storage format
 * Returns DEFAULT_AVATAR_PATH for null/empty inputs
 */
export function normalizeAvatarPath(avatarPath: string | null | undefined): string {
  // Handle null/undefined/empty inputs
  if (!avatarPath || avatarPath.trim() === '') {
    return DEFAULT_AVATAR_PATH;
  }

  // If already in canonical format, return as-is
  if (avatarPath.startsWith('images/avatars/')) {
    return avatarPath;
  }

  // Extract filename from various formats
  let filename = avatarPath;
  if (filename.startsWith('/')) {
    filename = filename.substring(1);
  }

  if (filename.startsWith('images/')) {
    filename = path.basename(filename);
  } else {
    filename = path.basename(filename);
  }

  // Return in canonical format
  return `images/avatars/${filename}`;
}