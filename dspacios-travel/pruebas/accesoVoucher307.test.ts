import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolverAccesoVoucher, type DepsAccesoVoucher, type VoucherFila, type ContratoVoucher } from "../lib/voucher/accesoVoucher.ts";
import { acuerdoDeFila } from "../lib/contrato/reglaConfirmacion.ts";
import type { PerfilAcceso } from "../lib/auth/accesoDocumentoContrato.ts";

// #53 (307) · acceso a un voucher por token. Función pura con dependencias inyectadas: aquí se prueba la POLÍTICA (quién abre qué y cuándo); la aritmética del pago completo
// (moneda de cobro, tolerancia, contrato cancelado) vive en la base y se prueba en supabase/scripts/test_307_minimo_vencimiento_voucher.sh.
function leer(rel: string): string { return readFileSync(new URL(`../${rel}`, import.meta.url), "utf8").replace(/\r\n/g, "\n"); }

const TOKEN = "11111111-2222-3333-4444-555555555555";
const VOUCHER: VoucherFila = { id: 7, numero_contrato: "DTM-0100", tipo: "hotel", contenido: { x: 1 } };
const CONTRATO: ContratoVoucher = { tenant: "mayorista", b2b_usuario_id: null, aliado_id: 9601, agencia_nombre: "Agencia X", freelance_nombre: null };
const perfil = (rol: string, extra: Partial<PerfilAcceso> = {}): PerfilAcceso => ({ id: `u-${rol}`, rol, tenant: "mayorista", nombre: "N", activo: true, aliadoId: null, accesoLegacyNombre: null, ...extra });

type Cfg = { sesion?: boolean; perfil?: PerfilAcceso | null; voucher?: VoucherFila | null; visibleInterno?: boolean; contrato?: ContratoVoucher | null; ficha?: boolean | null; pagado?: boolean | "lanza" };
function deps(c: Cfg, llamadas: string[] = []): DepsAccesoVoucher {
  return {
    sesion: async () => (c.sesion === false ? null : { id: c.perfil?.id ?? "u" }),
    perfil: async () => (c.perfil === undefined ? perfil("agencia", { aliadoId: 9601 }) : c.perfil),
    voucher: async () => (c.voucher === undefined ? VOUCHER : c.voucher),
    visibleParaInterno: async () => { llamadas.push("rls"); return c.visibleInterno !== false; },
    contrato: async () => (c.contrato === undefined ? CONTRATO : c.contrato),
    fichaManual: async () => (c.ficha === undefined ? false : c.ficha),
    pagadoCompleto: async () => { llamadas.push("pago"); if (c.pagado === "lanza") throw new Error("lectura de pago falló"); return c.pagado === true; },
  };
}
const aliado = (extra: Partial<PerfilAcceso> = {}) => perfil("agencia", { aliadoId: 9601, ...extra });

