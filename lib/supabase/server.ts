import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { requireEnv } from "@/lib/env";

/**
 * Service-role Supabase client. Bypasses RLS — server-only.
 * Throws immediately if imported/executed in the browser.
 *
 * This is the ONLY Supabase client in the app. Auth was removed on 2026-08-04
 * (single-user, self-hosted, bound to localhost), so there is no session to
 * respect and no cookie-scoped anon client: every read and write goes through
 * the service role. Nothing in the schema is scoped by user — no table has a
 * `user_id`/`owner_id` column and no policy references `auth.uid()` — so this
 * is the same data every request already saw when a login existed.
 *
 * The blanket `to authenticated using (true)` RLS policies on every table are
 * left in place deliberately: the service role bypasses them, and they still
 * deny a stray direct PostgREST connection made with the anon key.
 */
export function createServiceSupabase(): SupabaseClient {
  if (typeof window !== "undefined") {
    throw new Error(
      "createServiceSupabase() must never run in the browser: it uses the service-role key."
    );
  }

  return createClient(
    requireEnv("NEXT_PUBLIC_SUPABASE_URL", process.env.NEXT_PUBLIC_SUPABASE_URL),
    requireEnv(
      "SUPABASE_SERVICE_ROLE_KEY",
      process.env.SUPABASE_SERVICE_ROLE_KEY
    ),
    {
      auth: {
        persistSession: false,
        autoRefreshToken: false,
      },
    }
  );
}
