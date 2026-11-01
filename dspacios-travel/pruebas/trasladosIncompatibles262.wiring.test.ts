// Un traslado por alcance (262) es incompatible con las rutas que cobran SIN alcance (traslado incluido en el hotel, reserva interna y oferta #63). Debe decirse en el PRIMER punto
// donde se conoce: al marcarlo incluido, al generar el tarifario (nunca «publicado» con 0 filas) y en la pantalla de reserva (no se ofrece y se explica). La base y los
// recorridos reales los prueban supabase/scripts/test_262_venta_alcance.sh y las pruebas de base de datos del PR de migraciones; aquí se fija el cableado y los mensajes.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { mensajeTrasladoIncluido, MENSAJE_TRASLADOS_SOLO_CARRITO_PANTALLA, MENSAJE_TRASLADO_POR_ALCANCE_SOLO_CARRITO } from "../lib/servicios/alcanceContexto.ts";

const leer = (ruta: string) => readFileSync(new URL(`../${ruta}`, import.meta.url), "utf8");
const paquetes = leer("app/(dashboard)/dashboard/paquetes/actions.ts");
const pagina = leer("app/(dashboard)/dashboard/reservar/nuevo/page.tsx");
const formulario = leer("app/(dashboard)/dashboard/reservar/nuevo/ReservaForm.tsx");

test("los mensajes son claros para operador y cliente: nombran el servicio, el motivo y qué hacer", () => {
  const m = mensajeTrasladoIncluido("Traslado aeropuerto");
  assert.match(m, /«Traslado aeropuerto»/);
  assert.match(m, /llegada, salida o ida y regreso/);
  assert.match(m, /no puede ir incluido/);
  assert.match(m, /opcional/);
  assert.match(MENSAJE_TRASLADOS_SOLO_CARRITO_PANTALLA, /carrito/);
  assert.match(MENSAJE_TRASLADO_POR_ALCANCE_SOLO_CARRITO, /cotízalos desde el carrito/);
});

test("armado: marcar un servicio como incluido pasa por la guarda en setServicio y en setServicios (lote)", () => {
  const cuerpoUno = paquetes.slice(paquetes.indexOf("export async function setServicio("), paquetes.indexOf("export type ServicioLoteItem"));
  assert.match(cuerpoUno, /if \(checked && incluido\) \{\s*const t = await trasladosIncluidos\(sb, \[servicioId\]\);\s*if \(t\) return \{ ok: false, error: t \};/);
  const cuerpoLote = paquetes.slice(paquetes.indexOf("export async function setServicios("), paquetes.indexOf("// ── GENERAR TARIFARIO"));
  assert.match(cuerpoLote, /trasladosIncluidos\(sb, lista\.filter\(\(x\) => x\.incluido\)\.map\(\(x\) => x\.servicioId\)\)/);
});

test("generarTarifario: un traslado por alcance incluido (armado anterior) FALLA con el motivo antes de calcular, no publica 0 filas", () => {
  const i = paquetes.indexOf("for (const [k, v] of rv.porServicio) vigenciasPorServicio.set(k, v);");
  assert.ok(i > 0);
  const bloque = paquetes.slice(i, i + 900);
  assert.match(bloque, /vigenciasPorServicio\.get\(s\.servicio_id\)\?\.usaAlcance/);
  assert.match(bloque, /return await fallar\(mensajeTrasladoIncluido\(nombre\)\)/);
});

test("pantalla de reserva: no ofrece traslados por alcance, lo explica y computarReserva los rechaza igual", () => {
  assert.match(pagina, /trasladosPorAlcance\(createAdminClient\(\), \[\.\.\.servMap\.keys\(\)\]\)/);
  assert.match(pagina, /filter\(\(s\) => !idsOcultos\.has\(s\.servicioId\)\)/);
  assert.match(pagina, /hayTrasladosOcultos=\{hayTrasladosOcultos\}/);
  assert.match(formulario, /data-testid="aviso-traslados-carrito"/);
  assert.match(formulario, /MENSAJE_TRASLADOS_SOLO_CARRITO_PANTALLA/);
  const computo = leer("lib/reservar/computo.ts");
  assert.match(computo, /trasladosPorAlcance\(createAdminClient\(\), input\.servicios\)/);
});
