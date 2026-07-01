/**
 * Redact host-internal detail from an error string before it is exposed to a
 * VM's (possibly non-admin) owner — e.g. via GraphQL `configuration.lastError`.
 *
 * A create/install failure message can embed raw host filesystem paths
 * (`/opt/infinibay/isos/...`, `/workspace/...`), raw multi-line stderr from
 * `ip`/`7z`/`qemu`, or a node's internal name. Surfacing that verbatim to a
 * tenant hands them host-layout / tooling reconnaissance they should never see.
 *
 * This keeps the SEMANTIC message useful (error text + file basenames survive)
 * but strips absolute paths down to their basename and collapses stderr dumps to
 * a single capped line. Callers should still log the FULL raw error server-side
 * (this is only for the user-facing surface).
 */
const MAX_LEN = 300

export function sanitizeErrorForUser (raw: string | null | undefined): string | null {
  if (raw === null || raw === undefined) return raw ?? null
  let s = String(raw)

  // Collapse newlines/repeated whitespace — raw command stderr is often a
  // multi-line dump that leaks far more than the one relevant line.
  s = s.replace(/\s*\r?\n\s*/g, ' ').replace(/[ \t]{2,}/g, ' ')

  // Replace absolute POSIX paths (2+ segments, so a lone "/x" or "and/or" is
  // untouched) with just their basename: /opt/infinibay/isos/ubuntu.iso -> ubuntu.iso.
  s = s.replace(/(?:\/[\w.-]+){2,}\/?/g, (m) => {
    const trimmed = m.replace(/\/+$/, '')
    return trimmed.slice(trimmed.lastIndexOf('/') + 1)
  })

  s = s.trim()
  return s.length > MAX_LEN ? s.slice(0, MAX_LEN - 1) + '…' : s
}

export default sanitizeErrorForUser
