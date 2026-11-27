// #88 — la tarjeta del paquete dinámico muestra la información REAL del hotel del catálogo vinculado (estrellas, clasificación, descripción, ubicación, galería).
// Comportamiento puro (`presentacionDelHotel`/`vistaPublica`) + la lectura por lotes (`cargarPresentacionHoteles`) con un cliente falso que cuenta solicitudes.
// Los valores esperados están escritos a mano (no se calculan con el código bajo prueba).
import test from "node:test";
import assert from "node:assert/strict";
import { register } from "node:module";
import { readFileSync } from "node:fs";
import { join } from "node:path";

register("data:text/javascript," + encodeURIComponent('export async function resolve(s, c, n) { if (s === "server-only") return { url: "data:text/javascript,export {}", shortCircuit: true }; return n(s === "next/cache" ? s + ".js" : s, c); }'));
const { presentacionDelHotel, vistaPublica, FOTO_HOTEL_PREDETERMINADA } = await import("../lib/paqueteDinamico/publico.ts");
const { cargarPresentacionHoteles } = await import("../lib/paqueteDinamico/fichas.ts");
import type { FilaHotelDin, FilaPaqueteDin } from "../lib/paqueteDinamico/modelo.ts";
import type { PresentacionHotelCatalogo } from "../lib/paqueteDinamico/publico.ts";

const PAQ = { id: 1, nombre: "Paq 88", moneda: "COP", esquema: "solo_pvp" as const, pvp_modo: "por_componente" as const, pct_mk: 0, usa_vuelo: false, usa_hotel: true, usa_servicios: false, noches: 3, pvp_general: null, total_declarado: null,
  destino: "CARTAGENA", compra_fin: null, descripcion: null, incluye: null, no_incluye: null } satisfies FilaPaqueteDin & Record<string, unknown>;
const fila = (id: number, hotelId: number | null, o: Partial<FilaHotelDin> = {}): FilaHotelDin => ({ id, hotel_id: hotelId, nombre: `Hotel ${id}`, categoria: "Superior", regimen: "PAM", descripcion: null, foto_url: null, estrellas: null, ubicacion: null, proveedor: "PROVEEDOR_SECRETO", neto: {}, pvp: { doble: 500000, sencilla: 700000 }, pvp_general: null, ...o });
const cat = (o: Partial<PresentacionHotelCatalogo> = {}): PresentacionHotelCatalogo => ({ estrellas: null, clasificacion: "", descripcion: "", ubicacion: "", fotos: [], ...o });

test("A1 identidad por hotel_id: dos filas con el MISMO nombre muestran cada una los datos de SU hotel del catálogo", () => {
  const v = vistaPublica(PAQ, [fila(1, 30401, { nombre: "Hotel Duplicado" }), fila(2, 30402, { nombre: "Hotel Duplicado" })], [], [], {
    catalogo: new Map([[30401, cat({ estrellas: 4, descripcion: "Descripción A", ubicacion: "Bocagrande", fotos: ["a1", "a2"] })], [30402, cat({ estrellas: 5, descripcion: "Descripción B", ubicacion: "Getsemaní", fotos: ["b1"] })]]),
  })!;
  const [a, b] = v.hoteles;
  assert.deepEqual([a.estrellas, a.descripcion, a.ubicacion, a.fotos], [4, "Descripción A", "Bocagrande", ["a1", "a2"]]);
  assert.deepEqual([b.estrellas, b.descripcion, b.ubicacion, b.fotos], [5, "Descripción B", "Getsemaní", ["b1"]]);
});

test("A1b una fila vinculada cuyo hotel NO está en el mapa (ficha ilegible o sin vínculo válido) muestra lo guardado; nunca el dato de otro hotel", () => {
  const v = vistaPublica(PAQ, [fila(1, 30401, { descripcion: "Guardada", estrellas: 3, ubicacion: "  Calle 1  " })], [], [], { catalogo: new Map([[99999, cat({ estrellas: 5, descripcion: "OTRO", ubicacion: "OTRO", fotos: ["x"] })]]) })!;
  const h = v.hoteles[0];
  assert.deepEqual([h.estrellas, h.descripcion, h.ubicacion, h.fotos], [3, "Guardada", "Calle 1", [FOTO_HOTEL_PREDETERMINADA]]);
});

test("A2 las estrellas son las del HOTEL y la categoría de la habitación sigue aparte e intacta", () => {
  const v = vistaPublica(PAQ, [fila(1, 5, { categoria: "4*", regimen: "PAM" })], [], [], { catalogo: new Map([[5, cat({ estrellas: 2 })]]) })!;
  assert.equal(v.hoteles[0].estrellas, 2);
  assert.equal(v.hoteles[0].categoria, "4*");
  assert.equal(v.hoteles[0].regimen, "PAM");
});

