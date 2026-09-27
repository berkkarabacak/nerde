// Shared HTTP plumbing for the Nerde API: request context, typed errors,
// response helpers. No side effects on import.
import type { IncomingMessage, ServerResponse } from 'node:http'

/** Authenticated user attached to the request context (subset of users row). */
export interface SessionUser {
  id: number
  username: string
  role: 'user' | 'admin'
}

/** Everything a route handler needs. */
export interface Ctx {
  req: IncomingMessage
  res: ServerResponse
  method: string
  path: string
  /** Path parameters captured by the router (`:slug` → params.slug). */
  params: Record<string, string>
  query: URLSearchParams
  /** Session user when a valid `nerde_session` cookie is present, else null. */
  user: SessionUser | null
}

/** Error carrying an HTTP status; the router turns it into `{error}` JSON. */
export class HttpError extends Error {
  status: number
  extra?: Record<string, unknown>
  constructor(status: number, message: string, extra?: Record<string, unknown>) {
    super(message)
    this.name = 'HttpError'
    this.status = status
    this.extra = extra
  }
}

/** Convenience thrower: `throw httpError(404, 'place not found')`. */
export function httpError(status: number, message: string, extra?: Record<string, unknown>): HttpError {
  return new HttpError(status, message, extra)
}

/** Send a JSON response and end the request. */
export function json(res: ServerResponse, status: number, body: unknown): void {
  const payload = JSON.stringify(body)
  res.statusCode = status
  res.setHeader('content-type', 'application/json; charset=utf-8')
  res.setHeader('content-length', Buffer.byteLength(payload))
  res.end(payload)
}

/** 204 No Content (used by POST /api/events). */
export function noContent(res: ServerResponse): void {
  res.statusCode = 204
  res.end()
}
