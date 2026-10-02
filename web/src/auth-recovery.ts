export class AuthenticationRequiredError extends Error {
  constructor() {
    super("Sign in to continue.");
    this.name = "AuthenticationRequiredError";
  }
}

export class RecentAuthenticationRequiredError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "RecentAuthenticationRequiredError";
  }
}

export function shouldRecoverExpiredSession(status: number, path: string): boolean {
  return status === 401 && !path.startsWith("/api/auth/");
}