test("A6 el dato del catálogo manda cuando existe; lo guardado completa lo que la ficha no tiene; nada se inventa", () => {
  const casos: { nombre: string; fila: Partial<FilaHotelDin>; cat: Partial<PresentacionHotelCatalogo>; esperado: [number | null, string, string] }[] = [
    { nombre: "copia vacía + catálogo con datos", fila: {}, cat: { estrellas: 3, descripcion: "Actual", ubicacion: "Manga" }, esperado: [3, "Actual", "Manga"] },
    { nombre: "copia vieja + catálogo corregido", fila: { estrellas: 2, descripcion: "Vieja", ubicacion: "Vieja" }, cat: { estrellas: 4, descripcion: "Corregida", ubicacion: "Centro" }, esperado: [4, "Corregida", "Centro"] },
    { nombre: "catálogo vacío + dato guardado", fila: { estrellas: 3, descripcion: "Guardada", ubicacion: "Guardada" }, cat: {}, esperado: [3, "Guardada", "Guardada"] },
    { nombre: "ambos vacíos", fila: {}, cat: {}, esperado: [null, "", ""] },
    { nombre: "solo estrellas en el catálogo", fila: { descripcion: "Guardada" }, cat: { estrellas: 5 }, esperado: [5, "Guardada", ""] },
  ];
  for (const c of casos) {
    const v = vistaPublica(PAQ, [fila(1, 7, c.fila)], [], [], { catalogo: new Map([[7, cat(c.cat)]]) })!.hoteles[0];
    assert.deepEqual([v.estrellas, v.descripcion, v.ubicacion], c.esperado, c.nombre);
  }
});

test("A3 sin datos: no hay estrellas inventadas, ni clasificación, y la foto cae a la predeterminada", () => {
  const h = vistaPublica(PAQ, [fila(1, 8)], [], [], { catalogo: new Map([[8, cat()]]) })!.hoteles[0];
  assert.deepEqual([h.estrellas, h.clasificacion, h.descripcion, h.ubicacion, h.fotos, h.foto], [null, "", "", "", [FOTO_HOTEL_PREDETERMINADA], FOTO_HOTEL_PREDETERMINADA]);
  const sinCtx = vistaPublica(PAQ, [fila(1, 8)], [], [])!.hoteles[0];
  assert.deepEqual([sinCtx.estrellas, sinCtx.descripcion, sinCtx.ubicacion, sinCtx.fotos], [null, "", "", [FOTO_HOTEL_PREDETERMINADA]]);
});

test("A3b la clasificación del catálogo viaja separada de las estrellas (la tarjeta la usa solo sin estrellas)", () => {
  const h = vistaPublica(PAQ, [fila(1, 9)], [], [], { catalogo: new Map([[9, cat({ clasificacion: "Posada" })]]) })!.hoteles[0];
  assert.deepEqual([h.estrellas, h.clasificacion], [null, "Posada"]);
});

test("A4 fotos: galería del catálogo (portada primero) > foto propia del paquete > predeterminada; un hotel manual conserva su foto", () => {
  const f = (o: Partial<FilaHotelDin>, c?: PresentacionHotelCatalogo) => vistaPublica(PAQ, [fila(1, o.hotel_id === undefined ? 10 : o.hotel_id, o)], [], [], c ? { catalogo: new Map([[10, c]]) } : {})!.hoteles[0];
  assert.deepEqual(f({ foto_url: "propia" }, cat({ fotos: ["portada", "uno", "dos"] })).fotos, ["portada", "uno", "dos"]);
  assert.deepEqual(f({ foto_url: " propia " }, cat({ fotos: [] })).fotos, ["propia"]);
  assert.deepEqual(f({ foto_url: "  " }, cat({ fotos: [] })).fotos, [FOTO_HOTEL_PREDETERMINADA]);
  const manual = f({ hotel_id: null, foto_url: "manual" }, cat({ fotos: ["no-debe-usarse"] }));
  assert.deepEqual(manual.fotos, ["manual"]);
  assert.equal(manual.foto, "manual");
});

test("A5 hotel manual (sin hotel_id): exactamente lo guardado, como antes de #88", () => {
  const h = vistaPublica(PAQ, [fila(1, null, { descripcion: "Manual", estrellas: 3, ubicacion: "Barú", foto_url: "m" })], [], [])!.hoteles[0];
  assert.deepEqual([h.descripcion, h.estrellas, h.ubicacion, h.fotos, h.clasificacion], ["Manual", 3, "Barú", ["m"], ""]);
});

