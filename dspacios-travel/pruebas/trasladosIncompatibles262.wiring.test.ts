// (El traslado INCLUIDO ya no es incompatible: se cobra por ida y regreso.) Un traslado por alcance (262) es incompatible con las rutas que cobran SIN alcance (traslado incluido en el hotel, reserva interna y oferta #63). Debe decirse en el PRIMER punto
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

test("armado y generación: ya NO bloquean un traslado incluido (se cobra por ida y regreso en incluidoEnEstadia)", () => {
  assert.doesNotMatch(paquetes, /trasladosIncluidos|mensajeTrasladoIncluido|trasladosPorAlcance/);
  assert.doesNotMatch(leer("lib/calc/servicioVigencias.ts"), /no puede ir incluido en el hotel. Márcalo como opcional.`, motivo: "dato_invalido"/);
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
