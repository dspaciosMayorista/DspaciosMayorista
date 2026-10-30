// Se ejecuta con npm run test:react (loader del arnés + jsdom). NO entra en test:unit.
//
// #88 — El FORMULARIO de reserva de un programa por hotel y vigencia, de punta a punta contra la
// Server Action REAL y la BD en memoria del arnés:
//   · el usuario elige hotel, servicios, fecha de entrada y noches adicionales; ve las fechas
//     exactas, la vigencia y el valor de CADA noche, el itinerario con los días libres y el total;
//   · lo que se confirma es EXACTAMENTE el total mostrado (el servidor lo recalcula y debe coincidir);
//   · si la tarifa cambia entre la vista previa y la confirmación NO se crea nada hasta aceptar el
//     nuevo importe de forma expresa;
//   · sin vigencia/tarifa, o con una selección inválida, se avisa y no se envía;
//   · los modos de siempre (sin `hoteles`) no muestran nada de esto.
import { montar, clic, escribir, enviar, esperar, usarBD, dom, MOMENTOS, reloj, soltarReloj } from "./support/fechaNegocioArnes.ts";
import { test, describe, afterEach, beforeEach, after } from "node:test";
import assert from "node:assert/strict";

process.env.SUPABASE_SERVICE_ROLE_KEY ??= "clave-de-prueba";

const React = await import("react");
const { ProgramaReservaForm } = await import("../app/(dashboard)/dashboard/reservar/programa/[id]/ProgramaReservaForm.tsx");
const { cargarTablasPvp88 } = await import("../lib/programas/estanciaHotelDatos88.ts");
const h = React.createElement;

type Fila = Record<string, unknown>;
const txt = (el: Element | null | undefined) => (el?.textContent ?? "").replace(/\s+/g, " ").trim();

const programa: Fila = {
  id: 3, nombre: "Caribe terrestre", subtitulo: "Cartagena", moneda: "USD", pct_mk: 0.15, pct_fee_tarjeta: 0.03,
  asistencia_medica_dia: 4, modo_precio: "hotel", dias: 4, noches: 3, proveedor_id: 9, proveedor_asistencia_id: 55, tipo_transporte: "ninguno", incluye_aereo: false,
  vigencia_desde: null, vigencia_hasta: null, edad_nino_min: 2, edad_nino_max: 11, edad_infante_max: 1,
  condicion_pago_tipo: "anticipo_saldo", condicion_pago_pct_inicial: 0.3, condicion_pago_dias_saldo: 30, restriccion_comercial: "normal",
  regla_comisionable: false, regla_comisionable_modalidad_mk: "historica", regla_comisionable_modo: "pct",
  regla_comisionable_valor: 0, regla_comisionable_pct_comision: 0, regla_comisionable_impuesto_por_acomodacion: false,
  proveedores: { nombre: "Operador Andes", aplica_retencion: false, pct_retencion: 0 }, programa_destinos_fijos: null,
};
const DIAS = [
  { programa_id: 3, dia: 1, titulo: "Llegada", desayuno: false, almuerzo: false, cena: true, descripcion: "Traslado al hotel" },
  { programa_id: 3, dia: 2, titulo: "Tour ciudad", desayuno: true, almuerzo: true, cena: false, descripcion: "Tour de ciudad" },
  { programa_id: 3, dia: 3, titulo: "Playa", desayuno: true, almuerzo: false, cena: false, descripcion: "Día de playa" },
  { programa_id: 3, dia: 4, titulo: "Salida", desayuno: true, almuerzo: false, cena: false, descripcion: "Traslado al aeropuerto" },
];
const semilla = (): Record<string, Fila[]> => ({
  programas: [{ ...programa }], programa_salidas: [], programa_categorias: [], programa_precios: [],
  programa_hoteles: [{ id: 1, programa_id: 3, orden: 0, nombre: "Hotel Centro", zona: "Centro", tipo_habitacion: "Estándar", max_pax_habitacion: 4, max_menores_habitacion: 2, proveedor_id: null }],
  programa_hotel_precios: [
    { id: 1, hotel_id: 1, desde: "2027-03-01", hasta: "2027-03-31", modalidad_servicios: "privado", bajo_solicitud: false, neto_sencilla: 800, neto_doble: 600, neto_triple: 520, neto_multiple: null, neto_nino: 400 },
    { id: 2, hotel_id: 1, desde: "2027-03-01", hasta: "2027-03-31", modalidad_servicios: "regular", bajo_solicitud: false, neto_sencilla: null, neto_doble: 450, neto_triple: null, neto_multiple: null, neto_nino: null },
  ],
  programa_hotel_noches: [
    { id: 1, hotel_id: 1, desde: "2027-03-01", hasta: "2027-03-04", unidad_cobro: "persona", neto_sencilla: 130, neto_doble: 100, neto_triple: 90, neto_multiple: null, neto_nino: 60 },
    { id: 2, hotel_id: 1, desde: "2027-03-05", hasta: "2027-03-31", unidad_cobro: "persona", neto_sencilla: 150, neto_doble: 120, neto_triple: 100, neto_multiple: null, neto_nino: 70 },
  ],
  aliados: [
    { id: 5, nombre: "Viajes Sol", tipo: "agencia", pct_comision: 0.1, activo: true, nit: "900123456", tipo_documento: "NIT", telefono: null, email: null, direccion: null },
    { id: 6, nombre: "Freelance Luna", tipo: "freelance", pct_comision: 0.08, activo: true, nit: "52111222", tipo_documento: "CC", telefono: null, email: null, direccion: null },
  ],
  usuarios: [{ id: "u-arnes", rol: "venta", activo: true, tenant: "mayorista" }],
  programa_dias: DIAS, proveedores: [{ id: 9, nombre: "Operador Andes", aplica_retencion: false, pct_retencion: 0 }, { id: 55, nombre: "Asistencia Global", aplica_retencion: false, pct_retencion: 0 }],
});
const RPCS = { congelar_condiciones_contrato: () => "OK", crear_pasajeros_contrato: () => [], registrar_comision_b2b_reserva: () => 501 };
const ALIADOS_UI = [
  { id: 5, nombre: "Viajes Sol", tipo: "agencia" as const, pct: 0.1, pctOrigen: "aliado" as const },
  { id: 6, nombre: "Freelance Luna", tipo: "freelance" as const, pct: 0.08, pctOrigen: "aliado" as const },
];

