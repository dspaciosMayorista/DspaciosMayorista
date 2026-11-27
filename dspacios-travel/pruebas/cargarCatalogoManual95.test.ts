// #95 — la carga del catálogo para precargar formularios manuales: lecturas paginadas con orden TOTAL por las columnas reales de cada tabla (hotel_categorias/hotel_regimenes
// no tienen `id`: el primer intento falló en silencio y dejó vacías las listas), solo columnas de presentación (NUNCA precios) y mapeo correcto. Cliente falso; valores a mano.
import test from "node:test";
import assert from "node:assert/strict";
import { register } from "node:module";

register("data:text/javascript," + encodeURIComponent('export async function resolve(s, c, n) { if (s === "server-only") return { url: "data:text/javascript,export {}", shortCircuit: true }; return n(s === "next/cache" ? s + ".js" : s, c); }'));
const { cargarCatalogoManual } = await import("../lib/catalogo/cargarCatalogoManual.ts");

type Fila = Record<string, unknown>;
function cliente(tablas: Record<string, Fila[]>, sinColumna: Record<string, string> = {}) {
  const llamadas: { tabla: string; select: string; orden: string[]; filtros: string[] }[] = [];
  const sb = { from(tabla: string) {
    const estado = { tabla, select: "", orden: [] as string[], filtros: [] as string[] };
    const b: Record<string, unknown> = {
      select: (c: string) => { estado.select = c; return b; },
      eq: (c: string, v: unknown) => { estado.filtros.push(`${c}=${String(v)}`); return b; },
      order: (c: string) => { estado.orden.push(c); return b; },
      range: (d: number) => {
        llamadas.push({ ...estado });
        // Como PostgREST: ordenar o seleccionar una columna inexistente es un error (no un resultado vacío).
        const mala = (sinColumna[tabla] && (estado.orden.includes(sinColumna[tabla]) || new RegExp(`(^|, )${sinColumna[tabla]}(,|$)`).test(estado.select)));
        if (mala) return Promise.resolve({ data: null, error: { message: `column ${tabla}.${sinColumna[tabla]} does not exist` } });
        return Promise.resolve({ data: d === 0 ? tablas[tabla] ?? [] : [], error: null });
      },
    };
    return b;
  } };
  return { sb, llamadas };
}

const DATOS = {
  hoteles: [{ id: 1, nombre: "Hotel Caribe", proveedor_id: 10, adults_only: false, pet_friendly: true, destino_id: 3, pax_min: 1, pax_max: 6, edad_infante_max: 2, edad_nino_max: 10, destinos: { nombre: "CARTAGENA" } }, { id: 2, nombre: "Hotel Solo Adultos", proveedor_id: null, adults_only: true, pet_friendly: false, destinos: null }, { id: 3, nombre: "  ", proveedor_id: null, adults_only: false, pet_friendly: false }],
  proveedores: [{ id: 10, nombre: "Operadora Mar" }, { id: 11, nombre: "Asistencia Plus" }],
  hotel_categorias: [{ hotel_id: 1, categoria_id: 7, categorias_habitacion: { nombre: "Superior" } }, { hotel_id: 1, categoria_id: 8, categorias_habitacion: { nombre: "Estándar" } }, { hotel_id: 2, categoria_id: 7, categorias_habitacion: { nombre: "Superior" } }],
  hotel_regimenes: [{ hotel_id: 1, plan_id: 3, planes_alimentacion: { codigo: "PAM" } }],
  hotel_acomodaciones: [{ id: 1, hotel_id: 1, acomodacion: "doble", pax_tarifa: 2, pax_max: 4, adt_min: 0, adt_max: 0, chd_min: 0, chd_max: 2, inf_min: 0, inf_max: 1 }, { id: 2, hotel_id: 1, acomodacion: "sencilla", pax_tarifa: 1, pax_max: 2, adt_min: 0, adt_max: 0, chd_min: 0, chd_max: 1, inf_min: 0, inf_max: 1 }],
  aerolineas: [{ id: 5, nombre: "Avianca" }, { id: 6, nombre: "JetSMART" }],
  servicios_adicionales: [{ id: 20, nombre: "Seguro Viaje", categoria: "asistencia", proveedor_id: 11 }, { id: 21, nombre: "Cena show", categoria: "otro", proveedor_id: null }],
};

