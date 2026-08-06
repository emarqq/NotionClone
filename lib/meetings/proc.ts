import "server-only";

import { spawn } from "node:child_process";

export interface RunResult {
  code: number | null;
  stdout: string;
  stderr: string;
}

/**
 * Spawn a binary and collect its output.
 *
 * Always called with an ABSOLUTE binary path: the Electron shell spawns the Next
 * server with a minimal PATH (`childEnv()` in desktop/electron/src/main.js is
 * /opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin), which notably excludes the
 * Python framework bin dir where the fallback whisper lives. Resolving by name
 * would work in a terminal and mysteriously fail inside the desktop app.
 *
 * `shell: false` (the default) — none of these arguments are shell-escaped, and
 * transcripts contain arbitrary user speech. Never switch this to a shell.
 */
export function run(
  bin: string,
  args: string[],
  opts: { signal?: AbortSignal; cwd?: string } = {}
): Promise<RunResult> {
  return new Promise((resolve, reject) => {
    const child = spawn(bin, args, { signal: opts.signal, cwd: opts.cwd });
    let stdout = "";
    let stderr = "";

    // Cap retained output: whisper is chatty and a long meeting would otherwise
    // hold megabytes of progress lines in memory for no reason.
    const MAX = 64 * 1024;
    child.stdout.on("data", (d: Buffer) => {
      if (stdout.length < MAX) stdout += d.toString();
    });
    child.stderr.on("data", (d: Buffer) => {
      if (stderr.length < MAX) stderr += d.toString();
    });

    child.on("error", reject);
    child.on("close", (code) => resolve({ code, stdout, stderr }));
  });
}

/** Run and throw on a non-zero exit, surfacing the tail of stderr. */
export async function runOrThrow(
  label: string,
  bin: string,
  args: string[],
  opts: { signal?: AbortSignal } = {}
): Promise<RunResult> {
  const result = await run(bin, args, opts);
  if (result.code !== 0) {
    const tail = result.stderr.trim().split("\n").slice(-4).join(" | ");
    throw new Error(`${label} failed (exit ${result.code}): ${tail || "no output"}`);
  }
  return result;
}
