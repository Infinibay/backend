/**
 * Resolve the CLIENT-FACING host for a VM's SPICE/VNC console (the address that
 * goes into the downloadable `.vv` file / `spice://host:port` URL).
 *
 * This is deliberately SEPARATE from the QEMU *bind* address (graphicHost, which
 * is kept stable at 0.0.0.0/loopback and self-healed at start — see infinization
 * resolveBindAddress). The connect host must be the reachable IP of the host that
 * actually RUNS the VM, so a remote client (virt-viewer / the browser) can dial
 * it. `0.0.0.0` / loopback are never valid connect targets.
 *
 * Priority (first usable wins):
 *   1. configuredHost — a concrete routable IP explicitly persisted in
 *      graphicHost (legacy / operator override). Wildcard/loopback are skipped.
 *   2. nodeAddress    — the `address` of the Node hosting the VM. This is THE
 *      correct source ("the IP of the host that hosts it"), and is required to be
 *      right for remote compute-node VMs (whose host is NOT the master).
 *   3. envHost        — a GRAPHIC_HOST override configured on the master.
 *   4. requestHost    — the host the client used to reach the API. In a
 *      containerised master the process cannot self-discover the host's LAN IP,
 *      but the client reached the UI on it, so it is a reachable last resort for
 *      MASTER-hosted VMs. Ranked below nodeAddress so it never masks a remote
 *      node's real address.
 *   5. 'localhost'.
 */

// Addresses that are never a valid client connect target.
const UNUSABLE_HOSTS = new Set(['', '0.0.0.0', '::', '*', 'localhost', '127.0.0.1', '::1'])

function usable (h?: string | null): string | null {
  if (h == null) return null
  const s = String(h).trim()
  if (s === '') return null
  return UNUSABLE_HOSTS.has(s.toLowerCase()) ? null : s
}

export interface ConnectHostSources {
  configuredHost?: string | null
  nodeAddress?: string | null
  envHost?: string | null
  requestHost?: string | null
}

export function resolveConnectHost (sources: ConnectHostSources): string {
  return (
    usable(sources.configuredHost) ??
    usable(sources.nodeAddress) ??
    usable(sources.envHost) ??
    usable(sources.requestHost) ??
    'localhost'
  )
}

/**
 * Extract a bare hostname/IP from an HTTP Host / X-Forwarded-Host header value,
 * stripping any `:port` and IPv6 brackets. Returns null when nothing usable.
 */
export function hostFromHeader (raw?: string | string[] | null): string | null {
  if (raw == null) return null
  // X-Forwarded-Host may be a comma list ("client, proxy"); take the first hop.
  const first = Array.isArray(raw) ? raw[0] : String(raw).split(',')[0]
  if (first == null) return null
  const s = first.trim()
  if (s === '') return null
  // IPv6 literal in brackets: "[::1]:5900" -> "::1"
  if (s.startsWith('[')) {
    const end = s.indexOf(']')
    return end > 1 ? s.slice(1, end) : null
  }
  // "host:port" -> "host". A bare IPv6 (multiple colons, no brackets) is left as
  // is — we only strip a single trailing :port.
  const colonCount = (s.match(/:/g) ?? []).length
  if (colonCount === 1) {
    const host = s.slice(0, s.indexOf(':'))
    return host === '' ? null : host
  }
  return s
}
