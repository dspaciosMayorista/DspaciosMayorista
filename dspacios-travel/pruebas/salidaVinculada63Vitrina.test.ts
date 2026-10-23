import { test, describe } from "node:test";
import assert from "node:assert/strict";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "../types/database.ts";
import { filtrarFilasPorOrigenAereo, vinculosIncompatibles } from "../lib/paquetes/destinosAereos67.ts";
import { crearClienteFalso, type FilaFalsa, type TablasFalsas } from "./support/fakeSupabase.ts";

// #63 — la VITRINA (filas ya publicadas, que son una caché) oculta una salida vinculada cuya fuente ya no es elegible:
// con record (PNR agregado después), desactivada, fuera de compra, con copia vieja o con destino aéreo no permitido (#67/220).
// Las salidas manuales y los demás módulos no se tocan. Con error de lectura se ocultan las dinámicas con salida y se informa.

function fechaBogota(offsetDias: number): string {
  return new Date(Date.now() + offsetDias * 86400000).toLocaleDateString("en-CA", { timeZone: "America/Bogota" });
}
const IDA = fechaBogota(30);
const REG = fechaBogota(33);
const AYER = fechaBogota(-1);
const PAQUETE_ID = 70;

const fuente = (o: FilaFalsa = {}): FilaFalsa => ({
  id: 5, activo: true, record: null, compra_inicio: null, compra_fin: null, fecha_ida: IDA, fecha_regreso: REG,
  ruta: "BOG - CTG - BOG", aerolinea: "JetSMART", destino_id: 1, moneda: "COP", tarifa_para_empaquetar: 1_130_000, fee_infante: 80_500, ...o,
});
const salida = (o: FilaFalsa = {}): FilaFalsa => ({
  id: 11, paquete_id: PAQUETE_ID, empaquetado_id: 5, fecha_ida: IDA, fecha_regreso: REG, ruta: "BOG - CTG - BOG", aerolinea: "JetSMART",
  valor_tiquete: 1_130_000, fee_infante: 80_500, ...o,
});
function tablas(o: { salidas?: FilaFalsa[]; fuentes?: FilaFalsa[]; destinoPaquete?: number } = {}): TablasFalsas {
  return {
    salidas_dinamicas: o.salidas ?? [salida()],
    empaquetados: o.fuentes ?? [fuente()],
    armado_paquetes: [{ id: PAQUETE_ID, destino_id: o.destinoPaquete ?? 1, destinos_aereos_alternativos: false }],
    destinos: [{ id: 1, nombre: "CARTAGENA", codigo_iata: "CTG", pais: "Colombia", activo: true }],
    armado_paquete_destinos_aereos: [],
    bloqueos_vuelo: [],
  };
}
const filaDin = (salidaId: number | null, extra: FilaFalsa = {}): FilaFalsa => ({ modulo: "dinamico", paquete_id: PAQUETE_ID, salida_id: salidaId, bloqueo_id: null, empaquetado_id: null, ...extra });

async function filtrar(t: TablasFalsas, filas: FilaFalsa[]) {
  const admin = crearClienteFalso(t) as unknown as SupabaseClient<Database>;
  return filtrarFilasPorOrigenAereo(admin, filas as never);
}
const salidasDe = (r: { filas: FilaFalsa[] }) => r.filas.map((f) => f.salida_id);

