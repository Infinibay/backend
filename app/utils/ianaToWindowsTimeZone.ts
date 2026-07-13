/**
 * IANA → Windows time-zone name mapping.
 *
 * The Windows unattend `<TimeZone>` element (and `tzutil`) expect a Windows time
 * zone *ID* (e.g. "Eastern Standard Time"), NOT an IANA zone (e.g.
 * "America/New_York"). The rest of Infinibay speaks IANA (Linux installers, the
 * `timezone` create field), so we translate here.
 *
 * This is a curated subset of the Unicode CLDR `windowsZones` primary mappings
 * covering the zones a VDI deployment realistically uses. Unmapped input falls
 * back to "UTC" — which is safe now that we also set RealTimeIsUniversal=1, so
 * the guest's UTC clock is correct regardless of the display zone. Extend the map
 * as needed; keep values to valid Windows zone IDs.
 */

const IANA_TO_WINDOWS: Record<string, string> = {
  // Universal
  UTC: 'UTC',
  'Etc/UTC': 'UTC',
  'Etc/GMT': 'UTC',
  GMT: 'GMT Standard Time',

  // North America
  'America/New_York': 'Eastern Standard Time',
  'America/Detroit': 'Eastern Standard Time',
  'America/Toronto': 'Eastern Standard Time',
  'America/Chicago': 'Central Standard Time',
  'America/Winnipeg': 'Central Standard Time',
  'America/Mexico_City': 'Central Standard Time (Mexico)',
  'America/Denver': 'Mountain Standard Time',
  'America/Edmonton': 'Mountain Standard Time',
  'America/Phoenix': 'US Mountain Standard Time',
  'America/Los_Angeles': 'Pacific Standard Time',
  'America/Vancouver': 'Pacific Standard Time',
  'America/Tijuana': 'Pacific Standard Time (Mexico)',
  'America/Anchorage': 'Alaskan Standard Time',
  'Pacific/Honolulu': 'Hawaiian Standard Time',
  'America/Halifax': 'Atlantic Standard Time',
  'America/St_Johns': 'Newfoundland Standard Time',

  // Central & South America
  'America/Bogota': 'SA Pacific Standard Time',
  'America/Lima': 'SA Pacific Standard Time',
  'America/Guatemala': 'Central America Standard Time',
  'America/Caracas': 'Venezuela Standard Time',
  'America/La_Paz': 'SA Western Standard Time',
  'America/Santiago': 'Pacific SA Standard Time',
  'America/Sao_Paulo': 'E. South America Standard Time',
  'America/Argentina/Buenos_Aires': 'Argentina Standard Time',
  'America/Montevideo': 'Montevideo Standard Time',
  'America/Asuncion': 'Paraguay Standard Time',

  // Europe
  'Europe/London': 'GMT Standard Time',
  'Europe/Dublin': 'GMT Standard Time',
  'Europe/Lisbon': 'GMT Standard Time',
  'Europe/Madrid': 'Romance Standard Time',
  'Europe/Paris': 'Romance Standard Time',
  'Europe/Brussels': 'Romance Standard Time',
  'Europe/Berlin': 'W. Europe Standard Time',
  'Europe/Amsterdam': 'W. Europe Standard Time',
  'Europe/Rome': 'W. Europe Standard Time',
  'Europe/Vienna': 'W. Europe Standard Time',
  'Europe/Zurich': 'W. Europe Standard Time',
  'Europe/Stockholm': 'W. Europe Standard Time',
  'Europe/Warsaw': 'Central European Standard Time',
  'Europe/Prague': 'Central Europe Standard Time',
  'Europe/Budapest': 'Central Europe Standard Time',
  'Europe/Athens': 'GTB Standard Time',
  'Europe/Bucharest': 'GTB Standard Time',
  'Europe/Helsinki': 'FLE Standard Time',
  'Europe/Kiev': 'FLE Standard Time',
  'Europe/Kyiv': 'FLE Standard Time',
  'Europe/Istanbul': 'Turkey Standard Time',
  'Europe/Moscow': 'Russian Standard Time',

  // Africa
  'Africa/Casablanca': 'Morocco Standard Time',
  'Africa/Lagos': 'W. Central Africa Standard Time',
  'Africa/Cairo': 'Egypt Standard Time',
  'Africa/Johannesburg': 'South Africa Standard Time',
  'Africa/Nairobi': 'E. Africa Standard Time',

  // Middle East
  'Asia/Jerusalem': 'Israel Standard Time',
  'Asia/Riyadh': 'Arab Standard Time',
  'Asia/Dubai': 'Arabian Standard Time',
  'Asia/Tehran': 'Iran Standard Time',

  // Asia
  'Asia/Karachi': 'Pakistan Standard Time',
  'Asia/Kolkata': 'India Standard Time',
  'Asia/Calcutta': 'India Standard Time',
  'Asia/Dhaka': 'Bangladesh Standard Time',
  'Asia/Bangkok': 'SE Asia Standard Time',
  'Asia/Jakarta': 'SE Asia Standard Time',
  'Asia/Shanghai': 'China Standard Time',
  'Asia/Hong_Kong': 'China Standard Time',
  'Asia/Singapore': 'Singapore Standard Time',
  'Asia/Taipei': 'Taipei Standard Time',
  'Asia/Seoul': 'Korea Standard Time',
  'Asia/Tokyo': 'Tokyo Standard Time',

  // Oceania
  'Australia/Perth': 'W. Australia Standard Time',
  'Australia/Adelaide': 'Cen. Australia Standard Time',
  'Australia/Sydney': 'AUS Eastern Standard Time',
  'Australia/Brisbane': 'E. Australia Standard Time',
  'Pacific/Auckland': 'New Zealand Standard Time'
}

/**
 * Translate an IANA time zone to a Windows time-zone ID for use in autounattend.
 * Returns "UTC" for empty/unknown input (safe with RealTimeIsUniversal=1).
 */
export function ianaToWindowsTimeZone (iana?: string | null): string {
  if (!iana) return 'UTC'
  const key = iana.trim()
  return IANA_TO_WINDOWS[key] ?? 'UTC'
}
