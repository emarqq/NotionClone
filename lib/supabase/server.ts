import { createServerClient } from "@supabase/ssr";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { cookies } from "next/headers";
import { requireEnv } from "@/lib/env";

/**
 * Cookie-based Supabase client for Server Components, Server Actions and
 * Route Handlers. Uses the anon key; respects the signed-in user's session.
 */
export async function createServerSupabase(): Promise<SupabaseClient> {
  const cookieStore = await cookies();

  return createServerClient(
    requireEnv("NEXT_PUBLIC_SUPABASE_URL", process.env.NEXT_PUBLIC_SUPABASE_URL),
    requireEnv(
      "NEXT_PUBLIC_SUPABASE_ANON_KEY",
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
    ),
    {
      cookies: {
        getAll() {
          return cookieStore.getAll();
        },
        setAll(cookiesToSet) {
          try {
            cookiesToSet.forEach(({ name, value, options }) =>
              cookieStore.set(name, value, options)
            );
          } catch {
            // `cookies().set` throws when called from a Server Component.
            // Safe to ignore: middleware refreshes the session cookie.
          }
        },
      },
    }
  );
}

/**
 * Service-role Supabase client. Bypasses RLS — server-only.
 * Throws immediately if imported/executed in the browser.
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
