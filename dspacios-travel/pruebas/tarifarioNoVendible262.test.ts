// Tarifario no publicado (generación fallida): el cliente ve un aviso neutro del paquete y el operador el motivo exacto; nunca el genérico «No se encontró la tarifa seleccionada».
// El recorrido real (traslado incluido -> generarTarifario falla -> cotizar) lo comprueba supabase/scripts/test_262_venta_alcance.sh.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { MENSAJE_PAQUETE_NO_DISPONIBLE_CLIENTE, mensajePaqueteNoDisponibleOperador, tarifarioFallido } from "../lib/reservar/tarifarioNoVendible.ts";
import { mensajeTrasladoIncluido } from "../lib/servicios/alcanceContexto.ts";

test("solo una generación fallida cuenta como «no se pudo publicar»", () => {
  assert.equal(tarifarioFallido({ tarifario_estado: "fallido" }), true);
  for (const e of ["listo", "pendiente", "generando", null, undefined, ""]) assert.equal(tarifarioFallido({ tarifario_estado: e as never }), false);
  assert.equal(tarifarioFallido(null), false);
});

test("cliente: aviso neutro, sin detalle de configuración; operador: incluye el motivo exacto", () => {
  assert.doesNotMatch(MENSAJE_PAQUETE_NO_DISPONIBLE_CLIENTE, /traslado|incluido|alcance|servicio/i);
  assert.match(MENSAJE_PAQUETE_NO_DISPONIBLE_CLIENTE, /no está disponible por ahora/);
  const motivo = mensajeTrasladoIncluido("Traslado aeropuerto");
  const op = mensajePaqueteNoDisponibleOperador({ tarifario_estado: "fallido", tarifario_error: motivo });
  assert.ok(op.includes(motivo), "el operador ve el motivo exacto");
  assert.match(op, /no se puede vender hasta corregirlo/);
  assert.match(mensajePaqueteNoDisponibleOperador({ tarifario_estado: "fallido", tarifario_error: "  " }), /Producto → Paquetes/);
});

test("cableado: computarReserva (cliente) y la pantalla interna usan estos mensajes en vez del genérico cuando la generación falló", () => {
  const leer = (r: string) => readFileSync(new URL(`../${r}`, import.meta.url), "utf8");
  const computo = leer("lib/reservar/computo.ts");
  assert.match(computo, /if \(\(!filas \|\| !filas\.length\) && await paqueteConTarifarioFallido\(input\.paqueteId\)\) return \{ ok: false, error: MENSAJE_PAQUETE_NO_DISPONIBLE_CLIENTE \};/);
  assert.match(computo, /async function paqueteConTarifarioFallido\(paqueteId: number\): Promise<boolean> \{\s*try \{[\s\S]*catch \{ return false; \}/);
  const pagina = leer("app/(dashboard)/dashboard/reservar/nuevo/page.tsx");
  assert.match(pagina, /mensajePaqueteNoDisponibleOperador\(est as/);
  assert.match(pagina, /data-testid=\{fallido \? "tarifario-fallido" : undefined\}/);
});
