// #95 / B95-3 — restricción establecida (Adults Only) comprobada por el servidor sobre el hotel ELEGIDO por id; falla cerrado; mascotas no se convierten en prohibición.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { evaluarRestriccionesHotelCatalogo, idsHotelesElegidos, verificarRestriccionesHotelCatalogo } from "../lib/catalogo/restriccionesHotel.ts";

const hoteles = [{ id: 1, nombre: "Hotel Familiar", adults_only: false }, { id: 2, nombre: "Hotel Solo Adultos", adults_only: true }];
const cliente = (data: unknown, error: unknown = null) => ({ from: () => ({ select: () => ({ in: async () => ({ data, error }) }) }) });

test("Adults Only + menores → rechazo con el nombre del hotel; sin menores o hotel familiar → ok", () => {
  assert.match(evaluarRestriccionesHotelCatalogo(hoteles, [2], true) ?? "", /«Hotel Solo Adultos» es solo para adultos/);
  assert.equal(evaluarRestriccionesHotelCatalogo(hoteles, [2], false), null);
  assert.equal(evaluarRestriccionesHotelCatalogo(hoteles, [1], true), null);
  assert.equal(evaluarRestriccionesHotelCatalogo(hoteles, [], true), null, "texto libre: nada que comprobar");
});

test("un hotel elegido que ya no existe falla cerrado", () => {
  assert.match(evaluarRestriccionesHotelCatalogo(hoteles, [99], false) ?? "", /ya no existe o no se pudo verificar/);
});

test("ids: solo enteros positivos sin repetir", () => {
  assert.deepEqual(idsHotelesElegidos([2, 2, null, undefined, 0, -1, 1.5, 7]), [2, 7]);
});

test("lectura OK / error de lectura (inyección): el error NO se toma por «sin restricciones»", async () => {
  assert.deepEqual(await verificarRestriccionesHotelCatalogo(cliente(hoteles), [1, 2], false), { ok: true });
  const bloqueado = await verificarRestriccionesHotelCatalogo(cliente(hoteles), [2], true);
  assert.equal(bloqueado.ok, false);
  const roto = await verificarRestriccionesHotelCatalogo(cliente(null, { message: "boom" }), [2], false);
  assert.equal(roto.ok, false);
  if (!roto.ok) assert.match(roto.error, /No se pudieron verificar las restricciones/);
  assert.deepEqual(await verificarRestriccionesHotelCatalogo(cliente(null, { message: "no se llama" }), [], true), { ok: true }, "sin hoteles elegidos no lee nada");
});

test("mascotas: no existe ninguna prohibición derivada de pet_friendly", () => {
  const src = fs.readFileSync("lib/catalogo/restriccionesHotel.ts", "utf8");
  assert.ok(!/pet_friendly|mascota/i.test(src.replace(/\/\/.*$/gm, "")), "el servidor solo aplica Adults Only");
});

test("wiring: contrato manual, cotización manual y comparativa llaman al verificador ANTES de crear, con el id elegido", () => {
  const leer = (p: string) => fs.readFileSync(p, "utf8").replace(/\r\n/g, "\n");
  const contrato = leer("app/(dashboard)/dashboard/contratos/actions.ts");
  const i = contrato.indexOf("verificarRestriccionesHotelCatalogo(createAdminClient()");
  // El verificador recibe los ids ELEGIDOS (h.catalogoHotelId de cada hotel; la lectura de esos ids precede a la llamada) y corre antes de calcular el precio / numerar.
  assert.ok(i > 0 && i < contrato.indexOf("const precioVenta = items.reduce"));
  assert.match(contrato.slice(Math.max(0, i - 400), i + 160), /idsCatalogo\s*=\s*\(input\.hoteles \?\? \[\]\)\.map\(\(h\) => h\.catalogoHotelId\)[\s\S]*verificarRestriccionesHotelCatalogo\(createAdminClient\(\), idsCatalogo,/);
  const cot = leer("app/(dashboard)/dashboard/cotizaciones/manual-actions.ts");
  assert.equal(cot.split("verificarRestriccionesHotelCatalogo(admin").length - 1, 2);
  assert.ok(cot.indexOf("verificarRestriccionesHotelCatalogo(admin") < cot.indexOf('admin.rpc("crear_cotizacion_comparativa"'));
});

test("la cotización guarda categoría, régimen, acomodación y el id elegido en el payload (el catálogo no recibe nada)", async () => {
  const { construirCotizacionManual } = await import("../lib/cotizacion/liquidacionManual.ts");
  const r = construirCotizacionManual({
    cliente: { nombres: "Ana", apellidos: "P", tipoDoc: "CC", numeroDoc: "1", telefono: "", email: "" }, destino: "Cartagena", fechaIda: "2030-03-01", fechaRegreso: "2030-03-04", pax: 2, moneda: "COP",
    tipoAsesor: "interno", asesorInterno: "A", agenciaNombre: "", freelanceNombre: "", plazo: "", vigenciaHasta: "", observaciones: "", incluye: "", noIncluye: "",
    servicios: [{ tipo: "hotel", plataforma: "", nombre: "Hotel Caribe", proveedor: "Operadora Mar", costoNeto: 800_000, modo: "mk", pctMarkup: 20, ta: 0, catalogoId: 12, categoria: "Superior (copia editada)", regimen: "PAM", acomodacion: "Doble" }],
  }, { vigencia: "2030-02-20" });
  assert.ok(r.ok, r.ok ? "" : r.error);
  if (!r.ok) return;
  const s = (r.cabecera.payload as { servicios: Record<string, unknown>[] }).servicios[0];
  assert.deepEqual([s.catalogoId, s.categoria, s.regimen, s.acomodacion], [12, "Superior (copia editada)", "PAM", "Doble"]);
  assert.ok(!JSON.stringify(r.servicios).includes("Superior"), "las filas de cotizacion_servicios no cambian de forma");
});
