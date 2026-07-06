// Notion Clone desktop app — Electron main process.
//
// Ports the startup sequence from ../../launch.sh: boot colima (if needed),
// boot local Supabase (if needed), boot the Next.js production server on
// port 3777 (building first if there's no .next/BUILD_ID), wait for it to
// answer, then show the main window. Everything is idempotent — if a
// service is already running we just reuse it, exactly like launch.sh.
//
// The Next.js server is spawned *detached* so it outlives this process:
// quitting the app (Cmd-Q, red-dot close, whatever) must not kill the
// backend. The only way to stop the backend from inside the app is the
// "Shut Down Backend & Quit" item in the app menu, which shells out to
// stop.sh --all.

const { app, BrowserWindow, Menu, MenuItem, shell } = require("electron");
const { spawn } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");
const http = require("node:http");

// Hardcoded, matching launch.sh/stop.sh: this is a single-machine personal
// tool, not a redistributable app. It also sidesteps a real footgun — once
// packaged, __dirname resolves *inside* app.asar (e.g.
// ".../Notion Clone.app/Contents/Resources/app.asar/src"), not the actual
// checkout on disk, so deriving REPO_DIR from __dirname silently points at
// garbage (this was caught in testing: it produced a bogus Supabase
// project-id derived from ".../Contents" and nearly raced the real stack).
const REPO_DIR = "/Users/erikmarquardt/OS/projects/NotionClone";
const DESKTOP_DIR = path.join(REPO_DIR, "desktop");
const LOG_DIR = path.join(app.getPath("home"), "Library", "Logs");
const LOG_FILE = path.join(LOG_DIR, "NotionClone.log");
const PORT = 3777;
const APP_URL = `http://127.0.0.1:${PORT}`;
const SUPABASE_BIN = "/opt/homebrew/bin/supabase";
const DOCKER_SOCK = "unix:///Users/erikmarquardt/.colima/default/docker.sock";
const WINDOW_STATE_FILE = path.join(app.getPath("userData"), "window-state.json");

fs.mkdirSync(LOG_DIR, { recursive: true });

function log(message) {
  const ts = new Date()
    .toLocaleString("sv-SE", { hour12: false })
    .replace(",", "");
  fs.appendFileSync(LOG_FILE, `${ts} ${message}\n`);
}

// PATH inside a .app bundle is minimal (no shell profile is sourced), so we
// build it explicitly the same way launch.sh's environment ends up looking
// when run from a full shell. DOCKER_HOST is required for colima/supabase's
// docker calls to find the colima VM's socket.
function childEnv() {
  return {
    ...process.env,
    PATH: `/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:${process.env.PATH || ""}`,
    DOCKER_HOST: DOCKER_SOCK,
  };
}

// Runs a command to completion, appending all output to the log file.
// Resolves with the exit code (never rejects on non-zero exit — callers
// check the code themselves, matching launch.sh's `if cmd; then` checks).
function runCommand(cmd, args, opts = {}) {
  return new Promise((resolve) => {
    const fd = fs.openSync(LOG_FILE, "a");
    const child = spawn(cmd, args, {
      cwd: opts.cwd || REPO_DIR,
      env: childEnv(),
      stdio: ["ignore", fd, fd],
    });
    // A failed spawn emits 'error' and then still emits 'close' — guard so
    // we don't close the same fd twice (the second close throws EBADF,
    // uncaught, and crashes the whole Electron main process).
    let fdClosed = false;
    const closeFd = () => {
      if (fdClosed) return;
      fdClosed = true;
      fs.closeSync(fd);
    };
    child.on("error", (err) => {
      log(`${cmd} ${args.join(" ")}: FAILED to spawn (${err.message})`);
      closeFd();
      resolve(1);
    });
    child.on("close", (code) => {
      closeFd();
      resolve(code ?? 1);
    });
  });
}

