// #89 — Vista Booking: portada de servicios receptivos. Reproducción con datos sintéticos de las dos
// hipótesis, corriendo el cargador REAL de la página (`cargarResumenTarifario`, que arma `fotosPorServicio`)
// y la búsqueda en vivo REAL (`buscarReceptivos`) sobre un cliente Supabase falso con retrasos y fallos
// por tabla.
//   A) La búsqueda en vivo devuelve servicios cuyo id no está en el mapa de fotos de la página.
//   B) La consulta de fotos tarda o falla.
import { test, describe, mock } from "node:test";
import assert from "node:assert/strict";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "../types/database.ts";

type Tabla = { rows: Record<string, unknown>[]; delayMs?: number; error?: { message: string } | null };
type Consulta = { tabla: string; filtros: string[] };
const consultas: Consulta[] = [];

function cliente(tablas: Record<string, Tabla>) {
  const from = (tabla: string) => {
    const preds: ((r: Record<string, unknown>) => boolean)[] = [];
    const filtros: string[] = [];
    let rango: [number, number] | null = null;
    let unico = false;
    const q = {
      select() { return q; }, order() { return q; }, limit() { return q; }, gte() { return q; }, lte() { return q; }, or() { return q; },
      eq(c: string, v: unknown) { filtros.push(`${c}=${v}`); preds.push((r) => !(c in r) || r[c] === v); return q; },
      in(c: string, vs: unknown[]) { filtros.push(`${c} in ${vs.length}`); preds.push((r) => !(c in r) || vs.includes(r[c])); return q; },
      not(c: string, op: string, v: unknown) { if (op === "is" && v === null) preds.push((r) => r[c] != null); return q; },
      is(c: string, v: unknown) { preds.push((r) => !(c in r) || r[c] === v); return q; },
      range(f: number, t: number) { rango = [f, t]; return q; },
      maybeSingle() { unico = true; return q; }, single() { unico = true; return q; },
      then(res: (v: unknown) => void, rej?: (e: unknown) => void) {
        consultas.push({ tabla, filtros });
        const t = tablas[tabla] ?? { rows: [] };
        const filas = t.rows.filter((r) => preds.every((p) => p(r)));
        const [f, h] = rango ?? [0, Number.MAX_SAFE_INTEGER];
        const data = t.error ? null : unico ? (filas[0] ?? null) : filas.slice(f, h + 1);
        return new Promise((ok) => setTimeout(ok, t.delayMs ?? 0)).then(() => ({ data, error: t.error ?? null })).then(res, rej);
      },
    };
    return q;
  };
  return { from, rpc: () => from("__rpc") } as unknown as SupabaseClient<Database>;
}

process.env.SUPABASE_SERVICE_ROLE_KEY ??= "clave-sintetica-de-prueba"; // buscarReceptivos exige la variable; el cliente real se sustituye abajo
let adminActual: SupabaseClient<Database>;
mock.module("@/lib/supabase/admin", { namedExports: { createAdminClient: () => adminActual } });
const { cargarResumenTarifario } = await import("../lib/tarifario/resumen.ts");
const { buscarReceptivos } = await import("../lib/reservar/cotizar.ts");

