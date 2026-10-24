import { test, describe, mock } from "node:test";
import assert from "node:assert/strict";
import { register } from "node:module";
import {
  crearBd, cuentaEscrituras, tablasBase, JOINS_ARMADO, PAQUETE_ID, D, fuente,
  type BdFalsa, type Tablas, type Fila,
} from "./destinosAereos67Soporte.ts";

// #67 — destinos aéreos alternativos (Bloqueo/Sistema). EJECUCIÓN REAL de los
// consumidores (acciones de paquetes y de Empaquetados, generador de tarifario,
// cómputo de reserva, filtro post-carga, resumen y detalle) contra una BD en
// memoria. Caso base: paquete de Juan Dolio (ID 10) con vuelos a Santo Domingo
// (20) y Punta Cana (30), mismo país; Cartagena (40) es de otro país.
//
// Qué NO se prueba aquí (va en SQL/CI, destinosAereos67.pg.ts y
// supabase/scripts/test_220_*): las guardas de la base (triggers diferidos),
// las carreras entre sesiones y los permisos por rol. Esta capa prueba que el
// SERVIDOR valida antes de escribir y que ninguna escritura queda a medias.

process.env.SUPABASE_SERVICE_ROLE_KEY = "dummy-service-role";
process.env.NEXT_PUBLIC_SUPABASE_URL = "https://dummy.supabase.co";
process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = "dummy-anon";

let sbActual: unknown = null;
let adminActual: unknown = null;
mock.module("@/lib/supabase/server", {
  namedExports: {
    createClient: async () => {
      if (sbActual == null) throw new Error("createClient() sin cliente de prueba configurado.");
      return sbActual;
    },
  },
});
mock.module("@/lib/supabase/admin", {
  namedExports: {
    createAdminClient: () => {
      if (adminActual == null) throw new Error("createAdminClient() sin cliente de prueba configurado.");
      return adminActual;
    },
  },
});
// `next/cache` no resuelve bajo `node --test` plano: hook de resolución local a
// ESTE proceso de prueba (sin tocar aliasLoader.mjs), antes del primer import.
register("data:text/javascript," + encodeURIComponent(
  `export async function resolve(s, c, n) {
     if (s === "next/cache") return { url: "data:text/javascript,export const revalidatePath=()=>{};export const revalidateTag=()=>{};", shortCircuit: true };
     return n(s, c);
   }`
));

const acciones = await import("../app/(dashboard)/dashboard/paquetes/actions.ts");
const accionesEmp = await import("../app/(dashboard)/dashboard/vuelos/empaquetados-actions.ts");
const { computarReserva } = await import("@/lib/reservar/computo.ts");
const { aplicarFiltrosPostCarga } = await import("../lib/tarifario/filtrosPostCarga.ts");
const { cargarResumenTarifario } = await import("../lib/tarifario/resumen.ts");
const { obtenerDetalleSalida } = await import("../app/tarifario/detalle-actions.ts");

const { setVuelo, setTodosVuelos, actualizarPaquete, crearPaquete, generarTarifario, crearSalidaDinamica } = acciones;
const { setEmpaquetado, setTodosEmpaquetados } = accionesEmp;

// ─── helpers ───────────────────────────────────────────────────────────────
function conBd(tablas: Tablas, o: Parameters<typeof crearBd>[1] = {}): BdFalsa {
  const bd = crearBd(tablas, { joins: JOINS_ARMADO, ...o });
  sbActual = bd.cliente;
  adminActual = bd.cliente;
  return bd;
}
const sinEscrituras = (bd: BdFalsa) => assert.equal(bd.escrituras.length, 0, `no debe haber escrituras; hubo: ${JSON.stringify(bd.escrituras.map((e) => `${e.op}:${e.tabla}`))}`);
const idsLigados = (bd: BdFalsa, tabla: string, col: string) => (bd.tablas[tabla] ?? []).map((f) => f[col]).sort();
const MSG_NO_PERMITIDO = /no corresponde/i;
const MSG_TECNICO = /no se pudo verificar/i;
const MSG_DESVINCULAR = /desvinc[uú]l/i;

// RPC de guardado atómico (la base real valida al confirmar; aquí aplica los cambios).
function rpcGuardarOk(args: Record<string, unknown>, bd: BdFalsa) {
  const pid = args.p_paquete_id as number;
  const pq = bd.tablas.armado_paquetes.find((p) => p.id === pid);
  if (pq) { pq.destino_id = args.p_destino_id; pq.destinos_aereos_alternativos = args.p_activo; }
  bd.tablas.armado_paquete_destinos_aereos = (args.p_destinos as number[]).map((d) => ({ paquete_id: pid, destino_id: d }));
  return { data: { ok: true }, error: null };
}
const RPC_OK = { guardar_destinos_aereos_67: rpcGuardarOk };

