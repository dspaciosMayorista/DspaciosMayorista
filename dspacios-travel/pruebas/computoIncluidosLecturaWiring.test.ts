// `computarReserva` (lib/reservar/computo.ts): los servicios INCLUIDOS del
// paquete se leen con service-role. `armado_servicios`, `servicios_adicionales`
// y `servicio_tarifa_pax` son catálogo interno por RLS: con la sesión de un
// usuario externo (checkout público/B2B) o de `venta`, la consulta devolvía 0
// filas sin error y el incluido desaparecía del documento ("Asistencia: No"),
// de la CxP al convertir y, en modo grupo, del precio. La ejecución del resto
// del flujo con incluidos se prueba en pruebas/checkoutB2BIncluidos.test.ts.
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const computo = readFileSync(join(import.meta.dirname, "..", "lib/reservar/computo.ts"), "utf8");
const inicio = computo.indexOf("const serviciosIncluidos: ServicioEfectivo[] = [];");
const fin = computo.indexOf("const cargo = cargoGrupoIncluido(", inicio);
const bloque = computo.slice(inicio, fin);

describe("computarReserva — lectura de servicios incluidos", () => {
  test("el bloque existe y termina en el cargo por grupo (ancla estable)", () => {
    assert.notEqual(inicio, -1);
    assert.notEqual(fin, -1);
  });

  test("armado_servicios + categoría/precio y servicio_tarifa_pax se leen con el cliente de servicio", () => {
    assert.match(bloque, /const catalogo = createAdminClient\(\);/);
    assert.match(bloque, /await catalogo\s*\n\s*\.from\("armado_servicios"\)/);
    // 226: además `precio_infante` (precio del menor de 2 años del servicio).
    assert.match(bloque, /servicios_adicionales\(nombre, categoria, precio_persona, (precio_infante, )?liquidacion, proveedor_id\)/);
    // SIN «GENERAL»: las vigencias y rangos de cada incluido se leen con ESE mismo cliente de servicio (cargarVigenciasServicios) y ya no se consulta la temporada GENERAL.
    assert.match(bloque, /cargarVigenciasServicios\(catalogo,/);
    assert.doesNotMatch(bloque, /"GENERAL"/);
  });

  test("ninguna lectura de incluidos queda con la sesión", () => {
    assert.doesNotMatch(bloque, /\bsb\s*\.from\(|await sb\s*\n\s*\.from\(/);
  });

  test("sigue acotada al paquete y a los incluidos, y falla cerrado ante error", () => {
    assert.match(bloque, /\.eq\("paquete_id", input\.paqueteId\)\s*\n\s*\.eq\("incluido", true\)/);
    assert.match(bloque, /if \(incErr\) return \{ ok: false,/);
    assert.match(bloque, /if \(!rvInc\.ok\) return \{ ok: false,/);
  });

  test("reglas de precio intactas: por persona solo se registra; por grupo se cobra una vez con el pax real", () => {
    const resto = computo.slice(inicio, computo.indexOf("serviciosIncluidos.push(...cargo.servicios);", inicio) + 50);
    assert.match(resto, /if \(modo === "persona"\) \{[\s\S]*?serviciosIncluidos\.push\(\{[\s\S]*?continue;/);
    // 226: el rango cuenta SOLO a los de 2+ años (`paxServAdulto`); el menor de 2 años no cuenta ni paga extra.
    assert.match(resto, /const cargo = cargoGrupoIncluido\(gruposIncluidosPendientes, paxServAdulto, pctMk, numNochesInc\);/);
    assert.equal((resto.match(/precioVenta \+= cargo\.pvp;/g) ?? []).length, 1);
  });
});
