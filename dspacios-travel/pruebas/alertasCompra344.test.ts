// B3 (revisión del dueño) — reglas PURAS de las alertas de fin de compra (344) y de la consulta paginada de presencia, más guardas de cableado de lo que SALIÓ de la campana y del CRM.
// Los efectos sobre la base (revisado, archivo por cambio de fecha, 1000 usuarios) se prueban con base real en bloque3_11_13_36.pg.ts.
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { esFuenteCompra, rutaVentana } from "../lib/paquetes/vencimientoCompra.ts";
import { hrefCompra, textoCompra } from "../lib/avisos/compraAviso.ts";
import { TAM_PAGINA_ACTIVIDAD, normalizarConsultaActividad, paramsRpcActividad, totalPaginas } from "../lib/actividad/consulta.ts";

const leer = (r: string) => readFileSync(new URL(`../${r}`, import.meta.url), "utf8");

describe("B3-03 destino de cada alerta = el objeto que POSEE la vigencia", () => {
  test("hotel: abre ESE hotel en Temporadas y resalta ESA vigencia (el id de la vigencia viaja guardado, no se deduce del nombre)", () => {
    assert.equal(hrefCompra({ ventana_tipo: "hotel_vigencia", ventana_id: 77, ventana_ref: 12 }), "/dashboard/producto/hoteles/12?tab=temporadas&vigencia=77");
  });
  test("servicio: abre ESE servicio y resalta ESA vigencia", () => {
    assert.equal(hrefCompra({ ventana_tipo: "servicio_vigencia", ventana_id: 9, ventana_ref: 4 }), "/dashboard/producto/servicios?servicio=4&vigencia=9");
  });
  test("vuelo: la fecha límite de compra pertenece al empaquetado, y abre el empaquetado (no un paquete)", () => {
    assert.equal(hrefCompra({ ventana_tipo: "empaquetado", ventana_id: 5, ventana_ref: 5 }), "/dashboard/vuelos/empaquetados/5");
  });
  test("un paquete solo se abre para SU PROPIA fecha de compra (y la salida dinámica que le pertenece); ninguna alerta de hotel/servicio apunta a /paquetes", () => {
    assert.equal(hrefCompra({ ventana_tipo: "paquete", ventana_id: 3, ventana_ref: 3 }), "/dashboard/paquetes/3?tab=config");
    assert.equal(hrefCompra({ ventana_tipo: "salida_dinamica", ventana_id: 40, ventana_ref: 3 }), "/dashboard/paquetes/3?tab=vuelos");
    for (const tipo of ["hotel_vigencia", "servicio_vigencia"] as const) assert.doesNotMatch(hrefCompra({ ventana_tipo: tipo, ventana_id: 1, ventana_ref: 1 }), /\/paquetes/);
  });
  test("sin identidad suficiente cae al listado de Paquetes, nunca a una ruta inventada; sin id de vigencia el hotel abre igual pero sin resaltar", () => {
    assert.equal(hrefCompra({ ventana_tipo: "hotel_vigencia", ventana_ref: null }), "/dashboard/paquetes");
    assert.equal(rutaVentana("hotel_vigencia", 12), "/dashboard/producto/hoteles/12?tab=temporadas");
    assert.equal(esFuenteCompra("hotel_vigencia") && esFuenteCompra("servicio_vigencia"), true);
    assert.equal(esFuenteCompra("hotel"), false);
  });
  test("el texto nombra el tipo de vigencia", () => {
    assert.match(textoCompra({ ventana_tipo: "hotel_vigencia", ventana_titulo: "Hotel Sol · Alta", compra_fin: "2026-11-28" }, "2026-11-26"), /^Compra por vencer · vigencia de hotel: Hotel Sol · Alta · Vence en 2 días \(28\/11\/2026\)$/);
    assert.match(textoCompra({ ventana_tipo: "servicio_vigencia", ventana_titulo: "Tour · Baja", compra_fin: "2026-11-26" }, "2026-11-26"), /· vigencia de servicio: Tour · Baja · Vence hoy/);
  });
});

describe("B3-01 consulta paginada de presencia", () => {
  test("normaliza lo que llega del navegador: grupo desconocido = interno, búsqueda recortada a 80, página entera ≥ 0 y acotada", () => {
    assert.deepEqual(normalizarConsultaActividad({}), { grupo: "interno", busqueda: "", pagina: 0 });
    assert.deepEqual(normalizarConsultaActividad({ grupo: "aliado", busqueda: "  ana  ", pagina: 3 }), { grupo: "aliado", busqueda: "ana", pagina: 3 });
    assert.equal(normalizarConsultaActividad({ grupo: "x'; drop table usuarios;--" }).grupo, "interno");
    assert.equal(normalizarConsultaActividad({ busqueda: "a".repeat(500) }).busqueda.length, 80);
    for (const mala of [-1, 1.5, NaN, "2", null, Infinity]) assert.equal(normalizarConsultaActividad({ pagina: mala }).pagina, 0, String(mala));
    assert.equal(normalizarConsultaActividad({ pagina: 10 ** 9 }).pagina, 10_000);
  });
  test("los parámetros de la RPC piden SIEMPRE una página acotada (≤ 20 filas); sin búsqueda va null", () => {
    assert.deepEqual(paramsRpcActividad({ grupo: "interno", busqueda: "", pagina: 2 }), { p_grupo: "interno", p_busqueda: null, p_offset: 40, p_limite: TAM_PAGINA_ACTIVIDAD, p_dias: 7 });
    assert.equal(paramsRpcActividad({ grupo: "aliado", busqueda: "x", pagina: 0 }).p_busqueda, "x");
    assert.ok(TAM_PAGINA_ACTIVIDAD <= 50, "la base limita a 50");
  });
  test("total de páginas: ceil(total / 20), mínimo 1", () => {
    assert.deepEqual([0, 1, 20, 21, 1000].map(totalPaginas), [1, 1, 1, 2, 50]);
  });
});

describe("B3-02/B3-04 lo que SALIÓ de la campana y del CRM (guardas de cableado; el comportamiento real está en la prueba con base)", () => {
  test("la campana ya no cuenta, lista ni reclama alertas de compra, ni conoce el tipo", () => {
    const acciones = leer("lib/avisos/actions.ts");
    assert.doesNotMatch(acciones, /hrefCompra|textoCompra|COLS_COMPRA|ventana_/, "sondearAvisos no compone avisos de compra");
    assert.match(acciones, /\.neq\("tipo", "compra_por_vencer"\)/, "el contador excluye el tipo");
    assert.doesNotMatch(leer("lib/avisos/presentacion.ts"), /compra_por_vencer/);
  });
  test("el CRM no monta la campana general (el lugar queda para notificaciones del CRM) y conserva su presencia y navegación", () => {
    const crm = leer("app/(crm)/layout.tsx");
    assert.doesNotMatch(crm, /<CampanaAvisos|import \{ CampanaAvisos/);
    assert.match(crm, /<PresenciaActiva \/>/);
    assert.match(crm, /ml-auto flex items-center gap-2/);
  });
  test("el tablero muestra las alertas de compra en el área de ALERTAS con «Revisado» y las lee sin sondeo", () => {
    const pagina = leer("app/(dashboard)/dashboard/page.tsx");
    assert.match(pagina, /Vigencias de compra por terminar/);
    assert.match(pagina, /<AlertasCompra /);
    const cliente = leer("components/dashboard/AlertasCompra.tsx");
    assert.match(cliente, /Revisado/);
    assert.doesNotMatch(cliente, /setInterval|setTimeout/);
  });
});
