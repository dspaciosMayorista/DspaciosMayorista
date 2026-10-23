import { test, describe, mock } from "node:test";
import assert from "node:assert/strict";
import { register } from "node:module";

// #63 — Server Actions REALES del armado de paquetes para las salidas vinculadas a Empaquetados sin record y para el modo
// `cop_trm_63`: listar candidatos (múltiple, todas las elegibles, nuevas = pendientes), vincular (todo o nada, 220, sin duplicar),
// actualizar desde la fuente, no editar a mano una vinculada, y modo/TRM del paquete. El SQL (guardas, único, FK) se prueba en Postgres.

process.env.SUPABASE_SERVICE_ROLE_KEY = "dummy-service-role";
process.env.NEXT_PUBLIC_SUPABASE_URL = "https://dummy.supabase.co";
process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = "dummy-anon";

type Fila = Record<string, unknown>;
type Escritura = { tabla: string; op: "insert" | "update"; payload: unknown; filtros?: Record<string, unknown> };

let bd: ReturnType<typeof crearBd>;
mock.module("@/lib/supabase/server", { namedExports: { createClient: async () => bd.sb } });
mock.module("@/lib/supabase/admin", { namedExports: { createAdminClient: () => bd.sb } });
register("data:text/javascript," + encodeURIComponent(
  `export async function resolve(s, c, n) {
     if (s === "next/cache") return { url: "data:text/javascript,export const revalidatePath=()=>{};export const revalidateTag=()=>{};", shortCircuit: true };
     return n(s, c);
   }`
));

const acciones = await import("../app/(dashboard)/dashboard/paquetes/actions.ts");

function fechaBogota(offsetDias: number): string {
  return new Date(Date.now() + offsetDias * 86400000).toLocaleDateString("en-CA", { timeZone: "America/Bogota" });
}
const IDA = fechaBogota(30);
const REG = fechaBogota(33);
const AYER = fechaBogota(-1);
const PAQUETE_ID = 70;
const R = 1_130_000;
const F = 80_500;

/** BD en memoria con lo que usan estas acciones: select/eq/in/not/order/range/limit/maybeSingle/single, insert y update. */
function crearBd(tablas: Record<string, Fila[]>, opciones: { errorEn?: string; errorAlEscribir?: string } = {}) {
  const escrituras: Escritura[] = [];
  const consultadas: string[] = [];
  let seq = 1000;
  function from(tabla: string) {
    consultadas.push(tabla);
    const filtros: ((r: Fila) => boolean)[] = [];
    const eqs: Record<string, unknown> = {};
    let op: "select" | "insert" | "update" = "select";
    let payload: unknown = null;
    let uno = false;
    let desde = 0; let hasta = Infinity;
    const b: Record<string, unknown> = {};
    b.select = () => b;
    b.insert = (p: unknown) => { op = "insert"; payload = p; return b; };
    b.update = (p: unknown) => { op = "update"; payload = p; return b; };
    b.eq = (c: string, v: unknown) => { filtros.push((r) => r[c] === v); eqs[c] = v; return b; };
    b.in = (c: string, v: unknown[]) => { filtros.push((r) => v.includes(r[c])); return b; };
    b.not = (c: string, o: string, v: unknown) => { if (o === "is") filtros.push((r) => (r[c] ?? null) !== v); return b; };
    b.order = () => b;
    b.limit = () => b;
    b.range = (a: number, z: number) => { desde = a; hasta = z; return b; };
    b.single = () => { uno = true; return b; };
    b.maybeSingle = () => { uno = true; return b; };
    b.then = (res: (v: unknown) => unknown, rej?: (e: unknown) => unknown) => {
      if (opciones.errorEn === tabla && op === "select") return Promise.resolve({ data: null, error: { message: `permission denied for table ${tabla}` } }).then(res, rej);
      if (tablas[tabla] === undefined) throw new Error(`fixture sin la tabla "${tabla}"`);
      if (op === "insert") {
        if (opciones.errorAlEscribir) return Promise.resolve({ data: null, error: { message: opciones.errorAlEscribir } }).then(res, rej);
        const lista = (Array.isArray(payload) ? payload : [payload]) as Fila[];
        const filas = lista.map((f) => ({ id: ++seq, ...f }));
        tablas[tabla].push(...filas);
        escrituras.push({ tabla, op, payload });
        return Promise.resolve({ data: uno ? (filas[0] ?? null) : filas, error: null }).then(res, rej);
      }
      if (op === "update") {
        if (opciones.errorAlEscribir) return Promise.resolve({ data: null, error: { message: opciones.errorAlEscribir } }).then(res, rej);
        const afectadas = tablas[tabla].filter((r) => filtros.every((f) => f(r)));
        for (const f of afectadas) Object.assign(f, payload as Fila);
        escrituras.push({ tabla, op, payload, filtros: eqs });
        return Promise.resolve({ data: afectadas, error: null }).then(res, rej);
      }
      const filas = tablas[tabla].filter((r) => filtros.every((f) => f(r))).slice(desde, hasta === Infinity ? undefined : hasta + 1);
      return Promise.resolve({ data: uno ? (filas[0] ?? null) : filas, error: null }).then(res, rej);
    };
    return b;
  }
  const rpcs: string[] = [];
  const sb = { from, rpc: async (n: string) => { rpcs.push(n); return { data: null, error: null }; } };
  return { sb, tablas, escrituras, consultadas, rpcs };
}

