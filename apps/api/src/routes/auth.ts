import { Router } from 'express';
import { loginSchema } from '@garage/shared';

import { clearSession, isStaff, issueSession, isValidPassphrase } from '../auth.js';

export function authRoutes(): Router {
  const router = Router();

  router.get('/session', (req, res) => {
    res.json({ staff: isStaff(req) });
  });

  router.post('/login', (req, res) => {
    const parsed = loginSchema.safeParse(req.body);
    if (!parsed.success || !isValidPassphrase(parsed.data.passphrase)) {
      res.status(401).json({ error: 'Incorrect passphrase' });
      return;
    }

    issueSession(res);
    res.json({ staff: true });
  });

  // No requireStaff here: it would re-issue the cookie moments before we clear
  // it, and signing out should always succeed regardless of session state.
  router.post('/logout', (_req, res) => {
    clearSession(res);
    res.json({ staff: false });
  });

  return router;
}