describe("aliado: solo con el contrato 100 % pagado, sin excepción", () => {
  test("pagado completo y es el dueño → abre", async () => {
    const r = await resolverAccesoVoucher(TOKEN, deps({ perfil: aliado(), pagado: true }));
    assert.equal(r.ok, true);
    if (r.ok) assert.equal(r.modo, "aliado");
  });
  test("pago incompleto → NO abre (pago_incompleto), aunque sea el dueño", async () => {
    assert.deepEqual(await resolverAccesoVoucher(TOKEN, deps({ perfil: aliado(), pagado: false })), { ok: false, motivo: "pago_incompleto" });
  });
  test("voucher generado por un superadmin antes de tiempo: el aliado sigue sin acceder (no hay excepción anticipada)", async () => {
    // El token no distingue quién lo generó: la política solo mira el pago. Un voucher «anticipado» es indistinguible de uno normal y por eso no abre.
    assert.deepEqual(await resolverAccesoVoucher(TOKEN, deps({ perfil: aliado(), pagado: false, voucher: { ...VOUCHER, id: 99 } })), { ok: false, motivo: "pago_incompleto" });
  });
  test("pago revertido o saldo que vuelve a subir: se evalúa en CADA apertura (misma persona, mismo token, ahora bloqueado) sin tocar el voucher", async () => {
    const abierto = await resolverAccesoVoucher(TOKEN, deps({ perfil: aliado(), pagado: true }));
    const luego = await resolverAccesoVoucher(TOKEN, deps({ perfil: aliado(), pagado: false }));
    assert.equal(abierto.ok, true);
    assert.deepEqual(luego, { ok: false, motivo: "pago_incompleto" });
  });
  test("falla cerrado: si la lectura del pago lanza, NO abre", async () => {
    assert.deepEqual(await resolverAccesoVoucher(TOKEN, deps({ perfil: aliado(), pagado: "lanza" })), { ok: false, motivo: "error" });
  });
  test("otro aliado (aliado_id distinto) no abre aunque el contrato esté pagado", async () => {
    assert.deepEqual(await resolverAccesoVoucher(TOKEN, deps({ perfil: aliado({ aliadoId: 1234 }), pagado: true })), { ok: false, motivo: "sin_permiso" });
  });
  test("el dueño por b2b_usuario_id abre", async () => {
    const r = await resolverAccesoVoucher(TOKEN, deps({ perfil: perfil("freelance", { id: "uf" }), contrato: { ...CONTRATO, aliado_id: null, b2b_usuario_id: "uf" }, pagado: true }));
    assert.equal(r.ok, true);
  });
  test("aliado desactivado no abre", async () => {
    assert.deepEqual(await resolverAccesoVoucher(TOKEN, deps({ perfil: aliado({ activo: false }), pagado: true })), { ok: false, motivo: "sin_permiso" });
  });
  test("el pago ni se consulta si no es el dueño (no se gastan solicitudes ni se revela nada)", async () => {
    const llamadas: string[] = [];
    await resolverAccesoVoucher(TOKEN, deps({ perfil: aliado({ aliadoId: 1234 }), pagado: true }, llamadas));
    assert.deepEqual(llamadas, []);
  });
});

describe("personal interno: vista previa en cualquier momento, decidida por la RLS", () => {
  for (const rol of ["superadmin", "gerencia", "administracion", "operaciones", "venta"]) {
    test(`${rol} con la fila visible por RLS abre aunque el contrato NO esté pagado`, async () => {
      const llamadas: string[] = [];
      const r = await resolverAccesoVoucher(TOKEN, deps({ perfil: perfil(rol), visibleInterno: true, pagado: false }, llamadas));
      assert.equal(r.ok, true);
      if (r.ok) assert.equal(r.modo, "interno");
      assert.ok(!llamadas.includes("pago"), "la vista previa interna no depende del pago");
    });
  }
  test("interno sin permiso de la RLS (p. ej. asesor `venta` de un contrato ajeno) NO abre", async () => {
    assert.deepEqual(await resolverAccesoVoucher(TOKEN, deps({ perfil: perfil("venta"), visibleInterno: false })), { ok: false, motivo: "sin_permiso" });
  });
  test("un interno que además figura como aliado del contrato NO entra por la puerta del aliado (no hay atajo)", async () => {
    assert.deepEqual(await resolverAccesoVoucher(TOKEN, deps({ perfil: perfil("operaciones", { aliadoId: 9601 }), visibleInterno: false, pagado: true })), { ok: false, motivo: "sin_permiso" });
  });
});

