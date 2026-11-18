// Publica el tarifario del paquete sintético «Porción 102» con la acción REAL (generarTarifario → publicar_tarifario_resultado).
// SOLO local: la lanza `local102.ps1 generar` con la URL del gateway local y la clave de servicio de ESE entorno.
// Lo único simulado es la sesión (se usa la del usuario administracion@local102.test, que existe en la base local).
import nodeModule from "node:module";
import { mock } from "node:test";
import { createHmac } from "node:crypto";
import { createClient } from "@supabase/supabase-js";

const URL_LOCAL = process.env.LOCAL102_URL ?? "";
const SERVICIO = process.env.LOCAL102_SERVICE_KEY ?? "";
const SECRETO = process.env.LOCAL102_JWT_SECRET ?? "";
if (!URL_LOCAL.startsWith("http://127.0.0.1") || !SERVICIO || !SECRETO) throw new Error("Solo local: usa local102.ps1 generar.");

type ResolveHook = (specifier: string, context: unknown, nextResolve: (specifier: string, context: unknown) => unknown) => unknown;
const { registerHooks } = nodeModule as unknown as { registerHooks: (hooks: { resolve: ResolveHook }) => void };
const MINIMOS: Record<string, string> = { "server-only": "export {}", "next/cache": "export function revalidatePath() {} export function revalidateTag() {}" };
registerHooks({ resolve(s, c, n) { const src = MINIMOS[s]; return src != null ? { url: `data:text/javascript,${encodeURIComponent(src)}`, shortCircuit: true } : n(s, c); } });

process.env.NEXT_PUBLIC_SUPABASE_URL = URL_LOCAL;
process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = "anon-local";
process.env.SUPABASE_SERVICE_ROLE_KEY = SERVICIO;
const servicio = () => createClient(URL_LOCAL, SERVICIO, { auth: { persistSession: false, autoRefreshToken: false } });
const { data: u } = await servicio().from("usuarios").select("id, email").eq("email", "administracion@local102.test").maybeSingle();
if (!u) throw new Error("Falta administracion@local102.test: corre 'preparar'.");
// Sesión real: JWT `authenticated` del usuario, firmado con el secreto LOCAL de este entorno (la base exige auth.uid()).
const b64u = (s: string) => Buffer.from(s).toString("base64url");
const jwtUsuario = () => {
  const h = b64u(JSON.stringify({ alg: "HS256", typ: "JWT" }));
  const p = b64u(JSON.stringify({ role: "authenticated", sub: u.id, aud: "authenticated", exp: Math.floor(Date.now() / 1000) + 3600 }));
  return `${h}.${p}.${createHmac("sha256", SECRETO).update(`${h}.${p}`).digest("base64url")}`;
};
const sesion = () => {
  const sb = createClient(URL_LOCAL, jwtUsuario(), { auth: { persistSession: false, autoRefreshToken: false } });
  (sb.auth as unknown as { getUser: () => Promise<unknown> }).getUser = async () => ({ data: { user: { id: u.id, email: u.email } }, error: null });
  return sb;
};
mock.module("@/lib/supabase/server", { namedExports: { createClient: async () => sesion() } });
mock.module("@/lib/supabase/admin", { namedExports: { createAdminClient: () => servicio() } });
mock.module("next/headers", { namedExports: { headers: async () => new Map([["host", "localhost"]]), cookies: async () => ({ get: () => undefined, getAll: () => [] }) } });

const { generarTarifario } = await import("../../../app/(dashboard)/dashboard/paquetes/actions.ts");
const r = await generarTarifario(10201);
console.log(r.ok ? "Tarifario de «Porción 102» publicado." : `No se publicó: ${JSON.stringify(r)}`);
process.exit(r.ok ? 0 : 1);
