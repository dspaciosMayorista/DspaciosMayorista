import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { evaluarHotelPorFechas, type DatosHotelPaquete, type FilaServicioIncluidoRaw } from "../lib/reservar/liquidacionHotel.ts";
import { construirComposicion, type BaseMotor } from "../lib/cotizacion/composicionPrecio.ts";
import { guardarComposicionMejorEsfuerzo, leerComposicionGuardada } from "../lib/cotizacion/composicionServidor.ts";

// Recorrido: solicitud pendiente_tarifa → valoración (cargar_neta_solicitud) → composición privada → ficha interna.
const srv: FilaServicioIncluidoRaw = { incluido: true, precio_persona: 80_000, liquidacion: "paquete", servicio_id: 1, modo: "persona", nombre: "Traslados", categoria: "otro", proveedor_id: null, rangos_grupo: [],
  vigencias: { servicioId: 1, nombre: "Traslados", conFranjas: new Set<string>(), temporadas: [{ nombre: "V", fecha_inicio: "2000-01-01", fecha_fin: "2099-12-31", precio_persona: 80_000, precio_infante: null }], grupos: [] } };
const datos: DatosHotelPaquete = {
  paquete: { pct_mk: 0.2, pvp_infante_fijo: null, impuesto_fijo: 50_000, destino_nombre: "Cartagena", fecha_viaje_inicio: "2026-01-01", fecha_viaje_fin: "2026-12-31" },
  armadoHotel: { categorias: null, regimenes: null, hotel_nombre: "Hotel", hotel_moneda: "COP" },
  temporadas: [{ nombre: "ALTA", fecha_inicio: "2026-09-01", fecha_fin: "2026-09-15", prioridad: 1, compra_inicio: null, compra_fin: null, tipo: "tarifa", descuento_valor: null, rangos: [], blackouts: [], min_noches: 1, regimen_restringido: null }],
  tarifas: [{ tipo_habitacion: "Estandar", alimentacion: "PC", temporada: "ALTA", neto_sencilla: 150_000, neto_doble: 100_000, neto_triple: null, neto_multiple: null, neto_nino: 50_000, neto_nino2: 30_000, neto_infante: 40_000 }],
  serviciosIncluidos: [srv], blackouts: [], vuelo: { aporte: 400_001, feeInfante: 30_000 },
};
const r = evaluarHotelPorFechas(datos, "2026-09-05", 3)!;
const combo = r.combos[0];
const base: BaseMotor = { ...r.composicionBase!, netos: { ...combo.netos } };
const lineasHab = [{ acom: "doble", habitaciones: 1, pax: 2, pvp: combo.precios.doble }];
const composicion = construirComposicion({ base, moneda: "COP", trm: null, lineasHab, lineasMenores: [], adicionales: [], total: 2 * combo.precios.doble });

// Cliente falso de tabla con PK cotizacion_id: un segundo insert devuelve 23505 y NO modifica lo guardado.
function fakeAdmin(opts?: { falla?: string; tenantCot?: string | null; dup?: { message?: string; details?: string } }) {
  const filas = new Map<number, { composicion: unknown; tenant: string }>();
  const admin = {
    from: (t: string) => t === "cotizaciones"
      ? { select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: opts?.tenantCot === null ? null : { tenant: opts?.tenantCot ?? "mayorista" }, error: null }) }) }) }
      : ({
      insert: async (f: { cotizacion_id: number; tenant: string; composicion: unknown }) => {
        if (opts?.falla) return { error: { code: opts.falla } };
        if (opts?.dup) return { error: { code: "23505", ...opts.dup } };
        if (filas.has(f.cotizacion_id)) return { error: { code: "23505", message: 'duplicate key value violates unique constraint "cotizacion_composicion_pkey"', details: "Key (cotizacion_id)=(78) already exists." } };
        filas.set(f.cotizacion_id, { composicion: f.composicion, tenant: f.tenant });
        return { error: null };
      },
      select: () => ({ eq: (_c: string, id: number) => ({ maybeSingle: async () => ({ data: filas.get(id) ?? null, error: null }) }) }),
    }),
  };
  return { admin: admin as never, filas };
}
const args = (c: typeof composicion | null = composicion) => ({ cotizacionId: 78, tenant: "mayorista", hoteles: [{ ref: null, nombre: "Hotel", composicion: c }] });
const conRol = async (v: string | undefined, f: () => Promise<void>) => {
  const prev = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (v === undefined) delete process.env.SUPABASE_SERVICE_ROLE_KEY; else process.env.SUPABASE_SERVICE_ROLE_KEY = v;
  try { await f(); } finally { if (prev === undefined) delete process.env.SUPABASE_SERVICE_ROLE_KEY; else process.env.SUPABASE_SERVICE_ROLE_KEY = prev; }
};