// ═══ 1. setVuelo / setTodosVuelos (Bloqueo negociado) ═════════════════════
describe("setVuelo() — validación en servidor del destino aéreo", () => {
  test("check OFF: el vuelo del destino comercial se vincula; el de otro destino (aun del mismo país) se rechaza sin escribir", async () => {
    const bd = conBd(tablasBase({ check: false }));
    const ok = await setVuelo(PAQUETE_ID, 101, true, true, 0);
    assert.equal(ok.ok, true);
    assert.deepEqual(idsLigados(bd, "armado_vuelos", "bloqueo_id"), [101]);

    const bd2 = conBd(tablasBase({ check: false }));
    const r = await setVuelo(PAQUETE_ID, 201, true, true, 0); // Santo Domingo, mismo país
    assert.equal(r.ok, false);
    if (!r.ok) assert.match(r.error, MSG_NO_PERMITIDO);
    sinEscrituras(bd2);
  });

  test("check ON con SDQ y PUJ elegidos: aceptan comercial + alternativas; rechazan otro país, sin destino, país ausente, inactivo, alias RD, no elegido e ID inexistente", async () => {
    for (const id of [101, 201, 202, 301]) {
      const bd = conBd(tablasBase({ check: true, alternativas: [D.SANTO_DOMINGO, D.PUNTA_CANA] }));
      const r = await setVuelo(PAQUETE_ID, id, true, true, 0);
      assert.equal(r.ok, true, `vuelo ${id} debe aceptarse`);
      assert.deepEqual(idsLigados(bd, "armado_vuelos", "bloqueo_id"), [id]);
    }
    const rechazados: [number, string][] = [
      [401, "otro país (Colombia)"], [501, "fuente sin destino"], [601, "destino sin país"],
      [701, "destino inactivo"], [801, "alias RD no comparable"], [901, "mismo país pero no elegido"], [999999, "ID forjado inexistente"],
    ];
    for (const [id, motivo] of rechazados) {
      const bd = conBd(tablasBase({ check: true, alternativas: [D.SANTO_DOMINGO, D.PUNTA_CANA] }));
      const r = await setVuelo(PAQUETE_ID, id, true, true, 0);
      assert.equal(r.ok, false, `vuelo ${id} (${motivo}) debe rechazarse`);
      sinEscrituras(bd);
    }
  });

  test("check ON pero con una alternativa ya inválida (país cambiado después): esa alternativa deja de contar — el vuelo de SDQ se rechaza", async () => {
    const tablas = tablasBase({ check: true, alternativas: [D.SANTO_DOMINGO, D.PUNTA_CANA] });
    (tablas.destinos.find((d) => d.id === D.SANTO_DOMINGO) as Fila).pais = "Colombia";
    const bd = conBd(tablas);
    const r = await setVuelo(PAQUETE_ID, 201, true, true, 0);
    assert.equal(r.ok, false);
    sinEscrituras(bd);
    // PUJ sigue siendo válido
    const r2 = await setVuelo(PAQUETE_ID, 301, true, true, 0);
    assert.equal(r2.ok, true);
  });

  test("check ON con país del destino comercial ausente: las alternativas no autorizan nada", async () => {
    const tablas = tablasBase({ check: true, alternativas: [D.SANTO_DOMINGO] });
    (tablas.destinos.find((d) => d.id === D.JUAN_DOLIO) as Fila).pais = null;
    const bd = conBd(tablas);
    const r = await setVuelo(PAQUETE_ID, 201, true, true, 0);
    assert.equal(r.ok, false);
    sinEscrituras(bd);
    const r2 = await setVuelo(PAQUETE_ID, 101, true, true, 0); // el comercial exacto sí
    assert.equal(r2.ok, true);
  });

  test("paquete sin destino comercial: nunca se listan ni vinculan todos los vuelos como respaldo", async () => {
    const bd = conBd(tablasBase({ paquete: { destino_id: null } }));
    const r = await setVuelo(PAQUETE_ID, 101, true, true, 0);
    assert.equal(r.ok, false);
    sinEscrituras(bd);
  });

  test("desvincular (checked=false) siempre se permite aunque la fuente ya sea incompatible: es la desvinculación explícita", async () => {
    const bd = conBd(tablasBase({ check: false, vuelosLigados: [201] }));
    const r = await setVuelo(PAQUETE_ID, 201, false, true, 0);
    assert.equal(r.ok, true);
    assert.deepEqual(idsLigados(bd, "armado_vuelos", "bloqueo_id"), []);
  });

  test("error técnico de lectura: se rechaza con mensaje de error técnico (distinto de 'no corresponde') y sin escribir", async () => {
    const bd = conBd(tablasBase({ check: true, alternativas: [D.SANTO_DOMINGO] }), { errorLectura: { armado_paquete_destinos_aereos: "boom" } });
    const r = await setVuelo(PAQUETE_ID, 201, true, true, 0);
    assert.equal(r.ok, false);
    if (!r.ok) {
      assert.match(r.error, MSG_TECNICO);
      assert.doesNotMatch(r.error, MSG_NO_PERMITIDO);
      assert.doesNotMatch(r.error, /boom/, "el texto crudo del error no llega al llamador");
    }
    sinEscrituras(bd);
  });
});

describe("setTodosVuelos() — lote: todo o nada, deduplicado", () => {
  test("lote mixto (uno de otro país): se rechaza completo, sin ningún vínculo escrito", async () => {
    const bd = conBd(tablasBase({ check: true, alternativas: [D.SANTO_DOMINGO, D.PUNTA_CANA] }));
    const r = await setTodosVuelos(PAQUETE_ID, [101, 201, 301, 401], true);
    assert.equal(r.ok, false);
    if (!r.ok) assert.match(r.error, MSG_NO_PERMITIDO);
    sinEscrituras(bd);
  });

  test("lote válido con duplicados: una sola escritura, cada vuelo una vez", async () => {
    const bd = conBd(tablasBase({ check: true, alternativas: [D.SANTO_DOMINGO, D.PUNTA_CANA] }));
    const r = await setTodosVuelos(PAQUETE_ID, [101, 201, 201, 301, 101], true);
    assert.equal(r.ok, true);
    assert.equal(cuentaEscrituras(bd, "armado_vuelos"), 1);
    assert.equal(bd.escrituras[0].filas?.length, 3, "lo que viaja a la base ya va deduplicado (un upsert con repetidos falla en Postgres)");
    assert.deepEqual(idsLigados(bd, "armado_vuelos", "bloqueo_id"), [101, 201, 301]);
  });

  test("OFF: lote con vuelos de SDQ se rechaza; ID forjado también", async () => {
    const bd = conBd(tablasBase({ check: false }));
    assert.equal((await setTodosVuelos(PAQUETE_ID, [101, 201], true)).ok, false);
    assert.equal((await setTodosVuelos(PAQUETE_ID, [101, 888888], true)).ok, false);
    sinEscrituras(bd);
  });

  test("quitar todos (checked=false) borra los vínculos del paquete", async () => {
    const bd = conBd(tablasBase({ check: false, vuelosLigados: [101, 201] }));
    const r = await setTodosVuelos(PAQUETE_ID, [], false);
    assert.equal(r.ok, true);
    assert.deepEqual(idsLigados(bd, "armado_vuelos", "bloqueo_id"), []);
  });
});

// ═══ 2. setEmpaquetado / setTodosEmpaquetados (vuelos por Sistema) ════════
describe("setEmpaquetado() / setTodosEmpaquetados() — mismas reglas para vuelos por Sistema", () => {
  test("OFF: solo el destino comercial; ON: comercial + alternativas elegidas", async () => {
    const off = conBd(tablasBase({ check: false }));
    assert.equal((await setEmpaquetado(PAQUETE_ID, 1101, true, true, 0)).ok, true);
    assert.equal((await setEmpaquetado(PAQUETE_ID, 1201, true, true, 0)).ok, false);
    assert.deepEqual(idsLigados(off, "armado_empaquetados", "empaquetado_id"), [1101]);

    for (const id of [1101, 1201, 1301]) {
      const on = conBd(tablasBase({ check: true, alternativas: [D.SANTO_DOMINGO, D.PUNTA_CANA] }));
      assert.equal((await setEmpaquetado(PAQUETE_ID, id, true, true, 0)).ok, true, `empaquetado ${id}`);
    }
    for (const id of [1401, 1501, 1601, 1701, 1801, 1901, 999999]) {
      const on = conBd(tablasBase({ check: true, alternativas: [D.SANTO_DOMINGO, D.PUNTA_CANA] }));
      assert.equal((await setEmpaquetado(PAQUETE_ID, id, true, true, 0)).ok, false, `empaquetado ${id} debe rechazarse`);
      sinEscrituras(on);
    }
  });

  test("lote mixto: se rechaza completo; lote válido con duplicados se escribe una vez", async () => {
    const bd = conBd(tablasBase({ check: true, alternativas: [D.SANTO_DOMINGO, D.PUNTA_CANA] }));
    assert.equal((await setTodosEmpaquetados(PAQUETE_ID, [1101, 1201, 1401], true)).ok, false);
    sinEscrituras(bd);
    const r = await setTodosEmpaquetados(PAQUETE_ID, [1101, 1201, 1201, 1301], true);
    assert.equal(r.ok, true);
    assert.equal(cuentaEscrituras(bd, "armado_empaquetados"), 1);
    assert.equal(bd.escrituras[0].filas?.length, 3, "lo que viaja a la base ya va deduplicado");
    assert.deepEqual(idsLigados(bd, "armado_empaquetados", "empaquetado_id"), [1101, 1201, 1301]);
  });

  test("desvincular y quitar todos siempre se permiten", async () => {
    const bd = conBd(tablasBase({ check: false, empaquetadosLigados: [1201, 1301] }));
    assert.equal((await setEmpaquetado(PAQUETE_ID, 1201, false, true, 0)).ok, true);
    assert.equal((await setTodosEmpaquetados(PAQUETE_ID, [], false)).ok, true);
    assert.deepEqual(idsLigados(bd, "armado_empaquetados", "empaquetado_id"), []);
  });

  test("error técnico: mensaje técnico diferenciado y sin escribir", async () => {
    const bd = conBd(tablasBase({ check: false }), { errorLectura: { empaquetados: "boom" } });
    const r = await setEmpaquetado(PAQUETE_ID, 1101, true, true, 0);
    assert.equal(r.ok, false);
    if (!r.ok) assert.match(r.error, MSG_TECNICO);
    sinEscrituras(bd);
  });
});