function httpStatus(url, timeoutMs = 2000) {
  return new Promise((resolve) => {
    const req = http.get(url, { timeout: timeoutMs }, (res) => {
      res.resume();
      resolve(res.statusCode);
    });
    req.on("timeout", () => {
      req.destroy();
      resolve(null);
    });
    req.on("error", () => resolve(null));
  });
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// ---------------------------------------------------------------------
// Splash window
// ---------------------------------------------------------------------

let splashWin = null;

function splashHtml() {
  return `<!doctype html>
<html>
<head>
<meta charset="utf-8">
<style>
  :root { color-scheme: light dark; }
  html, body {
    margin: 0; height: 100%; -webkit-user-select: none; user-select: none;
    background: #1e1e1e; color: #eee;
    font-family: -apple-system, BlinkMacSystemFont, "SF Pro Text", sans-serif;
    display: flex; align-items: center; justify-content: center;
  }
  .card { text-align: center; padding: 24px; }
  h1 { font-size: 17px; font-weight: 600; margin: 0 0 10px; letter-spacing: -0.2px; }
  #status { font-size: 12px; color: #a0a0a0; min-height: 16px; }
  .spinner {
    margin: 0 auto 14px; width: 22px; height: 22px;
    border-radius: 50%; border: 2.5px solid rgba(255,255,255,0.2);
    border-top-color: #eee; animation: spin 0.8s linear infinite;
  }
  @keyframes spin { to { transform: rotate(360deg); } }
</style>
</head>
<body>
  <div class="card">
    <div class="spinner"></div>
    <h1>Notion Clone</h1>
    <div id="status">Starting…</div>
  </div>
</body>
</html>`;
}

function createSplash() {
  splashWin = new BrowserWindow({
    width: 320,
    height: 200,
    frame: false,
    resizable: false,
    movable: true,
    center: true,
    show: true,
    alwaysOnTop: true,
    icon: path.join(DESKTOP_DIR, "icon.icns"),
    webPreferences: { contextIsolation: true },
  });
  splashWin.loadURL(`data:text/html,${encodeURIComponent(splashHtml())}`);
}

function setStatus(text) {
  log(`status: ${text}`);
  if (splashWin && !splashWin.isDestroyed()) {
    splashWin.webContents
      .executeJavaScript(
        `document.getElementById('status') && (document.getElementById('status').innerText = ${JSON.stringify(text)});`
      )
      .catch(() => {});
  }
}

// ---------------------------------------------------------------------
// Startup sequence (ported from launch.sh)
// ---------------------------------------------------------------------

async function ensureColima() {
  setStatus("Checking Docker VM…");
  const status = await runCommand("colima", ["status"]);
  if (status === 0) {
    log("colima: already running");
    return true;
  }
  setStatus("Starting Docker VM…");
  log("colima: not running, starting...");
  const started = await runCommand("colima", ["start"]);
  if (started === 0) {
    log("colima: started ok");
    return true;
  }
  log("colima: FAILED to start");
  return false;
}

async function ensureSupabase() {
  setStatus("Checking Supabase…");
  const status = await runCommand(SUPABASE_BIN, ["status"], { cwd: REPO_DIR });
  if (status === 0) {
    log("supabase: already running");
    return true;
  }
  setStatus("Starting Supabase…");
  log("supabase: not running, starting...");
  const started = await runCommand(SUPABASE_BIN, ["start"], { cwd: REPO_DIR });
  if (started === 0) {
    log("supabase: started ok");
    return true;
  }
  log("supabase: FAILED to start");
  return false;
}

async function isPortListening() {
  const code = await httpStatus(APP_URL, 1500);
  return code !== null;
}

async function ensureNextServer() {
  if (await isPortListening()) {
    log(`next: something already listening on ${PORT}, reusing it`);
    return true;
  }
  log(`next: nothing listening on ${PORT}`);

  const buildIdPath = path.join(REPO_DIR, ".next", "BUILD_ID");
  if (!fs.existsSync(buildIdPath)) {
    setStatus("Building app…");
    log("next: no build found (.next/BUILD_ID missing), running npm run build...");
    const buildCode = await runCommand("npm", ["run", "build"], { cwd: REPO_DIR });
    if (buildCode !== 0) {
      log("next: BUILD FAILED");
      return false;
    }
    log("next: build succeeded");
  }

  setStatus("Starting server…");
  log(`next: starting production server on port ${PORT}...`);
  const fd = fs.openSync(LOG_FILE, "a");
  const child = spawn("npx", ["next", "start", "-p", String(PORT)], {
    cwd: REPO_DIR,
    env: childEnv(),
    detached: true,
    stdio: ["ignore", fd, fd],
  });
  child.unref();
  fs.closeSync(fd);

  setStatus("Waiting for server…");
  log(`waiting for ${APP_URL} to respond...`);
  for (let i = 0; i < 180; i++) {
    const code = await httpStatus(APP_URL, 2000);
    if (code !== null) {
      log(`next: server ready after ${i + 1}s (HTTP ${code})`);
      return true;
    }
    await sleep(1000);
  }
  log(`ERROR: timed out after 180s waiting for ${APP_URL} to respond`);
  return false;
}

async function runStartupSequence() {
  log("==== Electron main starting startup sequence ====");

  const colimaOk = await ensureColima();
  if (!colimaOk) {
    return { ok: false, reason: "Docker VM (colima) failed to start. Check the log for details." };
  }

  const supabaseOk = await ensureSupabase();
  if (!supabaseOk) {
    return { ok: false, reason: "Supabase failed to start. Check the log for details." };
  }

  const nextOk = await ensureNextServer();
  if (!nextOk) {
    return {
      ok: false,
      reason: `The app server did not respond at ${APP_URL} within 180s. Check the log at ${LOG_FILE}.`,
    };
  }

  log("==== startup sequence done ====");
  return { ok: true };
}

// ---------------------------------------------------------------------
// Main window + window-state persistence
// ---------------------------------------------------------------------

let mainWin = null;

function loadWindowState() {
  try {
    const raw = fs.readFileSync(WINDOW_STATE_FILE, "utf8");
    const state = JSON.parse(raw);
    if (
      typeof state.width === "number" &&
      typeof state.height === "number"
    ) {
      return state;
    }
  } catch {
    // no saved state yet, or it's corrupt — fall through to defaults
  }
  return { width: 1280, height: 800 };
}

function saveWindowState() {
  if (!mainWin || mainWin.isDestroyed()) return;
  const bounds = mainWin.isMaximized() ? mainWin.getNormalBounds() : mainWin.getBounds();
  const state = { ...bounds, maximized: mainWin.isMaximized() };
  try {
    fs.writeFileSync(WINDOW_STATE_FILE, JSON.stringify(state));
  } catch (err) {
    log(`window-state: failed to save (${err.message})`);
  }
}

function createMainWindow() {
  const state = loadWindowState();
  mainWin = new BrowserWindow({
    x: state.x,
    y: state.y,
    width: state.width,
    height: state.height,
    minWidth: 940,
    minHeight: 600,
    title: "Notion Clone",
    icon: path.join(DESKTOP_DIR, "icon.icns"),
    show: false,
    webPreferences: { contextIsolation: true },
  });

  if (state.maximized) mainWin.maximize();

  mainWin.loadURL(APP_URL);

  mainWin.once("ready-to-show", () => {
    mainWin.show();
    log("main window shown");
  });

  // External links (anything not on our own origin) open in the user's
  // default browser instead of a second Electron window.
  mainWin.webContents.setWindowOpenHandler(({ url }) => {
    try {
      const target = new URL(url);
      const own = new URL(APP_URL);
      if (target.origin !== own.origin) {
        shell.openExternal(url);
        return { action: "deny" };
      }
    } catch {
      // malformed URL — let Electron's default handling deal with it
    }
    return { action: "allow" };
  });

  // Electron's default BrowserWindow has no right-click menu at all — not
  // even Cut/Copy/Paste — unless one is built by hand. This wires up the
  // standard edit commands plus spelling-correction suggestions (using
  // Chromium's built-in spellchecker, which is on by default) so misspelled
  // words show suggested corrections and "Add to Dictionary" like a native
  // text field.
  mainWin.webContents.on("context-menu", (_event, params) => {
    const menu = new Menu();

    if (params.misspelledWord) {
      for (const suggestion of params.dictionarySuggestions) {
        menu.append(
          new MenuItem({
            label: suggestion,
            click: () => mainWin.webContents.replaceMisspelling(suggestion),
          })
        );
      }
      if (params.dictionarySuggestions.length > 0) {
        menu.append(new MenuItem({ type: "separator" }));
      }
      menu.append(
        new MenuItem({
          label: "Add to Dictionary",
          click: () =>
            mainWin.webContents.session.addWordToSpellCheckerDictionary(params.misspelledWord),
        })
      );
      menu.append(new MenuItem({ type: "separator" }));
    }

    if (params.isEditable) {
      menu.append(new MenuItem({ label: "Cut", role: "cut", enabled: params.editFlags.canCut }));
      menu.append(new MenuItem({ label: "Copy", role: "copy", enabled: params.editFlags.canCopy }));
      menu.append(new MenuItem({ label: "Paste", role: "paste", enabled: params.editFlags.canPaste }));
      menu.append(new MenuItem({ type: "separator" }));
      menu.append(new MenuItem({ label: "Select All", role: "selectAll" }));
    } else if (params.selectionText) {
      menu.append(new MenuItem({ label: "Copy", role: "copy" }));
    }

    if (menu.items.length > 0) {
      menu.popup();
    }
  });

  let saveTimer = null;
  const scheduleSave = () => {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(saveWindowState, 400);
  };
  mainWin.on("resize", scheduleSave);
  mainWin.on("move", scheduleSave);
  mainWin.on("close", saveWindowState);

  mainWin.on("closed", () => {
    mainWin = null;
  });
}

// ---------------------------------------------------------------------
// Application menu
// ---------------------------------------------------------------------

function shutDownBackendAndQuit() {
  log("menu: Shut Down Backend & Quit selected");
  const stopScript = path.join(DESKTOP_DIR, "stop.sh");
  const fd = fs.openSync(LOG_FILE, "a");
  const child = spawn("bash", [stopScript, "--all"], {
    cwd: REPO_DIR,
    env: childEnv(),
    stdio: ["ignore", fd, fd],
  });
  // Same double-close hazard as runCommand: a failed spawn emits both
  // 'error' and 'close', and closing the same fd twice throws EBADF.
  let fdClosed = false;
  const closeFd = () => {
    if (fdClosed) return;
    fdClosed = true;
    fs.closeSync(fd);
  };
  child.on("close", () => {
    closeFd();
    app.quit();
  });
  child.on("error", (err) => {
    log(`stop.sh --all failed to run: ${err.message}`);
    closeFd();
    app.quit();
  });
}

function buildMenu() {
  const template = [
    {
      label: app.name,
      submenu: [
        { role: "about" },
        { type: "separator" },
        { role: "services" },
        { type: "separator" },
        { role: "hide" },
        { role: "hideOthers" },
        { role: "unhide" },
        { type: "separator" },
        {
          label: "Shut Down Backend && Quit",
          click: shutDownBackendAndQuit,
        },
        { type: "separator" },
        { role: "quit" },
      ],
    },
    {
      label: "File",
      submenu: [{ role: "close" }],
    },
    { role: "editMenu" },
    { role: "windowMenu" },
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

// ---------------------------------------------------------------------
// App lifecycle
// ---------------------------------------------------------------------

app.whenReady().then(async () => {
  buildMenu();
  createSplash();

  const result = await runStartupSequence();

  if (!result.ok) {
    const { dialog } = require("electron");
    await dialog.showMessageBox({
      type: "error",
      title: "Notion Clone failed to start",
      message: "Notion Clone could not start.",
      detail: `${result.reason}\n\nLog: ${LOG_FILE}`,
      buttons: ["Quit"],
    });
    app.quit();
    return;
  }

  createMainWindow();

  if (splashWin && !splashWin.isDestroyed()) {
    splashWin.close();
    splashWin = null;
  }
});

// Standard macOS behavior: closing the last window doesn't quit the app
// (it stays alive in the dock), and clicking the dock icon reopens a
// window instantly since the backend is still running.
app.on("window-all-closed", () => {
  // Intentionally no app.quit() here — see comment above.
});

app.on("activate", () => {
  if (BrowserWindow.getAllWindows().length === 0 && mainWin === null) {
    if (splashWin) return; // startup still in progress
    createMainWindow();
  }
});