test("A7 precios, «Desde» y opciones son idénticos con y sin la presentación del catálogo (valores calculados a mano)", () => {
  const neta = { ...PAQ, esquema: "neta_markup" as const, pvp_modo: null, pct_mk: 0.2 };
  const filas = [fila(1, 30403, { neto: { doble: 400000, sencilla: 560000 }, pvp: {} }), fila(2, 30405, { neto: { doble: 560000, sencilla: 760000 }, pvp: {} })];
  const con = vistaPublica(neta, filas, [], [], { catalogo: new Map([[30403, cat({ estrellas: 3, fotos: ["x"] })], [30405, cat({ estrellas: 5, descripcion: "d", ubicacion: "u" })]]) })!;
  const sin = vistaPublica(neta, filas, [], [])!;
  assert.deepEqual(con.opciones, sin.opciones);
  assert.deepEqual(con.hoteles.map((h) => h.desde), [500000, 700000]);          // 400.000/0,8 y 560.000/0,8
  assert.deepEqual(sin.hoteles.map((h) => h.desde), [500000, 700000]);
});

test("A8 la vista pública solo lleva campos de presentación: ni netas, ni proveedor, ni notas, ni contactos", () => {
  const v = vistaPublica({ ...PAQ, esquema: "neta_markup" as const, pvp_modo: null, pct_mk: 0.2 }, [fila(1, 5, { neto: { doble: 400000 }, pvp: {} })], [], [], { catalogo: new Map([[5, cat({ estrellas: 4, descripcion: "d", fotos: ["f"] })]]) })!;
  assert.deepEqual(Object.keys(v.hoteles[0]).sort(), ["categoria", "categorias", "clasificacion", "descripcion", "desde", "estrellas", "foto", "fotos", "id", "nombre", "regimen", "regimenes", "reglas", "ubicacion"]);
  const json = JSON.stringify(v);
  for (const secreto of ["PROVEEDOR_SECRETO", "400000", "\"neto\":{\"doble\""]) assert.ok(!json.includes(secreto), `filtra ${secreto}`);
});

// ── lectura por lotes ──
type Fila = Record<string, unknown>;
function clienteFalso(opts: { hoteles?: Fila[]; fotos?: Fila[]; errHoteles?: string; errFotos?: string } = {}) {
  const llamadas: { tabla: string; select: string; ids: unknown[] }[] = [];
  const admin = { from(tabla: string) {
    let select = "", ids: unknown[] = [];
    const b: Record<string, unknown> = new Proxy({}, { get(_o, prop: string) {
      if (prop === "then") return (ok: (v: unknown) => unknown) => { llamadas.push({ tabla, select, ids }); return ok({ data: tabla === "hoteles" ? (opts.errHoteles ? null : opts.hoteles ?? []) : [], error: tabla === "hoteles" && opts.errHoteles ? { message: opts.errHoteles } : null }); };
      return (...a: unknown[]) => {
        if (prop === "select") select = String(a[0]);
        if (prop === "in") ids = a[1] as unknown[];
        if (prop === "range") { llamadas.push({ tabla, select, ids }); const d = a[0] as number; return Promise.resolve(opts.errFotos ? { data: null, error: { message: opts.errFotos } } : { data: d === 0 ? opts.fotos ?? [] : [], error: null }); }
        return b;
      };
    } });
    return b;
  } };
  return { admin: admin as never, llamadas };
}

test("lectura por lotes: 2 consultas distintas (hoteles + hotel_fotos) sin importar cuántos hoteles; ids únicos; ninguna por tarjeta", async () => {
  for (const n of [1, 3, 50]) {
    const ids = Array.from({ length: n }, (_, i) => 100 + i);
    const { admin, llamadas } = clienteFalso({ hoteles: ids.map((id) => ({ id, estrellas: 4, clasificacion: null, descripcion: "d", ubicacion: "u" })), fotos: [] });
    const m = await cargarPresentacionHoteles(admin, [...ids, ...ids]);
    assert.equal(m.size, n);
    assert.deepEqual([...new Set(llamadas.map((l) => l.tabla))].sort(), ["hotel_fotos", "hoteles"]);
    assert.equal(llamadas.filter((l) => l.tabla === "hoteles").length, 1, `hoteles una sola vez con ${n} ids`);
    assert.ok(llamadas.filter((l) => l.tabla === "hotel_fotos").length <= 2, "fotos: una página (+ la vacía que cierra la paginación)");
    assert.ok(llamadas.every((l) => l.ids.length === n), "los ids van deduplicados");
    assert.equal(llamadas.find((l) => l.tabla === "hoteles")!.select, "id, estrellas, clasificacion, descripcion, ubicacion", "solo columnas de presentación pública");
  }
  const { admin, llamadas } = clienteFalso();
  assert.equal((await cargarPresentacionHoteles(admin, [])).size, 0);
  assert.equal(llamadas.length, 0, "sin ids no hay lecturas");
});

