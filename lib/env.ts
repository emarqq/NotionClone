/**
 * Environment variable access with runtime guards.
 *
 * Values are read lazily so a missing .env.local fails with a clear error
 * when a Supabase client is actually created, not at module import time
 * (which would break typecheck/build in environments without env vars).
 */
export function requireEnv(name: string, value: string | undefined): string {
  if (!value) {
    throw new Error(
      `Missing environment variable ${name}. ` +
        `Add it to .env.local (see .env.example for the required variables).`
    );
  }
  return value;
}
