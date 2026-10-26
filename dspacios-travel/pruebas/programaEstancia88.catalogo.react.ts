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
const { HotelesVigenciaEditor } = await import("../app/(dashboard)/dashboard/producto/programas/[id]/HotelesVigenciaEditor.tsx");
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

describe("HotelesVigenciaEditor", () => {
  let desmontar: (() => Promise<void>) | undefined;
  afterEach(async () => { await desmontar?.(); desmontar = undefined; });
  after(() => dom.window.close());

  const PROGRAMA = { moneda: "USD", pct_mk: 0.15, pct_fee_tarjeta: 0.03, asistencia_medica_dia: 4, dias: 4 };
  const boton = (raiz: Element, t: RegExp) => [...raiz.querySelectorAll("button")].find((b) => t.test(txt(b))) as HTMLButtonElement;
  async function elegir(sel: HTMLSelectElement, valor: string) {
    await React.act(async () => {
      Object.getOwnPropertyDescriptor(dom.window.HTMLSelectElement.prototype, "value")!.set!.call(sel, valor);
      sel.dispatchEvent(new dom.window.Event("change", { bubbles: true }));
    });
  }
  const dentro = (raiz: Element, etiqueta: string) => raiz.querySelector(`[aria-label="${etiqueta}"]`) as HTMLElement;

  test("captura un hotel con precio base y noche adicional: muestra el PVP junto al neto y NO guarda sin unidad de cobro", async () => {
    const { llamadas } = conRpc();
    const m = await montar(h(HotelesVigenciaEditor, { programaId: 3, programa: PROGRAMA, proveedores: [{ id: 9, nombre: "Operador Andes" }], catalogo: { hoteles: [], base: [], noches: [] } }));
    desmontar = m.desmontar;
    const raiz = m.contenedor as HTMLElement;

    await clic(boton(raiz, /Agregar hotel/), "Agregar hotel");
    await escribir(raiz.querySelector('input[placeholder="Nombre del hotel"]') as HTMLInputElement, "Hotel Centro");

    await clic(boton(raiz, /Agregar vigencia de precio base/), "Agregar vigencia base");
    const base = dentro(raiz, "Vigencia base 1 de Hotel Centro");
    await escribir(base.querySelector('input[aria-label="Entrada desde"]') as HTMLInputElement, "2027-03-01");
    await escribir(base.querySelector('input[aria-label="Entrada hasta"]') as HTMLInputElement, "2027-03-31");
    await elegir(base.querySelector("select") as HTMLSelectElement, "privado");
    const inputsBase = [...base.querySelectorAll('input[inputmode="decimal"]')] as HTMLInputElement[];
    await escribir(inputsBase[1], "600"); // doble
    assert.match(txt(base), /PVP USD \$748/, "base doble 600 → 748 por persona (misma fórmula que la ficha)");

    await clic(boton(raiz, /Agregar vigencia de noche adicional/), "Agregar vigencia de noche");
    const noche = dentro(raiz, "Vigencia de noche adicional 1 de Hotel Centro");
    await escribir(noche.querySelector('input[aria-label="Noche desde"]') as HTMLInputElement, "2027-03-01");
    await escribir(noche.querySelector('input[aria-label="Noche hasta"]') as HTMLInputElement, "2027-03-31");
    const inputsNoche = [...noche.querySelectorAll('input[inputmode="decimal"]')] as HTMLInputElement[];
    await escribir(inputsNoche[1], "100"); // doble
    assert.equal((noche.querySelector("select") as HTMLSelectElement).value, "", "la unidad de cobro NO tiene valor por defecto");
    assert.doesNotMatch(txt(noche), /PVP USD/, "sin unidad no hay PVP de noche que mostrar");

    await clic(boton(raiz, /^Guardar$/), "Guardar");
    await esperar(() => !!raiz.querySelector('[role="alert"]'));
    assert.match(txt(raiz.querySelector('[role="alert"]')), /unidad de cobro/);
    assert.equal(llamadas.length, 0, "sin unidad no se llama a la base");

    await elegir(noche.querySelector("select") as HTMLSelectElement, "habitacion");
    assert.match(txt(noche), /PVP USD \$131 por habitación/, "(100 + 4×2 ocupantes)/0.8245 = 130,98 → 131 por habitación y noche");
    await elegir(noche.querySelector("select") as HTMLSelectElement, "persona");
    assert.match(txt(noche), /PVP USD \$127 por persona/);
    await clic(boton(raiz, /^Guardar$/), "Guardar");
    await esperar(() => llamadas.length > 0);
    assert.equal(llamadas.length, 1);
    const [hotel] = llamadas[0].p_hoteles as { nombre: string; noches: { unidad_cobro: string; neto_doble: number }[]; base: { modalidad_servicios: string; neto_doble: number }[] }[];
    assert.equal(hotel.nombre, "Hotel Centro");
    assert.deepEqual(hotel.noches.map((n) => [n.unidad_cobro, n.neto_doble]), [["persona", 100]]);
    assert.deepEqual(hotel.base.map((b) => [b.modalidad_servicios, b.neto_doble]), [["privado", 600]]);
  });

  test("carga un catálogo existente con su unidad de cobro y permite quitar vigencias y hoteles", async () => {
    conRpc();
    const neto = (o: Record<string, number | null>) => ({ sencilla: null, doble: null, triple: null, multiple: null, nino: null, ...o });
    const m = await montar(h(HotelesVigenciaEditor, {
      programaId: 3, programa: PROGRAMA, proveedores: [],
      catalogo: {
        hoteles: [{ id: 1, nombre: "Hotel Playa", zona: "Playa", tipoHabitacion: "Vista mar", maxPaxHabitacion: 3, maxMenoresHabitacion: 1, proveedorId: null }],
        base: [{ id: 1, hotelId: 1, desde: "2027-03-01", hasta: "2027-03-31", modalidad: "regular", bajoSolicitud: false, neto: neto({ doble: 450 }) }],
        noches: [{ id: 1, hotelId: 1, desde: "2027-03-01", hasta: "2027-03-31", unidad: "habitacion", neto: neto({ doble: 180 }) }],
      },
    }));
    desmontar = m.desmontar;
    const raiz = m.contenedor as HTMLElement;
    assert.equal((raiz.querySelector('input[placeholder="Nombre del hotel"]') as HTMLInputElement).value, "Hotel Playa");
    const noche = dentro(raiz, "Vigencia de noche adicional 1 de Hotel Playa");
    assert.equal((noche.querySelector("select") as HTMLSelectElement).value, "habitacion");
    assert.match(txt(noche), /PVP USD \$229 por habitación/);
    assert.match(txt(dentro(raiz, "Vigencia base 1 de Hotel Playa")), /PVP USD \$566/);
    await clic(boton(noche, /Quitar vigencia/), "Quitar vigencia de noche");
    assert.equal(dentro(raiz, "Vigencia de noche adicional 1 de Hotel Playa"), null);
    await clic(raiz.querySelector('button[aria-label^="Quitar el hotel"]'), "Quitar el hotel");
    assert.equal(raiz.querySelector('input[placeholder="Nombre del hotel"]'), null);
  });
});
