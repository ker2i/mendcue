// Express 4 does not forward async handler rejections. This wraps every
// subsequently registered handler so thrown errors reach the error
// middleware instead of becoming unhandled rejections (R12).
import type { Express, NextFunction, Request, Response } from "express";

type Handler = (req: Request, res: Response, next: NextFunction) => unknown;

function wrap(h: unknown): unknown {
  if (typeof h !== "function") return h;
  const fn = h as Handler & { length: number };
  if (fn.length >= 4) return h; // error middleware: leave alone
  return (req: Request, res: Response, next: NextFunction) => {
    Promise.resolve(fn(req, res, next)).catch(next);
  };
}

export function patchAsyncErrors(app: Express): void {
  if ((app as unknown as { __asyncPatched?: boolean }).__asyncPatched) return;
  (app as unknown as { __asyncPatched?: boolean }).__asyncPatched = true;
  for (const m of ["get", "post", "patch", "put", "delete", "options", "use"] as const) {
    const orig = (app[m] as unknown as (...args: unknown[]) => unknown).bind(app);
    (app[m] as unknown as (...args: unknown[]) => unknown) = (...args: unknown[]) =>
      orig(...args.map((a) => (Array.isArray(a) ? a.map(wrap) : wrap(a))));
  }
}
