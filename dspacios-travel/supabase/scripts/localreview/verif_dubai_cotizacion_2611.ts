// VERIF-2 (2026-11-18) — cadena REAL Dubai: crearCotizacion sobre el paquete 912512 (hotel Dubai ACTIVO, publicado con generarTarifario) y relectura. Solo base LOCAL desechable (REV_DB).
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
const { crearCotizacion, convertirCotizacion } = await import("../../../app/(dashboard)/dashboard/reservar/actions.ts");

const falla = (m: string, r: unknown): never => { console.error(`FALLO ${m}: ${JSON.stringify(r)}`); process.exit(1); };
const adulto = (i: number) => ({ nombres: `Adulto${i}`, apellidos: "Verif Dubai 2611", tipoDoc: "CC", numeroDoc: `2611${i}${i}`, fechaNacimiento: "1985-03-04", nacionalidad: "Colombiana", esInfante: false });
const casos = JSON.parse(process.env.CASOS ?? "[]") as { regimen: string; ida: string; regreso: string; paquete: number; hotel: number; edades: number[]; nombre: string }[];
for (const c of casos) {
  const pas = [adulto(1), adulto(2), ...c.edades.map((e, i) => ({ nombres: `Menor${e}`, apellidos: "Verif Dubai 2611", tipoDoc: "RC", numeroDoc: `2612${i}${e}`, fechaNacimiento: `${Number(c.ida.slice(0, 4)) - e}-01-01`, nacionalidad: "Colombiana", esInfante: false }))];
  const r = await crearCotizacion({
    paqueteId: c.paquete, bloqueoId: null, modulo: "porcion_terrestre" as const, hotelId: c.hotel, fechaIda: c.ida, fechaRegreso: c.regreso, categoria: "Estandar", regimen: c.regimen,
    habitaciones: { doble: 1 }, ninos: 0, ninos2: 0, infantes: 0, edadesMenores: c.edades, cantidadMenores: c.edades.length,
    cliente: { nombres: c.nombre, apellidos: "Verif Dubai 2611", numeroDoc: `26110${c.regimen.length}${c.edades.length}${c.hotel % 100}`, email: "verif.dubai.2611@ejemplo.test", tipoDoc: "CC", telefono: "3001234567" },
    tipoAsesor: "interno", asesorInterno: "Rev Venta", agenciaNombre: "", agenciaAsesor: "", freelanceNombre: "", plazo: "", pasajeros: pas, servicios: [] as number[],
  } as never) as { ok: boolean; id?: number; error?: string };
  if (!r.ok) falla(`crearCotizacion ${c.nombre}`, r);
  console.log(`COTIZACION ${r.id} ← ${c.nombre} (${c.regimen} ${c.ida}→${c.regreso} edades=${JSON.stringify(c.edades)})`);
}

// CONVERTIR=7,10: convierte esas cotizaciones en contrato con la acción REAL (misma ruta que el asesor).
for (const idTxt of (process.env.CONVERTIR ?? "").split(",").map((x) => x.trim()).filter(Boolean)) {
  const id = Number(idTxt);
  const edades = (sql(`select coalesce(payload->'edadesMenores','[]'::jsonb)::text from public.cotizaciones where id = ${id}`) || "[]");
  const ida = sql(`select fecha_salida::text from public.cotizaciones where id = ${id}`);
  const lista = JSON.parse(edades) as number[];
  const pas = [adulto(1), adulto(2), ...lista.map((e, i) => ({ nombres: `Menor${e}`, apellidos: "Verif Dubai 2611", tipoDoc: "RC", numeroDoc: `2612${i}${e}`, fechaNacimiento: `${Number(ida.slice(0, 4)) - e}-01-01`, nacionalidad: "Colombiana", esInfante: false }))];
  const c = await convertirCotizacion(id, pas as never, false, "Rev Venta", null, null, null) as { ok: boolean; numero?: string; numeros?: string[]; error?: string };
  if (!c.ok) falla(`convertirCotizacion ${id}`, c);
  console.log(`CONTRATO ${c.numero ?? (c.numeros ?? []).join(",")} ← cotización ${id}`);
}
