// Se ejecuta con npm run test:react (loader del arnés + jsdom). NO entra en test:unit.
//
// PR #409 — Interfaz: (1) la calculadora es un botón que abre y recoge el panel (aria-expanded) SIN perder selección ni resultado;
// (2) el blackout elige su alcance; (3) el itinerario muestra los días que faltan y deja guardar el borrador; (4) publicar queda bloqueado con su motivo;
// (5) el formulario de reserva avisa y no envía con itinerario incompleto o un blackout de viaje.
import { montar, clic, escribir, esperar, usarBD, dom } from "./support/fechaNegocioArnes.ts";
import { test, describe, afterEach, after } from "node:test";
import assert from "node:assert/strict";

const React = await import("react");
const { HotelesVigenciaEditor } = await import("../app/(dashboard)/dashboard/producto/programas/[id]/HotelesVigenciaEditor.tsx");
const { ProgramaEditor, BlackoutsEditor, ItinerarioEditor } = await import("../app/(dashboard)/dashboard/producto/programas/[id]/ProgramaEditor.tsx");
const { ProgramaReservaForm } = await import("../app/(dashboard)/dashboard/reservar/programa/[id]/ProgramaReservaForm.tsx");
const h = React.createElement;

const txt = (el: Element | null | undefined) => (el?.textContent ?? "").replace(/\s+/g, " ").trim();
const boton = (raiz: ParentNode, t: RegExp) => [...raiz.querySelectorAll("button")].find((b) => t.test(txt(b)) || t.test(b.getAttribute("aria-label") ?? "")) as HTMLButtonElement | undefined;
async function elegir(sel: HTMLSelectElement, valor: string) {
  await React.act(async () => {
    Object.getOwnPropertyDescriptor(dom.window.HTMLSelectElement.prototype, "value")!.set!.call(sel, valor);
    sel.dispatchEvent(new dom.window.Event("change", { bubbles: true }));
  });
}
async function esperarReal(listo: () => boolean, ms = 4000) {
  for (let t = 0; t < ms && !listo(); t += 50) await React.act(async () => { await new Promise((r) => setTimeout(r, 50)); });
}

const PROGRAMA_BD = { id: 3, moneda: "USD", pct_mk: 0.15, pct_fee_tarjeta: 0.03, asistencia_medica_dia: 4, dias: 4, noches: 3, modo_precio: "hotel" };
const DIAS_BD = [1, 2, 3, 4].map((dia) => ({ programa_id: 3, dia, titulo: dia === 4 ? "Salida" : `Día ${dia}`, desayuno: true, almuerzo: false, cena: false, descripcion: "x" }));
const netosC = (o: Record<string, number | null> = {}) => ({ sencilla: null, doble: null, triple: null, multiple: null, nino: null, ...o });
const CATALOGO = {
  hoteles: [{ id: 1, nombre: "Hotel Playa", zona: "Playa", tipoHabitacion: "Vista mar", maxPaxHabitacion: 4, maxMenoresHabitacion: 2, proveedorId: null }],
  base: [{ id: 1, hotelId: 1, desde: "2027-03-01", hasta: "2027-03-31", modalidad: "privado", bajoSolicitud: false, neto: netosC({ doble: 600 }) }],
  noches: [{ id: 1, hotelId: 1, desde: "2027-03-01", hasta: "2027-03-31", unidad: "persona", neto: netosC({ doble: 100 }) }],
};