let desmontar: (() => Promise<void>) | undefined;
beforeEach(() => reloj(MOMENTOS[0][1]));
afterEach(async () => { await desmontar?.(); desmontar = undefined; soltarReloj(); });
after(() => dom.window.close());

async function montarForm(over: Fila = {}) {
  const bd = usarBD(semilla(), RPCS);
  const r = await cargarTablasPvp88(bd.sb as never, 3, programa as never);
  assert.equal(r.ok, true);
  if (!r.ok) throw new Error("tablas");
  assert.doesNotMatch(JSON.stringify(r.tablas), /neto/i);
  const m = await montar(h(ProgramaReservaForm, {
    programaId: 3, moneda: "USD", dias: 4, vigenciaDesde: null, vigenciaHasta: null,
    asesores: [{ nombre: "Asesor", email: "a@x.test" }], categorias: [],
    hoteles: r.tablas, nochesIncluidas: 3, itinerario: DIAS.map((d) => ({ dia: d.dia, titulo: d.titulo, desayuno: d.desayuno, almuerzo: d.almuerzo, cena: d.cena, descripcion: d.descripcion })), ...over,
  }));
  desmontar = m.desmontar;
  return { bd, raiz: m.contenedor as HTMLElement };
}
const porEtiqueta = (raiz: Element, a: string) => raiz.querySelector(`[aria-label="${a}"]`) as HTMLInputElement | HTMLSelectElement;
const cuadroHab = (raiz: Element, nombre: RegExp) =>
  [...raiz.querySelectorAll("div")].find((d) => nombre.test(txt(d.firstElementChild)) && d.querySelector("input[type=number]"))!.querySelector("input[type=number]") as HTMLInputElement;
