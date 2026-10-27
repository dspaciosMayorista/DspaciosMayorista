// Se ejecuta con npm run test:react (loader del arnés + jsdom). NO entra en test:unit.
//
// PR #409 — Editor de hoteles por vigencia: tarjetas compactas + diálogo de edición, capacidad del hotel, noches ligadas a las
// vigencias base, clonar como borrador, errores dentro del diálogo, y la acción de vista previa (solo lectura, con rol).
import { montar, clic, escribir, esperar, usarBD, dom } from "./support/fechaNegocioArnes.ts";
import { test, describe, afterEach, after } from "node:test";
import assert from "node:assert/strict";

const React = await import("react");
const { HotelesVigenciaEditor } = await import("../app/(dashboard)/dashboard/producto/programas/[id]/HotelesVigenciaEditor.tsx");
const { calcularVistaPreviaPrograma } = await import("../app/(dashboard)/dashboard/producto/programas/actions.ts");
const h = React.createElement;

const txt = (el: Element | null | undefined) => (el?.textContent ?? "").replace(/\s+/g, " ").trim();
const PROGRAMA = { moneda: "USD", pct_mk: 0.15, pct_fee_tarjeta: 0.03, asistencia_medica_dia: 4, dias: 4 };
const netosC = (o: Record<string, number | null> = {}) => ({ sencilla: null, doble: null, triple: null, multiple: null, nino: null, ...o });
const netosT = (o: Record<string, string> = {}) => ({ sencilla: "", doble: "", triple: "", multiple: "", nino: "", ...o });

const dialogo = () => document.querySelector<HTMLElement>('[role="dialog"]');
const boton = (raiz: ParentNode, t: RegExp) => [...raiz.querySelectorAll("button")].find((b) => t.test(txt(b)) || t.test(b.getAttribute("aria-label") ?? "")) as HTMLButtonElement | undefined;
async function elegir(sel: HTMLSelectElement, valor: string) {
  await React.act(async () => {
    Object.getOwnPropertyDescriptor(dom.window.HTMLSelectElement.prototype, "value")!.set!.call(sel, valor);
    sel.dispatchEvent(new dom.window.Event("change", { bubbles: true }));
  });
}
/** La RPC simulada PERSISTE lo recibido (hoteles, vigencias y noches con ids nuevos), como la real: el editor lee de vuelta los ids guardados. */
function persistirCatalogo(bd: ReturnType<typeof usarBD>, args: Record<string, unknown>) {
  const lista = args.p_hoteles as Record<string, unknown>[];
  const t = (n: string) => bd.tablas.get(n) ?? [];
  let id = Math.max(100, ...t("programa_hoteles").map((f) => Number(f.id) || 0));
  bd.tablas.set("programa_hoteles", []); bd.tablas.set("programa_hotel_precios", []); bd.tablas.set("programa_hotel_noches", []);
  lista.forEach((hh, orden) => {
    const hid = (hh.id as number | null) ?? ++id;
    t("programa_hoteles").push({ id: hid, programa_id: args.p_programa_id, orden, nombre: hh.nombre, zona: hh.zona, tipo_habitacion: hh.tipo_habitacion, max_pax_habitacion: hh.max_pax_habitacion, max_menores_habitacion: hh.max_menores_habitacion, proveedor_id: hh.proveedor_id });
    for (const b of hh.base as Record<string, unknown>[]) t("programa_hotel_precios").push({ id: ++id, hotel_id: hid, ...b });
    for (const n of hh.noches as Record<string, unknown>[]) t("programa_hotel_noches").push({ id: ++id, hotel_id: hid, ...n });
  });
}
function conRpc(error?: string) {
  const llamadas: Record<string, unknown>[] = [];
  const bd: ReturnType<typeof usarBD> = usarBD({}, { guardar_programa_hoteles: (args) => { llamadas.push(args); if (error) return { __error: { code: "P0001", message: error } }; persistirCatalogo(bd, args); return null; } });
  return { bd, llamadas };
}
const catalogoUno = (over: { maxPax?: number | null; maxMenores?: number | null; base?: unknown[]; noches?: unknown[] } = {}) => ({
  hoteles: [{ id: 1, nombre: "Hotel Playa", zona: "Playa", tipoHabitacion: "Vista mar", maxPaxHabitacion: over.maxPax === undefined ? 4 : over.maxPax, maxMenoresHabitacion: over.maxMenores === undefined ? 2 : over.maxMenores, proveedorId: null }],
  base: over.base ?? [{ id: 1, hotelId: 1, desde: "2027-03-01", hasta: "2027-03-31", modalidad: "privado", bajoSolicitud: false, neto: netosC({ doble: 600 }) }],
  noches: over.noches ?? [{ id: 1, hotelId: 1, desde: "2027-03-01", hasta: "2027-03-31", unidad: "persona", neto: netosC({ doble: 100 }) }],
});
const montarEditor = (catalogo: unknown) =>
  montar(h(HotelesVigenciaEditor as never, { programaId: 3, programa: PROGRAMA, proveedores: [{ id: 9, nombre: "Operador Andes" }], catalogo }));