// ═══ 3. Configuración del paquete: guardar / retirar / apagar ═════════════
function cfg(over: Record<string, unknown> = {}) {
  return {
    nombre: "Juan Dolio 4D/3N", tipo: "bloqueo" as const, noches: 3, destinoId: D.JUAN_DOLIO,
    fechaCompraInicio: "", fechaCompraFin: "", fechaViajeInicio: "2026-12-01", fechaViajeFin: "2026-12-31",
    pctMk: 20, impuestoTipo: "fijo" as const, impuestoFijo: 100000, activo: true, notas: "",
    programaIncluye: "", programaNoIncluye: "", programaTarifasEspeciales: "", programaCondicionesComerciales: "",
    ...over,
  };
}
const hayRpc = (bd: BdFalsa) => bd.rpcs.some((r) => r.nombre === "guardar_destinos_aereos_67");

describe("actualizarPaquete() — check y alternativas con rechazo seguro al retirar", () => {
  test("activar con SDQ y PUJ: llama al guardado atómico con IDs deduplicados (sin el comercial) y luego actualiza el resto", async () => {
    const bd = conBd(tablasBase(), { rpc: RPC_OK });
    const r = await actualizarPaquete(PAQUETE_ID, cfg({ destinosAereosAlternativos: true, destinosAereosIds: [30, 20, 20, D.JUAN_DOLIO] }));
    assert.equal(r.ok, true, r.ok ? "" : r.error);
    const llamada = bd.rpcs.find((x) => x.nombre === "guardar_destinos_aereos_67");
    assert.ok(llamada, "debe usar el guardado atómico");
    assert.deepEqual(llamada.args, { p_paquete_id: PAQUETE_ID, p_destino_id: D.JUAN_DOLIO, p_activo: true, p_destinos: [20, 30] });
    assert.ok(cuentaEscrituras(bd, "armado_paquetes") >= 1, "el resto de la configuración también se actualiza");
  });

  test("apagar el check con un vuelo de SDQ vinculado: se rechaza listando el vuelo, sin ningún cambio parcial", async () => {
    const bd = conBd(tablasBase({ check: true, alternativas: [D.SANTO_DOMINGO, D.PUNTA_CANA], vuelosLigados: [101, 201] }), { rpc: RPC_OK });
    const r = await actualizarPaquete(PAQUETE_ID, cfg({ destinosAereosAlternativos: false, destinosAereosIds: [20, 30] }));
    assert.equal(r.ok, false);
    if (!r.ok) { assert.match(r.error, MSG_DESVINCULAR); assert.match(r.error, /R201/); assert.doesNotMatch(r.error, /R101/); }
    sinEscrituras(bd);
    assert.equal(hayRpc(bd), false);
  });

  test("retirar una alternativa (PUJ) con un vuelo de PUJ vinculado: rechazo; tras desvincularlo explícitamente, sí se guarda", async () => {
    const bd = conBd(tablasBase({ check: true, alternativas: [D.SANTO_DOMINGO, D.PUNTA_CANA], vuelosLigados: [101, 301] }), { rpc: RPC_OK });
    const r1 = await actualizarPaquete(PAQUETE_ID, cfg({ destinosAereosAlternativos: true, destinosAereosIds: [20] }));
    assert.equal(r1.ok, false);
    sinEscrituras(bd);
    assert.equal((await setVuelo(PAQUETE_ID, 301, false, true, 0)).ok, true); // desvinculación explícita
    const r2 = await actualizarPaquete(PAQUETE_ID, cfg({ destinosAereosAlternativos: true, destinosAereosIds: [20] }));
    assert.equal(r2.ok, true, r2.ok ? "" : r2.error);
  });

  test("los vínculos de Empaquetados también bloquean el retiro", async () => {
    const bd = conBd(tablasBase({ check: true, alternativas: [D.SANTO_DOMINGO], empaquetadosLigados: [1201] }), { rpc: RPC_OK });
    const r = await actualizarPaquete(PAQUETE_ID, cfg({ destinosAereosAlternativos: false, destinosAereosIds: [20] }));
    assert.equal(r.ok, false);
    if (!r.ok) assert.match(r.error, /R1201/);
    sinEscrituras(bd);
  });

  test("cambiar el destino comercial deja vuelos incompatibles: rechazo", async () => {
    const bd = conBd(tablasBase({ vuelosLigados: [101] }), { rpc: RPC_OK });
    const r = await actualizarPaquete(PAQUETE_ID, cfg({ destinoId: D.CARTAGENA, destinosAereosAlternativos: false, destinosAereosIds: [] }));
    assert.equal(r.ok, false);
    sinEscrituras(bd);
  });

  test("activar exige al menos una alternativa válida del mismo país: vacío, otro país, sin país, inactivo, alias RD e ID inexistente se rechazan", async () => {
    const casos: [number[], string][] = [
      [[], "sin alternativas"], [[D.JUAN_DOLIO], "solo el comercial"], [[D.CARTAGENA], "otro país"],
      [[D.SIN_PAIS], "alternativa sin país"], [[D.INACTIVO], "alternativa inactiva"], [[D.ALIAS_RD], "alias RD"],
      [[999999], "ID inexistente"], [[D.SANTO_DOMINGO, D.CARTAGENA], "lote mixto"],
    ];
    for (const [ids, motivo] of casos) {
      const bd = conBd(tablasBase(), { rpc: RPC_OK });
      const r = await actualizarPaquete(PAQUETE_ID, cfg({ destinosAereosAlternativos: true, destinosAereosIds: ids }));
      assert.equal(r.ok, false, `${motivo} debe rechazarse`);
      sinEscrituras(bd);
      assert.equal(hayRpc(bd), false);
    }
  });

  test("activar con el destino comercial sin país: se rechaza", async () => {
    const tablas = tablasBase({ paquete: { destino_id: D.SIN_PAIS } });
    const bd = conBd(tablas, { rpc: RPC_OK });
    const r = await actualizarPaquete(PAQUETE_ID, cfg({ destinoId: D.SIN_PAIS, destinosAereosAlternativos: true, destinosAereosIds: [D.SANTO_DOMINGO] }));
    assert.equal(r.ok, false);
    sinEscrituras(bd);
  });

  test("error técnico leyendo los vínculos NO equivale a cero vínculos: se rechaza como error técnico", async () => {
    const bd = conBd(tablasBase({ check: true, alternativas: [D.SANTO_DOMINGO] }), { rpc: RPC_OK, errorLectura: { armado_vuelos: "boom" } });
    const r = await actualizarPaquete(PAQUETE_ID, cfg({ destinosAereosAlternativos: false, destinosAereosIds: [20] }));
    assert.equal(r.ok, false);
    if (!r.ok) { assert.match(r.error, MSG_TECNICO); assert.doesNotMatch(r.error, /boom/); }
    sinEscrituras(bd);
  });

  test("la base rechaza al confirmar (carrera con una vinculación): error y NO se ejecuta la actualización posterior", async () => {
    const bd = conBd(tablasBase(), {
      rpc: { guardar_destinos_aereos_67: () => ({ data: null, error: { message: "destino_aereo_vinculos: vuelo R201 ya no cumple" } }) },
    });
    const r = await actualizarPaquete(PAQUETE_ID, cfg({ destinosAereosAlternativos: true, destinosAereosIds: [20] }));
    assert.equal(r.ok, false);
    if (!r.ok) assert.match(r.error, MSG_DESVINCULAR);
    sinEscrituras(bd);
  });

  test("sin los campos nuevos (formularios anteriores): actualización de siempre, sin tocar el guardado aéreo", async () => {
    const bd = conBd(tablasBase({ check: true, alternativas: [D.SANTO_DOMINGO] }), { rpc: RPC_OK });
    const r = await actualizarPaquete(PAQUETE_ID, cfg({ nombre: "Nuevo nombre" }));
    assert.equal(r.ok, true);
    assert.equal(hayRpc(bd), false);
    assert.equal(bd.tablas.armado_paquetes[0].nombre, "Nuevo nombre");
    assert.equal(bd.tablas.armado_paquetes[0].destinos_aereos_alternativos, true, "la configuración aérea guardada no se pisa");
  });
});