const totalMostrado = (raiz: Element) => txt([...raiz.querySelectorAll("div")].find((d) => /pasajero\(s\)/.test(txt(d)) && d.children.length === 2 && /\$/.test(txt(d)))?.lastElementChild);
async function cambiar(sel: HTMLSelectElement, valor: string) {
  await React.act(async () => {
    Object.getOwnPropertyDescriptor(dom.window.HTMLSelectElement.prototype, "value")!.set!.call(sel, valor);
    sel.dispatchEvent(new dom.window.Event("change", { bubbles: true }));
  });
}
async function llenarSeleccion(raiz: HTMLElement, entrada: string, noches: string) {
  await escribir(porEtiqueta(raiz, "Fecha de entrada al hotel") as HTMLInputElement, entrada);
  await escribir(porEtiqueta(raiz, "Noches adicionales") as HTMLInputElement, noches);
  await escribir(cuadroHab(raiz, /^Doble/), "1");
}
async function llenarTrm(raiz: HTMLElement, v = "4000") { await escribir(porEtiqueta(raiz, "TRM de costos") as HTMLInputElement, v); }
async function llenarCliente(raiz: HTMLElement) {
  const inputs = [...raiz.querySelectorAll("fieldset")].find((f) => /Cliente/.test(txt(f.querySelector("legend"))))!;
  const campo = (etq: string) => [...inputs.querySelectorAll("label")].find((l) => txt(l) === etq)!.parentElement!.querySelector("input") as HTMLInputElement;
  await escribir(campo("Nombres"), "Ana");
  await escribir(campo("Apellidos"), "Ruiz");
}
const botonGenerar = (raiz: Element) => [...raiz.querySelectorAll("button")].find((b) => /Generar reserva/.test(txt(b))) as HTMLButtonElement;

