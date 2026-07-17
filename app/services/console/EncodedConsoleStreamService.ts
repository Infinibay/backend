/**
 * EncodedConsoleStreamService — master-side relay for infinigpu's infiniPixel
 * remote-display stream (docs/INTEGRATION.md §4); the GPU-VM counterpart to the
 * SPICE console relay.
 *
 * A GPU VM has NO SPICE console — infinization gives it `-vga none` plus the
 * infinigpu vfio-user device as its SOLE display, and its remote display is the
 * infiniPixel WebSocket the per-VM device server serves on 127.0.0.1:<pixelPort>
 * inside the backend host. This relay bridges that loopback WS to a
 * client-reachable ingress port on the master — exactly as SpiceProxyService does
 * for SPICE — so the native infinigpu viewer (or the browser WebCodecs client)
 * can connect from off-host without publishing the device server's port.
 *
 * It reuses SpiceProxyService's protocol-agnostic raw-TCP relay verbatim (the
 * WebSocket upgrade + frames pass straight through) on a SEPARATE port range, so
 * a GPU VM's stream can never collide with a SPICE session. The upstream
 * (host, port) is still resolved SERVER-SIDE — never from client input — so this
 * is not an open relay.
 */
import { SpiceProxyService } from './SpiceProxyService'

function envInt (name: string, fallback: number): number {
  const raw = process.env[name]
  if (raw == null || raw.trim() === '') return fallback
  const n = Number(raw)
  return Number.isInteger(n) ? n : fallback
}

let instance: SpiceProxyService | null = null

/**
 * Singleton relay for infiniPixel streams. Listens on INFINIPIXEL_PROXY_PORT_MIN..
 * MAX (default 6120-6139 — adjacent to, and non-overlapping with, the SPICE
 * proxy's 6100-6119). Publish that range from the container to reach it off-host.
 */
export function getEncodedConsoleStreamService (): SpiceProxyService {
  if (instance == null) {
    instance = new SpiceProxyService({
      portMin: envInt('INFINIPIXEL_PROXY_PORT_MIN', 6120),
      portMax: envInt('INFINIPIXEL_PROXY_PORT_MAX', 6139)
    })
  }
  return instance
}
