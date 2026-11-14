import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { SELECT_GRUPOS_VIGENCIA } from "../lib/calc/gruposDias.ts";

// #43/#60 incremento 2 — cableado: grupos dentro de la lectura existente (0 solicitudes nuevas),
// armado compartido del mapa de netos, y lo que este incremento NO toca.
const leer = (f: string) => readFileSync(f, "utf8").replace(/\r\n/g, "\n");
const CARGADORES = {
  "lib/reservar/cotizar.ts": "admin",
  "lib/reservar/computo.ts": "admin",
  "lib/tarifario/vigencia.ts": "admin",
  "app/(dashboard)/dashboard/paquetes/actions.ts": "sb",
};

test("los cuatro cargadores del motor piden los grupos DENTRO de su lectura de vigencias, con su cliente de siempre", () => {
  for (const [f, cliente] of Object.entries(CARGADORES)) {
    const src = leer(f);
    // #43/#60 entrega 4: el select es una plantilla (`…, ${SELECT_PROMO_VIGENCIA}`): misma lectura, 0 solicitudes nuevas.
    const lecturas = [...src.matchAll(/(\w+)\s*\n?\s*\.from\("hotel_temporadas"\)\s*\.select\(["`]([^"`]*)["`]\)/g)]
      .filter((m) => m[2].includes(SELECT_GRUPOS_VIGENCIA));
    assert.equal(lecturas.length, 1, `${f}: una lectura de vigencias con ${SELECT_GRUPOS_VIGENCIA}`);
    assert.equal(lecturas[0][1], cliente, `${f}: el cliente no cambia (nunca anon)`);
    assert.ok(lecturas[0][2].includes("${SELECT_PROMO_VIGENCIA}"), `${f}: las promociones (300) llegan en la MISMA lectura`);
  }
});

test("los cargadores arman el mapa de netos con el helper compartido", () => {
  for (const f of ["lib/reservar/liquidacionHotel.ts", "lib/reservar/computo.ts", "lib/tarifario/vigencia.ts", "app/(dashboard)/dashboard/paquetes/actions.ts"]) {
    assert.match(leer(f), /netosDeColumna\(/, f);
  }
});

// Entrega L (2026-11-12): el límite de duración de las consultas pasó a ser la estadía máxima del viaje (30), definida en un solo lugar.
test("entrega L: el límite de duración de consultas es la estadía máxima única (lib/reglas/duracionViaje.ts)", () => {
  assert.match(leer("lib/reservar/edadesMenores.ts"), /export const MAX_NOCHES_CONSULTA = MAX_NOCHES_VIAJE;/);
});

test("la 293 sigue con el candado de inactividad (el incremento 2 no activa grupos)", () => {
  assert.match(leer("supabase/migrations/20260601000293_vigencia_grupos_dias_inactivos.sql"), /constraint hotel_temporada_grupos_inactivos_43\n\s+check \(not activo\)/);
});
