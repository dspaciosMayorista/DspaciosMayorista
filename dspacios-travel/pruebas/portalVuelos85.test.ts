// #85 (bloque A) — vuelos de contratos propios en el portal B2B. FIXTURES LOCALES: contratos, records y horarios inventados.
import { test } from "node:test";
import assert from "node:assert/strict";
import { armarTramosPortal, normalizarHora, type FuenteVuelo, type TramoFila, type VentaRef } from "../lib/portal/vuelosContrato.ts";
import { cargarVuelosPortal, type AdminLectura } from "../lib/portal/vuelosPortalServidor.ts";

const tramo = (o: Partial<TramoFila>): TramoFila => ({
  id: 1, numero_contrato: "00-0001", direccion: "ida", aerolinea: "AvianX", origen_codigo: "MDE", destino_codigo: "CTG", origen_ciudad: "Medellín", destino_ciudad: "Cartagena",
  numero_vuelo: "AV100", hora_salida: "08:00", hora_llegada: "09:10", fecha_salida: "2026-12-01", record: "ZZTEST", orden: 0, ...o,
});
const bloqueo = (o: Partial<FuenteVuelo> = {}): FuenteVuelo => ({
  tipo: "bloqueo", id: 7, record: "ZZTEST", ruta: "MDE - CTG - MDE", vuelo_ida: "AV100", fecha_ida: "2026-12-01", hora_salida_ida: "08:00:00", hora_llegada_ida: "09:10:00",
  vuelo_regreso: "AV101", fecha_regreso: "2026-12-05", hora_salida_reg: "18:00:00", hora_llegada_reg: "19:10:00", ...o,
});
const venta: VentaRef = { numero_contrato: "00-0001", bloqueo_ref_id: 7, empaquetado_ref_id: null };
const f = (b: FuenteVuelo | null, e: FuenteVuelo | null = null) => ({ bloqueo: b, empaquetado: e });

test("normalizarHora: time de BD, am/pm y texto libre", () => {
  assert.equal(normalizarHora("08:47:00"), "08:47");
  assert.equal(normalizarHora("8:47 pm"), "20:47");
  assert.equal(normalizarHora("12:05 am"), "00:05");
  assert.equal(normalizarHora("mañana"), "mañana");
  assert.equal(normalizarHora("  "), null);
});

test("bloqueo con vínculo por tramo y horarios iguales: acredita y no duplica información", () => {
  const [t] = armarTramosPortal([tramo({})], venta, f(bloqueo()));
  assert.equal(t.vinculo, "acreditado");
  assert.deepEqual(t.diferencias, []);
  assert.deepEqual(t.registrado, {});
});

test("bloqueo con horarios distintos: solo se reportan los campos que difieren", () => {
  const [t] = armarTramosPortal([tramo({})], venta, f(bloqueo({ hora_salida_ida: "09:30:00", vuelo_ida: "AV 105" })));
  assert.deepEqual(t.diferencias.sort(), ["horaSalida", "numeroVuelo"]);
  assert.equal(t.registrado.horaSalida, "09:30");
  assert.equal(t.contratado.horaSalida, "08:00"); // la copia contractual no se sobrescribe
});

test("regreso se compara con la ida invertida", () => {
  const filas = [tramo({}), tramo({ id: 2, direccion: "regreso", origen_codigo: "CTG", destino_codigo: "MDE", numero_vuelo: "AV101", hora_salida: "17:00", hora_llegada: "19:10", fecha_salida: "2026-12-05", orden: 1 })];
  const r = armarTramosPortal(filas, venta, f(bloqueo()));
  assert.equal(r[1].vinculo, "acreditado");
  assert.deepEqual(r[1].diferencias, ["horaSalida"]);
  assert.equal(r[1].registrado.horaSalida, "18:00");
});

