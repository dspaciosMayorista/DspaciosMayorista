// #13 / B3-2 — Panel de vigencias de compra por vencer: un barrido incompleto NUNCA se oculta, ni siquiera con la lista vacía; el error de lectura y el caso normal también se rotulan. Render real del componente.
import { test } from "node:test";
import assert from "node:assert/strict";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";

const { AvisosCompraPaquetes } = await import("../app/(dashboard)/dashboard/paquetes/AvisosCompraPaquetes.tsx");
type Aviso = Parameters<typeof AvisosCompraPaquetes>[0]["avisos"][number];
const aviso = (n: number, dias = 2): Aviso => ({ fuente: "paquete", clave: `paquete:${n}`, nombre: `Paquete ${n}`, detalle: "Vigencia de compra del paquete · hasta 2026-12-01", compraFin: "2026-12-01", dias, ruta: `/dashboard/paquetes/${n}?tab=config` });
const html = (p: Partial<Parameters<typeof AvisosCompraPaquetes>[0]>) => renderToStaticMarkup(React.createElement(AvisosCompraPaquetes, { avisos: [], dias: 5, truncado: false, error: false, ...p }));

test("B3-2: lista VACÍA pero barrido TRUNCADO → aviso explícito de revisión incompleta (no se oculta)", () => {
  const h = html({ avisos: [], truncado: true });
  assert.match(h, /data-testid="avisos-compra-incompleto"/); assert.match(h, /quedó incompleta/); assert.match(h, /no se puede afirmar que no haya vigencias/); assert.match(h, /próximos 5 días/);
  assert.doesNotMatch(h, /data-testid="avisos-compra"/);
});
test("lista vacía y barrido completo → no muestra nada (nada que avisar)", () => { assert.equal(html({ avisos: [], truncado: false }), ""); });
test("error de lectura → aviso de error propio (no se disfraza de «no hay avisos»)", () => {
  const h = html({ avisos: [], error: true }); assert.match(h, /data-testid="avisos-compra-error"/); assert.match(h, /No se pudieron leer/);
});
test("con avisos y truncado: lista con enlaces correctos y nota de que hay más", () => {
  const h = html({ avisos: [aviso(1, 0), aviso(2, 1), aviso(3, 3)], truncado: true });
  assert.match(h, /3 vigencias de compra terminan/); assert.match(h, /Vence hoy/); assert.match(h, /Vence mañana/); assert.match(h, /Vence en 3 días/);
  assert.match(h, /href="\/dashboard\/paquetes\/2\?tab=config"/); assert.match(h, /Hay más vigencias de las listadas/);
});
test("más de 6 avisos: los 6 primeros visibles y el resto agrupado en «Ver N más»", () => {
  const h = html({ avisos: Array.from({ length: 9 }, (_, i) => aviso(i + 1)) });
  assert.match(h, /Ver 3 más/); assert.equal((h.match(/data-testid="aviso-compra"/g) ?? []).length, 9);
});