describe("no autorizados y casos límite", () => {
  test("sin sesión → no abre", async () => {
    assert.deepEqual(await resolverAccesoVoucher(TOKEN, deps({ sesion: false })), { ok: false, motivo: "sin_sesion" });
  });
  test("token inexistente o voucher sin contenido → no existe (404, no se revela otra cosa)", async () => {
    assert.deepEqual(await resolverAccesoVoucher(TOKEN, deps({ voucher: null })), { ok: false, motivo: "no_existe" });
    assert.deepEqual(await resolverAccesoVoucher(TOKEN, deps({ voucher: { ...VOUCHER, contenido: null } })), { ok: false, motivo: "no_existe" });
  });
  test("token vacío o demasiado corto no consulta nada", async () => {
    const llamadas: string[] = [];
    assert.deepEqual(await resolverAccesoVoucher("", deps({}, llamadas)), { ok: false, motivo: "no_existe" });
    assert.deepEqual(llamadas, []);
  });
  test("rol desconocido o sin rol → no abre", async () => {
    assert.deepEqual(await resolverAccesoVoucher(TOKEN, deps({ perfil: perfil("control_vuelo"), pagado: true })), { ok: false, motivo: "sin_permiso" });
    assert.deepEqual(await resolverAccesoVoucher(TOKEN, deps({ perfil: null })), { ok: false, motivo: "sin_permiso" });
  });
  test("cualquier excepción de una dependencia se convierte en denegación (falla cerrado)", async () => {
    const d = deps({ perfil: aliado(), pagado: true });
    d.contrato = async () => { throw new Error("boom"); };
    assert.deepEqual(await resolverAccesoVoucher(TOKEN, d), { ok: false, motivo: "error" });
  });
});

describe("acuerdoDeFila (lectura del acuerdo guardado)", () => {
  test("mapea los tres tipos y descarta filas incoherentes", () => {
    assert.deepEqual(acuerdoDeFila({ tipo: "total", porcentaje: null, importe: null, moneda: null }), { tipo: "total" });
    assert.deepEqual(acuerdoDeFila({ tipo: "porcentaje", porcentaje: "0.5000", importe: null, moneda: null }), { tipo: "porcentaje", porcentaje: 0.5 });
    assert.deepEqual(acuerdoDeFila({ tipo: "importe", porcentaje: null, importe: "350000.00", moneda: "COP" }), { tipo: "importe", importe: 350000, moneda: "COP" });
    assert.equal(acuerdoDeFila({ tipo: "porcentaje", porcentaje: 0, importe: null, moneda: null }), null);
    assert.equal(acuerdoDeFila({ tipo: "otro", porcentaje: null, importe: null, moneda: null }), null);
  });
});

describe("cableado: el candado está en el SERVIDOR, no en el botón", () => {
  test("la página del voucher y su metadata usan la MISMA resolución y ya no leen con service-role por token", () => {
    const p = leer("app/voucher/[token]/page.tsx");
    assert.equal((p.match(/accesoVoucherPorToken\(token\)/g) ?? []).length, 2, "generateMetadata y la página");
    assert.doesNotMatch(p, /createAdminClient|share_token/);
    assert.match(p, /if \(!r\.ok\) notFound\(\)/);
  });
  test("la resolución real usa el pago de la base (RPC) y la RLS de la sesión para el interno", () => {
    const s = leer("lib/voucher/accesoVoucher.server.ts");
    assert.match(s, /pagadoCompleto: contratoPagadoCompleto/);
    assert.match(s, /visibleParaInterno/);
    assert.match(leer("lib/voucher/pagoCompleto.ts"), /rpc\("contratos_pagados_completos"/);
  });
  test("el portal filtra los vouchers por pago completo y, sin poder verificarlo, no enlaza ninguno", () => {
    const s = leer("lib/portal/b2bPortalServidor.ts");
    assert.match(s, /contratosPagadosCompletos\(conVoucher\)/);
    assert.match(s, /if \(pagados === null\)[\s\S]{0,200}vouchers = \[\]/);
  });
  test("la generación interna ya no exige el 100 % ni tiene excepción de superadmin; el borrado/edición siguen por RLS", () => {
    const a = leer("app/(dashboard)/dashboard/contratos/[numero]/voucher-actions.ts");
    assert.doesNotMatch(a, /100% pago|esSuperadmin|cobroDeVenta/);
  });
  test("el cron de vencimiento sigue llamando la misma función de base (la regla vive en SQL)", () => {
    assert.match(leer("lib/reservar/liberarVencidas.ts"), /rpc\("liberar_vencidas"/);
  });
});