test("vuelo manual adicional en el mismo contrato NO recibe el horario del bloqueo", () => {
  const filas = [tramo({}), tramo({ id: 3, direccion: "suelto", origen_codigo: "CTG", destino_codigo: "SMR", numero_vuelo: "XX9", record: null, orden: 2 })];
  const r = armarTramosPortal(filas, venta, f(bloqueo({ hora_salida_ida: "10:00:00" })));
  assert.equal(r[0].vinculo, "acreditado");
  assert.equal(r[1].vinculo, "sin_vinculo");
  assert.deepEqual(r[1].diferencias, []);
  assert.ok(r[1].motivoSinVinculo);
});

test("manual con el mismo record y misma ruta que otro tramo: ambiguo, sin vínculo para ambos", () => {
  const r = armarTramosPortal([tramo({}), tramo({ id: 4, numero_vuelo: "ZZ1" })], venta, f(bloqueo({ hora_salida_ida: "10:00:00" })));
  assert.ok(r.every((t) => t.vinculo === "sin_vinculo" && t.diferencias.length === 0));
});

test("record distinto, ruta distinta o venta sin fuente: sin vínculo aunque la venta tenga bloqueo_ref_id", () => {
  assert.equal(armarTramosPortal([tramo({ record: "OTRO99" })], venta, f(bloqueo()))[0].vinculo, "sin_vinculo");
  assert.equal(armarTramosPortal([tramo({ destino_codigo: "SMR" })], venta, f(bloqueo()))[0].vinculo, "sin_vinculo");
  assert.equal(armarTramosPortal([tramo({})], { ...venta, bloqueo_ref_id: null }, f(bloqueo()))[0].vinculo, "sin_vinculo");
  assert.equal(armarTramosPortal([tramo({})], venta, f(null))[0].vinculo, "sin_vinculo");
});

test("empaquetado: vínculo por record + empaquetado_ref_id; sin record en el tramo no se acredita", () => {
  const emp = bloqueo({ tipo: "empaquetado", id: 9, hora_salida_ida: "11:00:00" });
  const v: VentaRef = { numero_contrato: "00-0001", bloqueo_ref_id: null, empaquetado_ref_id: 9 };
  assert.deepEqual(armarTramosPortal([tramo({})], v, f(null, emp))[0].diferencias, ["horaSalida"]);
  assert.equal(armarTramosPortal([tramo({ record: null })], v, f(null, emp))[0].vinculo, "sin_vinculo");
});

test("dinámico sin vínculo y datos faltantes: se conserva lo parcial y se señalan los ausentes; no se inventa regreso", () => {
  const [t] = armarTramosPortal([tramo({ record: null, numero_vuelo: null, hora_salida: null, hora_llegada: "", direccion: "ida" })], { numero_contrato: "00-0001", bloqueo_ref_id: null, empaquetado_ref_id: null }, f(null));
  assert.equal(t.vinculo, "sin_vinculo");
  assert.deepEqual(t.ausentes.sort(), ["horaLlegada", "horaSalida", "numeroVuelo"]);
  assert.equal(t.contratado.fecha, "2026-12-01");
  assert.equal(armarTramosPortal([], venta, f(null)).length, 0);
});

test("formato anterior a la 135 (ida y regreso en una fila) se expande sin inventar datos", () => {
  const r = armarTramosPortal([tramo({ direccion: null, numero_vuelo: null, hora_salida: null, vuelo_ida: "AV100", hora_salida_ida: "08:00", vuelo_regreso: "AV101", fecha_regreso: "2026-12-05" })], { ...venta, bloqueo_ref_id: null }, f(null));
  assert.deepEqual(r.map((t) => t.direccion), ["ida", "regreso"]);
  assert.equal(r[1].origen, "Cartagena");
  assert.equal(r[1].contratado.horaSalida, null);
});

test("fuente sin dato: no se marca diferencia", () => {
  const [t] = armarTramosPortal([tramo({})], venta, f(bloqueo({ hora_llegada_ida: null })));
  assert.deepEqual(t.diferencias, []);
});

test("el DTO no contiene record/PNR ni ids de fuente", () => {
  const r = armarTramosPortal([tramo({})], venta, f(bloqueo({ hora_salida_ida: "10:00:00" })));
  const json = JSON.stringify(r);
  assert.ok(!json.includes("ZZTEST"));
  assert.ok(!/record|bloqueo_ref|empaquetado_ref|nota|costo|cupo/i.test(json));
});

