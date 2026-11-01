// La CxP automática del carrito debe empezar por marca_cxp_automatica() («Generado automáticamente desde el tarifario»): es el prefijo con el que
// registrar_financiero_contrato reconoce y REEMPLAZA sus CxP en un reintento (cron). Con otro texto el reintento no las borraba y chocaba con la clave de enlace (265).
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const MARCA = "Generado automáticamente desde el tarifario"; // = public.marca_cxp_automatica() (migración 171)
const fuente = readFileSync(new URL("../app/(dashboard)/dashboard/reservar/actions.ts", import.meta.url), "utf8");

test("convertirCotizacionCarrito: OBS_AUTO empieza por la marca automática de la base", () => {
  const todas = [...fuente.matchAll(/const OBS_AUTO = "([^"]+)"/g)].map((x) => x[1]);
  assert.ok(todas.length >= 2, "hay dos OBS_AUTO (reserva interna y carrito)");
  for (const t of todas) assert.ok(t.startsWith(MARCA), `«${t}» debe empezar por la marca`);
  assert.ok(todas.includes("Generado automáticamente desde el tarifario (carrito)"));
});

test("la clave de enlace va como sufijo (no rompe el prefijo)", () => {
  assert.match(fuente, /observaciones: claveEnlace \? `\$\{OBS_AUTO\} · enlace:\$\{claveEnlace\}` : OBS_AUTO/);
});
