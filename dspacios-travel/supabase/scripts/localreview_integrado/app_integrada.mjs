// Compila / arranca la app INTEGRADA (#126 + #127 + bloque B2B) con los endpoints LOCALES de la pila de revisión (config.json con puertos y llaves locales; nunca producción).
// Uso (desde dspacios-travel/): node supabase/scripts/localreview_integrado/app_integrada.mjs <carpeta_config> build|start <log>
// `build` pasa el límite de heap también a los procesos hijos (NODE_OPTIONS): sin eso el chequeo de tipos se queda en ~2 GB de heap y falla («JavaScript heap out of memory»).
import { readFileSync, openSync } from "node:fs";
import { spawn } from "node:child_process";
import { resolve } from "node:path";
const [CFGDIR, modo, LOG] = process.argv.slice(2);
if (!CFGDIR || !["build", "start"].includes(modo) || !LOG) throw new Error("Uso: app_integrada.mjs <carpeta_config> build|start <log>");
const cfg = JSON.parse(readFileSync(`${CFGDIR}/config.json`, "utf8"));
const WT = resolve(import.meta.dirname, "../../..");
const heap = process.env.HEAP_MB ?? "4096";
const env = {
  ...process.env,
  NEXT_PUBLIC_SUPABASE_URL: `http://127.0.0.1:${cfg.puertos.gateway}`,
  NEXT_PUBLIC_SUPABASE_ANON_KEY: cfg.anonKey,
  SUPABASE_SERVICE_ROLE_KEY: cfg.serviceKey ?? cfg.serviceRoleKey,
  NEXT_PUBLIC_SITE_URL: `http://localhost:${cfg.puertos.app}`,
  CRON_SECRET: cfg.cronSecret ?? "cron-local",
  ...(modo === "build" ? { NODE_OPTIONS: `--max-old-space-size=${heap}` } : {}),
};
if (!env.NEXT_PUBLIC_SUPABASE_ANON_KEY || !env.SUPABASE_SERVICE_ROLE_KEY) throw new Error("faltan llaves en config.json");
// `next start` escucha en 0.0.0.0 por defecto: la revisión es SOLO local, así que se fija el loopback IPv4 (-H 127.0.0.1). La URL de la app sigue siendo http://localhost:<puerto> (NEXT_PUBLIC_SITE_URL compilado y SITE_URL de Auth) y `localhost` llega a 127.0.0.1.
const args = modo === "start" ? ["node_modules/next/dist/bin/next", "start", "-p", String(cfg.puertos.app), "-H", "127.0.0.1"] :["node_modules/next/dist/bin/next", "build"];
const out = openSync(LOG, "w");
const p = spawn(process.execPath, args, { cwd: WT, env, stdio: ["ignore", out, out], detached: modo === "start", windowsHide: true });
if (modo === "start") { p.unref(); console.log("next start lanzado, pid", p.pid, "puerto", cfg.puertos.app); } else p.on("close", (c) => { console.log("build exit", c); process.exit(c ?? 1); });