describe("formulario de reserva · programa por hotel y vigencia", () => {
  test("muestra las fechas exactas, la vigencia y el valor de cada noche, el itinerario con el día libre y el total", async () => {
    const { raiz } = await montarForm();
    await llenarSeleccion(raiz, "2027-03-01", "3");
    const resumen = txt(raiz.querySelector('[aria-label="Resumen de la estancia"]'));
    assert.match(resumen, /Estancia incluida: 01\/03\/2027 a 04\/03\/2027 \(3 noches\)/);
    assert.match(resumen, /Regreso con 3 noche\(s\) adicional\(es\): 07\/03\/2027/);
    // 04/03 (vigencia A): 127 × 2; 05 y 06/03 (vigencia B): 151 × 2.
    assert.match(resumen, /04\/03\/2027\s*01\/03\/2027 — 04\/03\/2027\s*por persona\s*USD \$254/);
    assert.match(resumen, /05\/03\/2027\s*05\/03\/2027 — 31\/03\/2027\s*por persona\s*USD \$302/);
    assert.match(resumen, /Estancia incluida\s*USD \$1[.,]496/);
    assert.match(resumen, /Noches adicionales\s*USD \$858/);
    const it = txt(raiz.querySelector('[aria-label="Itinerario con las noches adicionales"]'));
    assert.match(it, /Día 3 \(03\/03\/2027\): Playa\s*Día 4 \(04\/03\/2027\): Día libre\s*Día 5 \(05\/03\/2027\): Día libre\s*Día 6 \(06\/03\/2027\): Día libre\s*Día 7 \(07\/03\/2027\): Salida/);
    assert.match(totalMostrado(raiz), /2[.,]354/);
    assert.doesNotMatch(raiz.textContent ?? "", /neto/i);
  });

  test("0 noches: sin desglose de noches; el total es el de la base", async () => {
    const { raiz } = await montarForm();
    await llenarSeleccion(raiz, "2027-03-01", "0");
    assert.match(txt(raiz.querySelector('[aria-label="Resumen de la estancia"]')), /Estancia incluida: 01\/03\/2027 a 04\/03\/2027 \(3 noches\)/);
    assert.equal(raiz.querySelector('[aria-label="Resumen de la estancia"] table'), null);
    assert.match(totalMostrado(raiz), /1[.,]496/);
  });

  test("cambiar el hotel, los servicios o la acomodación recalcula; servicios regulares usan otra base", async () => {
    const { raiz } = await montarForm();
    await llenarSeleccion(raiz, "2027-03-01", "1");
    assert.match(totalMostrado(raiz), /1[.,]750/);
    await cambiar(porEtiqueta(raiz, "Servicios") as HTMLSelectElement, "regular");
    // regulares: (450 + 16)/0.8245 → 566 × 2 + noche 254.
    assert.match(totalMostrado(raiz), /1[.,]386/);
    await escribir(porEtiqueta(raiz, "Noches adicionales") as HTMLInputElement, "2");
    assert.match(totalMostrado(raiz), /1[.,]688/);
  });

  test("fecha fuera de toda vigencia o noche sin tarifa: avisa con la fecha y no deja enviar", async () => {
    const { raiz } = await montarForm();
    await llenarSeleccion(raiz, "2027-03-29", "5"); // la noche del 01/04 no tiene tarifa
    const alerta = txt(raiz.querySelector('[role="alert"]'));
    assert.match(alerta, /No hay tarifa de noche adicional en Hotel Centro para el 01\/04\/2027/);
    await escribir(porEtiqueta(raiz, "Fecha de entrada al hotel") as HTMLInputElement, "2027-05-10");
    assert.match(txt(raiz.querySelector('[role="alert"]')), /No hay precio base de Hotel Centro con servicios privados para el 10\/05\/2027/);
  });

  test("lo que se confirma es el total mostrado: la reserva queda con ese importe, la foto del contrato y una sola CxP", async () => {
    const { raiz, bd } = await montarForm();
    await llenarSeleccion(raiz, "2027-03-01", "3");
    await llenarCliente(raiz);
    await llenarTrm(raiz);
    await enviar(raiz.querySelector("form"));
    await esperar(() => bd.filas("ventas").length > 0 || /\S/.test(txt(raiz.querySelector(".text-red-600"))));
    assert.equal(txt(raiz.querySelector(".text-red-600")), "");
    const [venta] = bd.filas("ventas");
    assert.equal(venta.precio_venta, 2354);
    assert.equal(venta.fecha_regreso, "2027-03-07");
    const [est] = bd.filas("contrato_programa_estancia");
    assert.equal(est.noches_adicionales, 3);
    assert.equal(est.precio_noches, 858);
    // Hotel/operador + asistencia de la estancia completa (4 × 7 días × 2 pax), cada una con su TRM y equivalente COP.
    const cxp = bd.filas("cuentas_por_pagar");
    assert.equal(cxp.length, 2);
    assert.equal(cxp.find((c) => c.tipo_proveedor === "asistencia")?.valor_total, 56);
    assert.ok(cxp.every((c) => c.moneda === "USD" && c.trm_costo === 4000 && c.valor_cop_costo === Number(c.valor_total) * 4000));
  });

  test("si la tarifa cambia entre la vista previa y la confirmación: aviso, nada se crea y solo aceptar el nuevo importe reserva", async () => {
    const { raiz, bd } = await montarForm();
    await llenarSeleccion(raiz, "2027-03-01", "1");
    await llenarCliente(raiz);
    await llenarTrm(raiz);
    assert.match(totalMostrado(raiz), /1[.,]750/);
    bd.filas("programa_hotel_noches")[0].neto_doble = 110; // la noche sube a 139 por persona
    await enviar(raiz.querySelector("form"));
    await esperar(() => /El precio de la reserva cambió/.test(txt(raiz)));
    assert.match(txt(raiz.querySelector('[role="alert"]')), /Habías confirmado USD \$1[.,]750\. Importe actual: USD \$1[.,]774/);
    assert.equal(bd.filas("ventas").length, 0, "no se creó ningún contrato");
    assert.equal(bd.filas("contrato_programa_estancia").length, 0);
    assert.equal(botonGenerar(raiz).disabled, true, "mientras hay un cambio pendiente no se reenvía el importe viejo");
    const aceptar = [...raiz.querySelectorAll("button")].find((b) => /Aceptar USD \$1[.,]774/.test(txt(b)));
    await clic(aceptar, "aceptar el nuevo importe");
    await esperar(() => bd.filas("ventas").length > 0);
    assert.equal(bd.filas("ventas")[0].precio_venta, 1774);
  });

  test("USD sin TRM de costos: avisa y no envía; con itinerario incompleto y noches adicionales tampoco", async () => {
    const { raiz, bd } = await montarForm();
    await llenarSeleccion(raiz, "2027-03-01", "1");
    await llenarCliente(raiz);
    await enviar(raiz.querySelector("form"));
    await esperar(() => false, 3);
    assert.equal(bd.filas("ventas").length, 0);
    assert.match(txt(raiz), /TRM/);
    await desmontar?.();
    const m2 = await montarForm({ itinerario: [] });
    await llenarSeleccion(m2.raiz, "2027-03-01", "1");
    assert.match(txt(m2.raiz.querySelector('[role="alert"]')), /itinerario/i);
  });

  test("si el programa tiene días y noches incoherentes: avisa y no deja enviar", async () => {
    const { raiz, bd } = await montarForm({ nochesIncluidas: null, errorPrograma: "Revisa los días y noches del programa: 4 días corresponden a 3 noches y figuran 5." });
    await escribir(porEtiqueta(raiz, "Fecha de entrada al hotel") as HTMLInputElement, "2027-03-01");
    assert.match(txt(raiz.querySelector('[role="alert"]')), /Revisa los días y noches del programa/);
    await llenarCliente(raiz);
    await enviar(raiz.querySelector("form"));
    await esperar(() => false, 3);
    assert.equal(bd.filas("ventas").length, 0);
  });

  test("un programa de los modos de siempre (sin hoteles) no muestra nada de esto", async () => {
    usarBD({}, RPCS);
    const m = await montar(h(ProgramaReservaForm, {
      programaId: 1, moneda: "USD", dias: 5, vigenciaDesde: null, vigenciaHasta: null, asesores: [{ nombre: "Asesor", email: "a@x.test" }],
      categorias: [{ id: 1, nombre: "Estándar", precios: [{ acomodacion: "doble", pvp: 1000, bajoSolicitud: false }] }],
    }));
    desmontar = m.desmontar;
    assert.equal(m.contenedor.querySelector('[aria-label="Noches adicionales"]'), null);
    assert.equal(m.contenedor.querySelector('[aria-label="Hotel"]'), null);
    assert.match(txt(m.contenedor), /Categoría \(hoteles\)/);
  });

  // ── PR #409 — B2B: elección expresa PVP o NETO ───────────────────────────────
  const radio = (raiz: Element, etiqueta: string) =>
    [...raiz.querySelectorAll('input[type="radio"]')].find((r) => new RegExp(etiqueta).test(txt(r.closest("label")))) as HTMLInputElement;
  async function elegirTipo(raiz: HTMLElement, tipo: RegExp) {
    await clic(radio(raiz, tipo.source), "tipo de venta");
  }
  async function esperarReal(listo: () => boolean, ms = 4000) {
    for (let t = 0; t < ms && !listo(); t += 50) await React.act(async () => { await new Promise((r) => setTimeout(r, 50)); });
  }
  const esperarTerminos = (raiz: Element) => esperarReal(() => !!raiz.querySelector('[data-testid="terminos-b2b-previa"]'));

  test("B2B: sin modalidad elegida no se genera; elegir PVP o NETO muestra base comisionable, impuesto, % y comisión, y NETO cambia el total exigible", async () => {
    const { raiz, bd } = await montarForm({ aliados: ALIADOS_UI });
    await llenarSeleccion(raiz, "2027-03-01", "0");
    await llenarCliente(raiz);
    await elegirTipo(raiz, /Agencia \(B2B\)/);
    assert.equal(radio(raiz, "PVP").checked || radio(raiz, "NETO").checked, false, "no hay modalidad por defecto");
    await cambiar(raiz.querySelector("#aliado-b2b") as HTMLSelectElement, "5");
    assert.match(txt(raiz), /Comisión 10 % · porcentaje propio del aliado/);
    await enviar(raiz.querySelector("form"));
    await esperar(() => false, 3);
    assert.match(txt(raiz), /Elige si el contrato se genera a PVP o a NETO/);
    assert.equal(bd.filas("ventas").length, 0, "nada se creó");

    await clic(radio(raiz, "PVP"), "PVP");
    await esperarTerminos(raiz);
    const pvp = txt(raiz.querySelector('[data-testid="terminos-b2b-previa"]')) || `SIN PANEL: ${[...raiz.querySelectorAll("[role=status]")].map(txt).join(" | ")}`;
    assert.match(pvp, /Base comisionable/);
    assert.match(pvp, /Impuesto no comisionable/);
    assert.match(pvp, /10 %/);
    assert.match(pvp, /Comisión/);
    assert.match(pvp, /Viajes Sol/);
    assert.match(pvp, /1[.,]496/, "PVP 748 × 2 pax");
    await clic(radio(raiz, "NETO"), "NETO");
    await esperarReal(() => /Total exigible \(NETO\)/.test(txt(raiz.querySelector('[data-testid="terminos-b2b-previa"]'))));
    const neto = txt(raiz.querySelector('[data-testid="terminos-b2b-previa"]'));
    assert.match(neto, /Total exigible \(NETO\)/);
    assert.match(neto, /1[.,]346/, "1.496 − 10 % de comisión (150) = 1.346");
    assert.equal(bd.filas("ventas").length, 0, "la vista previa no creó nada");
    assert.equal(bd.llamadasRpc.filter((c) => c.fn === "registrar_comision_b2b_reserva").length, 0);
  });

  test("copiar datos del cliente: solo UN pasajero a la vez; los demás quedan inhabilitados y deshacer los habilita", async () => {
    const { raiz } = await montarForm();
    await llenarSeleccion(raiz, "2027-03-01", "0");
    await llenarCliente(raiz);
    const botones = () => [...raiz.querySelectorAll("button")].filter((b) => /Copiar del cliente|Deshacer copia/.test(txt(b))) as HTMLButtonElement[];
    assert.equal(botones().length, 2, "una doble = 2 pasajeros");
    assert.deepEqual(botones().map((b) => b.disabled), [false, false]);
    await clic(botones()[0], "copiar en el pasajero 1");
    assert.equal(txt(botones()[0]), "Deshacer copia");
    assert.equal(botones()[1].disabled, true, "el segundo pasajero ya no puede recibir la copia");
    assert.match(botones()[1].title, /ya se copiaron en el pasajero 1/);
    await clic(botones()[1], "intento sobre el pasajero 2");
    assert.equal(txt(botones()[0]), "Deshacer copia", "el intento no hizo nada");
    await clic(botones()[0], "deshacer");
    assert.deepEqual(botones().map((b) => b.disabled), [false, false]);
    assert.equal(txt(botones()[0]), "Copiar del cliente");
  });

  test("recorrido #409 con un hotel de máximo 2 por habitación: el editor no guarda Triple, la ficha pública no publica filas antiguas y la reserva rechaza antes de numerar", async () => {
    const { guardarHoteles } = await import("../app/(dashboard)/dashboard/producto/programas/actions.ts");
    const { reservarPrograma } = await import("../app/(dashboard)/dashboard/reservar/actions.ts");
    const netos = (o: Record<string, string> = {}) => ({ sencilla: "", doble: "", triple: "", multiple: "", nino: "", ...o });

    // 1) editor → guardado: la Server Action rechaza la tarifa Triple antes de llamar a la base.
    const llamadas: Record<string, unknown>[] = [];
    usarBD(semilla(), { ...RPCS, guardar_programa_hoteles: (a) => { llamadas.push(a); return null; } });
    const guardado = await guardarHoteles(3, [{
      id: 1, nombre: "Hotel Centro", zona: "", tipoHabitacion: "", maxPaxHabitacion: "2", maxMenoresHabitacion: "2", proveedorId: null,
      base: [{ desde: "2027-03-01", hasta: "2027-03-31", modalidad: "privado", bajoSolicitud: false, neto: netos({ doble: "600", triple: "520" }) }],
      noches: [],
    }]);
    assert.equal(guardado.ok, false);
    assert.match(guardado.ok ? "" : guardado.error, /Triple.*máximo 2 persona/);
    assert.equal(llamadas.length, 0);

    // 2) ficha pública: filas ANTIGUAS con Triple (guardadas cuando el hotel admitía 4) no se publican ahora que admite 2.
    const sem = semilla();
    (sem.programa_hoteles[0] as Fila).max_pax_habitacion = 2;
    const bd = usarBD(sem, RPCS);
    const t = await cargarTablasPvp88(bd.sb as never, 3, programa as never);
    assert.equal(t.ok, true);
    if (!t.ok) return;
    const tabla = t.tablas[0];
    assert.ok(tabla.base.every((b) => b.pvp.triple == null && b.pvp.multiple == null), "base sin Triple/Múltiple");
    assert.ok(tabla.noches.every((n) => n.pvp.triple == null), "noches sin Triple");
    assert.ok(tabla.base.some((b) => b.pvp.doble != null), "lo compatible sigue publicado");

    // 3) reserva: una triple + una sencilla (4 ocupantes en 2 habitaciones) no pasa con máximo 2, y no se crea nada.
    const r = await reservarPrograma({
      programaId: 3, categoriaId: 0, estancia: { hotelId: 1, modalidad: "privado", nochesAdicionales: 0 }, fechaIda: "2027-03-01",
      paxPorAcom: { triple: 1, sencilla: 1 }, ninos: 0,
      cliente: { nombres: "Ana", apellidos: "Ruiz", tipoDoc: "CC", numeroDoc: "1010", telefono: "300", email: "" },
      tipoAsesor: "interno", asesorInterno: "Asesor", agenciaNombre: "", agenciaAsesor: "", freelanceNombre: "", plazo: "", pasajeros: [], precioConfirmado: 1,
    } as never);
    assert.equal(r.ok, false);
    assert.match(r.ok ? "" : r.error, /máximo 2 persona/);
    assert.equal(bd.filas("ventas").length, 0, "rechazada antes de numerar y de toda escritura");
  });
});