describe("HotelesVigenciaEditor (PR #409)", () => {
  let desmontar: (() => Promise<void>) | undefined;
  afterEach(async () => { await desmontar?.(); desmontar = undefined; });
  after(() => dom.window.close());

  test("alta: «Agregar hotel» abre el diálogo; la noche se LIGA a una vigencia base (privado+regular iguales = una opción); sin unidad no se guarda; al guardar se cierra y vuelve el foco", async () => {
    const { llamadas } = conRpc();
    const m = await montarEditor({ hoteles: [], base: [], noches: [] });
    desmontar = m.desmontar;
    const raiz = m.contenedor as HTMLElement;
    assert.equal(dialogo(), null, "sin diálogo hasta pulsar");
    await clic(boton(raiz, /Agregar hotel/), "Agregar hotel");
    const d = dialogo()!;
    assert.ok(d, "se abrió el diálogo");
    await escribir(d.querySelector("#hotel-nombre") as HTMLInputElement, "Hotel Centro");
    await escribir(d.querySelector("#hotel-maxpax") as HTMLInputElement, "4");

    for (const [i, mod, doble] of [[1, "privado", "600"], [2, "regular", "450"]] as const) {
      await clic(boton(d, /Agregar vigencia de precio base/), "Agregar vigencia base");
      const base = d.querySelector(`[aria-label="Vigencia base ${i} de Hotel Centro"]`) as HTMLElement;
      await escribir(base.querySelector('input[aria-label="Entrada desde"]') as HTMLInputElement, "2027-03-01");
      await escribir(base.querySelector('input[aria-label="Entrada hasta"]') as HTMLInputElement, "2027-03-31");
      await elegir(base.querySelector("select") as HTMLSelectElement, mod);
      await escribir([...base.querySelectorAll('input[inputmode="decimal"]')][1] as HTMLInputElement, doble);
    }
    assert.match(txt(d.querySelector('[aria-label="Vigencia base 1 de Hotel Centro"]')), /PVP USD \$748/);

    await clic(boton(d, /Agregar tarifa de noche adicional/), "Agregar tarifa de noche");
    const noche = d.querySelector('[aria-label="Vigencia de noche adicional 1 de Hotel Centro"]') as HTMLElement;
    const vig = noche.querySelector('select[aria-label="Vigencia base de la noche"]') as HTMLSelectElement;
    const opciones = [...vig.options].filter((o) => o.value);
    assert.equal(opciones.length, 1, "privado y regular con las mismas fechas son UNA sola opción");
    assert.match(txt(opciones[0]), /Privados y regulares/);
    assert.equal(noche.querySelector('input[aria-label="Noche desde"]'), null, "ya no se escriben fechas de noche");
    assert.equal((noche.querySelectorAll("select")[1] as HTMLSelectElement).value, "", "la unidad de cobro NO tiene valor por defecto");
    await escribir([...noche.querySelectorAll('input[inputmode="decimal"]')][1] as HTMLInputElement, "100");

    await clic(boton(d, /^Guardar$/), "Guardar");
    await esperar(() => !!d.querySelector('[role="alert"]'));
    assert.match(txt(d.querySelector('[role="alert"]')), /unidad de cobro/);
    assert.equal(llamadas.length, 0, "sin unidad no se llama a la base");
    assert.ok(dialogo(), "el diálogo sigue abierto y conserva el borrador");
    assert.equal((d.querySelector("#hotel-nombre") as HTMLInputElement).value, "Hotel Centro");

    await elegir(noche.querySelectorAll("select")[1] as HTMLSelectElement, "persona");
    await clic(boton(d, /^Guardar$/), "Guardar");
    await esperar(() => llamadas.length > 0 && !dialogo());
    assert.equal(llamadas.length, 1);
    const [hotel] = llamadas[0].p_hoteles as { nombre: string; noches: { desde: string; hasta: string; unidad_cobro: string }[]; base: unknown[] }[];
    assert.equal(hotel.nombre, "Hotel Centro");
    assert.deepEqual(hotel.noches.map((n) => [n.desde, n.hasta, n.unidad_cobro]), [["2027-03-01", "2027-03-31", "persona"]]);
    assert.equal(hotel.base.length, 2);
    assert.equal(dialogo(), null, "guardar cierra el diálogo");
    const tarjeta = raiz.querySelector('[aria-label="Hotel Hotel Centro"]')!;
    assert.match(txt(tarjeta), /1 vigencia base/, "queda como tarjeta compacta con el resumen");
    await esperar(() => (document.activeElement as HTMLElement | null)?.getAttribute("data-foco") === "agregar-hotel");
    assert.equal((document.activeElement as HTMLElement).getAttribute("data-foco"), "agregar-hotel", "el foco vuelve al botón que abrió el diálogo");
  });

  test("capacidad: con máximo 2 y 0 menores no se piden Triple/Múltiple/Menor; las tarifas ya cargadas se ven como conflicto y se quitan solo con una acción explícita", async () => {
    const { llamadas } = conRpc();
    const m = await montarEditor(catalogoUno({
      maxPax: 2, maxMenores: 0,
      base: [{ id: 1, hotelId: 1, desde: "2027-03-01", hasta: "2027-03-31", modalidad: "privado", bajoSolicitud: false, neto: netosC({ doble: 600, triple: 520, nino: 300 }) }],
      noches: [{ id: 1, hotelId: 1, desde: "2027-03-01", hasta: "2027-03-31", unidad: "persona", neto: netosC({ doble: 100, triple: 90 }) }],
    }));
    desmontar = m.desmontar;
    const raiz = m.contenedor as HTMLElement;
    assert.match(txt(raiz.querySelector('[aria-label="Hotel Hotel Playa"]')), /Revisar/, "la tarjeta avisa que hay algo por resolver");
    await clic(boton(raiz, /Editar Hotel Playa/), "Editar");
    const d = dialogo()!;
    const etiquetas = [...d.querySelectorAll("label")].map((l) => txt(l));
    for (const prohibida of ["Triple", "Múltiple", "Menor", "Menor (por persona)"]) assert.ok(!etiquetas.includes(prohibida), `no se pide ${prohibida}`);
    assert.match(txt(d.querySelector('[role="alert"]')), /Triple/, "el conflicto es visible");
    assert.equal(boton(d, /^Guardar$/)!.disabled, true, "no se puede guardar con tarifas incompatibles");
    await clic(boton(d, /Quitar las tarifas que el hotel no admite/), "Quitar incompatibles");
    assert.equal(d.querySelector('[role="alert"]'), null);
    assert.equal(boton(d, /^Guardar$/)!.disabled, false);
    await clic(boton(d, /^Guardar$/), "Guardar");
    await esperar(() => llamadas.length > 0);
    const [hotel] = llamadas[0].p_hoteles as { base: { neto_doble: number; neto_triple: number | null; neto_nino: number | null }[]; noches: { neto_triple: number | null }[] }[];
    assert.equal(hotel.base[0].neto_doble, 600);
    assert.equal(hotel.base[0].neto_triple, null);
    assert.equal(hotel.base[0].neto_nino, null);
    assert.equal(hotel.noches[0].neto_triple, null);
  });

  test("clonar: abre un BORRADOR con nombre nuevo y las vigencias copiadas; cancelar no cambia nada; el nombre debe ser único; confirmar crea el hotel con identidad nueva", async () => {
    const { llamadas } = conRpc();
    const m = await montarEditor(catalogoUno());
    desmontar = m.desmontar;
    const raiz = m.contenedor as HTMLElement;
    await clic(boton(raiz, /Clonar Hotel Playa/), "Clonar");
    let d = dialogo()!;
    assert.equal((d.querySelector("#hotel-nombre") as HTMLInputElement).value, "Hotel Playa (copia)");
    assert.equal(d.querySelectorAll('[aria-label^="Vigencia base 1 de"]').length, 1, "vigencias copiadas");
    assert.equal(llamadas.length, 0, "no se guarda al clonar");
    await clic(boton(d, /^Cancelar$/), "Cancelar");
    await esperar(() => !dialogo());
    assert.equal(raiz.querySelectorAll('li[aria-label^="Hotel "]').length, 1, "el original queda solo");
    assert.equal(llamadas.length, 0);
    await esperar(() => (document.activeElement as HTMLElement | null)?.getAttribute("data-foco") === "clonar-0");
    assert.equal((document.activeElement as HTMLElement).getAttribute("data-foco"), "clonar-0", "el foco vuelve al botón Clonar");

    await clic(boton(raiz, /Clonar Hotel Playa/), "Clonar");
    d = dialogo()!;
    await escribir(d.querySelector("#hotel-nombre") as HTMLInputElement, "hotel playa");
    assert.match(txt(d), /Ya hay otro hotel con este nombre/);
    assert.equal(boton(d, /Crear copia/)!.disabled, true, "nombre repetido: no se puede confirmar");
    await escribir(d.querySelector("#hotel-nombre") as HTMLInputElement, "Hotel Playa Norte");
    await clic(boton(d, /Crear copia/), "Crear copia");
    await esperar(() => llamadas.length > 0);
    const lista = llamadas[0].p_hoteles as { id: number | null; nombre: string; base: unknown[]; noches: unknown[] }[];
    assert.deepEqual(lista.map((x) => [x.id, x.nombre]), [[1, "Hotel Playa"], [null, "Hotel Playa Norte"]]);
    assert.deepEqual(lista[1].base, lista[0].base);
    assert.deepEqual(lista[1].noches, lista[0].noches);
  });

  test("un error del servidor se muestra DENTRO del diálogo y el borrador se conserva", async () => {
    conRpc("Hay vigencias de precio base solapadas para un mismo hotel y modalidad de servicios.");
    const m = await montarEditor(catalogoUno());
    desmontar = m.desmontar;
    const raiz = m.contenedor as HTMLElement;
    await clic(boton(raiz, /Editar Hotel Playa/), "Editar");
    const d = dialogo()!;
    await escribir(d.querySelector("#hotel-zona") as HTMLInputElement, "Zona cambiada");
    await clic(boton(d, /^Guardar$/), "Guardar");
    await esperar(() => !!d.querySelector('[role="alert"]'));
    assert.match(txt(d.querySelector('[role="alert"]')), /solapadas/);
    assert.ok(dialogo(), "no se cierra");
    assert.equal((d.querySelector("#hotel-zona") as HTMLInputElement).value, "Zona cambiada", "el borrador sigue ahí");
  });

  test("una tarifa de noche sin vigencia base es un conflicto visible; elegir una vigencia existente lo resuelve", async () => {
    conRpc();
    const m = await montarEditor(catalogoUno({ noches: [{ id: 1, hotelId: 1, desde: "2027-03-05", hasta: "2027-03-20", unidad: "persona", neto: netosC({ doble: 100 }) }] }));
    desmontar = m.desmontar;
    const raiz = m.contenedor as HTMLElement;
    await clic(boton(raiz, /Editar Hotel Playa/), "Editar");
    const d = dialogo()!;
    assert.match(txt(d.querySelector('[role="alert"]')), /vigencia base/);
    assert.equal(boton(d, /^Guardar$/)!.disabled, true);
    const vig = d.querySelector('select[aria-label="Vigencia base de la noche"]') as HTMLSelectElement;
    assert.match(txt(vig), /Vigencia que ya no existe/);
    await elegir(vig, "2027-03-01|2027-03-31");
    assert.equal(d.querySelector('[role="alert"]'), null);
    assert.equal(boton(d, /^Guardar$/)!.disabled, false);
  });

  test("vigencias base que no coinciden entre modalidades: no se pueden agregar noches adicionales hasta resolverlo", async () => {
    conRpc();
    const m = await montarEditor(catalogoUno({
      base: [
        { id: 1, hotelId: 1, desde: "2027-03-01", hasta: "2027-03-31", modalidad: "privado", bajoSolicitud: false, neto: netosC({ doble: 600 }) },
        { id: 2, hotelId: 1, desde: "2027-03-01", hasta: "2027-03-15", modalidad: "regular", bajoSolicitud: false, neto: netosC({ doble: 450 }) },
      ],
      noches: [],
    }));
    desmontar = m.desmontar;
    await clic(boton(m.contenedor as HTMLElement, /Editar Hotel Playa/), "Editar");
    const d = dialogo()!;
    assert.equal(boton(d, /Agregar tarifa de noche adicional/)!.disabled, true);
    assert.match(txt(d), /Corrige las vigencias base/);
  });

  test("quitar un hotel pide confirmación dentro del diálogo y guarda la lista sin él", async () => {
    const { llamadas } = conRpc();
    const m = await montarEditor(catalogoUno());
    desmontar = m.desmontar;
    const raiz = m.contenedor as HTMLElement;
    await clic(boton(raiz, /Editar Hotel Playa/), "Editar");
    const d = dialogo()!;
    await clic(boton(d, /Quitar hotel/), "Quitar hotel");
    assert.equal(llamadas.length, 0, "primero se confirma");
    await clic(boton(d, /Sí, quitar/), "Sí, quitar");
    await esperar(() => llamadas.length > 0);
    assert.deepEqual(llamadas[0].p_hoteles, []);
    await esperar(() => !dialogo());
    assert.equal(raiz.querySelectorAll('li[aria-label^="Hotel "]').length, 0);
  });
});