test("lectura por lotes: valida estrellas (1–5 enteras), recorta textos, ordena la galería con la portada primero y no deja pasar columnas extra", async () => {
  const hoteles = [
    { id: 1, estrellas: 4, clasificacion: " Boutique ", descripcion: "  Texto  ", ubicacion: " Calle 1 ", notas: "NOTA INTERNA", contacto_telefono: "300", email_comercial: "x@y", costo: 9 },
    { id: 2, estrellas: 0, clasificacion: null, descripcion: "   ", ubicacion: "", notas: "n" },
    { id: 3, estrellas: 6, clasificacion: null, descripcion: null, ubicacion: null },
    { id: 4, estrellas: 2.5, clasificacion: null, descripcion: null, ubicacion: null },
    { id: 5, estrellas: "4", clasificacion: null, descripcion: null, ubicacion: null },
  ];
  const fotos = [{ id: 11, hotel_id: 1, url: "u1", es_portada: false, orden: 0 }, { id: 12, hotel_id: 1, url: "u2", es_portada: true, orden: 1 }, { id: 13, hotel_id: 1, url: "u3", es_portada: false, orden: 2 }, { id: 14, hotel_id: 1, url: "u1", es_portada: false, orden: 3 }];
  const { admin } = clienteFalso({ hoteles, fotos });
  const m = await cargarPresentacionHoteles(admin, [1, 2, 3, 4, 5]);
  assert.deepEqual(m.get(1), { estrellas: 4, clasificacion: "Boutique", descripcion: "Texto", ubicacion: "Calle 1", fotos: ["u2", "u1", "u3"] });
  assert.deepEqual(Object.keys(m.get(1)!).sort(), ["clasificacion", "descripcion", "estrellas", "fotos", "ubicacion"]);
  assert.deepEqual(m.get(2), { estrellas: null, clasificacion: "", descripcion: "", ubicacion: "", fotos: [] });
  for (const id of [3, 4, 5]) assert.equal(m.get(id)!.estrellas, null, `estrellas inválidas del hotel ${id} se descartan`);
});

test("lectura por lotes: un fallo de lectura LANZA (nunca se confunde con «la ficha no tiene el dato»)", async () => {
  await assert.rejects(() => cargarPresentacionHoteles(clienteFalso({ errHoteles: "boom" }).admin, [1]), /No se pudo leer la presentación de los hoteles del catálogo: boom/);
  await assert.rejects(() => cargarPresentacionHoteles(clienteFalso({ hoteles: [{ id: 1, estrellas: 3 }], errFotos: "sin fotos" }).admin, [1]), /No se pudo leer las fotos de los hoteles del catálogo: sin fotos/);
});

test("cableado (complementario): la carga pública degrada sin bloquear la lista y la tarjeta usa la galería y la clasificación", () => {
  const leer = (p: string) => readFileSync(join(process.cwd(), p), "utf8").replace(/\r\n/g, "\n");
  const c = leer("lib/paqueteDinamico/cargarPublico.ts");
  assert.match(c, /cargarPresentacionHoteles\(admin2, idsFicha\)\.catch\(/);
  assert.match(c, /catalogo \}/);
  const t = leer("app/tarifario/PorDinamicos.tsx");
  assert.match(t, /<CarruselFotoHotel fotos=\{h\.fotos\} alt=\{h\.nombre\} \/>/);
  assert.match(t, /<Categoria estrellas=\{h\.estrellas\} clasificacion=\{h\.clasificacion \|\| null\} \/>/);
});

test("A5b presentacionDelHotel por sí sola: sin hotel_id nunca usa un dato de catálogo que se le pase", () => {
  const r = presentacionDelHotel({ hotel_id: null, descripcion: "Manual", foto_url: "m", estrellas: 2, ubicacion: "Barú" }, cat({ estrellas: 5, descripcion: "OTRO", ubicacion: "OTRO", fotos: ["x"], clasificacion: "Resort" }));
  assert.deepEqual(r, { descripcion: "Manual", estrellas: 2, ubicacion: "Barú", clasificacion: "", fotos: ["m"] });
});
