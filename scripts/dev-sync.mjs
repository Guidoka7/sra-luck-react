import { spawn } from "node:child_process";

const intervalMs = Number(process.env.DEV_SYNC_INTERVAL_MS ?? 5000);
const cwd = process.cwd();
let stopping = false;
let syncing = false;

function run(command, args, options = {}) {
  return new Promise((resolve, reject) => {
    const executable = process.platform === "win32" && command === "npm" ? "npm.cmd" : command;
    const child = spawn(executable, args, {
      cwd,
      stdio: options.silent ? ["ignore", "pipe", "pipe"] : "inherit",
      shell: false,
      ...options,
    });

    let stdout = "";
    let stderr = "";
    if (options.silent) {
      child.stdout.on("data", (chunk) => (stdout += chunk));
      child.stderr.on("data", (chunk) => (stderr += chunk));
    }

    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0) resolve({ stdout, stderr });
      else reject(new Error(`${command} ${args.join(" ")} terminou com código ${code}.\n${stderr}`));
    });
  });
}

async function isClean() {
  const { stdout } = await run("git", ["status", "--porcelain"], { silent: true });
  return stdout.trim() === "";
}

async function syncOnce() {
  if (stopping || syncing) return;
  syncing = true;
  try {
    if (!(await isClean())) {
      console.warn("[dev-sync] Alterações locais detectadas; sincronização automática pausada.");
      return;
    }

    await run("git", ["fetch", "origin", "main"], { silent: true });
    const { stdout: local } = await run("git", ["rev-parse", "HEAD"], { silent: true });
    const { stdout: remote } = await run("git", ["rev-parse", "origin/main"], { silent: true });

    if (local.trim() === remote.trim()) return;

    await run("git", ["merge", "--ff-only", "origin/main"]);
    console.log("\n[dev-sync] Código atualizado do GitHub. O Vite/HMR recarregará as alterações automaticamente.\n");
  } catch (error) {
    console.warn("[dev-sync] Sincronização adiada:", error instanceof Error ? error.message : error);
  } finally {
    syncing = false;
  }
}

const npmCommand = process.platform === "win32" ? "npm.cmd" : "npm";
const vite = spawn(npmCommand, ["run", "dev"], {
  cwd,
  stdio: "inherit",
  shell: false,
});

vite.on("exit", (code, signal) => {
  stopping = true;
  process.exit(code ?? (signal ? 1 : 0));
});

const timer = setInterval(syncOnce, intervalMs);
await syncOnce();

function stop(signal) {
  if (stopping) return;
  stopping = true;
  clearInterval(timer);
  vite.kill(signal);
}

process.on("SIGINT", () => stop("SIGINT"));
process.on("SIGTERM", () => stop("SIGTERM"));
