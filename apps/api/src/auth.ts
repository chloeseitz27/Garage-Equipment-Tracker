import { createHmac, timingSafeEqual } from 'node:crypto';
import type { NextFunction, Request, Response } from 'express';

import { config } from './config.js';

/**
 * Shared-passphrase auth issuing a signed httpOnly cookie (technical-spec.md §8).
 *
 * Deliberately minimal and NOT a production answer — no individual
 * accountability, no audit trail. It sits behind one middleware precisely so
 * that swapping in Entra ID later touches this file and nothing else.
 */

const COOKIE_NAME = 'garage_staff';

const sign = (payload: string): string =>
  createHmac('sha256', config.sessionSecret).update(payload).digest('hex');

const safeEqual = (a: string, b: string): boolean => {
  const bufferA = Buffer.from(a);
  const bufferB = Buffer.from(b);
  return bufferA.length === bufferB.length && timingSafeEqual(bufferA, bufferB);
};

export const isValidPassphrase = (passphrase: string): boolean =>
  safeEqual(passphrase, config.staffPassphrase);

const createToken = (): string => {
  const expiresAt = String(Date.now() + config.sessionTtlMinutes * 60_000);
  return `${expiresAt}.${sign(expiresAt)}`;
};

const isValidToken = (token: string | undefined): boolean => {
  if (!token) return false;
  const [expiresAt, signature] = token.split('.');
  if (!expiresAt || !signature) return false;
  if (!safeEqual(signature, sign(expiresAt))) return false;
  return Number(expiresAt) > Date.now();
};

export const issueSession = (res: Response): void => {
  res.cookie(COOKIE_NAME, createToken(), {
    httpOnly: true,
    sameSite: 'lax',
    maxAge: config.sessionTtlMinutes * 60_000,
  });
};

export const clearSession = (res: Response): void => {
  res.clearCookie(COOKIE_NAME);
};

export const isStaff = (req: Request): boolean => isValidToken(req.cookies?.[COOKIE_NAME]);

/**
 * Every mutating staff route goes through this. Hiding edit affordances in the
 * UI is not access control (technical-spec.md §8).
 */
export const requireStaff = (req: Request, res: Response, next: NextFunction): void => {
  if (!isStaff(req)) {
    res.status(401).json({ error: 'Staff sign-in required' });
    return;
  }
  // Sliding expiry: activity keeps the session alive, an abandoned kiosk times out.
  issueSession(res);
  next();
};
