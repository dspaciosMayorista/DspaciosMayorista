// REVISIÓN CONSOLIDADA — publica con la ACCIÓN REAL (generarTarifario) los paquetes de EJ_PUBLICAR (ids separados por coma) en la base rev_revision. Lo usa localreview.ps1 (accion publicar) para añadir un paquete a un entorno YA preparado sin repetir los ejemplos. Solo base LOCAL.
import { mock } from "node:test";
import { createHmac } from "node:crypto";
import { readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import nodeModule from "node:module";
import { createClient as crearClienteSupabase } from "@supabase/supabase-js";

const CFG = { jwtSecret: process.env.REV_JWT_SECRET ?? "", serviceKey: process.env.REV_SERVICE_KEY ?? "", anonKey: process.env.REV_ANON_KEY ?? "" };
const DBN = process.env.REV_DB ?? "";
if (!CFG.jwtSecret || !CFG.serviceKey || !DBN || !(process.env.REV_URL ?? "").startsWith("http://127.0.0.1")) throw new Error("Solo local: usa localreview.ps1 preparar.");
const URL_GW = process.env.REV_URL as string;
const sql = (q: string) => execFileSync("docker", ["exec", "-i", "-e", "PGPASSWORD=postgres", "pg304", "psql", "-h", "127.0.0.1", "-U", "supabase_admin", "-d", DBN, "-X", "-q", "-t", "-A", "-v", "ON_ERROR_STOP=1"], { input: q, encoding: "utf8" }).trim();

const { registerHooks } = nodeModule as unknown as { registerHooks: (h: { resolve: (s: string, c: unknown, n: (s: string, c: unknown) => unknown) => unknown }) => void };
const MIN: Record<string, string> = { "server-only": "export {}", "next/cache": "export function revalidatePath() {} export function revalidateTag() {}" };
registerHooks({ resolve(s, c, n) { const src = MIN[s]; if (src != null) return { url: `data:text/javascript,${encodeURIComponent(src)}`, shortCircuit: true }; return n(s, c); } });

const b64u = (s: string) => Buffer.from(s).toString("base64url");
const jwt = (p: Record<string, unknown>) => { const h = b64u(JSON.stringify({ alg: "HS256", typ: "JWT" })); const c = b64u(JSON.stringify({ ...p, exp: Math.floor(Date.now() / 1000) + 3600 })); return `${h}.${c}.${createHmac("sha256", CFG.jwtSecret).update(`${h}.${c}`).digest("base64url")}`; };
const SUPER = sql("select id from public.usuarios where email = 'superadmin@revision.test'");
const EMAIL = "superadmin@revision.test";
const { cabecerasIdentidad } = await import("../../../lib/contrato/identidad.ts");
const cliente = (token: string, usuario?: { id: string; email: string }, headers: Record<string, string> = {}) => {
  const sb = crearClienteSupabase(URL_GW, token, { auth: { persistSession: false, autoRefreshToken: false }, global: { headers } });
  if (usuario) (sb.auth as unknown as { getUser: () => Promise<unknown> }).getUser = async () => ({ data: { user: usuario }, error: null });
  return sb;
};
process.env.NEXT_PUBLIC_SUPABASE_URL = URL_GW; process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = CFG.anonKey; process.env.SUPABASE_SERVICE_ROLE_KEY = CFG.serviceKey;
mock.module("@/lib/supabase/server", { namedExports: { createClient: async (id?: Record<string, string>) => cliente(jwt({ role: "authenticated", sub: SUPER, aud: "authenticated" }), { id: SUPER, email: EMAIL }, cabecerasIdentidad(id)) } });
mock.module("@/lib/supabase/admin", { namedExports: { createAdminClient: (id?: Record<string, string>) => cliente(CFG.serviceKey, undefined, cabecerasIdentidad(id)) } });
// La agencia activa (cookie «tenant») se puede cambiar con globalThis.__tenant: solo el paso 5 (importador histórico) la pone en «minorista».
const COOKIES = { get: (n: string) => (n === "tenant" && (globalThis as { __tenant?: string }).__tenant ? { name: n, value: (globalThis as { __tenant?: string }).__tenant } : undefined), getAll: () => [] as unknown[], set: () => undefined, delete: () => undefined, has: () => false };
mock.module("next/headers", { namedExports: { headers: async () => new Map([["host", "localhost"]]), cookies: async () => COOKIES } });

const { generarTarifario } = await import("../../../app/(dashboard)/dashboard/paquetes/actions.ts");

const falla = (m: string, r: unknown): never => { console.error(`FALLO ${m}: ${JSON.stringify(r)}`); process.exit(1); };
const ids = (process.env.EJ_PUBLICAR ?? "").split(",").map((x) => Number(x.trim())).filter((x) => Number.isInteger(x) && x > 0);
if (!ids.length) falla("EJ_PUBLICAR vacío", ids);
for (const p of ids) { const g = await generarTarifario(p); if (!(g as { ok?: boolean }).ok) falla(`generarTarifario(${p})`, g); console.log(`Tarifario ${p} publicado.`); }
