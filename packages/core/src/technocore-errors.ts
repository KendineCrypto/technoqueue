export class TechnocoreError extends Error {
  constructor(message: string, readonly status?: number, readonly body?: string) { super(message); }
}
export class TechnocoreTimeoutError extends TechnocoreError {}
export class TechnocoreUnavailableError extends TechnocoreError {}
export class TechnocoreRateLimitError extends TechnocoreError {
  constructor(message: string, readonly retryAfterMs: number, status = 429, body?: string) { super(message, status, body); }
}
export class TechnocoreConflictError extends TechnocoreError {
  constructor(message: string, readonly currentValue?: string, body?: string) { super(message, 409, body); }
}
export class TechnocoreProtocolError extends TechnocoreError {}
