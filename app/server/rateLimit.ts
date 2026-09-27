// In-memory fixed-window rate limiter (CONTRACTS §6: POST endpoints 30/min/IP,
// photos 10/min/IP). Process-local by design — a multi-process deployment would
// move this to a shared store; at MVP scale a single process serves everything.
import type { IncomingMessage } from 'node:http'
import { clientIp } from './validate.ts'

interface Bucket {
  count: number
  resetAt: number
}

const WINDOW_MS = 60_000
const buckets = new Map<string, Bucket>()

// Lazy sweep so the map cannot grow unboundedly under junk traffic.
let lastSweep = Date.now()
function sweep(now: number): void {
  if (now - lastSweep < WINDOW_MS * 5) return
  lastSweep = now
  for (const [key, bucket] of buckets) {
    if (bucket.resetAt <= now) buckets.delete(key)
  }
}

/**
 * Consume one token from `bucketName` for the caller's IP.
 * Returns true when the request is within the limit.
 */
export function consumeRateLimit(req: IncomingMessage, bucketName: string, limitPerMin: number): boolean {
  const now = Date.now()
  sweep(now)
  const key = `${bucketName}|${clientIp(req)}`
  let bucket = buckets.get(key)
  if (!bucket || bucket.resetAt <= now) {
    bucket = { count: 0, resetAt: now + WINDOW_MS }
    buckets.set(key, bucket)
  }
  bucket.count += 1
  return bucket.count <= limitPerMin
}

/** Test hook: clear all buckets. */
export function resetRateLimits(): void {
  buckets.clear()
}