const enDias = (d: number) => new Date(Date.now() + d * 86400000).toLocaleDateString("en-CA", { timeZone: "America/Bogota" });
const filaServicio = (paquete_id: number, servicio_id: number) => ({
  modulo: "servicios", paquete_id, paquete_nombre: `Paquete ${paquete_id}`, bloqueo_id: null, bloqueo_label: null, empaquetado_id: null, salida_id: null,
  hotel_id: null, hotel_nombre: null, servicio_id, servicio_nombre: `Tour ${servicio_id}`, destino_id: 7, destino_nombre: "CARTAGENA", categoria: null, regimen: null,
  fecha_ida: null, fecha_regreso: null, noches: null, moneda: "COP", precio_sencilla: null, precio_doble: null, precio_triple: null, precio_multiple: null,
  precio_nino: null, precio_nino2: null, precio_infante: null, desde_adulto: 100000, desde_general: 100000, descripcion: null, recargo_individual: null, tipo_tarifa: null,
});
// Paquete 70 es tipo «servicios»; el 80 es un Bloqueo que ofrece el Tour 2 como servicio opcional (add-on).
function tablas(extra: Partial<Record<string, Tabla>> = {}): Record<string, Tabla> {
  return {
    tarifario_resumen: { rows: [filaServicio(70, 1), filaServicio(80, 2)] },
    tarifario_resultado_publicable: { rows: [
      { modulo: "servicios", paquete_activo: true, paquete_id: 70, servicio_id: 1, servicio_nombre: "Tour 1", destino_nombre: "CARTAGENA", descripcion: null },
      { modulo: "servicios", paquete_activo: true, paquete_id: 80, servicio_id: 2, servicio_nombre: "Tour 2", destino_nombre: "CARTAGENA", descripcion: null },
    ] },
    armado_paquetes: { rows: [{ id: 70, tipo: "servicios", pct_mk: 0.2 }, { id: 80, tipo: "bloqueo", pct_mk: 0.2 }] },
    armado_servicios: { rows: [{ paquete_id: 70, servicio_id: 1, modo: "persona", incluido: false }, { paquete_id: 80, servicio_id: 2, modo: "persona", incluido: false }] },
    servicios_adicionales: { rows: [
      { id: 1, foto_url: "https://img.test/tour-1.jpg", precio_persona: 80000, recargo_individual: null, liquidacion: "persona", moneda: "COP", categoria: "tour", proveedor_id: null },
      { id: 2, foto_url: "https://img.test/tour-2.jpg", precio_persona: 80000, recargo_individual: null, liquidacion: "persona", moneda: "COP", categoria: "tour", proveedor_id: null },
    ] },
    servicio_temporadas: { rows: [1, 2].map((servicio_id) => ({ id: 900 + servicio_id, servicio_id, nombre: "2026", fecha_inicio: enDias(-30), fecha_fin: enDias(300), compra_inicio: null, compra_fin: null, prioridad: 1, precio_persona: 80000, precio_infante: null, recargo_individual: null, servicio_suplementos_franja: [] })) },
    ...extra,
  } as Record<string, Tabla>;
}
async function pagina(t: Record<string, Tabla>) {
  const sb = cliente(t);
  const r = await cargarResumenTarifario(sb, "test", "p89", sb);
  assert.equal(r.ok, true, "la página debe cargar");
  if (!r.ok) throw new Error("no cargó");
  return r.datos;
}
async function enVivo(t: Record<string, Tabla>) {
  adminActual = cliente(t);
  const r = await buscarReceptivos({ fechaIda: enDias(30), fechaRegreso: enDias(33), pax: 2, destino: "CARTAGENA" });
  assert.equal(r.ok, true, r.ok ? "" : r.error);
  return r.ok ? r.resultados : [];
}

describe("#89 reproducción", () => {
  test("A) la búsqueda en vivo devuelve un servicio de un Bloqueo sin portada en el mapa de la página", async () => {
    const datos = await pagina(tablas());
    const vivos = await enVivo(tablas());
    assert.deepEqual(vivos.map((r) => r.servicioId).sort(), [1, 2], "la búsqueda en vivo cotiza los dos servicios");
    const sinFoto = vivos.filter((r) => !datos.fotosPorServicio[r.servicioId]).map((r) => r.servicioId);
    console.log(`[#89 A] en vivo=${vivos.map((r) => `${r.paqueteId}/${r.servicioId}`).join(",")} fotos=${Object.keys(datos.fotosPorServicio).join(",")} sin_foto=${sinFoto.join(",")}`);
    assert.deepEqual(sinFoto, [], "cada resultado en vivo con foto_url debe tener su portada");
  });

  test("B1) consulta de fotos lenta (1,5 s): solo demora, la portada llega y corresponde a su servicio", async () => {
    const t = tablas();
    t.servicios_adicionales.delayMs = 1500;
    const t0 = performance.now();
    const datos = await pagina(t);
    console.log(`[#89 B1] ms=${Math.round(performance.now() - t0)} fotos=${JSON.stringify(datos.fotosPorServicio)}`);
    assert.equal(datos.fotosPorServicio[1], "https://img.test/tour-1.jpg");
    for (const [id, url] of Object.entries(datos.fotosPorServicio)) assert.match(url, new RegExp(`tour-${id}\\.jpg$`), "nunca la portada de otro servicio");
  });

  test("B2) consulta de fotos fallida: sin portadas, fallo marcado, sin reintento", async () => {
    const t = tablas();
    t.servicios_adicionales.error = { message: "canceling statement due to statement timeout" };
    consultas.length = 0;
    const datos = await pagina(t);
    console.log(`[#89 B2] fotos=${JSON.stringify(datos.fotosPorServicio)} consultas_fotos=${consultas.filter((c) => c.tabla === "servicios_adicionales").length}`);
    assert.deepEqual(datos.fotosPorServicio, {});
    assert.equal(consultas.filter((c) => c.tabla === "servicios_adicionales").length, 1, "una sola consulta: sin reintentos");
  });
});