describe("crearPaquete() — alternativas al crear", () => {
  test("crea y guarda las alternativas; si el guardado atómico falla, el paquete recién creado se elimina (sin paquete a medias)", async () => {
    const ok = conBd({ ...tablasBase(), armado_paquetes: [] }, { rpc: RPC_OK });
    const r = await crearPaquete(cfg({ monedaPublicacion: "COP", destinosAereosAlternativos: true, destinosAereosIds: [20, 30] }));
    assert.equal(r.ok, true, r.ok ? "" : r.error);
    assert.ok(hayRpc(ok));

    const mal = conBd({ ...tablasBase(), armado_paquetes: [] }, {
      rpc: { guardar_destinos_aereos_67: () => ({ data: null, error: { message: "destino_aereo_config: no válido" } }) },
    });
    const r2 = await crearPaquete(cfg({ monedaPublicacion: "COP", destinosAereosAlternativos: true, destinosAereosIds: [20, 30] }));
    assert.equal(r2.ok, false);
    assert.equal(mal.tablas.armado_paquetes.length, 0, "el paquete recién creado no queda a medias");
  });

  test("sin los campos nuevos: creación de siempre", async () => {
    const bd = conBd({ ...tablasBase(), armado_paquetes: [] }, { rpc: RPC_OK });
    const r = await crearPaquete(cfg({ monedaPublicacion: "COP" }));
    assert.equal(r.ok, true);
    assert.equal(hayRpc(bd), false);
  });
});

// ═══ 4. generarTarifario(): solo se publican fuentes con destino permitido ═
function tablasGenerar(o: Parameters<typeof tablasBase>[0] = {}, extra: Tablas = {}): Tablas {
  const t = tablasBase(o);
  return {
    ...t,
    armado_hoteles: [{ paquete_id: PAQUETE_ID, hotel_id: 217, categorias: null, regimenes: null }],
    hoteles: [{ id: 217, nombre: "Hotel JD", moneda: "COP", modelo_tarifario: "persona", adults_only: false }],
    armado_servicios: [],
    hotel_temporadas: [{
      hotel_id: 217, nombre: "Base", fecha_inicio: "2000-01-01", fecha_fin: "2099-12-31", prioridad: 1,
      compra_inicio: null, compra_fin: null, tipo: "tarifa", descuento_valor: null, rangos: null, blackouts: null, regimen_restringido: null,
    }],
    tarifa_hotel: [{
      hotel_id: 217, tipo_habitacion: "Estándar", alimentacion: "PAE", temporada: "Base",
      neto_sencilla: 200000, neto_doble: 300000, neto_triple: null, neto_multiple: null,
      neto_nino: null, neto_nino2: null, neto_infante: null, precio_final_autoritativo: false,
    }],
    salidas_dinamicas: [],
    ...extra,
  };
}
const RPC_GENERAR = {
  iniciar_generacion_tarifario: () => ({ data: [{ generacion: 3, revision_capturada: 5 }], error: null }),
  publicar_tarifario_resultado: () => ({ data: true, error: null }),
  marcar_generacion_fallida: () => ({ data: null, error: null }),
};
function publicadas(bd: BdFalsa) {
  const p = bd.rpcs.find((r) => r.nombre === "publicar_tarifario_resultado");
  return ((p?.args.p_filas ?? []) as { bloqueo_id: number | null; empaquetado_id: number | null; modulo: string }[]);
}
async function generar(bd: BdFalsa) {
  const prev = console.error;
  console.error = () => {};
  try { return await generarTarifario(PAQUETE_ID); } finally { console.error = prev; }
}