// ── Cargador con un doble de Supabase: dos agencias en las mismas tablas ──
function falso(tablas: Record<string, Record<string, unknown>[]>, opts: { fallar?: string } = {}) {
  const lecturas: { tabla: string; ids: unknown[] }[] = [];
  const admin: AdminLectura = {
    from: (tabla: string) => {
      let filtro: { col: string; vals: unknown[] } | null = null;
      let ord = "id";
      const q: any = {
        select: () => q,
        in: (col: string, vals: unknown[]) => { filtro = { col, vals }; lecturas.push({ tabla, ids: vals }); return q; },
        order: (c: string) => { ord = c; return q; },
        range: (d: number, h: number) => {
          if (opts.fallar === tabla) return Promise.resolve({ data: null, count: null, error: { message: "x" } });
          const todas = (tablas[tabla] ?? []).filter((r) => !filtro || filtro.vals.includes(r[filtro.col]))
            .sort((a, b) => String(a[ord]).localeCompare(String(b[ord]), "es", { numeric: true }));
          return Promise.resolve({ data: todas.slice(d, h + 1), count: todas.length, error: null });
        },
      };
      return q;
    },
  };
  return { admin, lecturas };
}
const datos = () => ({
  ventas: [
    { numero_contrato: "00-0001", bloqueo_ref_id: 7, empaquetado_ref_id: null }, // agencia A
    { numero_contrato: "00-0002", bloqueo_ref_id: 7, empaquetado_ref_id: null }, // agencia B
    { numero_contrato: "00-0003", bloqueo_ref_id: null, empaquetado_ref_id: null },
  ],
  contrato_vuelos: [
    tramo({ id: 1, numero_contrato: "00-0001" }), tramo({ id: 2, numero_contrato: "00-0002" }),
    ...Array.from({ length: 250 }, (_, i) => tramo({ id: 100 + i, numero_contrato: "00-0003", direccion: "suelto", record: null })),
  ] as unknown as Record<string, unknown>[],
  bloqueos_vuelo: [bloqueo({ hora_salida_ida: "10:00:00" })] as unknown as Record<string, unknown>[],
  empaquetados: [],
});

test("usuario de la agencia A: solo sus contratos propios; participación y contratos de B no se leen ni salen", async () => {
  const { admin, lecturas } = falso(datos());
  const r = await cargarVuelosPortal(admin, [
    { numero_contrato: "00-0001", relacion: "propio" },
    { numero_contrato: "00-0002", relacion: "participacion" }, // comisión: no da acceso al itinerario
  ]);
  assert.deepEqual([...r.porContrato.keys()], ["00-0001"]);
  assert.ok(!JSON.stringify(lecturas).includes("00-0002"));
  assert.deepEqual(r.porContrato.get("00-0001")!.tramos[0].diferencias, ["horaSalida"]);
});

test("usuario de la agencia B ve solo lo suyo; sin contratos propios no se consulta nada", async () => {
  const { admin, lecturas } = falso(datos());
  const b = await cargarVuelosPortal(admin, [{ numero_contrato: "00-0002", relacion: "propio" }]);
  assert.deepEqual([...b.porContrato.keys()], ["00-0002"]);
  assert.ok(!JSON.stringify(b).includes("00-0001"));
  const n = lecturas.length;
  const vacio = await cargarVuelosPortal(admin, [{ numero_contrato: "00-0001", relacion: "participacion" }]);
  assert.equal(vacio.porContrato.size, 0);
  assert.equal(lecturas.length, n);
});

test("paginación completa: 250 tramos de un contrato llegan enteros", async () => {
  const { admin } = falso(datos());
  const r = await cargarVuelosPortal(admin, [{ numero_contrato: "00-0003", relacion: "propio" }]);
  assert.equal(r.porContrato.get("00-0003")!.tramos.length, 250);
});