const paquete = (o: Fila = {}): Fila => ({
  id: PAQUETE_ID, nombre: "Dinámico", tipo: "dinamico", destino_id: 1, activo: true, destinos_aereos_alternativos: false,
  modo_oferta: "cop_trm_63", trm_oferta: 4000, ...o,
});
const fuente = (id: number, o: Fila = {}): Fila => ({
  id, activo: true, record: null, compra_inicio: null, compra_fin: null, fecha_ida: IDA, fecha_regreso: REG,
  ruta: `RUTA-${id}`, aerolinea: "JetSMART", destino_id: 1, moneda: "COP", tarifa_para_empaquetar: R, fee_infante: F, tarifa_proveedor: 1_000_000,
  hora_salida_ida: null, hora_llegada_ida: null, hora_salida_reg: null, hora_llegada_reg: null, ...o,
});
const salidaVinc = (id: number, empaquetado: number, o: Fila = {}): Fila => ({
  id, paquete_id: PAQUETE_ID, empaquetado_id: empaquetado, fecha_ida: IDA, fecha_regreso: REG, ruta: `RUTA-${empaquetado}`, aerolinea: "JetSMART",
  valor_tiquete: R, fee_infante: F, aplica_mk: false, ta: 0, moneda: "COP", ...o,
});
function montar(o: { paquete?: Fila; fuentes?: Fila[]; salidas?: Fila[]; errorEn?: string; errorAlEscribir?: string } = {}) {
  bd = crearBd({
    armado_paquetes: [paquete(o.paquete)],
    empaquetados: o.fuentes ?? [fuente(5), fuente(6)],
    salidas_dinamicas: o.salidas ?? [],
    destinos: [{ id: 1, nombre: "CARTAGENA", codigo_iata: "CTG", pais: "Colombia", activo: true }, { id: 2, nombre: "MIAMI", codigo_iata: "MIA", pais: "Estados Unidos", activo: true }],
    armado_paquete_destinos_aereos: [],
  }, { errorEn: o.errorEn, errorAlEscribir: o.errorAlEscribir });
  return bd;
}
const sinLog = async <T>(fn: () => Promise<T>) => { const p = console.error; console.error = () => {}; try { return await fn(); } finally { console.error = p; } };