describe("generarTarifario() — Bloqueo/Sistema con destinos aéreos", () => {
  test("OFF: solo se publican los vuelos del destino comercial (un vínculo antiguo a SDQ se excluye)", async () => {
    const bd = conBd(tablasGenerar({ check: false, vuelosLigados: [101, 201], empaquetadosLigados: [1101, 1201] }), { rpc: RPC_GENERAR });
    const r = await generar(bd);
    assert.equal(r.ok, true, r.ok ? "" : r.error);
    const filas = publicadas(bd);
    assert.deepEqual([...new Set(filas.map((f) => f.bloqueo_id).filter((x) => x != null))], [101]);
    assert.deepEqual([...new Set(filas.map((f) => f.empaquetado_id).filter((x) => x != null))], [1101]);
  });

  test("ON con SDQ y PUJ: se publican comercial + alternativas elegidas, varios vuelos por destino; el de otro país no", async () => {
    const bd = conBd(tablasGenerar({
      check: true, alternativas: [D.SANTO_DOMINGO, D.PUNTA_CANA],
      vuelosLigados: [101, 102, 201, 202, 301, 401], empaquetadosLigados: [1101, 1201, 1301, 1401],
    }), { rpc: RPC_GENERAR });
    const r = await generar(bd);
    assert.equal(r.ok, true, r.ok ? "" : r.error);
    const filas = publicadas(bd);
    assert.deepEqual([...new Set(filas.map((f) => f.bloqueo_id).filter((x) => x != null))].sort(), [101, 102, 201, 202, 301]);
    assert.deepEqual([...new Set(filas.map((f) => f.empaquetado_id).filter((x) => x != null))].sort(), [1101, 1201, 1301]);
  });

  test("todos los vuelos vinculados dejaron de cumplir (país cambiado): no publica y lo dice, distinto de 'selecciona al menos un vuelo'", async () => {
    const tablas = tablasGenerar({ check: true, alternativas: [D.SANTO_DOMINGO], vuelosLigados: [201] }, {});
    tablas.armado_paquetes[0].destino_id = D.CARTAGENA; // el comercial cambió de país; SDQ ya no es comparable
    const bd = conBd(tablas, { rpc: RPC_GENERAR });
    const r = await generar(bd);
    assert.equal(r.ok, false);
    if (!r.ok) assert.match(r.error, /destinos? a[eé]reos?/i);
    assert.equal(bd.rpcs.some((x) => x.nombre === "publicar_tarifario_resultado"), false);
  });

  test("error técnico leyendo la configuración aérea: no publica y no filtra el texto crudo", async () => {
    const bd = conBd(tablasGenerar({ check: true, alternativas: [D.SANTO_DOMINGO], vuelosLigados: [101, 201] }), {
      rpc: RPC_GENERAR, errorLectura: { armado_paquete_destinos_aereos: "boom-secreto" },
    });
    const r = await generar(bd);
    assert.equal(r.ok, false);
    if (!r.ok) assert.doesNotMatch(r.error, /boom-secreto/);
    assert.equal(bd.rpcs.some((x) => x.nombre === "publicar_tarifario_resultado"), false);
  });

  test("regresión #62: un paquete Dinámico con salida manual vigente se genera igual (no pasa por la regla de destinos aéreos)", async () => {
    const hoy = new Date().toLocaleDateString("en-CA", { timeZone: "America/Bogota" });
    const mas = (d: number) => new Date(Date.now() + d * 86400000).toLocaleDateString("en-CA", { timeZone: "America/Bogota" });
    const tablas = tablasGenerar({ paquete: { tipo: "dinamico" } }, {
      salidas_dinamicas: [{
        id: 1, paquete_id: PAQUETE_ID, aerolinea: "AV", ruta: "BOG-SDQ", origen: "BOG", fecha_ida: mas(30), fecha_regreso: mas(33),
        valor_tiquete: 400000, aplica_mk: true, ta: 0, fee_infante: 0, compra_inicio: null, compra_fin: mas(5), activo: true, orden: 0, moneda: "COP",
      }, {
        id: 2, paquete_id: PAQUETE_ID, aerolinea: "AV", ruta: "BOG-SDQ", origen: "BOG", fecha_ida: mas(30), fecha_regreso: mas(33),
        valor_tiquete: 400000, aplica_mk: true, ta: 0, fee_infante: 0, compra_inicio: null, compra_fin: hoy, activo: false, orden: 1, moneda: "COP",
      }],
    });
    const bd = conBd(tablas, { rpc: RPC_GENERAR });
    const r = await generar(bd);
    assert.equal(r.ok, true, r.ok ? "" : r.error);
    const filas = publicadas(bd) as unknown as { salida_id: number | null }[];
    assert.deepEqual([...new Set(filas.map((f) => f.salida_id))], [1], "solo la salida manual vigente (#62), sin tocar su alta manual");
  });

  test("regresión: el alta manual de una salida dinámica sigue funcionando y no consulta destinos aéreos", async () => {
    const bd = conBd({ ...tablasBase({ paquete: { tipo: "dinamico" } }), salidas_dinamicas: [] }, {
      rpc: { iniciar_generacion_tarifario: () => ({ data: null, error: { message: "sin generar" } }) },
    });
    const r = await crearSalidaDinamica(PAQUETE_ID, {
      aerolinea: "AV", ruta: "BOG-SDQ", origen: "BOG", fechaIda: "2026-12-10", fechaRegreso: "2026-12-14",
      horaSalidaIda: "", horaLlegadaIda: "", horaSalidaReg: "", horaLlegadaReg: "", valorTiquete: 400000, aplicaMk: true,
      ta: 0, feeInfante: 0, compraInicio: "", compraFin: "", notas: "",
    });
    assert.equal(r.ok, true);
    assert.equal(bd.tablas.salidas_dinamicas.length, 1);
    assert.ok(!bd.lecturas.includes("armado_paquete_destinos_aereos"));
  });
});

