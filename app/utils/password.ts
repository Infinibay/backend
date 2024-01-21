import unixcrypt from "unixcrypt";
/**
 * Crypts the given password using SHA-512 algorithm and returns the encrypted password in crypt library format.
 *
 * @param {string} password - The password to be encrypted.
 * @returns {string} - The encrypted password in crypt library format.
 */
export function cryptPassword(password: string): string {
  return unixcrypt.encrypt(password)
}
