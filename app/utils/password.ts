import crypto from "crypto";

/**
 * Crypts the given password using SHA-512 algorithm and returns the encrypted password in crypt library format.
 *
 * @param {string} password - The password to be encrypted.
 * @returns {string} - The encrypted password in crypt library format.
 */
export function cryptPassword(password: string): string {
  // The id for SHA-512 in the `crypt` library is 6
  const id = "6";
  // Generate a random salt
  const salt = crypto.randomBytes(8).toString("hex");

  const hash = crypto.createHash("sha512");
  hash.update(password + salt);

  // The format of the `crypt` library password is $id$salt$encrypted
  return "$" + id + "$" + salt + "$" + hash.digest('hex');
}