test("lectura fallida: el contrato se marca incompleto, nunca se muestra a medias", async () => {
  const { admin } = falso(datos(), { fallar: "contrato_vuelos" });
  const r = await cargarVuelosPortal(admin, [{ numero_contrato: "00-0001", relacion: "propio" }]);
  assert.equal(r.completa, false);
  assert.deepEqual(r.porContrato.get("00-0001"), { tramos: [], incompleto: true });
});

test("lectura de la fuente fallida: «no comprobada», NO «sin vínculo»; solo lo contratado y sin afirmar diferencias", async () => {
  const { admin } = falso(datos(), { fallar: "bloqueos_vuelo" });
  const r = await cargarVuelosPortal(admin, [{ numero_contrato: "00-0001", relacion: "propio" }]);
  const t = r.porContrato.get("00-0001")!.tramos[0];
  assert.equal(t.vinculo, "no_comprobada");
  assert.equal(t.comparacion, null);
  assert.equal(t.motivoSinVinculo, null);
  assert.deepEqual(t.diferencias, []);
});

test("fila de la fuente ausente en una lectura completa: también «no comprobada»", async () => {
  const d = datos(); d.bloqueos_vuelo = [];
  const { admin } = falso(d);
  const r = await cargarVuelosPortal(admin, [{ numero_contrato: "00-0001", relacion: "propio" }]);
  assert.equal(r.porContrato.get("00-0001")!.tramos[0].vinculo, "no_comprobada");
});

test("fallo de la fuente NO afecta a tramos que ya eran «sin vínculo» confirmado (manual sin record)", () => {
  const filas = [tramo({}), tramo({ id: 3, direccion: "suelto", record: null, orden: 2 })];
  const r = armarTramosPortal(filas, venta, f(null), { bloqueo: true });
  assert.equal(r[0].vinculo, "no_comprobada");
  assert.equal(r[1].vinculo, "sin_vinculo");
});

test("comparación: completa, parcial, sin datos operativos y diferente (con campos sin dato)", () => {
  const vacia = bloqueo({ vuelo_ida: null, fecha_ida: null, hora_salida_ida: null, hora_llegada_ida: null });
  const sd = armarTramosPortal([tramo({})], venta, f(vacia))[0];
  assert.equal(sd.comparacion, "sin_datos");
  assert.deepEqual(sd.comparados, []);
  assert.equal(sd.sinDatoOperativo.length, 4);
  assert.deepEqual(sd.diferencias, []);

  const parcial = armarTramosPortal([tramo({})], venta, f(bloqueo({ hora_llegada_ida: null, vuelo_ida: "  " })))[0];
  assert.equal(parcial.comparacion, "parcial");
  assert.deepEqual(parcial.comparados.sort(), ["fecha", "horaSalida"]);
  assert.deepEqual(parcial.sinDatoOperativo.sort(), ["horaLlegada", "numeroVuelo"]);

  assert.equal(armarTramosPortal([tramo({})], venta, f(bloqueo()))[0].comparacion, "completa");

  const dif = armarTramosPortal([tramo({})], venta, f(bloqueo({ hora_salida_ida: "10:00:00", hora_llegada_ida: null })))[0];
  assert.equal(dif.comparacion, "diferente");
  assert.deepEqual(dif.diferencias, ["horaSalida"]);
  assert.deepEqual(dif.sinDatoOperativo, ["horaLlegada"]);
});

test("la tarjeta no afirma «Coincide» sin datos ni en comparación parcial", async () => {
  const { readFileSync } = await import("node:fs");
  const src = readFileSync(new URL("../components/portal/VuelosContrato.tsx", import.meta.url), "utf8");
  assert.match(src, /comparacion === "completa"[\s\S]{0,200}Coincide con/);
  assert.match(src, /comparacion === "parcial"[\s\S]{0,300}Comparación parcial/);
  assert.match(src, /comparacion === "sin_datos"[\s\S]{0,200}Sin datos operativos/);
  assert.match(src, /no_comprobada[\s\S]{0,200}No se pudo comprobar/);
  assert.ok(src.includes('gridColumn: "1 / -1"'));
});