// ═══ 5. computarReserva(): la venta de Bloqueo valida el destino de la fuente ═
function tablasPrecio(o: Parameters<typeof tablasBase>[0] = {}, filasTarifa: Fila[] = []): Tablas {
  const base = tablasBase(o);
  return {
    ...base,
    hoteles: [{
      id: 217, modelo_tarifario: "persona", nombre: "Hotel JD", moneda: "COP",
      edad_infante_min: 0, edad_infante_max: 2, edad_nino_min: 3, edad_nino_max: 12,
      pax_min: 1, pax_max: 4, nino_nota: null, pet_costo_neto: 0, pet_costo_desc: null, pet_nota: null, adults_only: false, pet_friendly: false,
    }],
    tarifario_resultado_publicable: filasTarifa,
    hotel_acomodaciones: [{ hotel_id: 217, acomodacion: "doble", pax_tarifa: 2, pax_max: 4, adt_min: 1, adt_max: 2, chd_min: 0, chd_max: 2, inf_min: 0, inf_max: 2 }],
    hotel_temporadas: [{
      id: 1, hotel_id: 217, nombre: "Base", fecha_inicio: "2000-01-01", fecha_fin: "2099-12-31", prioridad: 1, compra_inicio: null, compra_fin: null,
      tipo: "tarifa", descuento_valor: null, rangos: null, blackouts: null, min_noches: null, regimen_restringido: null,
      condicion_pago_tipo: null, condicion_pago_pct_inicial: null, condicion_pago_dias_saldo: null,
    }],
    tarifa_hotel: [{
      id: 10, hotel_id: 217, tipo_habitacion: "Estándar", alimentacion: "PAE", temporada: "Base",
      neto_sencilla: null, neto_doble: 300000, neto_triple: null, neto_multiple: null, neto_nino: null, neto_nino2: null, neto_infante: null,
      nota_infante: null, notas: null, edad_infante_min: null, edad_infante_max: null, edad_nino_min: null, edad_nino_max: null, precio_final_autoritativo: false,
    }],
    hotel_blackouts: [], armado_servicios: [], servicios_adicionales: [],
  };
}
const filaTarifa = (extra: Fila): Fila => ({
  paquete_id: PAQUETE_ID, hotel_id: 217, categoria: "Estándar", regimen: "PAE", salida_id: null, bloqueo_id: null, empaquetado_id: null,
  acomodacion: "doble", precio_pvp: 1_630_000, hotel_nombre: "Hotel JD", destino_nombre: "JUAN DOLIO",
  fecha_ida: "2026-12-10", fecha_regreso: "2026-12-14", moneda: "COP", impuesto: 100_000, ...extra,
});
function inputBloqueo(over: Record<string, unknown> = {}) {
  return {
    paqueteId: PAQUETE_ID, bloqueoId: 201, empaquetadoId: null, salidaId: null, modulo: "bloqueo" as const, hotelId: 217,
    categoria: "Estándar", regimen: "PAE", habitaciones: { doble: 1 }, ninos: 0, ninos2: 0, infantes: 0,
    cliente: { nombres: "Juan", apellidos: "Pérez", tipoDoc: "CC", numeroDoc: "123", telefono: "300", email: "a@a.com" },
    tipoAsesor: "interno" as const, asesorInterno: "Asesor", agenciaNombre: "", agenciaAsesor: "", freelanceNombre: "",
    aliadoId: null, plazo: "24 horas", servicios: [],
    pasajeros: [
      { nombres: "Juan", apellidos: "Pérez", tipoDoc: "CC", numeroDoc: "123", fechaNacimiento: "1990-01-01", nacionalidad: "CO", esInfante: false },
      { nombres: "Ana", apellidos: "Pérez", tipoDoc: "CC", numeroDoc: "456", fechaNacimiento: "1992-01-01", nacionalidad: "CO", esInfante: false },
    ],
    ...over,
  };
}
async function reservarBloqueo(tablasSb: Tablas, tablasAdmin: Tablas, input: Record<string, unknown>, o: Parameters<typeof crearBd>[1] = {}) {
  const sbBd = crearBd(tablasSb, { joins: JOINS_ARMADO });
  const adminBd = crearBd(tablasAdmin, { joins: JOINS_ARMADO, ...o });
  adminActual = adminBd.cliente;
  const r = await computarReserva(sbBd.cliente as Parameters<typeof computarReserva>[0], input as Parameters<typeof computarReserva>[1]);
  return { r, sbBd, adminBd };
}
const TARIFAS_BLOQUEO = [
  filaTarifa({ bloqueo_id: 101 }), filaTarifa({ bloqueo_id: 201 }), filaTarifa({ bloqueo_id: 301 }), filaTarifa({ bloqueo_id: 401 }),
  filaTarifa({ empaquetado_id: 1201 }), filaTarifa({ empaquetado_id: 1401 }), filaTarifa({ empaquetado_id: 1101 }),
];

describe("computarReserva() — Bloqueo valida el destino aéreo de la fuente elegida", () => {
  test("OFF: el vuelo del destino comercial se vende con su precio; el de SDQ se rechaza sin leer precio", async () => {
    const t = tablasPrecio({ check: false }, TARIFAS_BLOQUEO);
    const ok = await reservarBloqueo(t, t, inputBloqueo({ bloqueoId: 101 }));
    assert.equal(ok.r.ok, true, ok.r.ok ? "" : ok.r.error);
    if (ok.r.ok) assert.equal(ok.r.data.precioVenta, 3_260_000, "precio de la fila del tarifario intacto (2 pax × 1.630.000)");

    const mal = await reservarBloqueo(t, t, inputBloqueo({ bloqueoId: 201 }));
    assert.equal(mal.r.ok, false);
    if (!mal.r.ok) assert.match(mal.r.error, MSG_NO_PERMITIDO);
    assert.ok(!mal.sbBd.lecturas.includes("tarifario_resultado_publicable"), "el rechazo ocurre antes de leer el precio");
  });

  test("ON con SDQ/PUJ elegidos: se vende (precio intacto); fuera de la lista, otro país y fuente sin destino se rechazan", async () => {
    const t = tablasPrecio({ check: true, alternativas: [D.SANTO_DOMINGO, D.PUNTA_CANA] }, TARIFAS_BLOQUEO);
    for (const id of [101, 201, 301]) {
      const x = await reservarBloqueo(t, t, inputBloqueo({ bloqueoId: id }));
      assert.equal(x.r.ok, true, `bloqueo ${id}: ${x.r.ok ? "" : x.r.error}`);
      if (x.r.ok) assert.equal(x.r.data.precioVenta, 3_260_000);
    }
    const t2 = tablasPrecio({ check: true, alternativas: [D.SANTO_DOMINGO, D.PUNTA_CANA] }, [...TARIFAS_BLOQUEO, filaTarifa({ bloqueo_id: 901 }), filaTarifa({ bloqueo_id: 501 })]);
    for (const id of [401, 901, 501]) {
      const x = await reservarBloqueo(t2, t2, inputBloqueo({ bloqueoId: id }));
      assert.equal(x.r.ok, false, `bloqueo ${id} debe rechazarse`);
    }
  });

  test("vuelo por Sistema (empaquetado): mismas reglas", async () => {
    const t = tablasPrecio({ check: true, alternativas: [D.SANTO_DOMINGO] }, TARIFAS_BLOQUEO);
    const ok = await reservarBloqueo(t, t, inputBloqueo({ bloqueoId: null, empaquetadoId: 1201 }));
    assert.equal(ok.r.ok, true, ok.r.ok ? "" : ok.r.error);
    const mal = await reservarBloqueo(t, t, inputBloqueo({ bloqueoId: null, empaquetadoId: 1401 }));
    assert.equal(mal.r.ok, false);
  });

  test("cambio posterior de país del destino alternativo: la venta se rechaza aunque el tarifario siga publicado", async () => {
    const t = tablasPrecio({ check: true, alternativas: [D.SANTO_DOMINGO] }, TARIFAS_BLOQUEO);
    (t.destinos.find((d) => d.id === D.SANTO_DOMINGO) as Fila).pais = "Colombia";
    const x = await reservarBloqueo(t, t, inputBloqueo({ bloqueoId: 201 }));
    assert.equal(x.r.ok, false);
    if (!x.r.ok) assert.match(x.r.error, MSG_NO_PERMITIDO);
  });

  test("cambio posterior del destino de la fuente (origen): la venta se rechaza", async () => {
    const t = tablasPrecio({ check: true, alternativas: [D.SANTO_DOMINGO] }, TARIFAS_BLOQUEO);
    (t.bloqueos_vuelo.find((b) => b.id === 201) as Fila).destino_id = D.CARTAGENA;
    const x = await reservarBloqueo(t, t, inputBloqueo({ bloqueoId: 201 }));
    assert.equal(x.r.ok, false);
  });

  test("la validación usa el cliente de servicio: la sesión (sin tablas de destinos) no se consulta para eso", async () => {
    const tSb = tablasPrecio({ check: true, alternativas: [D.SANTO_DOMINGO] }, TARIFAS_BLOQUEO);
    for (const k of ["destinos", "armado_paquete_destinos_aereos", "bloqueos_vuelo"]) delete (tSb as Record<string, unknown>)[k];
    const tAdmin = tablasPrecio({ check: true, alternativas: [D.SANTO_DOMINGO] }, TARIFAS_BLOQUEO);
    const x = await reservarBloqueo(tSb, tAdmin, inputBloqueo({ bloqueoId: 201 }));
    assert.equal(x.r.ok, true, x.r.ok ? "" : x.r.error);
  });

  test("error técnico de lectura: rechaza con mensaje técnico (no 'no corresponde') y sin precio", async () => {
    const t = tablasPrecio({ check: true, alternativas: [D.SANTO_DOMINGO] }, TARIFAS_BLOQUEO);
    const x = await reservarBloqueo(t, t, inputBloqueo({ bloqueoId: 201 }), { errorLectura: { destinos: "boom" } });
    assert.equal(x.r.ok, false);
    if (!x.r.ok) { assert.match(x.r.error, MSG_TECNICO); assert.doesNotMatch(x.r.error, MSG_NO_PERMITIDO); }
  });

  test("fuente borrada o paquete sin destino comercial: la venta rechaza (regla estricta), aunque la fila siga publicada", async () => {
    const t = tablasPrecio({ check: false }, TARIFAS_BLOQUEO);
    t.bloqueos_vuelo = t.bloqueos_vuelo.filter((b) => b.id !== 101);
    const x = await reservarBloqueo(t, t, inputBloqueo({ bloqueoId: 101 }));
    assert.equal(x.r.ok, false);

    const t2 = tablasPrecio({ check: false, paquete: { destino_id: null } }, TARIFAS_BLOQUEO);
    const y = await reservarBloqueo(t2, t2, inputBloqueo({ bloqueoId: 101 }));
    assert.equal(y.r.ok, false);
  });
});

