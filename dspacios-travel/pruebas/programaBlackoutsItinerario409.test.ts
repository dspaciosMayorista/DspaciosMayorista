// PR #409 — el SERVIDOR (no solo la pantalla) exige el itinerario 1..N y aplica los blackouts con alcance: reserva directa, publicación, guardado de blackouts.
// Contra la BD en memoria del arnés, con fallos de lectura inyectados. Cada rechazo ocurre ANTES de numerar y de toda escritura.
import { DIA_BOGOTA, MOMENTOS, reloj, soltarReloj, usarBD } from "./support/fechaNegocioArnes.ts";
import { test, afterEach, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

process.env.SUPABASE_SERVICE_ROLE_KEY ??= "clave-de-prueba";
void DIA_BOGOTA;

const { reservarPrograma } = await import("../app/(dashboard)/dashboard/reservar/actions.ts");
const { setPublicado, guardarBlackouts } = await import("../app/(dashboard)/dashboard/producto/programas/actions.ts");
const { getProgramaDetalle } = await import("../lib/programas.ts");
const { totalDesdePrecios } = await import("../lib/programas/precioReserva57.ts");

type Fila = Record<string, unknown>;
beforeEach(() => reloj(MOMENTOS[0][1]));
afterEach(() => soltarReloj());

// Programa por SALIDA de 8 días (7 noches → el viaje del 01/03 regresa el 08/03).
const programa = (over: Fila = {}): Fila => ({
  id: 3, nombre: "Circuito Andino", subtitulo: null, moneda: "USD", pct_mk: 0.15, pct_fee_tarjeta: 0.03,
  asistencia_medica_dia: 4, modo_precio: "salida", dias: 8, noches: 7, proveedor_id: 9, publicado: false,
  vigencia_desde: null, vigencia_hasta: null, edad_nino_min: 2, edad_nino_max: 11, edad_infante_max: 1,
  condicion_pago_tipo: "anticipo_saldo", condicion_pago_pct_inicial: 0.3, condicion_pago_dias_saldo: 30, restriccion_comercial: "normal",
  regla_comisionable: false, regla_comisionable_modalidad_mk: "historica", regla_comisionable_modo: "pct",
  regla_comisionable_valor: 0, regla_comisionable_pct_comision: 0, regla_comisionable_impuesto_por_acomodacion: false,
  proveedores: { nombre: "Operador Andes", aplica_retencion: false, pct_retencion: 0 }, programa_destinos_fijos: null, ...over,
});
const salida = (): Fila => ({
  id: 11, programa_id: 3, orden: 0, etiqueta: "Marzo", fecha_desde: "2027-03-01", fecha_hasta: "2027-03-08", noches: null, columna: null, bajo_solicitud: false,
  neto_sencilla: 1400, neto_doble: 1000, neto_triple: 900, neto_multiple: null, neto_nino: 700,
  tarifa_sencilla: null, tarifa_doble: null, tarifa_triple: null, tarifa_multiple: null, impuesto_sencilla: null, impuesto_doble: null, impuesto_triple: null, impuesto_multiple: null,
});
const dias = (...n: number[]): Fila[] => n.map((dia) => ({ programa_id: 3, dia, titulo: `Día ${dia}`, desayuno: false, almuerzo: false, cena: false, descripcion: "x" }));
const COMPLETO = dias(1, 2, 3, 4, 5, 6, 7, 8);
const semilla = (extra: Record<string, Fila[]> = {}) => ({
  programas: [programa()], programa_salidas: [salida()], programa_categorias: [], programa_precios: [], programa_dias: COMPLETO, programa_blackouts: [], ...extra,
});
const RPCS = { congelar_condiciones_contrato: () => "OK" };
const entrada = (precioConfirmado: number) => ({
  programaId: 3, categoriaId: 11, salidaId: 11, fechaIda: "2027-03-01", paxPorAcom: { doble: 1 }, ninos: 0,
  cliente: { nombres: "Ana", apellidos: "Ruiz", tipoDoc: "CC", numeroDoc: "1010", telefono: "300", email: "" },
  tipoAsesor: "interno" as const, asesorInterno: "Asesor", agenciaNombre: "", agenciaAsesor: "", freelanceNombre: "",
  plazo: "2027-02-01", pasajeros: [] as never[], precioConfirmado,
});
async function precio(bd: ReturnType<typeof usarBD>): Promise<number> {
  const det = await getProgramaDetalle(bd.sb as never, 3);
  assert.ok(det);
  const p = det!.salidas[0].precios;
  return totalDesdePrecios({ adultos: p.filter((x) => x.acomodacion !== "nino" && x.pvp != null).map((x) => ({ acomodacion: x.acomodacion, pvp: x.pvp })), precioNino: null, habitaciones: { doble: 1 }, ninos: 0 });
}
/** Hace que cualquier lectura de `tabla` falle (error técnico de Supabase). */
function fallarLectura(tabla: string) {
  const g = globalThis as unknown as { __arnesFechas: { sb: { from: (t: string) => unknown } } };
  const real = g.__arnesFechas.sb;
  const falla: Record<string, unknown> = {};
  Object.assign(falla, {
    eq: () => falla, order: () => falla, maybeSingle: () => falla, in: () => falla, single: () => falla,
    then: (res: (v: unknown) => unknown) => res({ data: null, error: { message: "fallo inyectado de lectura" } }),
  });
  g.__arnesFechas.sb = new Proxy(real, {
    get(t, p, r) {
      if (p === "from") return (n: string) => (n === tabla ? { select: () => falla } : t.from(n));
      return Reflect.get(t, p, r);
    },
  }) as never;
}
const sinEscrituras = (bd: ReturnType<typeof usarBD>) => {
  for (const t of ["ventas", "contrato_items", "contrato_pasajeros", "cuentas_por_pagar", "asientos_contables", "aliados_b2b"]) assert.equal(bd.filas(t).length, 0, `no debe haber escrituras en ${t}`);
};
const bo = (ini: string, fin: string, alcance?: string | null): Fila => ({ programa_id: 3, fecha_inicio: ini, fecha_fin: fin, motivo: "Feria", ...(alcance === undefined ? {} : { alcance }) });

// ── Reserva directa ──────────────────────────────────────────────────────────
test("blackout de ENTRADA: bloquea si la entrada cae dentro; uno a mitad del viaje no (y uno viejo sin alcance se comporta igual)", async () => {
  for (const [filas, ok, que] of [
    [[bo("2027-03-01", "2027-03-01", "entrada")], false, "entrada exacta"],
    [[bo("2027-03-01", "2027-03-01")], false, "viejo sin alcance, entrada exacta"],
    [[bo("2027-03-05", "2027-03-06", "entrada")], true, "mitad del viaje, alcance entrada"],
    [[bo("2027-03-05", "2027-03-06")], true, "mitad del viaje, sin alcance (viejo)"],
  ] as const) {
    const bd = usarBD(semilla({ programa_blackouts: [...filas] }), RPCS);
    const r = await reservarPrograma(entrada(await precio(bd)) as never);
    assert.equal(r.ok, ok, `${que}: ${JSON.stringify(r)}`);
    if (!ok) { assert.match(r.ok ? "" : r.error, /La fecha cae en un blackout/); sinEscrituras(bd); }
  }
});

test("blackout de VIAJE: bloquea si toca la entrada o cualquier día hasta el regreso (08/03 inclusive); pasa si termina antes o empieza después", async () => {
  for (const [ini, fin, ok, que] of [
    ["2027-02-20", "2027-02-28", true, "termina un día antes de la entrada"],
    ["2027-02-25", "2027-03-01", false, "termina el día de la entrada"],
    ["2027-03-05", "2027-03-06", false, "a mitad del viaje"],
    ["2027-03-08", "2027-03-08", false, "el día de regreso (frontera inclusiva)"],
    ["2027-03-09", "2027-03-10", true, "el día siguiente al regreso"],
  ] as const) {
    const bd = usarBD(semilla({ programa_blackouts: [bo(ini, fin, "viaje")] }), RPCS);
    const r = await reservarPrograma(entrada(await precio(bd)) as never);
    assert.equal(r.ok, ok, `${que}: ${JSON.stringify(r)}`);
    if (!ok) { assert.match(r.ok ? "" : r.error, /El viaje del 01\/03\/2027 al 08\/03\/2027 cae en un blackout/); sinEscrituras(bd); }
  }
});

test("si falla la LECTURA de blackouts NO se reserva (error técnico, nada escrito)", async () => {
  const bd = usarBD(semilla(), RPCS);
  const p = await precio(bd);
  fallarLectura("programa_blackouts");
  const r = await reservarPrograma(entrada(p) as never);
  assert.equal(r.ok, false);
  assert.doesNotMatch(r.ok ? "" : r.error, /blackout/i, "es un fallo técnico, no un rechazo comercial");
  sinEscrituras(bd);
});

// ── Itinerario ─────────────────────────────────────────────────────────────────
test("itinerario incompleto, repetido o fuera de 1..N: NO se reserva (en cualquier modo, sin noches adicionales), antes de numerar", async () => {
  for (const [filas, patron, que] of [
    [dias(1, 2, 4, 5, 6, 7, 8), /faltan los días 3/, "falta el 3"],
    [[...COMPLETO, ...dias(2)], /se repiten los días 2/, "día repetido"],
    [[...COMPLETO, ...dias(12)], /fuera de 1–8/, "día fuera de rango"],
    [[], /faltan los días 1, 2, 3, 4, 5, 6, 7, 8/, "sin itinerario"],
  ] as const) {
    const bd = usarBD(semilla({ programa_dias: [...filas] }), RPCS);
    const r = await reservarPrograma(entrada(1) as never);
    assert.equal(r.ok, false, que);
    assert.match(r.ok ? "" : r.error, patron, que);
    assert.ok(!(r as { cambioPrecio?: unknown }).cambioPrecio, `${que}: no es un cambio de precio`);
    sinEscrituras(bd);
  }
});

test("programa sin días en la cabecera: no hay itinerario que validar y no se reserva", async () => {
  const bd = usarBD(semilla({ programas: [programa({ dias: null, noches: null })] }), RPCS);
  const r = await reservarPrograma(entrada(1) as never);
  assert.equal(r.ok, false);
  assert.match(r.ok ? "" : r.error, /no tiene configurados sus días/);
  sinEscrituras(bd);
});

test("si falla la LECTURA del itinerario NO se reserva", async () => {
  const bd = usarBD(semilla(), RPCS);
  const p = await precio(bd);
  fallarLectura("programa_dias");
  const r = await reservarPrograma(entrada(p) as never);
  assert.equal(r.ok, false);
  sinEscrituras(bd);
});

// ── Publicación ────────────────────────────────────────────────────────────────
test("publicar exige el itinerario completo EN EL SERVIDOR; despublicar siempre se puede", async () => {
  const bd = usarBD(semilla({ programa_dias: dias(1, 2, 4, 5, 6, 7, 8) }), RPCS);
  const r = await setPublicado(3, true);
  assert.equal(r.ok, false);
  assert.match(r.ok ? "" : r.error, /faltan los días 3/);
  assert.equal(bd.filas("programas")[0].publicado, false, "no quedó publicado");
  const bd2 = usarBD(semilla(), RPCS);
  assert.deepEqual(await setPublicado(3, true), { ok: true, id: 3 });
  assert.equal(bd2.filas("programas")[0].publicado, true);
  const bd3 = usarBD(semilla({ programas: [programa({ publicado: true })], programa_dias: [] }), RPCS);
  assert.deepEqual(await setPublicado(3, false), { ok: true, id: 3 }, "despublicar un programa con itinerario incompleto");
  assert.equal(bd3.filas("programas")[0].publicado, false);
});

test("si falla la lectura del itinerario o de la cabecera, NO se publica (un fallo no se interpreta como «completo»)", async () => {
  for (const tabla of ["programa_dias", "programas"]) {
    const bd = usarBD(semilla(), RPCS);
    fallarLectura(tabla);
    const r = await setPublicado(3, true);
    assert.equal(r.ok, false, tabla);
    (globalThis as unknown as { __arnesFechas: { sb: unknown } }).__arnesFechas.sb = bd.sb;
    assert.equal(bd.filas("programas")[0].publicado, false, tabla);
  }
});

// ── Guardado de blackouts ────────────────────────────────────────────────────────
test("guardarBlackouts valida ANTES de llamar a la base y manda a la RPC atómica la forma exacta (alcance incluido)", async () => {
  const llamadas: Record<string, unknown>[] = [];
  const bd = usarBD(semilla({ programa_blackouts: [bo("2027-01-01", "2027-01-02", "viaje")] }), { ...RPCS, guardar_programa_blackouts: (a) => { llamadas.push(a); return 2; } });
  const invalido = await guardarBlackouts(3, [{ fechaInicio: "2027-03-01", fechaFin: "", motivo: "", ciudad: "" }]);
  assert.equal(invalido.ok, false);
  assert.equal(llamadas.length, 0, "un blackout inválido no llega a la base");
  const ok = await guardarBlackouts(3, [
    { fechaInicio: "2027-06-01", fechaFin: "2027-06-05", motivo: "Feria", ciudad: "", alcance: "viaje" },
    { fechaInicio: "2027-07-01", fechaFin: "2027-07-01", motivo: "", ciudad: "" },
    { fechaInicio: "", fechaFin: "", motivo: "", ciudad: "" },
  ]);
  assert.deepEqual(ok, { ok: true });
  assert.equal(llamadas.length, 1);
  assert.deepEqual(llamadas[0], {
    p_programa_id: 3,
    p_blackouts: [
      { fecha_inicio: "2027-06-01", fecha_fin: "2027-06-05", motivo: "Feria", ciudad: "", alcance: "viaje" },
      { fecha_inicio: "2027-07-01", fecha_fin: "2027-07-01", motivo: "", ciudad: "", alcance: "entrada" },
    ],
  });
  assert.equal(bd.filas("programa_blackouts").length, 1, "la app no tocó la tabla por su cuenta (lo hace la RPC)");
});

test("si la RPC falla, el error se devuelve y los blackouts anteriores NO se tocan (ya no hay un delete previo en la app)", async () => {
  const bd = usarBD(semilla({ programa_blackouts: [bo("2027-01-01", "2027-01-02", "viaje")] }), { ...RPCS, guardar_programa_blackouts: () => ({ __error: { message: "fallo de la base" } }) });
  const r = await guardarBlackouts(3, [{ fechaInicio: "2027-06-01", fechaFin: "2027-06-05", motivo: "", ciudad: "" }]);
  assert.equal(r.ok, false);
  assert.match(r.ok ? "" : r.error, /No se pudo guardar el cambio/);
  assert.doesNotMatch(r.ok ? "" : r.error, /fallo de la base/, "el texto crudo de la base no llega al formulario");
  assert.equal(bd.filas("programa_blackouts").length, 1);
  const src = readFileSync(new URL("../app/(dashboard)/dashboard/producto/programas/actions.ts", import.meta.url), "utf8");
  const ini = src.indexOf("export async function guardarBlackouts(");
  const cuerpo = src.slice(ini, src.indexOf("export async function", ini + 10));
  assert.doesNotMatch(cuerpo, /\.delete\(\)/, "guardarBlackouts ya no borra y luego inserta (no atómico)");
  assert.match(cuerpo, /rpc\("guardar_programa_blackouts"/);
});

// ── Entradas inválidas de blackouts: se rechazan SIN reemplazar las filas ───────────
test("blackouts inválidos (no-lista, elementos no-objeto, solo ciudad, fecha con espacios o inexistente): error claro y la RPC NO se llama", async () => {
  const llamadas: Record<string, unknown>[] = [];
  const bd = usarBD(semilla({ programa_blackouts: [bo("2027-01-01", "2027-01-02", "viaje")] }), { ...RPCS, guardar_programa_blackouts: (a) => { llamadas.push(a); return 1; } });
  const v = { fechaInicio: "2027-06-01", fechaFin: "2027-06-05", motivo: "Feria", ciudad: "" };
  for (const [entrada, patron, que] of [
    [null, /no son válidos/, "null"],
    [{ fechaInicio: "2027-06-01" }, /no son válidos/, "objeto en vez de lista"],
    [[v, null], /no son válidos/, "elemento null"],
    [[v, "texto"], /no son válidos/, "elemento de texto"],
    [[v, [v]], /no son válidos/, "elemento que es una lista"],
    [[{ ...v, fechaInicio: "", fechaFin: "", motivo: "", ciudad: "Cusco" }], /necesita fecha de inicio y de fin/, "fila con solo ciudad (no se descarta en silencio)"],
    [[{ ...v, fechaInicio: "   ", fechaFin: "", motivo: "x" }], /necesita fecha de inicio y de fin/, "fecha de solo espacios + motivo"],
    [[{ ...v, fechaInicio: " 2027-06-01" }], /fecha que no existe/, "fecha con espacios"],
    [[{ ...v, fechaInicio: "2027-02-30" }], /fecha que no existe/, "fecha inexistente"],
    [[{ ...v, alcance: "otro" }], /alcance/, "alcance desconocido"],
  ] as const) {
    const r = await guardarBlackouts(3, entrada as never);
    assert.equal(r.ok, false, que);
    assert.match(r.ok ? "" : r.error, patron, que);
  }
  assert.equal(llamadas.length, 0, "ninguna entrada inválida llega a la base");
  assert.equal(bd.filas("programa_blackouts").length, 1, "las filas anteriores siguen intactas");
  // Una fila totalmente en blanco SÍ se ignora, y la lista vacía es un guardado válido (borra a propósito).
  assert.deepEqual(await guardarBlackouts(3, [{ fechaInicio: " ", fechaFin: "", motivo: " ", ciudad: " " }]), { ok: true });
  assert.deepEqual(llamadas[0], { p_programa_id: 3, p_blackouts: [] });
});

// ── Itinerario de un programa PUBLICADO: no puede quedar incompleto ────────────────
const FILA = (dia: number) => ({ dia, titulo: `Día ${dia}`, desayuno: false, almuerzo: false, cena: false, descripcion: "x" });
const COMPLETO_UI = [1, 2, 3, 4, 5, 6, 7, 8].map(FILA);
const { guardarDias, guardarCabecera, importarDesdeTexto } = await import("../app/(dashboard)/dashboard/producto/programas/actions.ts");

test("guardarDias: un publicado con itinerario incompleto se rechaza ANTES de la RPC con mensaje claro; despublicado el borrador se guarda", async () => {
  const llamadas: Record<string, unknown>[] = [];
  const rpcs = { ...RPCS, guardar_programa_dias: (a: Record<string, unknown>) => { llamadas.push(a); return (a.p_dias as unknown[]).length; } };
  usarBD(semilla({ programas: [programa({ publicado: true })] }), rpcs);
  const r = await guardarDias(3, COMPLETO_UI.filter((d) => d.dia !== 3));
  assert.equal(r.ok, false);
  assert.match(r.ok ? "" : r.error, /publicado.*itinerario incompleto.*faltan los días 3.*Despublícalo primero/);
  assert.equal(llamadas.length, 0, "no llega a la base");
  assert.deepEqual(await guardarDias(3, COMPLETO_UI), { ok: true });
  assert.equal(llamadas.length, 1, "completo: sí");
  usarBD(semilla({ programas: [programa({ publicado: false })] }), rpcs);
  assert.deepEqual(await guardarDias(3, COMPLETO_UI.filter((d) => d.dia !== 3)), { ok: true });
  assert.equal(llamadas.length, 2, "borrador incompleto despublicado: se guarda");
});

test("guardarDias: filas inválidas (sin día pero con contenido, día 0, fraccionario, no-objeto) se rechazan sin llamar a la RPC; solo una fila en blanco se ignora", async () => {
  const llamadas: Record<string, unknown>[] = [];
  usarBD(semilla(), { ...RPCS, guardar_programa_dias: (a: Record<string, unknown>) => { llamadas.push(a); return 1; } });
  const en = (o: Record<string, unknown>) => ({ ...FILA(1), ...o });
  for (const [entrada, que] of [
    [[en({ dia: Number.NaN, titulo: "Cusco" })], "sin día pero con título"],
    [[en({ dia: 0 })], "día 0"],
    [[en({ dia: 1.5 })], "día fraccionario"],
    [[en({ dia: -2 })], "día negativo"],
    [[FILA(1), null], "elemento null"],
    [null, "no es lista"],
  ] as const) {
    const r = await guardarDias(3, entrada as never);
    assert.equal(r.ok, false, que);
  }
  assert.equal(llamadas.length, 0);
  const vacia = { dia: Number.NaN, titulo: " ", desayuno: false, almuerzo: false, cena: false, descripcion: "" };
  assert.deepEqual(await guardarDias(3, [FILA(1), vacia] as never), { ok: true });
  assert.equal((llamadas[0].p_dias as unknown[]).length, 1, "la fila en blanco no viaja");
});

test("guardarDias: si la RPC falla, el error se devuelve y la app no borra ni inserta por su cuenta", async () => {
  const bd = usarBD(semilla(), { ...RPCS, guardar_programa_dias: () => ({ __error: { message: "fallo de la base" } }) });
  const r = await guardarDias(3, COMPLETO_UI);
  assert.equal(r.ok, false);
  assert.match(r.ok ? "" : r.error, /No se pudo guardar el cambio/);
  assert.doesNotMatch(r.ok ? "" : r.error, /fallo de la base/, "el texto crudo de la base no llega al formulario");
  assert.equal(bd.filas("programa_dias").length, 8, "el itinerario anterior sigue intacto");
  const src = readFileSync(new URL("../app/(dashboard)/dashboard/producto/programas/actions.ts", import.meta.url), "utf8");
  const ini = src.indexOf("export async function guardarDias(");
  assert.doesNotMatch(src.slice(ini, src.indexOf("export async function", ini + 10)), /\.delete\(\)|\.insert\(/, "guardarDias ya no borra y luego inserta (no atómico)");
});

test("guardarCabecera: cambiar el total de días de un publicado que deja el itinerario incompleto se rechaza; despublicado pasa", async () => {
  const cab = (dias: number | null) => ({ nombre: "Circuito Andino", dias, noches: dias == null ? null : dias - 1 }) as never;
  const bd = usarBD(semilla({ programas: [programa({ publicado: true })] }), RPCS);
  const r = await guardarCabecera(3, cab(9));
  assert.equal(r.ok, false);
  assert.match(r.ok ? "" : r.error, /publicado.*faltan los días 9/);
  assert.equal(bd.filas("programas")[0].dias, 8, "el total no cambió");
  const r2 = await guardarCabecera(3, cab(5));
  assert.equal(r2.ok, false);
  assert.match(r2.ok ? "" : r2.error, /fuera de 1–5/);
  const r3 = await guardarCabecera(3, cab(null));
  assert.equal(r3.ok, false, "quitar el total de un publicado");
  usarBD(semilla({ programas: [programa({ publicado: false })] }), RPCS);
  assert.equal((await guardarCabecera(3, cab(9))).ok, true, "borrador: se puede");
});

test("importarDesdeTexto: en un publicado valida el RESULTADO (total + días) antes de escribir; el total viaja con los días en la RPC atómica", async () => {
  const llamadas: Record<string, unknown>[] = [];
  const rpcs = { ...RPCS, guardar_programa_dias: (a: Record<string, unknown>) => { llamadas.push(a); return 3; } };
  const texto3 = "3 días / 2 noches\nDía 1: Lima\nLlegada\nDía 2: Cusco\nTour\nDía 3: Regreso\nSalida";
  const texto3Salto = "3 días / 2 noches\nDía 1: Lima\nLlegada\nDía 3: Regreso\nSalida";
  const bd = usarBD(semilla({ programas: [programa({ publicado: true })] }), rpcs);
  const ok = await importarDesdeTexto(3, texto3, { itinerario: true, ruta: false, inclusiones: false, diasNoches: true });
  assert.deepEqual(ok, { ok: true });
  assert.equal(llamadas.length, 1);
  assert.equal(llamadas[0].p_total_dias, 3);
  assert.equal(bd.filas("programas")[0].dias, 8, "el total no se cambia por fuera de la RPC (lo hace ella, atómico con los días)");
  const bd2 = usarBD(semilla({ programas: [programa({ publicado: true })] }), rpcs);
  const mal = await importarDesdeTexto(3, texto3Salto, { itinerario: true, ruta: false, inclusiones: false, diasNoches: true });
  assert.equal(mal.ok, false);
  assert.match(mal.ok ? "" : mal.error, /publicado.*faltan los días 2/);
  assert.equal(llamadas.length, 1, "la RPC no se volvió a llamar");
  assert.equal(bd2.filas("programas")[0].noches, 7, "tampoco se tocó la cabecera");
  usarBD(semilla({ programas: [programa({ publicado: true })] }), rpcs);
  const soloTotal = await importarDesdeTexto(3, texto3, { itinerario: false, ruta: false, inclusiones: false, diasNoches: true });
  assert.equal(soloTotal.ok, false);
  assert.match(soloTotal.ok ? "" : soloTotal.error, /fuera de 1–3/);
  usarBD(semilla({ programas: [programa({ publicado: false })] }), rpcs);
  assert.deepEqual(await importarDesdeTexto(3, texto3Salto, { itinerario: true, ruta: false, inclusiones: false, diasNoches: true }), { ok: true });
  assert.equal(llamadas.length, 2);
});

// ── Traslados (migración 246/247) ────────────────────────────────────────────
const trasl = (dia: number, tipo: "traslado_previo" | "traslado_posterior"): Fila => ({ programa_id: 3, dia, tipo_tramo: tipo, titulo: "Bus", desayuno: false, almuerzo: false, cena: false, descripcion: "x" });

// Programa por SALIDA de 5 días (4 noches) como el 7 de Producción: la salida arranca el día del traslado y programa_salidas.noches = dias − 1.
const diasConTraslados = (n: number, previo: boolean, posterior: boolean): Fila[] => [
  ...(previo ? [trasl(0, "traslado_previo")] : []), ...dias(...Array.from({ length: n }, (_, i) => i + 1)), ...(posterior ? [trasl(n + 1, "traslado_posterior")] : []),
];
async function reservarSalida(o: { n?: number; previo?: boolean; posterior?: boolean; desde: string; hasta: string; blackouts?: Fila[]; fechaIda?: string }) {
  const n = o.n ?? 5;
  const bd = usarBD({
    programas: [programa({ dias: n, noches: n - 1 })],
    programa_salidas: [{ ...salida(), fecha_desde: o.desde, fecha_hasta: o.hasta, noches: n - 1 }],
    programa_categorias: [], programa_precios: [], programa_dias: diasConTraslados(n, !!o.previo, !!o.posterior), programa_blackouts: o.blackouts ?? [],
  }, RPCS);
  const r = await reservarPrograma({ ...entrada(await precio(bd)), fechaIda: o.fechaIda ?? o.desde } as never);
  return { bd, r };
}
const regresoDe = (bd: ReturnType<typeof usarBD>) => ({ salida: bd.filas("ventas")[0].fecha_salida, regreso: bd.filas("ventas")[0].fecha_regreso });

test("SALIDA sin traslado: el regreso es desde + noches y NO cambia (aunque fecha_hasta sea cualquier cosa)", async () => {
  const { bd, r } = await reservarSalida({ desde: "2027-03-02", hasta: "2027-03-20" });
  assert.equal(r.ok, true, JSON.stringify(r));
  assert.deepEqual(regresoDe(bd), { salida: "2027-03-02", regreso: "2027-03-06" });
});

test("SALIDA con traslado previo: del 2 al 7 (no al 6); con posterior, del 2 al 7; con ambos, del 2 al 8 — el traslado se cuenta una sola vez", async () => {
  for (const [previo, posterior, hasta, regreso] of [[true, false, "2027-03-07", "2027-03-07"], [false, true, "2027-03-07", "2027-03-07"], [true, true, "2027-03-08", "2027-03-08"]] as const) {
    const { bd, r } = await reservarSalida({ previo, posterior, desde: "2027-03-02", hasta });
    assert.equal(r.ok, true, `previo=${previo} posterior=${posterior}: ${JSON.stringify(r)}`);
    assert.deepEqual(regresoDe(bd), { salida: "2027-03-02", regreso }, `previo=${previo} posterior=${posterior}`);
  }
});

test("el traslado NO cambia noches, importes ni CxP: misma venta, mismos ítems y mismas cuentas por pagar con y sin traslado", async () => {
  const sin = await reservarSalida({ desde: "2027-03-02", hasta: "2027-03-06" });
  const con = await reservarSalida({ previo: true, posterior: true, desde: "2027-03-02", hasta: "2027-03-08" });
  assert.equal(sin.r.ok && con.r.ok, true);
  const v = (x: typeof sin) => x.bd.filas("ventas")[0];
  assert.ok(Number(v(sin).precio_venta) > 0, "hay un importe real que comparar");
  for (const k of ["precio_venta", "costo_hotel", "costo_aereo", "costo_receptivo", "costo_asistencia", "otros_costos", "pax"]) assert.equal(v(con)[k], v(sin)[k], `ventas.${k}`);
  const proy = (x: typeof sin, t: string, ks: string[]) => x.bd.filas(t).map((f) => ks.map((k) => f[k]));
  assert.deepEqual(proy(con, "contrato_items", ["descripcion", "cantidad", "tarifa", "subtotal"]), proy(sin, "contrato_items", ["descripcion", "cantidad", "tarifa", "subtotal"]));
  assert.deepEqual(proy(con, "cuentas_por_pagar", ["tipo_proveedor", "valor_total"]), proy(sin, "cuentas_por_pagar", ["tipo_proveedor", "valor_total"]));
});

test("blackouts de VIAJE con traslado previo: cubren el día extra del regreso (07/03) y no el siguiente (08/03)", async () => {
  const dentro = await reservarSalida({ previo: true, desde: "2027-03-02", hasta: "2027-03-07", blackouts: [bo("2027-03-07", "2027-03-07", "viaje")] });
  assert.equal(dentro.r.ok, false, "el 07/03 es el regreso real: bloquea");
  assert.match(dentro.r.ok ? "" : dentro.r.error, /El viaje del 02\/03\/2027 al 07\/03\/2027 cae en un blackout/);
  sinEscrituras(dentro.bd);
  const fuera = await reservarSalida({ previo: true, desde: "2027-03-02", hasta: "2027-03-07", blackouts: [bo("2027-03-08", "2027-03-08", "viaje")] });
  assert.equal(fuera.r.ok, true, JSON.stringify(fuera.r));
});

test("las CUATRO discrepancias de Producción (programas 7 y 11) fallan ANTES de numerar y sin escribir, con un mensaje claro", async () => {
  const casos: [number, string, string][] = [[5, "2026-12-28", "2027-01-01"], [6, "2026-10-13", "2026-10-16"], [6, "2026-12-25", "2026-12-30"], [6, "2027-01-02", "2027-01-09"]];
  for (const [n, desde, hasta] of casos) {
    const { bd, r } = await reservarSalida({ n, previo: true, desde, hasta });
    assert.equal(r.ok, false, `${desde}→${hasta} debe rechazarse`);
    assert.match(r.ok ? "" : r.error, /sus \d noches más el traslado deberían terminar el \d\d\/\d\d\/\d{4}\. Corrige las fechas de la salida/);
    sinEscrituras(bd);
    assert.equal(bd.filas("ventas").length, 0);
  }
});

const CUATRO_ANOMALAS: [number, string, string][] = [[5, "2026-12-28", "2027-01-01"], [6, "2026-10-13", "2026-10-16"], [6, "2026-12-25", "2026-12-30"], [6, "2027-01-02", "2027-01-09"]];
const TABLAS_HIJAS = ["ventas", "contrato_items", "contrato_pasajeros", "contrato_hoteles", "contrato_vuelos", "contrato_servicios", "cuentas_por_pagar", "asientos_contables", "aliados_b2b", "sillas", "abonos"];
const sinNada = (bd: ReturnType<typeof usarBD>, que: string) => {
  for (const t of TABLAS_HIJAS) assert.equal(bd.filas(t).length, 0, `${que}: sin escrituras en ${t}`);
  assert.deepEqual(bd.llamadasRpc.map((c) => c.fn), [], `${que}: ni consecutivo ni ninguna RPC (todo se rechaza antes de numerar)`);
};
const masDias = (iso: string, n: number) => new Date(Date.parse(`${iso}T00:00:00Z`) + n * 86400000).toISOString().slice(0, 10);

test("LLAMADA DIRECTA con otra fecha a las CUATRO salidas anómalas: falla sin consecutivo, contrato, CxP ni hijos (aunque la fecha 'corrija' el recorrido)", async () => {
  for (const [n, desde, hasta] of CUATRO_ANOMALAS) {
    // desde+1, el último día del recorrido cargado y la fecha_hasta esperada si fuera otra: ninguna es la fecha de la salida.
    for (const otra of [masDias(desde, 1), hasta, masDias(desde, -1)]) {
      const { bd, r } = await reservarSalida({ n, previo: true, desde, hasta, fechaIda: otra });
      assert.equal(r.ok, false, `${desde}→${hasta} con fechaIda ${otra} debe rechazarse`);
      assert.match(r.ok ? "" : r.error, /sale el [0-9]{2}[/][0-9]{2}[/][0-9]{4} y la reserva trae otra fecha/);
      sinNada(bd, `${desde}→${hasta} / ${otra}`);
    }
  }
});

test("una salida PUNTUAL coherente tampoco acepta otra fecha por llamada directa (con y sin traslado); en su fecha_desde sí reserva", async () => {
  for (const previo of [false, true]) {
    const hasta = previo ? "2027-03-07" : "2027-03-06";
    const otra = await reservarSalida({ previo, desde: "2027-03-02", hasta, fechaIda: "2027-03-03" });
    assert.equal(otra.r.ok, false, `previo=${previo}`);
    assert.match(otra.r.ok ? "" : otra.r.error, /otra fecha/);
    sinNada(otra.bd, `previo=${previo}`);
    const propia = await reservarSalida({ previo, desde: "2027-03-02", hasta });
    assert.equal(propia.r.ok, true, JSON.stringify(propia.r));
  }
});

test("una salida con rango ancho (fecha_desde → fecha_hasta de varias semanas) NO se trata como fecha libre: otra fecha dentro del rango se rechaza", async () => {
  const { bd, r } = await reservarSalida({ previo: true, desde: "2027-03-01", hasta: "2027-03-31", fechaIda: "2027-03-10" });
  assert.equal(r.ok, false);
  assert.match(r.ok ? "" : r.error, /otra fecha/);
  sinNada(bd, "rango ancho");
});

test("una salida sin fecha_desde no se puede reservar por llamada directa (antes aceptaba cualquier fecha)", async () => {
  const bd = usarBD({ programas: [programa({ dias: 5, noches: 4 })], programa_salidas: [{ ...salida(), fecha_desde: null, fecha_hasta: null, noches: 4 }], programa_categorias: [], programa_precios: [], programa_dias: COMPLETO.slice(0, 5), programa_blackouts: [] }, RPCS);
  const r = await reservarPrograma({ ...entrada(await precio(bd)), fechaIda: "2027-03-02" } as never);
  assert.equal(r.ok, false);
  assert.match(r.ok ? "" : r.error, /no tiene fecha de salida cargada/);
  sinNada(bd, "salida sin fecha");
});

test("guardarCabecera: con traslado posterior, cambiar el total se valida con el traslado ya recolocado (solo faltan días, no un traslado mal puesto)", async () => {
  usarBD(semilla({ programas: [programa({ publicado: true })], programa_dias: [...COMPLETO, trasl(9, "traslado_posterior")] }), RPCS);
  const r = await guardarCabecera(3, { nombre: "Circuito Andino", dias: 9, noches: 8 } as never);
  assert.equal(r.ok, false);
  assert.match(r.ok ? "" : r.error, /faltan los días 9/);
  assert.doesNotMatch(r.ok ? "" : r.error, /traslados deben/);
});