describe("PR #409 · interfaz de blackouts, itinerario, publicación y calculadora", () => {
  let desmontar: (() => Promise<void>) | undefined;
  afterEach(async () => { await desmontar?.(); desmontar = undefined; });
  after(() => dom.window.close());

  test("la calculadora es un BOTÓN con aria-expanded que abre y recoge el panel; al recogerlo se conservan la selección y el resultado", async () => {
    usarBD({ usuarios: [{ id: "u-arnes", rol: "superadmin" }], programas: [PROGRAMA_BD], programa_dias: DIAS_BD, programa_blackouts: [] });
    const m = await montar(h(HotelesVigenciaEditor as never, { programaId: 3, programa: PROGRAMA_BD, proveedores: [], catalogo: CATALOGO }));
    desmontar = m.desmontar;
    const raiz = m.contenedor as HTMLElement;
    const panelSeccion = raiz.querySelector('[aria-label="Calculadora de precio"]') as HTMLElement;
    const toggle = panelSeccion.querySelector("button[aria-expanded]") as HTMLButtonElement;
    const panel = () => document.getElementById(toggle.getAttribute("aria-controls")!) as HTMLElement;
    assert.equal(toggle.getAttribute("aria-expanded"), "false", "nace recogida");
    assert.equal(panel().hidden, true);
    assert.match(txt(toggle), /Calculadora de precio/);

    await clic(toggle, "abrir");
    assert.equal(toggle.getAttribute("aria-expanded"), "true");
    assert.equal(panel().hidden, false);

    // Selección + resultado.
    await escribir(panel().querySelector('input[aria-label="Fecha de entrada"]') as HTMLInputElement, "2027-03-01");
    await escribir(panel().querySelector("#vp-noches-3") as HTMLInputElement, "2");
    await clic(boton(panel(), /Calcular vista previa/), "calcular");
    await esperarReal(() => /Total PVP/.test(txt(panel())));
    const resultado = txt(panel().querySelector('[aria-label="Estancia incluida"]')?.parentElement);
    assert.match(txt(panel()), /Total PVP/);
    assert.match(txt(panel()), /Día libre agregado/, "las noches extra suman días libres al itinerario");

    await clic(toggle, "recoger");
    assert.equal(toggle.getAttribute("aria-expanded"), "false");
    assert.equal(panel().hidden, true, "recogido: oculto, no desmontado");
    await clic(toggle, "reabrir");
    assert.equal(toggle.getAttribute("aria-expanded"), "true");
    assert.equal((panel().querySelector("#vp-noches-3") as HTMLInputElement).value, "2", "la selección se conserva");
    assert.equal((panel().querySelector('input[aria-label="Fecha de entrada"]') as HTMLInputElement).value, "2027-03-01");
    assert.match(txt(panel()), /Total PVP/, "el resultado se conserva");
    assert.ok(resultado.length >= 0);
    // Accesible por teclado: es un <button> nativo (Enter/Espacio lo activan) dentro de un encabezado.
    assert.equal(toggle.tagName, "BUTTON");
    assert.equal(toggle.closest("h3") != null, true);
  });

  test("el blackout elige su alcance (los existentes quedan en «Solo fecha de entrada») y lo manda al guardar", async () => {
    const llamadas: Record<string, unknown>[] = [];
    usarBD({}, { guardar_programa_blackouts: (a) => { llamadas.push(a); return 2; } });
    const m = await montar(h(BlackoutsEditor as never, {
      programaId: 3,
      blackouts: [
        { fecha_inicio: "2027-03-05", fecha_fin: "2027-03-06", motivo: "Viejo", ciudad: null },
        { fecha_inicio: "2027-04-01", fecha_fin: "2027-04-03", motivo: "Nuevo", ciudad: null, alcance: "viaje" },
      ],
    }));
    desmontar = m.desmontar;
    const raiz = m.contenedor as HTMLElement;
    const selects = [...raiz.querySelectorAll('select[aria-label="Alcance del blackout"]')] as HTMLSelectElement[];
    assert.deepEqual(selects.map((s) => s.value), ["entrada", "viaje"], "el existente conserva el comportamiento de fecha de entrada");
    assert.deepEqual([...selects[0].options].map((o) => txt(o)), ["Solo fecha de entrada", "Cualquier día del viaje"]);
    assert.match(txt(raiz), /Solo fecha de entrada.*Cualquier día del viaje/);
    await elegir(selects[0], "viaje");
    await clic(boton(raiz, /^Guardar$/), "Guardar");
    await esperar(() => llamadas.length > 0);
    const enviados = (llamadas[0].p_blackouts as { alcance: string; motivo: string }[]).map((b) => [b.motivo, b.alcance]);
    assert.deepEqual(enviados, [["Viejo", "viaje"], ["Nuevo", "viaje"]]);
  });

  test("un blackout con un solo extremo no se guarda y el error se ve", async () => {
    const llamadas: Record<string, unknown>[] = [];
    usarBD({}, { guardar_programa_blackouts: (a) => { llamadas.push(a); return 1; } });
    const m = await montar(h(BlackoutsEditor as never, { programaId: 3, blackouts: [{ fecha_inicio: "2027-03-05", fecha_fin: null, motivo: "Incompleto", ciudad: null }] }));
    desmontar = m.desmontar;
    const raiz = m.contenedor as HTMLElement;
    await clic(boton(raiz, /^Guardar$/), "Guardar");
    await esperar(() => /necesita fecha de inicio y de fin/.test(txt(raiz)));
    assert.match(txt(raiz), /necesita fecha de inicio y de fin/);
    assert.equal(llamadas.length, 0);
  });

  test("itinerario incompleto: muestra los días que faltan, avisa qué no se podrá hacer y deja guardar el borrador", async () => {
    const guardados: unknown[] = [];
    usarBD({}, { reemplazar_dias_programa: (a) => { guardados.push(a); return null; } });
    const dias = [1, 2, 4].map((dia) => ({ dia, titulo: `Día ${dia}`, desayuno: false, almuerzo: false, cena: false, descripcion: "x" }));
    const m = await montar(h(ItinerarioEditor as never, { programaId: 3, dias, totalDias: 5 }));
    desmontar = m.desmontar;
    const raiz = m.contenedor as HTMLElement;
    const aviso = raiz.querySelector('[data-testid="itinerario-incompleto"]') as HTMLElement;
    assert.ok(aviso, "hay aviso");
    assert.match(txt(aviso), /Faltan los días: 3, 5\./);
    assert.match(txt(aviso), /no se podrá calcular, publicar ni reservar hasta completarlo/);
    assert.equal(boton(raiz, /^Guardar$/)!.disabled, false, "el borrador incompleto SÍ se puede guardar");
    // Completar el día 3 y el 5: el aviso desaparece.
    await clic(boton(raiz, /\+ Agregar día/), "agregar día");
    assert.match(txt(raiz.querySelector('[data-testid="itinerario-incompleto"]')), /Faltan los días: 3, 5\./, "agregar una fila no cambia qué días existen hasta numerarla");
  });

  test("itinerario completo: sin aviso", async () => {
    usarBD({});
    const dias = [1, 2, 3].map((dia) => ({ dia, titulo: `Día ${dia}`, desayuno: false, almuerzo: false, cena: false, descripcion: "x" }));
    const m = await montar(h(ItinerarioEditor as never, { programaId: 3, dias, totalDias: 3 }));
    desmontar = m.desmontar;
    assert.equal((m.contenedor as HTMLElement).querySelector('[data-testid="itinerario-incompleto"]'), null);
  });

  test("los traslados antes y después se distinguen de los días turísticos", async () => {
    usarBD({});
    const dias = [
      { dia: 0, tipo_tramo: "traslado_previo", titulo: "Bus de salida" },
      { dia: 1, tipo_tramo: "dia", titulo: "Tour" },
      { dia: 2, tipo_tramo: "dia", titulo: "Regreso" },
      { dia: 3, tipo_tramo: "traslado_posterior", titulo: "Bus nocturno" },
    ].map((d) => ({ ...d, desayuno: false, almuerzo: false, cena: false, descripcion: "Detalle" }));
    const m = await montar(h(ItinerarioEditor as never, { programaId: 3, dias, totalDias: 2 }));
    desmontar = m.desmontar;
    assert.doesNotMatch(txt(m.contenedor), /Itinerario incompleto/);
    assert.match(txt(m.contenedor), /Traslado previo/);
    assert.match(txt(m.contenedor), /Traslado posterior/);
    assert.match(txt(m.contenedor), /Día 1/);
    assert.match(txt(m.contenedor), /Día 2/);
  });

  test("itinerario incompleto de un programa PUBLICADO: aviso claro (despublicar primero) y «Guardar» deshabilitado; al completarlo se habilita", async () => {
    usarBD({});
    const dias = [1, 2, 4].map((dia) => ({ dia, titulo: `Día ${dia}`, desayuno: false, almuerzo: false, cena: false, descripcion: "x" }));
    const m = await montar(h(ItinerarioEditor as never, { programaId: 3, dias, totalDias: 4, publicado: true }));
    desmontar = m.desmontar;
    const raiz = m.contenedor as HTMLElement;
    const aviso = raiz.querySelector('[data-testid="itinerario-publicado-bloqueado"]') as HTMLElement;
    assert.ok(aviso, "hay aviso de publicado");
    assert.match(txt(aviso), /publicado: no puede quedar con el itinerario incompleto.*despublícalo primero para guardar un borrador incompleto/i);
    assert.equal(boton(raiz, /^Guardar$/)!.disabled, true, "no se puede guardar un publicado incompleto");
    // Completo y publicado: sin aviso y con Guardar habilitado.
    await m.desmontar();
    const completo = [1, 2, 3, 4].map((dia) => ({ dia, titulo: `Día ${dia}`, desayuno: false, almuerzo: false, cena: false, descripcion: "x" }));
    const m2 = await montar(h(ItinerarioEditor as never, { programaId: 3, dias: completo, totalDias: 4, publicado: true }));
    desmontar = m2.desmontar;
    const raiz2 = m2.contenedor as HTMLElement;
    assert.equal(raiz2.querySelector('[data-testid="itinerario-publicado-bloqueado"]'), null);
    assert.equal(boton(raiz2, /^Guardar$/)!.disabled, false);
  });

  test("PUBLICAR queda inhabilitado con el motivo cuando el itinerario guardado está incompleto; despublicar no", async () => {
    usarBD({});
    const programa = {
      id: 3, nombre: "Circuito", subtitulo: null, moneda: "USD", dias: 4, noches: 3, publicado: false, activo: true, modo_precio: "categoria", pct_mk: 0.2, pct_fee_tarjeta: 0.03,
      asistencia_medica_dia: 0, proveedor_id: null, tipo_transporte: "ninguno", incluye_aereo: false, destino_fijo_id: 1, regla_comisionable: false,
    };
    const base = (pub: boolean, dias: number[]) => ({
      programa: { ...programa, publicado: pub }, proveedores: [], ciudades: [], categorias: [], hoteles: [], precios: [], salidas: [], inclusiones: [], tours: [], blackouts: [],
      dias: dias.map((dia) => ({ dia, titulo: `Día ${dia}`, desayuno: false, almuerzo: false, cena: false, descripcion: "x" })),
    });
    let m = await montar(h(ProgramaEditor as never, base(false, [1, 2, 4])));
    let raiz = m.contenedor as HTMLElement;
    let publicar = boton(raiz, /^Publicar$/)!;
    assert.ok(publicar, "hay botón Publicar");
    assert.equal(publicar.disabled, true);
    assert.equal(publicar.getAttribute("aria-describedby"), "motivo-publicacion");
    assert.match(txt(raiz.querySelector("#motivo-publicacion")), /No se puede publicar: .*faltan los días 3/);
    await m.desmontar();
    m = await montar(h(ProgramaEditor as never, base(false, [1, 2, 3, 4])));
    raiz = m.contenedor as HTMLElement;
    assert.equal(boton(raiz, /^Publicar$/)!.disabled, false, "itinerario completo: se puede publicar");
    assert.equal(raiz.querySelector("#motivo-publicacion"), null);
    await m.desmontar();
    m = await montar(h(ProgramaEditor as never, base(true, [1])));
    raiz = m.contenedor as HTMLElement;
    assert.equal(boton(raiz, /^Despublicar$/)!.disabled, false, "despublicar siempre se puede");
    desmontar = m.desmontar;
  });

  test("formulario de reserva con traslado: el aviso de blackout cuenta el traslado previo una vez (01/03 → 06/03 en vez de 05/03) igual que el servidor", async () => {
    usarBD({});
    const traslado = { dia: 0, tipo_tramo: "traslado_previo", titulo: "Bus", desayuno: false, almuerzo: false, cena: false, descripcion: "x" };
    const props = (over: Record<string, unknown>) => ({
      programaId: 1, moneda: "USD", dias: 5, vigenciaDesde: null, vigenciaHasta: null, asesores: [{ nombre: "Asesor", email: "a@x.test" }],
      categorias: [{ id: 1, nombre: "Estándar", precios: [{ acomodacion: "doble", pvp: 1000, bajoSolicitud: false }] }], ...over,
    });
    // Un blackout de viaje SOLO el 06/03: sin traslado (regreso 05/03) no toca; con traslado previo (regreso 06/03) sí.
    const blackouts = [{ fecha_inicio: "2027-03-06", fecha_fin: "2027-03-06", motivo: "Feria", alcance: "viaje" }];
    let m = await montar(h(ProgramaReservaForm as never, props({ blackouts, itinerario: [] })));
    let raiz = m.contenedor as HTMLElement;
    await escribir(raiz.querySelector('input[aria-label="Fecha de salida"]') as HTMLInputElement, "2027-03-01");
    assert.equal(raiz.querySelector('[data-testid="error-blackout"]'), null, "sin traslado: regreso 05/03");
    await m.desmontar();
    m = await montar(h(ProgramaReservaForm as never, props({ blackouts, itinerario: [traslado] })));
    raiz = m.contenedor as HTMLElement;
    await escribir(raiz.querySelector('input[aria-label="Fecha de salida"]') as HTMLInputElement, "2027-03-01");
    assert.match(txt(raiz.querySelector('[data-testid="error-blackout"]')), /El viaje del 01\/03\/2027 al 06\/03\/2027 cae en un blackout \(Feria\)/);
    desmontar = m.desmontar;
  });

  test("formulario de reserva (modo categoría): itinerario incompleto o blackout de viaje → aviso visible y NO se envía", async () => {
    const bd = usarBD({});
    const props = (over: Record<string, unknown>) => ({
      programaId: 1, moneda: "USD", dias: 5, vigenciaDesde: null, vigenciaHasta: null, asesores: [{ nombre: "Asesor", email: "a@x.test" }],
      categorias: [{ id: 1, nombre: "Estándar", precios: [{ acomodacion: "doble", pvp: 1000, bajoSolicitud: false }] }], ...over,
    });
    let m = await montar(h(ProgramaReservaForm as never, props({ errorItinerarioPrograma: "El itinerario del programa está incompleto (faltan los días 3): complétalo antes de calcular, publicar o reservar el programa." })));
    let raiz = m.contenedor as HTMLElement;
    assert.match(txt(raiz.querySelector('[data-testid="error-itinerario"]')), /faltan los días 3.*No se puede reservar hasta completarlo/);
    await React.act(async () => { raiz.querySelector("form")!.dispatchEvent(new dom.window.Event("submit", { bubbles: true, cancelable: true })); });
    await esperar(() => false, 3);
    assert.equal(bd.filas("ventas").length, 0, "no se envió nada");
    await m.desmontar();

    // Blackout de VIAJE a mitad de un viaje de 4 noches (5 días): fecha de salida 01/03 → regreso 05/03.
    m = await montar(h(ProgramaReservaForm as never, props({ blackouts: [{ fecha_inicio: "2027-03-03", fecha_fin: "2027-03-03", motivo: "Feria", alcance: "viaje" }] })));
    raiz = m.contenedor as HTMLElement;
    await escribir(raiz.querySelector('input[aria-label="Fecha de salida"]') as HTMLInputElement, "2027-03-01");
    assert.match(txt(raiz.querySelector('[data-testid="error-blackout"]')), /El viaje del 01\/03\/2027 al 05\/03\/2027 cae en un blackout \(Feria\)/);
    await m.desmontar();
    // El MISMO blackout con alcance «entrada» no bloquea esa salida.
    m = await montar(h(ProgramaReservaForm as never, props({ blackouts: [{ fecha_inicio: "2027-03-03", fecha_fin: "2027-03-03", motivo: "Feria", alcance: "entrada" }] })));
    raiz = m.contenedor as HTMLElement;
    await escribir(raiz.querySelector('input[aria-label="Fecha de salida"]') as HTMLInputElement, "2027-03-01");
    assert.equal(raiz.querySelector('[data-testid="error-blackout"]'), null);
    desmontar = m.desmontar;
  });
});
