import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";

/**
 * Tests for .claude/hooks/enforce-status-update.sh — the Stop hook that blocks
 * ending a session with a dirty tree unless STATUS.md was touched.
 *
 * These drive the REAL script in throwaway git repos under os.tmpdir() rather
 * than reimplementing its logic, so they exercise the actual porcelain parsing.
 */

const HOOK = path.resolve(__dirname, "../../.claude/hooks/enforce-status-update.sh");
const BYPASS_FLAG = "/tmp/.skip-status-check";

/** The bypass flag is a real global path — preserve whatever the user had. */
let savedBypass: string | null = null;

beforeAll(() => {
  savedBypass = fs.existsSync(BYPASS_FLAG) ? fs.readFileSync(BYPASS_FLAG, "utf8") : null;
  fs.rmSync(BYPASS_FLAG, { force: true });
});

afterAll(() => {
  if (savedBypass !== null) fs.writeFileSync(BYPASS_FLAG, savedBypass);
  else fs.rmSync(BYPASS_FLAG, { force: true });
});

let repo: string;

function git(...args: string[]): string {
  return execFileSync("git", args, { cwd: repo, encoding: "utf8" });
}

function write(rel: string, content: string): void {
  const full = path.join(repo, rel);
  fs.mkdirSync(path.dirname(full), { recursive: true });
  fs.writeFileSync(full, content);
}

type Verdict = "allow" | "block";

/** Run the hook in `repo` and classify its decision. */
function runHook(): { verdict: Verdict; stdout: string } {
  const stdout = execFileSync("bash", [HOOK], { cwd: repo, encoding: "utf8" });
  const blocked = stdout.includes('"decision": "block"');
  return { verdict: blocked ? "block" : "allow", stdout };
}

beforeEach(() => {
  repo = fs.mkdtempSync(path.join(os.tmpdir(), "hooktest-"));
  git("init", "-q", ".");
  git("config", "user.email", "test@example.com");
  git("config", "user.name", "Test");
  write("STATUS.md", "# status\n");
  write("src/app.ts", "export const a = 1;\n");
  git("add", "-A");
  git("commit", "-qm", "init");
});

afterEach(() => {
  fs.rmSync(repo, { recursive: true, force: true });
  fs.rmSync(BYPASS_FLAG, { force: true });
});

describe("enforce-status-update.sh", () => {
  describe("allow paths", () => {
    it("allows a clean tree (nothing changed, nothing to log)", () => {
      expect(runHook().verdict).toBe("allow");
    });

    it("allows when STATUS.md was modified alongside code", () => {
      write("src/app.ts", "export const a = 2;\n");
      write("STATUS.md", "# status\nupdated\n");
      expect(runHook().verdict).toBe("allow");
    });

    it("allows when STATUS.md is the only change", () => {
      write("STATUS.md", "# status\nonly this\n");
      expect(runHook().verdict).toBe("allow");
    });

    it("allows when STATUS.md is newly created (untracked)", () => {
      git("rm", "-q", "STATUS.md");
      git("commit", "-qm", "drop status");
      write("STATUS.md", "# recreated\n");
      expect(runHook().verdict).toBe("allow");
    });
  });

  describe("block path", () => {
    it("blocks when code changed but STATUS.md did not", () => {
      write("src/app.ts", "export const a = 2;\n");
      const { verdict, stdout } = runHook();
      expect(verdict).toBe("block");
      // The block payload must be valid JSON with a usable reason.
      const parsed = JSON.parse(stdout);
      expect(parsed.decision).toBe("block");
      expect(parsed.reason).toMatch(/STATUS\.md/);
    });

    it("blocks on an untracked new file with no STATUS.md update", () => {
      write("src/new.ts", "export const b = 2;\n");
      expect(runHook().verdict).toBe("block");
    });

    it("blocks on a staged deletion with no STATUS.md update", () => {
      git("rm", "-q", "src/app.ts");
      expect(runHook().verdict).toBe("block");
    });

    it("does NOT treat a differently-pathed STATUS.md as the real one", () => {
      // Exact-match regression: docs/STATUS.md must not satisfy the check.
      write("docs/STATUS.md", "# not the root one\n");
      write("src/app.ts", "export const a = 3;\n");
      expect(runHook().verdict).toBe("block");
    });
  });

  describe("bypass path", () => {
    it("allows a dirty tree when the bypass flag is set", () => {
      write("src/app.ts", "export const a = 2;\n");
      fs.writeFileSync(BYPASS_FLAG, "");
      expect(runHook().verdict).toBe("allow");
    });

    it("consumes the bypass flag so it only works once", () => {
      write("src/app.ts", "export const a = 2;\n");
      fs.writeFileSync(BYPASS_FLAG, "");

      expect(runHook().verdict).toBe("allow");
      expect(fs.existsSync(BYPASS_FLAG)).toBe(false);
      // Second run, same dirty tree, flag now gone -> must block again.
      expect(runHook().verdict).toBe("block");
    });
  });

  describe("path parsing regressions", () => {
    it("handles a changed filename containing a space", () => {
      // Regression: `awk '{print $2}'` truncated "my notes file.md" to `"my`.
      write("my notes file.md", "hello\n");
      expect(runHook().verdict).toBe("block");
    });

    it("allows when STATUS.md changed alongside a space-named file", () => {
      // The space-named path must not desync parsing and hide STATUS.md.
      write("my notes file.md", "hello\n");
      write("STATUS.md", "# updated\n");
      expect(runHook().verdict).toBe("allow");
    });

    it("recognises STATUS.md when it arrives via a rename", () => {
      // Regression: porcelain prints `R  <old> -> <new>`; the old parser took
      // the SOURCE path, so `git mv DRAFT.md STATUS.md` blocked incorrectly.
      git("rm", "-q", "STATUS.md");
      git("commit", "-qm", "drop status");
      write("DRAFT.md", "draft\n");
      git("add", "-A");
      git("commit", "-qm", "add draft");
      git("mv", "DRAFT.md", "STATUS.md");
      expect(runHook().verdict).toBe("allow");
    });

    it("still blocks a rename that does not produce STATUS.md", () => {
      git("mv", "src/app.ts", "src/renamed.ts");
      expect(runHook().verdict).toBe("block");
    });

    it("keeps record alignment when a rename precedes other changes", () => {
      // A rename emits TWO NUL fields; if the source field is not consumed,
      // every subsequent entry is misread and STATUS.md can be missed.
      git("mv", "src/app.ts", "src/renamed.ts");
      write("STATUS.md", "# updated\n");
      expect(runHook().verdict).toBe("allow");
    });

    it("handles a path with non-ASCII characters", () => {
      write("étude.md", "hello\n");
      expect(runHook().verdict).toBe("block");
    });
  });

  describe("non-git safety", () => {
    it("no-ops (allows) outside a git repository", () => {
      const plain = fs.mkdtempSync(path.join(os.tmpdir(), "nogit-"));
      try {
        const stdout = execFileSync("bash", [HOOK], { cwd: plain, encoding: "utf8" });
        expect(stdout).not.toContain('"decision": "block"');
      } finally {
        fs.rmSync(plain, { recursive: true, force: true });
      }
    });
  });
});
