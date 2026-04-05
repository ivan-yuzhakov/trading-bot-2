import type { Request, Response, NextFunction } from 'express';

export function authRequired(req: any, res: Response, next: NextFunction): void {
  if (!req.auth) {
    res.redirect('/');
    return;
  }
  next();
}

export function authJson(req: any, res: Response, next: NextFunction): void {
  if (!req.auth) {
    res.json({ error: 'Unauthorized' });
    return;
  }
  next();
}
