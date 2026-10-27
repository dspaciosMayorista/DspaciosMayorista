// Se ejecuta con npm run test:react (loader del arnés + jsdom). NO entra en test:unit.
//
// #88 — Captura del catálogo de un programa por hotel y vigencia:
//   · la Server Action `guardarHoteles` valida ANTES de llamar a la base (unidad de cobro obligatoria,
//     solapes, fechas, ocupación) y manda a la RPC atómica exactamente la forma que la 244 espera;
//   · el editor (HotelesVigenciaEditor): agregar hotel, vigencia base y vigencia de noche; el PVP se
//     ve al lado de cada neto; la unidad de cobro NO tiene valor por defecto y sin ella no se guarda.
import { montar, clic, escribir, esperar, usarBD, dom } from "./support/fechaNegocioArnes.ts";
import { test, describe, afterEach, after } from "node:test";
import assert from "node:assert/strict";

const React = await import("react");
const { guardarHoteles } = await import("../app/(dashboard)/dashboard/producto/programas/actions.ts");
const h = React.createElement;

const txt = (el: Element | null | undefined) => (el?.textContent ?? "").replace(/\s+/g, " ").trim();
const netos = (o: Record<string, string> = {}) => ({ sencilla: "", doble: "", triple: "", multiple: "", nino: "", ...o });
const hotelOk = () => ({
  id: null as number | null, nombre: "Hotel Centro", zona: "Centro", tipoHabitacion: "", maxPaxHabitacion: "4", maxMenoresHabitacion: "", proveedorId: null as number | null,
  base: [{ desde: "2027-03-01", hasta: "2027-03-31", modalidad: "privado", bajoSolicitud: false, neto: netos({ doble: "600", nino: "400" }) }],
  noches: [{ desde: "2027-03-01", hasta: "2027-03-31", unidad: "persona", neto: netos({ doble: "100" }) }],
});

function conRpc() {
  const llamadas: Record<string, unknown>[] = [];
  const bd = usarBD({}, { guardar_programa_hoteles: (args) => { llamadas.push(args); return null; } });
  return { bd, llamadas };
}

describe("guardarHoteles (Server Action)", () => {
  test("válido: manda a la RPC la forma exacta que espera la migración 244 (vacíos → null, números → número)", async () => {
    const { llamadas } = conRpc();
    const r = await guardarHoteles(3, [hotelOk()]);
    assert.deepEqual(r, { ok: true });
    assert.equal(llamadas.length, 1);
    assert.equal(llamadas[0].p_programa_id, 3);
    assert.deepEqual(llamadas[0].p_hoteles, [{
      id: null, nombre: "Hotel Centro", zona: "Centro", tipo_habitacion: null, max_pax_habitacion: 4, max_menores_habitacion: null, proveedor_id: null,
      base: [{ desde: "2027-03-01", hasta: "2027-03-31", modalidad_servicios: "privado", bajo_solicitud: false,
        neto_sencilla: null, neto_doble: 600, neto_triple: null, neto_multiple: null, neto_nino: 400 }],
      noches: [{ desde: "2027-03-01", hasta: "2027-03-31", unidad_cobro: "persona",
        neto_sencilla: null, neto_doble: 100, neto_triple: null, neto_multiple: null, neto_nino: null }],
    }]);
  });

  test("conserva el id de un hotel existente y el proveedor propio", async () => {
    const { llamadas } = conRpc();
    await guardarHoteles(3, [{ ...hotelOk(), id: 7, proveedorId: 12 }]);
    const [hotel] = llamadas[0].p_hoteles as { id: number; proveedor_id: number }[];
    assert.deepEqual([hotel.id, hotel.proveedor_id], [7, 12]);
  });

  test("rechaza ANTES de la base: sin unidad de cobro, solapes, fechas, nombre y ocupación", async () => {
    const { llamadas } = conRpc();
    const casos: [string, ReturnType<typeof hotelOk>[], RegExp][] = [
      ["sin unidad de cobro", [{ ...hotelOk(), noches: [{ ...hotelOk().noches[0], unidad: "" }] }], /unidad de cobro/],
      ["base solapada", [{ ...hotelOk(), base: [hotelOk().base[0], { ...hotelOk().base[0], desde: "2027-03-15", hasta: "2027-04-15" }] }], /se solapan/],
      ["noches solapadas", [{ ...hotelOk(), noches: [hotelOk().noches[0], { ...hotelOk().noches[0], desde: "2027-03-20" }] }], /noche adicional se solapan/],
      ["fecha inválida", [{ ...hotelOk(), base: [{ ...hotelOk().base[0], desde: "2027-13-01" }] }], /fechas válidas/],
      ["modalidad vacía", [{ ...hotelOk(), base: [{ ...hotelOk().base[0], modalidad: "" }] }], /modalidad de servicios/],
      ["nombre vacío", [{ ...hotelOk(), nombre: "  " }], /no tiene nombre/],
      ["hotel repetido", [hotelOk(), hotelOk()], /repetido/],
      ["neto negativo", [{ ...hotelOk(), base: [{ ...hotelOk().base[0], neto: netos({ doble: "-5" }) }] }], /negativos/],
      ["ocupación no entera", [{ ...hotelOk(), maxPaxHabitacion: "2.5" }], /número entero/],
      ["máx. personas 0", [{ ...hotelOk(), maxPaxHabitacion: "0" }], /1 o más/],
    ];
    for (const [nombre, hoteles, esperado] of casos) {
      const r = await guardarHoteles(3, hoteles);
      assert.equal(r.ok, false, nombre);
      assert.match(r.ok ? "" : r.error, esperado, nombre);
    }
    assert.equal(llamadas.length, 0, "ningún rechazo llegó a la RPC");
  });

  test("un error de la base se devuelve tal cual y no se confirma como guardado", async () => {
    usarBD({}, { guardar_programa_hoteles: () => ({ __error: { code: "P0001", message: "Hay vigencias de precio base solapadas para un mismo hotel y modalidad de servicios." } }) });
    const r = await guardarHoteles(3, [hotelOk()]);
    assert.equal(r.ok, false);
    assert.match(r.ok ? "" : r.error, /solapadas/);
  });
});

// El editor (tarjetas + diálogo) se prueba en pruebas/programaHotel409.editor.react.ts.
after(() => dom.window.close());