describe("listarEmpaquetadosParaSalidas63() · TODAS las elegibles, nuevas = pendientes, nada se incorpora solo", () => {
  test("lista las elegibles (sin record, vigentes, destino permitido) como pendientes y sin exponer el costo", async () => {
    montar({ fuentes: [fuente(5), fuente(6), fuente(7, { record: "L93FYZ" }), fuente(8, { activo: false }), fuente(9, { compra_fin: AYER }), fuente(10, { destino_id: 2 })] });
    const r = await acciones.listarEmpaquetadosParaSalidas63(PAQUETE_ID);
    assert.equal(r.ok, true, r.ok ? "" : r.error);
    if (!r.ok) return;
    assert.deepEqual(r.candidatos.map((c) => c.id), [5, 6], "solo las elegibles: sin record, activas, con compra vigente y destino aéreo permitido");
    assert.equal(r.pendientes, 2);
    assert.ok(r.candidatos.every((c) => !c.vinculado && c.salidaId === null));
    assert.equal(JSON.stringify(r).includes("tarifa_proveedor") || JSON.stringify(r).includes("1000000"), false, "el costo N no sale al navegador");
    assert.equal(bd.escrituras.length, 0, "listar NO incorpora nada");
  });
  test("las ya vinculadas se muestran aunque dejaran de ser elegibles, marcadas para revisar", async () => {
    montar({ fuentes: [fuente(5), fuente(6, { record: "L93FYZ" })], salidas: [salidaVinc(21, 5), salidaVinc(22, 6)] });
    const r = await acciones.listarEmpaquetadosParaSalidas63(PAQUETE_ID);
    assert.equal(r.ok, true);
    if (!r.ok) return;
    const por = new Map(r.candidatos.map((c) => [c.id, c]));
    assert.equal(por.get(5)?.vinculado, true);
    assert.equal(por.get(5)?.desactualizado, false);
    assert.equal(por.get(6)?.vinculado, true);
    assert.equal(por.get(6)?.desactualizado, true, "la fuente 6 ya tiene record: hay que revisar la salida");
    assert.equal(r.pendientes, 0);
  });
  test("una vinculada cuya copia quedó vieja se marca desactualizada", async () => {
    montar({ salidas: [salidaVinc(21, 5, { valor_tiquete: 1_000_000 })] });
    const r = await acciones.listarEmpaquetadosParaSalidas63(PAQUETE_ID);
    assert.equal(r.ok && r.candidatos.find((c) => c.id === 5)?.desactualizado, true);
  });
  test("solo existe en paquetes Dinámico en modo cop_trm_63", async () => {
    for (const [paq, patron] of [[{ tipo: "bloqueo" }, /solo existen en paquetes Din[aá]mico/i], [{ modo_oferta: "legacy", trm_oferta: null }, /modo COP con TRM/i]] as const) {
      montar({ paquete: paq });
      const r = await acciones.listarEmpaquetadosParaSalidas63(PAQUETE_ID);
      assert.equal(r.ok, false);
      if (!r.ok) assert.match(r.error, patron);
    }
  });
  test("error de lectura: error técnico con mensaje de negocio (nunca 'no hay vuelos' ni el texto de Postgres)", async () => {
    montar({ errorEn: "empaquetados" });
    const r = await acciones.listarEmpaquetadosParaSalidas63(PAQUETE_ID);
    assert.equal(r.ok, false);
    if (!r.ok) assert.doesNotMatch(r.error, /permission denied|empaquetados/);
  });
  test("pagina por las filas REALES recibidas (el límite de filas de PostgREST no trunca la lista)", async () => {
    const muchas = Array.from({ length: 2300 }, (_, i) => fuente(1000 + i));
    montar({ fuentes: muchas });
    const r = await acciones.listarEmpaquetadosParaSalidas63(PAQUETE_ID);
    assert.equal(r.ok && r.candidatos.length, 2300);
  });
});

