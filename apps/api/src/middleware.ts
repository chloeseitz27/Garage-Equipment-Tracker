import type { NextFunction, Request, RequestHandler, Response } from 'express';

/** Express 4 doesn't catch rejected promises from handlers; this does. */
export const asyncHandler =
  (handler: (req: Request, res: Response, next: NextFunction) => Promise<unknown>): RequestHandler =>
  (req, res, next) => {
    handler(req, res, next).catch(next);
  };

/**
 * Per-IP fixed-window limiter.
 *
 * `/api/assistant/recommend` is unauthenticated by design and costs money per
 * call, so an accidental loop shouldn't burn the quota mid-hackathon
 * (technical-spec.md §9.2). In-memory is fine for a single kiosk process.
 */
export function rateLimit(options: { windowMs: number; max: number }): RequestHandler {
  const hits = new Map<string, { count: number; resetAt: number }>();

  return (req, res, next) => {
    const key = req.ip ?? 'unknown';
    const now = Date.now();
    const entry = hits.get(key);

    if (!entry || entry.resetAt <= now) {
      hits.set(key, { count: 1, resetAt: now + options.windowMs });
      next();
      return;
    }

    if (entry.count >= options.max) {
      res.status(429).json({ error: 'Too many requests — try again in a moment.' });
      return;
    }

    entry.count += 1;
    next();
  };
}
