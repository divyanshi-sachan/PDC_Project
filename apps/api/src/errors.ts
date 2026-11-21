import type { ErrorRequestHandler, RequestHandler } from "express";
import { ZodError } from "zod";

/** Throw from a handler to produce `{ error: { code, message } }` with the given status. */
export class ApiError extends Error {
  readonly status: number;
  readonly code: string;
  constructor(status: number, code: string, message: string) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

export const notFound = (what = "resource") => new ApiError(404, "not_found", `${what} not found`);

export const notFoundHandler: RequestHandler = (_req, _res, next) => next(notFound("route"));

/** The one error middleware: zod → 422, ApiError → its status, body-parser 4xx → 4xx, anything else → 500 (no stack). */
export const errorMiddleware: ErrorRequestHandler = (err: unknown, _req, res, next) => {
  if (res.headersSent) {
    // SSE or a half-written response: nothing sensible to send, drop the socket.
    res.end();
    return;
  }
  void next;
  if (err instanceof ApiError) {
    res.status(err.status).json({ error: { code: err.code, message: err.message } });
    return;
  }
  if (err instanceof ZodError) {
    const message = err.issues.map((i) => `${i.path.join(".") || "(root)"}: ${i.message}`).join("; ");
    res.status(422).json({ error: { code: "validation_error", message } });
    return;
  }
  const e = err as { status?: unknown; type?: unknown };
  if (typeof e.status === "number" && e.status >= 400 && e.status < 500) {
    if (e.type === "entity.parse.failed") {
      res.status(400).json({ error: { code: "bad_json", message: "request body is not valid JSON" } });
    } else if (e.type === "entity.too.large") {
      res.status(413).json({ error: { code: "payload_too_large", message: "request body too large" } });
    } else {
      res.status(e.status).json({ error: { code: "bad_request", message: "bad request" } });
    }
    return;
  }
  console.error("[api] unhandled error:", err instanceof Error ? err.message : String(err));
  res.status(500).json({ error: { code: "internal_error", message: "internal server error" } });
};