describe("composición de una solicitud valorada", () => {
  test("valorada → la ficha lee hotel, vuelo y servicios con el id de la cotización existente", async () => {
    const { admin, filas } = fakeAdmin();
    await conRol("x", () => guardarComposicionMejorEsfuerzo(() => admin, args()));
    assert.equal(filas.size, 1);
    const g = await leerComposicionGuardada(admin, 78);
    assert.ok(g, "la ficha debe encontrar la composición");
    const tipos = g!.hoteles[0].composicion.lineas[0].componentes!.map((c) => c.tipo);
    for (const t of ["hotel", "vuelo", "servicio"]) assert.ok(tipos.includes(t as never), t);
    assert.equal(g!.hoteles[0].composicion.total, composicion.total);
  });
  test("antes del arreglo la ficha no encuentra nada (sin guardado → null)", async () => {
    assert.equal(await leerComposicionGuardada(fakeAdmin().admin, 78), null);
  });
  test("reintento idéntico no duplica; uno con snapshot distinto no reemplaza", async () => {
    const { admin, filas } = fakeAdmin();
    await conRol("x", async () => {
      await guardarComposicionMejorEsfuerzo(() => admin, args());
      await guardarComposicionMejorEsfuerzo(() => admin, args());
      const otra = { ...composicion, total: composicion.total + 1_000 };
      await guardarComposicionMejorEsfuerzo(() => admin, args(otra));
    });
    assert.equal(filas.size, 1);
    assert.equal((await leerComposicionGuardada(admin, 78))!.hoteles[0].composicion.total, composicion.total);
  });
  test("sin service role o con fallo al guardar: no lanza y la ficha queda en «no conservada»", async () => {
    const { admin, filas } = fakeAdmin();
    await conRol(undefined, async () => { await guardarComposicionMejorEsfuerzo(() => admin, args()); });
    assert.equal(filas.size, 0);
    await conRol("x", async () => { await guardarComposicionMejorEsfuerzo(() => { throw new Error("sin cliente"); }, args()); });
    const f = fakeAdmin({ falla: "42P01" });
    await conRol("x", async () => { await guardarComposicionMejorEsfuerzo(() => f.admin, args()); });
    assert.equal(await leerComposicionGuardada(f.admin, 78), null);
    assert.match(readFileSync("components/cotizacion/ComposicionPrecio.tsx", "utf8"), /composicion-no-conservada/);
  });
  test("superadmin situado en la otra agencia: se guarda con el tenant de la cotización, no el de su agencia activa", async () => {
    const { admin, filas } = fakeAdmin({ tenantCot: "minorista" });
    await conRol("x", async () => {
      await guardarComposicionMejorEsfuerzo(() => admin, { ...args(), tenant: "mayorista" }); // agencia activa ≠ cotización
      assert.equal(filas.size, 0, "tenant que no corresponde no se guarda");
      await guardarComposicionMejorEsfuerzo(() => admin, { ...args(), tenant: "minorista" });
    });
    assert.equal(filas.get(78)?.tenant, "minorista");
  });
  test("cotización inexistente: no inserta", async () => {
    const { admin, filas } = fakeAdmin({ tenantCot: null });
    await conRol("x", () => guardarComposicionMejorEsfuerzo(() => admin, args()));
    assert.equal(filas.size, 0);
  });
  test("23505 que no es la PK de cotizacion_id no se trata como duplicado (se registra)", async () => {
    const { admin } = fakeAdmin({ dup: { message: 'violates unique constraint "otra_unica"', details: "Key (tenant)=(x) already exists." } });
    const errores: string[] = []; const orig = console.error; console.error = (m: string) => { errores.push(String(m)); };
    try { await conRol("x", () => guardarComposicionMejorEsfuerzo(() => admin, args())); } finally { console.error = orig; }
    assert.equal(errores.length, 1);
    assert.match(errores[0], /23505/);
  });
  test("cableado: la rama de solicitud guarda tras la RPC y antes de retornar, sin tocar neta ni precio", () => {
    const a = readFileSync("app/(dashboard)/dashboard/reservar/actions.ts", "utf8").replace(/\r\n/g, "\n");
    const rama = a.slice(a.indexOf("  if (solicitud) {\n    const { data: pk }"));
    const fin = rama.indexOf("return { ok: true, id: solicitud.cotizacionId }");
    const rpc = rama.indexOf('rpc("cargar_neta_solicitud"');
    const guarda = rama.indexOf("guardarComposicionMejorEsfuerzo(");
    assert.ok(rpc > 0 && guarda > rpc && guarda < fin, "debe guardar después de la RPC y antes del return");
    assert.ok(rama.indexOf("if (eNeta) return") < guarda, "no guarda si la RPC falla");
    assert.match(rama.slice(guarda, fin), /cotizacionId: solicitud\.cotizacionId/);
  });
});
