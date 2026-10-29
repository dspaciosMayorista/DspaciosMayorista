// Se ejecuta con npm run test:react (loader del arnés).
//
// #65 — /portal: el RESOLVEDOR REAL (resolverContextoPortal) con una sesión simulada en memoria, compuesto con
// destinoPortal, para cada estado de cuenta. La sesión es simulada (no hay Supabase real).
import { test, afterEach } from "node:test";
import assert from "node:assert/strict";

const { resolverContextoPortal } = await import("../lib/portal/b2bPortalServidor.ts");
const { destinoPortal } = await import("../lib/portal/b2bPortal.ts");
const { supabaseEnMemoria } = await import("./support/memoriaSupabase.ts");
const { __setClient, __resetClient } = await import("./support/stubs/supabaseServerStub.mjs");

type Fila = Record<string, unknown>;
afterEach(() => { __resetClient(); });

const perfil = (extra: Fila): Fila => ({ id: "u1", nombre: "Persona Prueba", rol: "venta", activo: true, agencia_id: null, pct_comision: null, aliado_id: null, tenant: "mayorista", acceso_legacy_nombre: false, ...extra });
async function recorrer(usuarios: Fila[], sesion: string | null) {
  __setClient(supabaseEnMemoria({ usuarios }, {}, sesion));
  const ctx = await resolverContextoPortal();
  return { ctx, destino: destinoPortal(ctx) };
}

const CASOS: { nombre: string; usuarios: Fila[]; sesion: string | null; estado: string; destino: string }[] = [
  { nombre: "visitante (sin sesión)", usuarios: [], sesion: null, estado: "visitante", destino: "/login" },
  { nombre: "aliado aprobado (agencia, activo)", usuarios: [perfil({ rol: "agencia" })], sesion: "u1", estado: "ok", destino: "/portal/b2b" },
  { nombre: "aliado aprobado (freelance, activo)", usuarios: [perfil({ rol: "freelance" })], sesion: "u1", estado: "ok", destino: "/portal/b2b" },
  { nombre: "registro B2B en revisión (activo sin aprobar)", usuarios: [perfil({ rol: "freelance", activo: null })], sesion: "u1", estado: "pendiente", destino: "/portal/b2b" },
  { nombre: "interno: superadmin", usuarios: [perfil({ rol: "superadmin" })], sesion: "u1", estado: "interno", destino: "/dashboard" },
  { nombre: "interno: venta", usuarios: [perfil({ rol: "venta" })], sesion: "u1", estado: "interno", destino: "/dashboard" },
  { nombre: "interno: control_vuelo", usuarios: [perfil({ rol: "control_vuelo" })], sesion: "u1", estado: "interno", destino: "/dashboard" },
  { nombre: "cliente_final autenticado", usuarios: [perfil({ rol: "cliente_final" })], sesion: "u1", estado: "interno", destino: "/tarifario" },
  { nombre: "interno desactivado", usuarios: [perfil({ rol: "gerencia", activo: false })], sesion: "u1", estado: "interno", destino: "/login?inactivo=1" },
  { nombre: "cliente_final desactivado", usuarios: [perfil({ rol: "cliente_final", activo: false })], sesion: "u1", estado: "interno", destino: "/login?inactivo=1" },
  { nombre: "sesión sin fila en usuarios (perfil ausente)", usuarios: [], sesion: "u1", estado: "interno", destino: "/login?sinperfil=1" },
  { nombre: "perfil con rol vacío", usuarios: [perfil({ rol: null })], sesion: "u1", estado: "interno", destino: "/login?sinperfil=1" },
  { nombre: "perfil con rol desconocido", usuarios: [perfil({ rol: "publico" })], sesion: "u1", estado: "interno", destino: "/login?sinperfil=1" },
];

for (const c of CASOS) {
  test(`/portal · ${c.nombre} → ${c.destino}`, async () => {
    const { ctx, destino } = await recorrer(c.usuarios, c.sesion);
    assert.equal(ctx.estado, c.estado);
    assert.equal(destino, c.destino);
  });
}

test("el portal B2B no se amplía: solo agencia/freelance activos son «ok»; ningún otro rol obtiene contexto de aliado", async () => {
  for (const rol of ["superadmin", "venta", "cliente_final", "publico", null]) {
    const { ctx } = await recorrer([perfil({ rol })], "u1");
    assert.notEqual(ctx.estado, "ok", String(rol));
  }
});
