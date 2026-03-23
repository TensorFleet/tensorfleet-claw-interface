import { spawn } from "bun";
import { watch, readdirSync, statSync, existsSync, type FSWatcher } from "fs";
import { dirname, normalize, resolve } from "path";
import { graph, type GraphEntry } from "./build.config";

const config: Record<string, GraphEntry> = graph;
const queue: string[] = [];
const queued = new Set<string>();
const watchers = new Map<string, FSWatcher>();
const state = new Map<
  string,
  {
    building: boolean;
    suppressUntil: number;
  }
>();
let processing = false;

function getState(name: string) {
  let s = state.get(name);
  if (!s) {
    s = { building: false, suppressUntil: 0 };
    state.set(name, s);
  }
  return s;
}

function rootFromPattern(input: string) {
  const normalized = normalize(input);
  const parts = normalized.split(/[/\\]+/);
  const out: string[] = [];

  for (const part of parts) {
    if (
      part.includes("*") ||
      part.includes("?") ||
      part.includes("[") ||
      part.includes("{")
    ) {
      break;
    }
    out.push(part);
  }

  const root = out.join("/");
  if (!root) return ".";

  if (existsSync(root)) {
    const stat = statSync(root);
    if (stat.isFile()) return dirname(root);
    return root;
  }

  return root;
}

function listDirs(root: string) {
  const dirs: string[] = [];
  const stack = [root];

  while (stack.length > 0) {
    const current = stack.pop()!;
    if (!existsSync(current)) continue;

    let stat;
    try {
      stat = statSync(current);
    } catch {
      continue;
    }

    if (!stat.isDirectory()) continue;

    dirs.push(current);

    let entries: string[];
    try {
      entries = readdirSync(current);
    } catch {
      continue;
    }

    for (const entry of entries) {
      const full = `${current}/${entry}`;
      try {
        if (statSync(full).isDirectory()) {
          stack.push(full);
        }
      } catch {}
    }
  }

  return dirs;
}

function enqueue(name: string) {
  if (queued.has(name)) return;
  queued.add(name);
  queue.push(name);
  void processQueue();
}

async function runBuild(name: string) {
  const cfg = config[name];
  if (!cfg) return;

  const cwd = resolve(cfg.cwd);
  if (!existsSync(cwd)) {
    throw new Error(`Missing cwd for ${name}: ${cwd}`);
  }

  const s = getState(name);
  s.building = true;

  console.log(`\n[build start] ${name}`);

  const proc = spawn([process.execPath, "run", cfg.script], {
    cwd,
    stdout: "inherit",
    stderr: "inherit"
  });

  const exitCode = await proc.exited;

  s.building = false;
  s.suppressUntil = Date.now() + (cfg.quietMs ?? 1500);

  console.log(`[build done] ${name} (${exitCode})`);
}

async function processQueue() {
  if (processing) return;
  processing = true;

  while (queue.length > 0) {
    const name = queue.shift()!;
    queued.delete(name);

    await runBuild(name);

    const cfg = config[name];
    if (cfg.triggers) {
      for (const target of cfg.triggers) {
        enqueue(target);
      }
    }
  }

  processing = false;
}

function onFsEvent(pkg: string) {
  const s = getState(pkg);
  if (s.building) return;
  if (Date.now() < s.suppressUntil) return;

  syncPackageWatches(pkg);
  enqueue(pkg);
}

function syncPackageWatches(pkg: string) {
  const cfg = config[pkg];
  if (!cfg) return;

  const wanted = new Set<string>();

  for (const pattern of cfg.watch) {
    const root = rootFromPattern(pattern);
    for (const dir of listDirs(root)) {
      wanted.add(dir);
    }
  }

  for (const dir of wanted) {
    const key = `${pkg}:${dir}`;
    if (watchers.has(key)) continue;

    const watcher = watch(dir, () => {
      onFsEvent(pkg);
    });

    watchers.set(key, watcher);
    console.log(`[watching] ${pkg}: ${dir}`);
  }

  for (const [key, watcher] of watchers) {
    if (!key.startsWith(`${pkg}:`)) continue;
    const dir = key.slice(pkg.length + 1);
    if (wanted.has(dir)) continue;
    watcher.close();
    watchers.delete(key);
  }
}

for (const pkg of Object.keys(config)) {
  syncPackageWatches(pkg);
}

for (const pkg of Object.keys(config)) {
  await runBuild(pkg);
}

await new Promise(() => {});