test("mapea hoteles con proveedor, categorías/regímenes ordenados, acomodaciones en orden de habitación y restricciones; ignora hoteles sin nombre", async () => {
  const { sb } = cliente(DATOS);
  const c = await cargarCatalogoManual(sb);
  assert.deepEqual(c.hoteles, [
    { id: 1, nombre: "Hotel Caribe", destino: "CARTAGENA", destinoId: 3, proveedor: "Operadora Mar", adultsOnly: false, petFriendly: true, categorias: ["Estándar", "Superior"], regimenes: ["PAM"], acomodaciones: ["Sencilla", "Doble"],
      // B95-13/20: destino guardado (id), rango de pax, umbrales de edad y reglas de acomodación del hotel (en el orden de lectura de hotel_acomodaciones).
      paxMin: 1, paxMax: 6, edadInfanteMax: 2, edadNinoMax: 10,
      reglasAcom: [{ acomodacion: "doble", pax_tarifa: 2, pax_max: 4, adt_min: 0, adt_max: 0, chd_min: 0, chd_max: 2, inf_min: 0, inf_max: 1 }, { acomodacion: "sencilla", pax_tarifa: 1, pax_max: 2, adt_min: 0, adt_max: 0, chd_min: 0, chd_max: 1, inf_min: 0, inf_max: 1 }] },
    { id: 2, nombre: "Hotel Solo Adultos", destino: null, destinoId: null, proveedor: null, adultsOnly: true, petFriendly: false, categorias: ["Superior"], regimenes: [], acomodaciones: [], paxMin: null, paxMax: null, edadInfanteMax: null, edadNinoMax: null, reglasAcom: [] },
  ]);
  assert.deepEqual(c.servicios, [{ id: 20, nombre: "Seguro Viaje", categoria: "asistencia", proveedor: "Asistencia Plus" }, { id: 21, nombre: "Cena show", categoria: "otro", proveedor: null }]);
  assert.deepEqual(c.aerolineas, ["Avianca", "JetSMART"]);
  assert.deepEqual(c.proveedores, ["Asistencia Plus", "Operadora Mar"]);
  assert.deepEqual(c.aerolineasConId, [{ id: 5, nombre: "Avianca" }, { id: 6, nombre: "JetSMART" }]);
});

test("cada lectura se ordena por las columnas REALES de su tabla (clave compuesta donde no hay id) y se pagina", async () => {
  const { sb, llamadas } = cliente(DATOS);
  await cargarCatalogoManual(sb);
  const orden = (t: string) => llamadas.find((l) => l.tabla === t)!.orden;
  assert.deepEqual(orden("hotel_categorias"), ["hotel_id", "categoria_id"]);
  assert.deepEqual(orden("hotel_regimenes"), ["hotel_id", "plan_id"]);
  assert.deepEqual(orden("hoteles"), ["id"]);
  assert.deepEqual(orden("servicios_adicionales"), ["id"]);
  for (const t of Object.keys(DATOS)) assert.ok(llamadas.filter((l) => l.tabla === t).length >= 2, `${t}: una página con datos y la vacía que cierra la paginación`);
  assert.ok(llamadas.filter((l) => l.tabla === "hoteles").every((l) => l.filtros.includes("activo=true")), "solo hoteles activos");
});

test("NUNCA se piden columnas de precio, tarifa, vigencia, notas ni contactos", async () => {
  const { sb, llamadas } = cliente(DATOS);
  await cargarCatalogoManual(sb);
  const pedido = llamadas.map((l) => l.select).join(" | ");
  // pax_tarifa es el multiplicador de acomodación (cuántos pax cubre 1 habitación), no una tarifa: se retira del texto antes de buscar «tarifa».
  const pedido2 = pedido.replace(/pax_tarifa/g, "");
  void pedido2;
  for (const prohibido of ["tarifa", "precio", "neto", "costo", "notas", "contacto", "recargo", "temporada", "vigencia", "foto", "descripcion"]) assert.ok(!pedido2.includes(prohibido), `no debe pedir «${prohibido}»: ${pedido}`);
});

test("una tabla cuya lectura falla deja ESA parte vacía sin romper el resto (y el defecto de `id` inexistente queda cubierto)", async () => {
  // Con el orden/columna `id` en hotel_categorias (el defecto original) la lectura fallaba y las categorías quedaban vacías:
  const { sb } = cliente(DATOS, { hotel_categorias: "id" });
  const bien = await cargarCatalogoManual(sb);
  assert.deepEqual(bien.hoteles[0].categorias, ["Estándar", "Superior"], "con las columnas reales sí se cargan");
  const { sb: sb2 } = cliente(DATOS, { hotel_categorias: "hotel_id" });
  const roto = await cargarCatalogoManual(sb2);
  assert.deepEqual(roto.hoteles[0].categorias, [], "si la lectura falla, esa parte queda vacía");
  assert.deepEqual(roto.hoteles[0].regimenes, ["PAM"], "lo demás sigue funcionando");
});
