import { mock } from "node:test";
import { createHmac } from "node:crypto";
import { readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import nodeModule from "node:module";
import { createClient as crearClienteSupabase } from "@supabase/supabase-js";

const CFG = JSON.parse(readFileSync(`${process.env.LOCALAPPDATA}/dspacios-local53/config.json`, "utf8")) as { jwtSecret: string; serviceKey: string; anonKey: string };
const URL_GW = "http://127.0.0.1:54353";
const sql = (q: string) => execFileSync("docker", ["exec", "-i", "-e", "PGPASSWORD=postgres", "pg304", "psql", "-h", "127.0.0.1", "-U", "supabase_admin", "-d", "dspacios_local53", "-X", "-q", "-t", "-A", "-v", "ON_ERROR_STOP=1"], { input: q, encoding: "utf8" }).trim();

const { registerHooks } = nodeModule as unknown as { registerHooks: (h: { resolve: (s: string, c: unknown, n: (s: string, c: unknown) => unknown) => unknown }) => void };
const MIN: Record<string, string> = { "server-only": "export {}", "next/cache": "export function revalidatePath() {} export function revalidateTag() {}" };
registerHooks({ resolve(s, c, n) { const src = MIN[s]; if (src != null) return { url: `data:text/javascript,${encodeURIComponent(src)}`, shortCircuit: true }; return n(s, c); } });

const b64u = (s: string) => Buffer.from(s).toString("base64url");
const jwt = (p: Record<string, unknown>) => { const h = b64u(JSON.stringify({ alg: "HS256", typ: "JWT" })); const c = b64u(JSON.stringify({ ...p, exp: Math.floor(Date.now() / 1000) + 3600 })); return `${h}.${c}.${createHmac("sha256", CFG.jwtSecret).update(`${h}.${c}`).digest("base64url")}`; };
const SUPER = sql("select id from public.usuarios where email = 'superadmin@local53.test'");
const EMAIL = "superadmin@local53.test";
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
const { crearCotizacion, convertirCotizacion } = await import("../../../app/(dashboard)/dashboard/reservar/actions.ts");
const { crearContrato } = await import("../../../app/(dashboard)/dashboard/contratos/actions.ts");
const { importarHistorico } = await import("../../../app/(dashboard)/dashboard/contratos/importar/actions.ts");
const { fijarMinimoConfirmacion } = await import("../../../app/(dashboard)/dashboard/contratos/[numero]/cobros-actions.ts");
const TRM = Number(process.env.TRM_COBRO);
const pax = [0, 1].map((i) => ({ nombres: `Usd${i + 1}`, apellidos: "Ejemplo", tipoDoc: "CC", numeroDoc: String(80000222 + i), fechaNacimiento: i === 0 ? "1985-04-12" : "1987-09-30", nacionalidad: "Colombiana", esInfante: false }));
const r = await convertirCotizacion(2, pax as never, false, "Local Venta", TRM, "COP", TRM) as { ok: boolean; numero?: string; numeros?: string[]; error?: string };
console.log(JSON.stringify(r));
if (r.ok && process.env.ACUERDO_PCT) { const uid = (r as { contratoUid?: string }).contratoUid!; const a = await fijarMinimoConfirmacion(r.numero!, "porcentaje", Number(process.env.ACUERDO_PCT), "ensayo: acuerdo del 30 %", { [r.numero!]: uid }); console.log(JSON.stringify(a)); }
if (r.ok && process.env.PAGO) { const { registrarAbono } = await import("../../../app/(dashboard)/dashboard/contratos/actions.ts"); const uid2 = (r as { contratoUid?: string }).contratoUid!; const ab = await registrarAbono(r.numero!, Number(process.env.PAGO), "Transferencia", "ENSAYO", undefined, undefined, undefined, crypto.randomUUID(), { [r.numero!]: uid2 } as never); console.log(JSON.stringify(ab)); }
process.exit(r.ok ? 0 : 1);