// ═══ 6. Cargadores de la vitrina: filtro post-carga, resumen y detalle ════
const MSG_CARGA = /No fue posible cargar el tarifario/;
const MSG_DETALLE = "No fue posible cargar el detalle en este momento. Intenta nuevamente en unos segundos.";
const filaBloq = (bloqueo_id: number | null, empaquetado_id: number | null = null, extra: Fila = {}): Fila => ({
  modulo: "bloqueo", hotel_id: null, categoria: "Estándar", regimen: "PAE", paquete_id: PAQUETE_ID, bloqueo_id, empaquetado_id,
  fecha_ida: "2099-12-10", fecha_regreso: "2099-12-14", noches: 4, ...extra,
});
const idsFilas = (filas: Fila[]) => filas.map((f) => (f.bloqueo_id ?? `e${f.empaquetado_id}`));

describe("aplicarFiltrosPostCarga() — oculta ofertas cuya fuente ya no cumple el destino aéreo", () => {
  test("OFF oculta SDQ aunque siga publicado; ON conserva comercial + alternativas y oculta otro país/sin destino", async () => {
    const filas = [filaBloq(101), filaBloq(201), filaBloq(301), filaBloq(401), filaBloq(501), filaBloq(null, 1201), filaBloq(null, 1101)];
    const off = conBd(tablasBase({ check: false }));
    const rOff = await aplicarFiltrosPostCarga(off.cliente as never, filas as never);
    assert.deepEqual(idsFilas(rOff.filas as Fila[]), [101, "e1101"]);

    const on = conBd(tablasBase({ check: true, alternativas: [D.SANTO_DOMINGO, D.PUNTA_CANA] }));
    const rOn = await aplicarFiltrosPostCarga(on.cliente as never, filas as never);
    assert.deepEqual(idsFilas(rOn.filas as Fila[]), [101, 201, 301, "e1201", "e1101"]);
    assert.equal((rOn as unknown as { errorOrigenAereo: unknown }).errorOrigenAereo, null);
  });

  test("cambio posterior de país: la oferta se oculta sin error técnico (es un resultado de negocio)", async () => {
    const t = tablasBase({ check: true, alternativas: [D.SANTO_DOMINGO] });
    (t.destinos.find((d) => d.id === D.SANTO_DOMINGO) as Fila).pais = "Colombia";
    const bd = conBd(t);
    const r = await aplicarFiltrosPostCarga(bd.cliente as never, [filaBloq(101), filaBloq(201)] as never);
    assert.deepEqual(idsFilas(r.filas as Fila[]), [101]);
    assert.equal((r as unknown as { errorOrigenAereo: unknown }).errorOrigenAereo, null);
  });

  test("error de lectura o ausencia de cliente: fallo cerrado (se ocultan las filas de Bloqueo con fuente) y se expone errorOrigenAereo aparte", async () => {
    const filas = [filaBloq(101), filaBloq(201), { modulo: "servicios", hotel_id: null, paquete_id: 9, bloqueo_id: null, empaquetado_id: null, fecha_ida: null }];
    const bd = conBd(tablasBase({ check: true, alternativas: [D.SANTO_DOMINGO] }), { errorLectura: { bloqueos_vuelo: "boom" } });
    const r = await aplicarFiltrosPostCarga(bd.cliente as never, filas as never);
    assert.deepEqual((r.filas as Fila[]).map((f) => f.modulo), ["servicios"]);
    assert.ok((r as unknown as { errorOrigenAereo: unknown }).errorOrigenAereo);

    const sin = await aplicarFiltrosPostCarga(null, filas as never);
    assert.deepEqual((sin.filas as Fila[]).map((f) => f.modulo), ["servicios"]);
    assert.ok((sin as unknown as { errorOrigenAereo: unknown }).errorOrigenAereo);
  });

  test("filas que no son de Bloqueo con fuente (porción, servicios, dinámico) no se tocan ni consultan destinos aéreos", async () => {
    const bd = conBd(tablasBase({ check: false }));
    const filas = [
      { modulo: "porcion_terrestre", hotel_id: null, paquete_id: 2, bloqueo_id: null, empaquetado_id: null, fecha_ida: "2020-01-01" },
      { modulo: "servicios", hotel_id: null, paquete_id: 3, bloqueo_id: null, empaquetado_id: null, fecha_ida: null },
    ];
    const r = await aplicarFiltrosPostCarga(bd.cliente as never, filas as never);
    assert.equal((r.filas as Fila[]).length, 2);
    assert.ok(!bd.lecturas.includes("armado_paquete_destinos_aereos"));
  });

  test("sin evidencia en contra (fuente borrada o paquete sin destino comercial): la vitrina NO oculta la fila — como hoy — y la venta la rechaza (ver computarReserva)", async () => {
    const sinFuente = tablasBase({ check: false });
    sinFuente.bloqueos_vuelo = sinFuente.bloqueos_vuelo.filter((b) => b.id !== 101);
    const r1 = await aplicarFiltrosPostCarga(conBd(sinFuente).cliente as never, [filaBloq(101)] as never);
    assert.equal((r1.filas as Fila[]).length, 1);
    assert.equal((r1 as unknown as { errorOrigenAereo: unknown }).errorOrigenAereo, null);

    const sinDestino = tablasBase({ check: false, paquete: { destino_id: null } });
    const r2 = await aplicarFiltrosPostCarga(conBd(sinDestino).cliente as never, [filaBloq(101)] as never);
    assert.equal((r2.filas as Fila[]).length, 1, "nunca se convierte en 'ofrecer todos los vuelos': solo no hay evidencia para ocultar");
  });
});

