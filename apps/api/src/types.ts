export interface AuthUser {
  id: string;
  email?: string;
}

declare global {
  // Express's documented extension point for request properties.
  namespace Express {
    interface Request {
      user?: AuthUser;
    }
  }
}