describe("vitrina · salida vinculada elegible vs no elegible", () => {
  test("elegible: se conserva", async () => {
    const r = await filtrar(tablas(), [filaDin(11)]);
    assert.deepEqual(salidasDe(r), [11]);
    assert.equal(r.errorOrigenAereo, null);
  });
  const ocultas: [string, TablasFalsas][] = [
    ["la fuente recibió un record (PNR) después de publicar", tablas({ fuentes: [fuente({ record: "L93FYZ" })] })],
    ["la fuente se desactivó", tablas({ fuentes: [fuente({ activo: false })] })],
    ["la ventana de compra de la fuente venció", tablas({ fuentes: [fuente({ compra_fin: AYER })] })],
    ["la copia de la salida quedó vieja (cambió la tarifa)", tablas({ fuentes: [fuente({ tarifa_para_empaquetar: 1_200_000 })] })],
    ["la copia de la salida quedó vieja (cambió el fee de infante)", tablas({ fuentes: [fuente({ fee_infante: 99_000 })] })],
    ["el destino de la fuente ya no está permitido por el paquete (#67/220)", tablas({ fuentes: [fuente({ destino_id: 2 })] })],
    ["la fuente ya no existe", tablas({ fuentes: [] })],
  ];
  for (const [nombre, t] of ocultas) {
    test(`oculta: ${nombre}`, async () => {
      const r = await filtrar(t, [filaDin(11)]);
      assert.deepEqual(salidasDe(r), []);
      assert.equal(r.errorOrigenAereo, null, "ocultar por evidencia positiva no es un error técnico");
    });
  }
  test("una salida MANUAL y las filas de otros módulos no se tocan", async () => {
    const t = tablas({ salidas: [salida(), salida({ id: 12, empaquetado_id: null })], fuentes: [fuente({ record: "L93FYZ" })] });
    const r = await filtrar(t, [filaDin(11), filaDin(12), { modulo: "porcion_terrestre", paquete_id: PAQUETE_ID, salida_id: null, bloqueo_id: null, empaquetado_id: null }]);
    assert.deepEqual(r.filas.map((f) => f.modulo + ":" + f.salida_id), ["dinamico:12", "porcion_terrestre:null"]);
  });
  test("sin cliente de servicio no hay evidencia: no se oculta nada (computarReserva la rechaza igual)", async () => {
    const r = await filtrarFilasPorOrigenAereo(null, [filaDin(11)] as never);
    assert.deepEqual(salidasDe(r as { filas: FilaFalsa[] }), [11]);
  });
  test("error al leer las salidas: se ocultan las dinámicas con salida y se informa un error técnico (nunca 'disponible')", async () => {
    const admin = {
      from(t: string) {
        if (t !== "salidas_dinamicas") return crearClienteFalso(tablas()).from(t);
        const b: Record<string, unknown> = {};
        for (const m of ["select", "eq", "in"]) b[m] = () => b;
        b.then = (res: (v: unknown) => unknown) => Promise.resolve({ data: null, error: { message: "permission denied" } }).then(res);
        return b;
      },
    } as unknown as SupabaseClient<Database>;
    const r = await filtrarFilasPorOrigenAereo(admin, [filaDin(11), { modulo: "porcion_terrestre", paquete_id: PAQUETE_ID, salida_id: null, bloqueo_id: null, empaquetado_id: null }] as never);
    assert.deepEqual(r.filas.map((f) => (f as FilaFalsa).modulo), ["porcion_terrestre"]);
    assert.ok(r.errorOrigenAereo instanceof Error);
    assert.doesNotMatch((r.errorOrigenAereo as Error).message, /permission denied/);
  });
});

describe("#67 · retirar un destino cuenta también las salidas vinculadas", () => {
  test("una salida vinculada hacia un destino que dejaría de ser válido AFECTA el guardado", async () => {
    const t = tablas({ fuentes: [fuente({ destino_id: 2, ruta: "BOG - SMR - BOG" })] });
    t.armado_vuelos = []; t.armado_empaquetados = [];
    const sb = crearClienteFalso(t, { joins: { salidas_dinamicas: { empaquetados: "empaquetado_id" } } }) as unknown as SupabaseClient<Database>;
    // el fake no soporta .not(): se envuelve para el filtro de "empaquetado_id no nulo"
    const envuelto = { ...sb, from(tabla: string) { const q = (sb as unknown as { from(t: string): Record<string, unknown> }).from(tabla); return Object.assign(q, { not: () => q }); } } as unknown as SupabaseClient<Database>;
    const r = await vinculosIncompatibles(envuelto, PAQUETE_ID, [1]);
    assert.equal(r.ok, true);
    if (r.ok) {
      assert.equal(r.afectados.length, 1);
      assert.deepEqual(r.afectados[0].fuente, { tipo: "empaquetado", id: 5 });
    }
  });
});