describe("vincularSalidasEmpaquetados63() · TODO o NADA, con la regla de destinos aéreos de la 220", () => {
  test("vincula varias: copia fechas, ruta y tarifas; sin markup ni TA; COP; regenera el tarifario", async () => {
    montar();
    const r = await sinLog(() => acciones.vincularSalidasEmpaquetados63(PAQUETE_ID, [5, 6, 5]));
    assert.equal(r.ok, true, r.ok ? "" : r.error);
    const ins = bd.escrituras.filter((e) => e.tabla === "salidas_dinamicas" && e.op === "insert");
    assert.equal(ins.length, 1, "un solo INSERT (todo o nada)");
    const filas = ins[0].payload as Fila[];
    assert.deepEqual(filas.map((f) => f.empaquetado_id), [5, 6], "deduplica");
    for (const f of filas) {
      assert.equal(f.paquete_id, PAQUETE_ID);
      assert.equal(f.aplica_mk, false);
      assert.equal(f.ta, 0);
      assert.equal(f.moneda, "COP");
      assert.equal(f.valor_tiquete, R);
      assert.equal(f.fee_infante, F);
      assert.equal(f.fecha_ida, IDA);
    }
    assert.ok(bd.rpcs.includes("iniciar_generacion_tarifario"), "regenera el tarifario tras vincular");
  });
  test("si UNA fuente tiene record no se vincula NINGUNA", async () => {
    montar({ fuentes: [fuente(5), fuente(6, { record: "L93FYZ" })] });
    const r = await acciones.vincularSalidasEmpaquetados63(PAQUETE_ID, [5, 6]);
    assert.equal(r.ok, false);
    if (!r.ok) assert.match(r.error, /No se vincul[oó] ning[uú]n vuelo.*ya tiene record/i);
    assert.equal(bd.escrituras.length, 0);
  });
  test("un texto cualquiera en el record (PROMOCION) también la rechaza", async () => {
    montar({ fuentes: [fuente(5, { record: "PROMOCION" })] });
    const r = await acciones.vincularSalidasEmpaquetados63(PAQUETE_ID, [5]);
    assert.equal(r.ok, false);
    assert.equal(bd.escrituras.length, 0);
  });
  test("destino aéreo no permitido (220): rechaza el lote completo, sin escribir", async () => {
    montar({ fuentes: [fuente(5), fuente(6, { destino_id: 2 })] });
    const r = await acciones.vincularSalidasEmpaquetados63(PAQUETE_ID, [5, 6]);
    assert.equal(r.ok, false);
    if (!r.ok) assert.match(r.error, /No se vincul[oó] ning[uú]n vuelo|no corresponde/i);
    assert.equal(bd.escrituras.length, 0);
  });
  test("una fuente inexistente rechaza el lote", async () => {
    montar();
    const r = await acciones.vincularSalidasEmpaquetados63(PAQUETE_ID, [5, 999]);
    assert.equal(r.ok, false);
    assert.equal(bd.escrituras.length, 0);
  });
  test("lo ya vinculado no se duplica: se agregan solo las nuevas; si todas ya están, error claro", async () => {
    montar({ salidas: [salidaVinc(21, 5)] });
    const r = await sinLog(() => acciones.vincularSalidasEmpaquetados63(PAQUETE_ID, [5, 6]));
    assert.equal(r.ok, true, r.ok ? "" : r.error);
    const ins = bd.escrituras.find((e) => e.tabla === "salidas_dinamicas" && e.op === "insert");
    assert.deepEqual((ins?.payload as Fila[]).map((f) => f.empaquetado_id), [6]);
    montar({ salidas: [salidaVinc(21, 5)] });
    const r2 = await acciones.vincularSalidasEmpaquetados63(PAQUETE_ID, [5]);
    assert.equal(r2.ok, false);
    if (!r2.ok) assert.match(r2.error, /ya est[aá]n vinculados/i);
  });
  test("entradas inválidas: vacío, no enteros, ids negativos, demasiados", async () => {
    montar();
    for (const ids of [[], [0], [-3], [1.5], [Number.NaN], Array.from({ length: 201 }, (_, i) => i + 1)]) {
      const r = await acciones.vincularSalidasEmpaquetados63(PAQUETE_ID, ids);
      assert.equal(r.ok, false, JSON.stringify(ids).slice(0, 40));
    }
    assert.equal(bd.escrituras.length, 0);
  });
  test("paquete legacy o que no es Dinámico: no vincula", async () => {
    montar({ paquete: { modo_oferta: "legacy", trm_oferta: null } });
    assert.equal((await acciones.vincularSalidasEmpaquetados63(PAQUETE_ID, [5])).ok, false);
    montar({ paquete: { tipo: "bloqueo" } });
    assert.equal((await acciones.vincularSalidasEmpaquetados63(PAQUETE_ID, [5])).ok, false);
    assert.equal(bd.escrituras.length, 0);
  });
  test("si la base rechaza (guarda de la 227), el mensaje es de negocio y no sale el texto crudo", async () => {
    montar({ errorAlEscribir: "salida_vinculada_record: el vuelo de Empaquetados 5 ya tiene record (PNR)" });
    const r = await acciones.vincularSalidasEmpaquetados63(PAQUETE_ID, [5]);
    assert.equal(r.ok, false);
    if (!r.ok) assert.match(r.error, /ya tiene record/i);
  });
  test("si el tarifario no se pudo regenerar, la vinculación SÍ queda y se avisa", async () => {
    montar();
    const r = await sinLog(() => acciones.vincularSalidasEmpaquetados63(PAQUETE_ID, [5]));
    assert.equal(r.ok, true);
    if (r.ok) assert.match(r.aviso ?? "", /no se pudo regenerar/i);
  });
});