describe("calcularVistaPreviaPrograma (Server Action, solo lectura)", () => {
  after(() => dom.window.close());
  const programa = { id: 3, moneda: "USD", pct_mk: 0.15, pct_fee_tarjeta: 0.03, asistencia_medica_dia: 4, dias: 4, noches: 3, modo_precio: "hotel" };
  const dias = [1, 2, 3, 4].map((dia) => ({ programa_id: 3, dia, titulo: dia === 4 ? "Salida" : `Día ${dia}`, desayuno: true, almuerzo: false, cena: false, descripcion: "x" }));
  const hotel = (over: Record<string, unknown> = {}) => ({
    id: null, nombre: "Hotel Centro", zona: "", tipoHabitacion: "", maxPaxHabitacion: "4", maxMenoresHabitacion: "2", proveedorId: null,
    base: [{ desde: "2027-03-01", hasta: "2027-03-31", modalidad: "privado", bajoSolicitud: false, neto: netosT({ doble: "600", nino: "400" }) }],
    noches: [{ desde: "2027-03-01", hasta: "2027-03-31", unidad: "persona", neto: netosT({ doble: "100", nino: "60" }) }],
    ...over,
  });
  const SEL = { hotelIndex: 0, modalidad: "privado", fechaEntrada: "2027-03-01", nochesAdicionales: 2, habitaciones: { doble: 1 }, ninos: 1, infantes: 0 };
  const sembrar = (rol: string) => usarBD({ usuarios: [{ id: "u-arnes", rol }], programas: [programa], programa_dias: dias });

  test("calcula con un borrador sin guardar y NO escribe nada (ni RPC, ni ventas, ni cuentas por pagar)", async () => {
    const bd = sembrar("superadmin");
    const r = await calcularVistaPreviaPrograma(3, [hotel() as never], SEL);
    assert.equal(r.ok, true, r.ok ? "" : r.causa);
    if (r.ok) {
      assert.equal(r.noches.length, 2);
      assert.equal(r.itinerario?.dias.length, 6, "días libres antes del último día");
      assert.ok(r.netos, "el personal autorizado ve los costos");
    }
    assert.equal(bd.llamadasRpc.length, 0);
    for (const t of ["ventas", "cuentas_por_pagar", "contrato_items", "cotizaciones", "programa_hoteles"]) assert.equal(bd.filas(t).length, 0, `${t} sigue vacía`);
  });

  test("un blackout de viaje cubre el traslado previo; uno de entrada conserva la fecha del hotel", async () => {
    const conTraslado = [{ programa_id: 3, dia: 0, tipo_tramo: "traslado_previo", titulo: "Bus nocturno", desayuno: false, almuerzo: false, cena: false, descripcion: "Salida" }, ...dias];
    const base = { usuarios: [{ id: "u-arnes", rol: "superadmin" }], programas: [programa], programa_dias: conTraslado };
    usarBD({ ...base, programa_blackouts: [{ programa_id: 3, fecha_inicio: "2027-02-28", fecha_fin: "2027-02-28", alcance: "viaje" }] });
    const bloqueado = await calcularVistaPreviaPrograma(3, [hotel() as never], SEL);
    assert.equal(bloqueado.ok, false);
    assert.match(bloqueado.ok ? "" : bloqueado.causa, /blackout|bloqueo|disponib/i);
    usarBD({ ...base, programa_blackouts: [{ programa_id: 3, fecha_inicio: "2027-02-28", fecha_fin: "2027-02-28", alcance: "entrada" }] });
    const permitido = await calcularVistaPreviaPrograma(3, [hotel() as never], SEL);
    assert.equal(permitido.ok, true, permitido.ok ? "" : permitido.causa);
    if (permitido.ok) assert.equal(permitido.itinerario?.dias[0]?.tipo_tramo, "traslado_previo");
  });

  test("sin permiso de producto no hay vista previa (ni costos): el rol venta es rechazado", async () => {
    sembrar("venta");
    const r = await calcularVistaPreviaPrograma(3, [hotel() as never], SEL);
    assert.equal(r.ok, false);
    assert.match(r.ok ? "" : r.causa, /permiso/);
  });

  test("un borrador con conflictos devuelve la causa y no un importe", async () => {
    sembrar("superadmin");
    const triple = hotel({ maxPaxHabitacion: "2", base: [{ desde: "2027-03-01", hasta: "2027-03-31", modalidad: "privado", bajoSolicitud: false, neto: netosT({ doble: "600", triple: "520" }) }] });
    const r = await calcularVistaPreviaPrograma(3, [triple as never], { ...SEL, nochesAdicionales: 0 });
    assert.equal(r.ok, false);
    assert.match(r.ok ? "" : r.causa, /Triple/);
    const sinTarifa = await calcularVistaPreviaPrograma(3, [hotel() as never], { ...SEL, fechaEntrada: "2027-06-01" });
    assert.equal(sinTarifa.ok, false);
    assert.match(sinTarifa.ok ? "" : sinTarifa.causa, /No hay precio base/);
  });
});
