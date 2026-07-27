import { execFileSync } from "node:child_process";
import path from "node:path";

/**
 * Thin psql driver for the DISPOSABLE test container (see setup-scratch-db.sh).
 *
 * Everything here targets container `nc_test_pg` on purpose — never the real
 * local Supabase stack, which holds Erik's actual notes.
 */

const CONTAINER = "nc_test_pg";
const SETUP = path.resolve(__dirname, "setup-scratch-db.sh");

function dockerEnv(): NodeJS.ProcessEnv {
  return {
    ...process.env,
    DOCKER_HOST:
      process.env.DOCKER_HOST ?? `unix://${process.env.HOME}/.colima/default/docker.sock`,
  };
}

/**
 * Ensure the scratch DB exists with all migrations applied.
 * Returns false when Docker isn't available, so suites can skip rather than fail.
 */
export function ensureScratchDb(): boolean {
  try {
    execFileSync("bash", [SETUP], { env: dockerEnv(), encoding: "utf8", stdio: "pipe" });
    return true;
  } catch {
    return false;
  }
}

/** Run SQL, returning nothing. Throws with psql's stderr on error. */
export function exec(sql: string): void {
  execFileSync(
    "docker",
    ["exec", "-i", CONTAINER, "psql", "-U", "postgres", "-d", "postgres", "-v", "ON_ERROR_STOP=1", "-q"],
    { env: dockerEnv(), input: sql, encoding: "utf8", stdio: "pipe" }
  );
}

/**
 * Run a SELECT and return the rows as objects.
 *
 * Goes through `json_agg` so values keep their types and any delimiter inside
 * the data can't corrupt the parse — psql's aligned text output would.
 */
export function query<T = Record<string, unknown>>(sql: string): T[] {
  const wrapped = `select coalesce(json_agg(t), '[]'::json)::text from (${sql}) t;`;
  const out = execFileSync(
    "docker",
    ["exec", "-i", CONTAINER, "psql", "-U", "postgres", "-d", "postgres", "-tA", "-v", "ON_ERROR_STOP=1"],
    { env: dockerEnv(), input: wrapped, encoding: "utf8", stdio: "pipe" }
  );
  return JSON.parse(out.trim()) as T[];
}

/**
 * A deterministic 768-dim unit-ish vector literal for pgvector.
 *
 * `seed` picks the "direction": vectors built from the same seed are identical,
 * and different seeds are far apart in cosine distance, which is what lets a
 * test assert on vector ranking without running a real embedding model.
 */
export function vec(seed: number): string {
  const dims = Array.from({ length: 768 }, (_, i) => (i % 97 === seed % 97 ? 1 : 0.0001));
  return `[${dims.join(",")}]`;
}