describe("actualizarSalidaDesdeFuente63() y edición manual de una vinculada", () => {
  test("vuelve a copiar de la fuente VIVA y regenera", async () => {
    montar({ fuentes: [fuente(5, { tarifa_para_empaquetar: 1_200_000, fee_infante: 90_000 })], salidas: [salidaVinc(21, 5)] });
    const r = await sinLog(() => acciones.actualizarSalidaDesdeFuente63(21));
    assert.equal(r.ok, true, r.ok ? "" : r.error);
    const upd = bd.escrituras.find((e) => e.tabla === "salidas_dinamicas" && e.op === "update");
    assert.equal((upd?.payload as Fila).valor_tiquete, 1_200_000);
    assert.equal((upd?.payload as Fila).fee_infante, 90_000);
    assert.equal((upd?.payload as Fila).aplica_mk, false);
    assert.equal(upd?.filtros?.id, 21);
  });
  test("si la fuente ya tiene record NO se actualiza (hay que revisar la salida)", async () => {
    montar({ fuentes: [fuente(5, { record: "L93FYZ" })], salidas: [salidaVinc(21, 5)] });
    const r = await acciones.actualizarSalidaDesdeFuente63(21);
    assert.equal(r.ok, false);
    if (!r.ok) assert.match(r.error, /ya tiene record/i);
    assert.equal(bd.escrituras.length, 0);
  });
  test("una salida manual no se actualiza desde ninguna fuente", async () => {
    montar({ salidas: [salidaVinc(21, 5, { empaquetado_id: null })] });
    const r = await acciones.actualizarSalidaDesdeFuente63(21);
    assert.equal(r.ok, false);
    if (!r.ok) assert.match(r.error, /no est[aá] vinculada/i);
  });
  test("actualizarSalidaDinamica NO edita a mano una vinculada (la copia debe coincidir con la fuente)", async () => {
    montar({ salidas: [salidaVinc(21, 5)] });
    const r = await acciones.actualizarSalidaDinamica(21, {
      aerolinea: "X", ruta: "X", origen: "", fechaIda: IDA, fechaRegreso: REG, horaSalidaIda: "", horaLlegadaIda: "", horaSalidaReg: "", horaLlegadaReg: "",
      valorTiquete: 1, aplicaMk: true, ta: 0, feeInfante: 0, compraInicio: "", compraFin: "", notas: "",
    });
    assert.equal(r.ok, false);
    if (!r.ok) assert.match(r.error, /vinculada a un vuelo de Empaquetados/i);
    assert.equal(bd.escrituras.length, 0);
  });
  test("una salida manual SÍ se edita como siempre", async () => {
    montar({ salidas: [salidaVinc(21, 5, { empaquetado_id: null })] });
    const r = await sinLog(() => acciones.actualizarSalidaDinamica(21, {
      aerolinea: "X", ruta: "X", origen: "", fechaIda: IDA, fechaRegreso: REG, horaSalidaIda: "", horaLlegadaIda: "", horaSalidaReg: "", horaLlegadaReg: "",
      valorTiquete: 1, aplicaMk: true, ta: 0, feeInfante: 0, compraInicio: "", compraFin: "", notas: "",
    }));
    assert.equal(r.ok, true, r.ok ? "" : r.error);
    assert.equal(bd.escrituras.filter((e) => e.op === "update").length, 1);
  });
});

