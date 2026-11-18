// Publishes the synthetic «servicios» packages 916001-916003 with the REAL action (generarTarifario).
// Local only (loopback URL + local service key). The only simulated piece is the session (administracion@lote.test).
import nodeModule from "node:module";
import { mock } from "node:test";
import { createHmac } from "node:crypto";
import { createClient } from "@supabase/supabase-js";

const URL_LOCAL = process.env.LOCALIMG_URL ?? "", SERVICIO = process.env.LOCALIMG_SERVICE_KEY ?? "", SECRETO = process.env.LOCALIMG_JWT_SECRET ?? "";
if (!URL_LOCAL.startsWith("http://127.0.0.1") || !SERVICIO || !SECRETO) throw new Error("Local only.");
type ResolveHook = (s: string, c: unknown, n: (s: string, c: unknown) => unknown) => unknown;
const { registerHooks } = nodeModule as unknown as { registerHooks: (h: { resolve: ResolveHook }) => void };
const MINIMOS: Record<string, string> = { "server-only": "export {}", "next/cache": "export function revalidatePath() {} export function revalidateTag() {}" };
registerHooks({ resolve(s, c, n) { const src = MINIMOS[s]; return src != null ? { url: `data:text/javascript,${encodeURIComponent(src)}`, shortCircuit: true } : n(s, c); } });
process.env.NEXT_PUBLIC_SUPABASE_URL = URL_LOCAL; process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = "anon-local"; process.env.SUPABASE_SERVICE_ROLE_KEY = SERVICIO;
const servicio = () => createClient(URL_LOCAL, SERVICIO, { auth: { persistSession: false, autoRefreshToken: false } });
const { data: u } = await servicio().from("usuarios").select("id, email").eq("email", "administracion@lote.test").maybeSingle();
if (!u) throw new Error("administracion@lote.test missing in this database");
const b64u = (s: string) => Buffer.from(s).toString("base64url");
const jwt = () => { const h = b64u(JSON.stringify({ alg: "HS256", typ: "JWT" })), p = b64u(JSON.stringify({ role: "authenticated", sub: u.id, aud: "authenticated", exp: Math.floor(Date.now() / 1000) + 3600 })); return `${h}.${p}.${createHmac("sha256", SECRETO).update(`${h}.${p}`).digest("base64url")}`; };
const sesion = () => { const sb = createClient(URL_LOCAL, jwt(), { auth: { persistSession: false, autoRefreshToken: false } }); (sb.auth as unknown as { getUser: () => Promise<unknown> }).getUser = async () => ({ data: { user: { id: u.id, email: u.email } }, error: null }); return sb; };
mock.module("@/lib/supabase/server", { namedExports: { createClient: async () => sesion() } });
mock.module("@/lib/supabase/admin", { namedExports: { createAdminClient: () => servicio() } });
mock.module("next/headers", { namedExports: { headers: async () => new Map([["host", "localhost"]]), cookies: async () => ({ get: () => undefined, getAll: () => [] }) } });
const { generarTarifario } = await import("../../../app/(dashboard)/dashboard/paquetes/actions.ts");
let ok = true;
for (const id of [916001, 916002, 916003]) { const r = await generarTarifario(id); console.log(id, r.ok ? "published" : JSON.stringify(r)); ok = ok && r.ok; }
process.exit(ok ? 0 : 1);