function tablasCarga(o: Parameters<typeof tablasBase>[0] = {}, extra: Tablas = {}): Tablas {
  return {
    ...tablasBase(o),
    cupos_por_bloqueo: [], hotel_temporadas: [], tarifa_hotel: [], hotel_fotos: [], hoteles: [], hotel_acomodaciones: [],
    servicios_adicionales: [], planes_alimentacion: [], armado_servicios: [], armado_hoteles: [], salidas_dinamicas: [], ...extra,
  };
}
const filaResumen = (bloqueo_id: number | null, empaquetado_id: number | null = null): Fila => ({
  modulo: "bloqueo", paquete_id: PAQUETE_ID, paquete_nombre: "Juan Dolio", bloqueo_id, bloqueo_label: "BOG-SDQ", empaquetado_id, salida_id: null,
  hotel_id: null, hotel_nombre: "Hotel JD", servicio_id: null, servicio_nombre: null, destino_id: D.JUAN_DOLIO, destino_nombre: "JUAN DOLIO",
  categoria: "Estándar", regimen: "PAE", fecha_ida: "2099-12-10", fecha_regreso: "2099-12-14", noches: 4, moneda: "COP",
  precio_sencilla: null, precio_doble: 1_630_000, precio_triple: null, precio_multiple: null, precio_nino: null, precio_nino2: null, precio_infante: null,
  desde_adulto: 1_630_000, desde_general: 1_630_000, descripcion: null, recargo_individual: null, tipo_tarifa: null,
});

describe("cargarResumenTarifario() — la vitrina real", () => {
  test("oculta la oferta de SDQ con check OFF y la conserva con check ON; sin error", async () => {
    const off = conBd(tablasCarga({ check: false }, { tarifario_resumen: [filaResumen(101), filaResumen(201)] }));
    const rOff = await cargarResumenTarifario(off.cliente as never, "t", "f", off.cliente as never);
    assert.equal(rOff.ok, true);
    if (rOff.ok) assert.deepEqual(rOff.datos.filasVisibles.map((f) => f.bloqueo_id), [101]);

    const on = conBd(tablasCarga({ check: true, alternativas: [D.SANTO_DOMINGO] }, { tarifario_resumen: [filaResumen(101), filaResumen(201)] }));
    const rOn = await cargarResumenTarifario(on.cliente as never, "t", "f", on.cliente as never);
    assert.equal(rOn.ok, true);
    if (rOn.ok) assert.deepEqual(rOn.datos.filasVisibles.map((f) => f.bloqueo_id).sort(), [101, 201]);
  });

  test("error técnico de lectura: ok:false con el mensaje público de carga (nunca 'sin disponibilidad' ni catálogo parcial)", async () => {
    const bd = conBd(tablasCarga({ check: true, alternativas: [D.SANTO_DOMINGO] }, { tarifario_resumen: [filaResumen(101), filaResumen(201)] }), { errorLectura: { destinos: "boom" } });
    const r = await cargarResumenTarifario(bd.cliente as never, "t", "f", bd.cliente as never);
    assert.equal(r.ok, false);
    if (!r.ok) { assert.match(r.error, MSG_CARGA); assert.doesNotMatch(r.error, /boom/); }
  });
});

describe("obtenerDetalleSalida() — detalle bajo demanda de un vuelo de Bloqueo", () => {
  const combo = (bloqueo_id: number) => ({
    modulo: "bloqueo", paquete_id: PAQUETE_ID, bloqueo_id, salida_id: null, hotel_id: null, categoria: "Estándar", regimen: "PAE",
    fecha_ida: "2099-12-10", fecha_regreso: "2099-12-14", moneda: "COP",
  });
  const filaDetalle = (bloqueo_id: number): Fila => ({
    modulo: "bloqueo", bloqueo_label: "BOG-SDQ", bloqueo_id, empaquetado_id: null, salida_id: null, paquete_id: PAQUETE_ID, hotel_id: null,
    fecha_ida: "2099-12-10", fecha_regreso: "2099-12-14", noches: 4, destino_nombre: "JUAN DOLIO", paquete_nombre: "Juan Dolio",
    hotel_nombre: "Hotel JD", categoria: "Estándar", regimen: "PAE", acomodacion: "doble", precio_pvp: 1_630_000, moneda: "COP", paquete_activo: true,
  });
  async function detalle(bd: BdFalsa, bloqueoId: number) {
    return obtenerDetalleSalida({ modulo: "bloqueo", bloqueoId, combos: [combo(bloqueoId)] });
  }

  test("OFF oculta el detalle de SDQ (0 filas, ok); ON lo devuelve", async () => {
    const off = conBd(tablasCarga({ check: false }, { tarifario_resultado_publicable: [filaDetalle(201)] }));
    const r1 = await detalle(off, 201);
    assert.equal(r1.ok, true);
    if (r1.ok) assert.equal(r1.filas.length, 0);

    const on = conBd(tablasCarga({ check: true, alternativas: [D.SANTO_DOMINGO] }, { tarifario_resultado_publicable: [filaDetalle(201)] }));
    const r2 = await detalle(on, 201);
    assert.equal(r2.ok, true);
    if (r2.ok) assert.equal(r2.filas.length, 1);
  });

  test("error técnico: ok:false con el mensaje público existente, no 'sin disponibilidad'", async () => {
    const bd = conBd(tablasCarga({ check: true, alternativas: [D.SANTO_DOMINGO] }, { tarifario_resultado_publicable: [filaDetalle(201)] }), { errorLectura: { bloqueos_vuelo: "boom" } });
    const r = await detalle(bd, 201);
    assert.equal(r.ok, false);
    if (!r.ok) assert.equal(r.error, MSG_DETALLE);
  });
});