describe("modo de oferta y TRM del paquete (crearPaquete / actualizarPaquete)", () => {
  const cfg = (o: Record<string, unknown> = {}) => ({
    nombre: "Dinámico 63", tipo: "dinamico", noches: 3, destinoId: 1, fechaCompraInicio: "", fechaCompraFin: "", fechaViajeInicio: "", fechaViajeFin: "",
    pctMk: 20, impuestoTipo: "tiquete", impuestoFijo: 0, activo: true, notas: "", programaIncluye: "", programaNoIncluye: "",
    programaTarifasEspeciales: "", programaCondicionesComerciales: "", ...o,
  });
  test("modo 63 + TRM válida: se guarda con la TRM como número", async () => {
    montar();
    const r = await sinLog(() => acciones.actualizarPaquete(PAQUETE_ID, cfg({ modoOferta: "cop_trm_63", trmOferta: "3987.65" }) as never));
    assert.equal(r.ok, true, r.ok ? "" : r.error);
    const upd = bd.escrituras.find((e) => e.tabla === "armado_paquetes" && e.op === "update");
    assert.equal((upd?.payload as Fila).modo_oferta, "cop_trm_63");
    assert.equal((upd?.payload as Fila).trm_oferta, 3987.65);
  });
  for (const trm of [null, undefined, "", 0, -1, "abc"]) {
    test(`modo 63 con TRM ${JSON.stringify(trm) ?? "undefined"}: rechazado antes de escribir (nunca TRM 1)`, async () => {
      montar();
      const r = await acciones.actualizarPaquete(PAQUETE_ID, cfg({ modoOferta: "cop_trm_63", trmOferta: trm }) as never);
      assert.equal(r.ok, false);
      if (!r.ok) assert.match(r.error, /TRM positiva/i);
      assert.equal(bd.escrituras.length, 0);
    });
  }
  test("modo 63 en un paquete que NO es Dinámico: rechazado", async () => {
    montar();
    const r = await acciones.actualizarPaquete(PAQUETE_ID, cfg({ tipo: "bloqueo", modoOferta: "cop_trm_63", trmOferta: 4000 }) as never);
    assert.equal(r.ok, false);
    if (!r.ok) assert.match(r.error, /solo est[aá] disponible para paquetes Din[aá]mico/i);
    assert.equal(bd.escrituras.length, 0);
  });
  test("modo desconocido: rechazado", async () => {
    montar();
    const r = await acciones.actualizarPaquete(PAQUETE_ID, cfg({ modoOferta: "raro" }) as never);
    assert.equal(r.ok, false);
  });
  test("modo legacy guarda la TRM en NULL", async () => {
    montar();
    const r = await sinLog(() => acciones.actualizarPaquete(PAQUETE_ID, cfg({ modoOferta: "legacy", trmOferta: 4000 }) as never));
    assert.equal(r.ok, true, r.ok ? "" : r.error);
    const upd = bd.escrituras.find((e) => e.tabla === "armado_paquetes" && e.op === "update");
    assert.equal((upd?.payload as Fila).modo_oferta, "legacy");
    assert.equal((upd?.payload as Fila).trm_oferta, null);
  });
  test("un formulario anterior que NO envía modo/TRM no toca lo guardado", async () => {
    montar();
    const r = await sinLog(() => acciones.actualizarPaquete(PAQUETE_ID, cfg() as never));
    assert.equal(r.ok, true, r.ok ? "" : r.error);
    const upd = bd.escrituras.find((e) => e.tabla === "armado_paquetes" && e.op === "update");
    assert.equal("modo_oferta" in (upd?.payload as Fila), false);
    assert.equal("trm_oferta" in (upd?.payload as Fila), false);
  });
  test("salir del modo 63 con salidas vinculadas: la base lo rechaza y el mensaje es de negocio", async () => {
    montar({ errorAlEscribir: "modo_oferta_vinculadas: el paquete 70 tiene salidas vinculadas a Empaquetados" });
    const r = await acciones.actualizarPaquete(PAQUETE_ID, cfg({ modoOferta: "legacy" }) as never);
    assert.equal(r.ok, false);
    if (!r.ok) assert.match(r.error, /desvinc[uú]lalas antes de cambiar el modo/i);
  });
  test("crearPaquete también valida la TRM", async () => {
    montar();
    const r = await acciones.crearPaquete(cfg({ modoOferta: "cop_trm_63", trmOferta: null }) as never);
    assert.equal(r.ok, false);
    assert.equal(bd.escrituras.length, 0);
  });
});
