// O-1 — el diagnóstico de configuración del hotel (campos de edades, ruta de Producto) es solo interno.
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { sanearBusquedaHoteles, tieneDetalleInterno, traeDetalleInterno } from "../lib/tarifario/detalleInterno.ts";
import { MENSAJE_EDADES_HOTEL_PUBLICO, mensajeEdadesHotel } from "../lib/calc/reglaEdadTarifa.ts";

const DETALLE = mensajeEdadesHotel("Hotel X", ["Infante hasta (edad)"], []);
const respuestaConfig = () => ({
  ok: true as const, resultados: [], diagnostico: DETALLE, diagnosticoConfig: true,
  enRevision: [{ hotelId: 1, hotelNombre: "Hotel X", paqueteId: 2, motivo: DETALLE, codigo: "edades_hotel_incompletas" }],
});

describe("O-1 · quién ve el detalle interno", () => {
  test("solo el personal interno ACTIVO; anónimo, aliados y clientes no", () => {
    for (const r of ["superadmin", "gerencia", "administracion", "operaciones", "venta"]) assert.equal(tieneDetalleInterno(r, true), true, r);
    for (const r of ["agencia", "freelance", "cliente_final", "control_vuelo", "", null, undefined, "invitado"]) assert.equal(tieneDetalleInterno(r, true), false, String(r));
    assert.equal(tieneDetalleInterno("superadmin", false), false, "cuenta desactivada = externo");
    assert.equal(tieneDetalleInterno("superadmin", null), false, "sin dato de activo = externo (falla cerrado)");
  });
});

describe("O-1 · saneamiento de la respuesta de búsqueda", () => {
  test("externo: sin lista en revisión, sin diagnóstico de configuración, sin la marca interna (payload serializado)", () => {
    const json = JSON.stringify(sanearBusquedaHoteles(respuestaConfig(), false));
    assert.doesNotMatch(json, /Infante hasta|Producto|Configuración del hotel|enRevision|edades_hotel_incompletas|diagnosticoConfig|Hotel X/);
  });
  test("interno: conserva el detalle y la lista, y retira solo la marca interna", () => {
    const r = sanearBusquedaHoteles(respuestaConfig(), true) as Record<string, unknown>;
    assert.equal(r.diagnostico, DETALLE);
    assert.equal((r.enRevision as unknown[]).length, 1);
    assert.equal("diagnosticoConfig" in r, false);
  });
  test("externo: un diagnóstico que NO es de configuración (capacidad, Adults Only) se conserva", () => {
    const r = sanearBusquedaHoteles({ ok: true as const, resultados: [], diagnostico: "Este hotel es Adults Only y no acepta menores." }, false) as Record<string, unknown>;
    assert.equal(r.diagnostico, "Este hotel es Adults Only y no acepta menores.");
  });
  test("un fallo técnico pasa tal cual", () => {
    const f = { ok: false as const, error: "No disponible" };
    assert.deepEqual(sanearBusquedaHoteles(f, false), f);
  });
  test("solo se lee la sesión cuando hay algo que ocultar", () => {
    assert.equal(traeDetalleInterno({ ok: true }), false);
    assert.equal(traeDetalleInterno({ ok: true, enRevision: [] }), false);
    assert.equal(traeDetalleInterno({ ok: true, diagnosticoConfig: true }), true);
    assert.equal(traeDetalleInterno({ ok: true, enRevision: [{}] }), true);
    assert.equal(traeDetalleInterno({ ok: false }), false);
  });
  test("el texto público no nombra campos, rutas ni instrucciones", () => {
    assert.doesNotMatch(MENSAJE_EDADES_HOTEL_PUBLICO, /Infante|Niño hasta|Producto|Hoteles|configuración|campo/i);
  });
});

describe("O-1 · cableado (por texto fuente)", () => {
  const src = (f: string) => readFileSync(new URL(`../${f}`, import.meta.url), "utf8");
  test("la acción pública de búsqueda por persona sanea según la sesión, una vez y de forma perezosa", () => {
    const s = src("app/(dashboard)/dashboard/reservar/actions.ts");
    assert.match(s, /traeDetalleInterno\(r\) \? await peticionConDetalleInterno\(\) : false/);
    assert.match(s, /return sanearBusquedaHoteles\(r, interno\)/);
  });
  test("la acción por unidad entrega enRevision solo a personal interno", () => {
    const s = src("app/tarifario/busquedaUnidadActions.ts");
    assert.match(s, /enRevision\.length > 0 \? await peticionConDetalleInterno\(\) : false/);
    assert.match(s, /enRevision: interno \? enRevision : \[\]/);
  });
  test("el lector de sesión falla cerrado y no consulta nada sin sesión", () => {
    const s = src("lib/tarifario/detalleInterno.server.ts");
    assert.match(s, /if \(!user\) return false/);
    assert.match(s, /catch \{\s*return false;/);
  });
  test("las rutas alcanzables por un aliado (reserva, solicitud, modal) usan el texto público", () => {
    assert.match(src("lib/reservar/computo.ts"), /error: MENSAJE_EDADES_HOTEL_PUBLICO/);
    assert.match(src("lib/reservar/solicitudHotelServidor.ts"), /error: MENSAJE_EDADES_HOTEL_PUBLICO/);
    assert.match(src("app/tarifario/VistaBooking.tsx"), /error: MENSAJE_EDADES_HOTEL_PUBLICO/);
    assert.match(src("app/tarifario/cotizacionBernaloActions.ts"), /edades_hotel_incompletas: MENSAJE_EDADES_HOTEL_PUBLICO/);
  });
});
