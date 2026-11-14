// Publica el tarifario de la semilla sintética con el motor REAL (`generarTarifario`), contra la base local del humo. Solo siembra datos: no simula ningún precio.
// Uso (lo lanza entorno_14a_real.sh): H14_BASE, H14_CONTENEDOR, H14_POSTGREST, H14_JWT_SECRET, H14_PAQUETE.
import { mock } from "node:test";
import { createHmac } from "node:crypto";
import nodeModule from "node:module";
import { createClient as crearClienteSupabase } from "@supabase/supabase-js";

const PGRST = process.env.H14_POSTGREST ?? "", SECRETO = process.env.H14_JWT_SECRET ?? "", PAQUETE = Number(process.env.H14_PAQUETE ?? 0);
if (!PGRST || !SECRETO || !PAQUETE) throw new Error("Faltan H14_POSTGREST, H14_JWT_SECRET y H14_PAQUETE.");
const { registerHooks } = nodeModule as unknown as { registerHooks: (h: { resolve: (s: string, c: unknown, n: (s: string, c: unknown) => unknown) => unknown }) => void };
const MIN: Record<string, string> = { "server-only": "export {}", "next/cache": "export function revalidatePath() {} export function revalidateTag() {}" };
registerHooks({ resolve(s, c, n) { const src = MIN[s]; if (src != null) return { url: `data:text/javascript,${encodeURIComponent(src)}`, shortCircuit: true }; return n(s, c); } });
const b64u = (s: string) => Buffer.from(s).toString("base64url");
const jwt = (p: Record<string, unknown>) => { const h = b64u(JSON.stringify({ alg: "HS256", typ: "JWT" })); const c = b64u(JSON.stringify({ ...p, exp: Math.floor(Date.now() / 1000) + 3600 })); return `${h}.${c}.${createHmac("sha256", SECRETO).update(`${h}.${c}`).digest("base64url")}`; };
const STAFF = "00000000-0000-0000-0000-00000014a001";
const fetchLocal: typeof fetch = (i, init) => fetch(String(i).replace("/rest/v1/", "/"), init);
const cliente = (token: string, usuario?: { id: string; email: string }) => {
  const sb = crearClienteSupabase(PGRST, token, { auth: { persistSession: false, autoRefreshToken: false }, global: { fetch: fetchLocal } });
  if (usuario) (sb.auth as unknown as { getUser: () => Promise<unknown> }).getUser = async () => ({ data: { user: usuario }, error: null });
  return sb;
};
process.env.NEXT_PUBLIC_SUPABASE_URL = PGRST; process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = "anon-local"; process.env.SUPABASE_SERVICE_ROLE_KEY = jwt({ role: "service_role" });
mock.module("@/lib/supabase/server", { namedExports: { createClient: async () => cliente(jwt({ role: "authenticated", sub: STAFF }), { id: STAFF, email: "staff14a@x.test" }) } });
mock.module("@/lib/supabase/admin", { namedExports: { createAdminClient: () => cliente(jwt({ role: "service_role" })) } });
const COOKIES = { get: () => undefined, getAll: () => [] as unknown[] };
mock.module("next/headers", { namedExports: { headers: async () => new Map([["host", "localhost"]]), cookies: async () => COOKIES } });
const { generarTarifario } = await import("../../app/(dashboard)/dashboard/paquetes/actions.ts");
const r = await generarTarifario(PAQUETE);
console.log("generarTarifario:", JSON.stringify(r).slice(0, 300));
process.exit((r as { ok?: boolean }).ok ? 0 : 1);
