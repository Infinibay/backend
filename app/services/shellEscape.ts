/**
 * Shell / PowerShell escaping helpers for values that are interpolated into
 * command strings inside generated unattended-install configs.
 *
 * Context: the unattended XML/YAML is auto-escaped by xml2js for *element*
 * values, but several `<CommandLine>` entries embed values (username, vmId) into
 * a cmd.exe / PowerShell command string that is only XML-escaped, NOT shell-
 * escaped. Without these helpers a crafted username/vmId can break out of the
 * command and execute arbitrary code inside the guest during install.
 *
 * These are defense-in-depth on top of validateUsernameStrict() (which already
 * restricts usernames to [A-Za-z0-9_-]); for already-valid input they are no-ops.
 */

/**
 * Escapes a value for safe interpolation INSIDE an existing double-quoted
 * cmd.exe argument. Removes embedded double-quotes and control chars, neutralizes
 * newlines, and caret-escapes cmd metacharacters.
 */
export function escapeForCmd (value: string): string {
  return String(value)
    .replace(/[\r\n]+/g, ' ')
    .replace(/"/g, '')
    .replace(/([&|<>^()%])/g, '^$1')
}

/**
 * Escapes a value as a fully single-quoted PowerShell literal. Doubles embedded
 * single quotes, strips backticks (PS escape char) and newlines, and wraps the
 * result in single quotes.
 */
export function escapeForPowerShellArg (value: string): string {
  return "'" + String(value)
    .replace(/[\r\n]+/g, ' ')
    .replace(/`/g, '')
    .replace(/'/g, "''") + "'"
}

/**
 * Validates and normalizes a username destined to become a guest OS account.
 * Applies the same character whitelist used for script names (collapse
 * whitespace to '_', keep only [A-Za-z0-9_-]) and caps length to the Windows
 * local-account practical limit. THROWS if the result is empty — we never
 * silently fall back for a security-sensitive identity field.
 */
export function validateUsernameStrict (username: string): string {
  const sanitized = String(username ?? '')
    .replace(/\s+/g, '_')
    .replace(/[^A-Za-z0-9_-]/g, '')
    .slice(0, 20)
  if (sanitized.length === 0) {
    throw new Error('Invalid username for unattended install (must contain letters, digits, _ or -)')
  }
  return sanitized
}
