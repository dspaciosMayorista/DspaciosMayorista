import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { ordenarContratosDesc } from "../lib/portal/b2bPortal.ts";

test("#96 orden numérico descendente: longitudes distintas y empate Mayorista/Minorista", () => {
  const r = ordenarContratosDesc(["00-0999", "00-10000", "MIN-00-0999", "00-0451"].map((numero_contrato) => ({ numero_contrato })));
  assert.deepEqual(r.map((x) => x.numero_contrato), ["00-10000", "MIN-00-0999", "00-0999", "00-0451"]);
});

test("#87 el inicio del portal ya no monta Planes recomendados", () => {
  assert.doesNotMatch(readFileSync("app/portal/b2b/page.tsx", "utf8"), /<PlanesRecomendados|import \{ PlanesRecomendados/);
});

import { salidasProximasRango, resumenInicio, type VentaPortal } from "../lib/portal/b2bPortal.ts";
const sv = (n: string, f: string | null, extra: Partial<VentaPortal> = {}): VentaPortal => ({ numero_contrato: n, tenant: "mayorista", relacion: "propio", fecha_salida: f, estado: "confirmado", ...extra });

test("#99 límites: hoy y día 30 entran; ayer y día 31 no; anulados y participación fuera; orden ascendente estable", () => {
  const hoy = "2026-11-06";
  const ventas = [
    sv("00-0005", "2026-12-06"), sv("00-0004", "2026-12-07"), sv("00-0003", "2026-11-05"), sv("00-0002", "2026-11-06"),
    sv("00-0009", "2026-11-20"), sv("00-0008", "2026-11-20"), sv("00-0010", "2026-11-10", { estado: "Anulado" }),
    sv("00-0011", "2026-11-10", { relacion: "participacion" }), sv("00-0012", null),
  ];
  const r = salidasProximasRango(ventas, hoy);
  assert.deepEqual(r.map((x) => x.numero_contrato), ["00-0002", "00-0008", "00-0009", "00-0005"]);
  assert.equal(resumenInicio({ ventas, cartera: [], cotizaciones: [], comisiones: [], hoy }).salidasProximas, r.length);
});

test("#99 cruce de fin de año usa calendario, no 30 días de texto", () => {
  const r = salidasProximasRango([sv("a-1", "2027-01-15"), sv("a-2", "2027-01-16")], "2026-12-16");
  assert.deepEqual(r.map((x) => x.numero_contrato), ["a-1"]);
});

test("#83 Documentos rotula la vista de impresión y /c/ conserva PrintButton oculto al imprimir", () => {
  assert.match(readFileSync("app/portal/b2b/documentos/page.tsx", "utf8"), /Imprimir \/ Guardar PDF/);
  const c = readFileSync("app/c/[token]/page.tsx", "utf8");
  assert.match(c, /print:hidden[^>]*>\s*<PrintButton/);
  assert.match(readFileSync("components/contrato/PrintButton.tsx", "utf8"), /window\.print\(\)/);
});

import { origenVenta } from "../lib/portal/b2bPortal.ts";
test("#99 mezcla directas/asistidas: contador = listado completo; pestañas filtran; tarjeta = primeras 3 de la misma regla", () => {
  const hoy = "2026-11-06";
  const u = "u1";
  const ventas = [
    sv("00-0005", "2026-11-20", { b2b_usuario_id: u }), sv("00-0004", "2026-11-08", { b2b_usuario_id: "otro" }),
    sv("00-0003", "2026-12-06", { b2b_usuario_id: u }), sv("00-0002", "2026-11-06"),
    sv("00-0001", "2026-12-07", { b2b_usuario_id: u }), sv("00-0009", "2026-11-10", { relacion: "participacion" }),
    sv("00-0008", "2026-11-10", { estado: "Cancelado", b2b_usuario_id: u }),
  ];
  const lista = salidasProximasRango(ventas, hoy);
  assert.deepEqual(lista.map((v) => v.numero_contrato), ["00-0002", "00-0004", "00-0005", "00-0003"]);
  const dir = lista.filter((v) => origenVenta(v, u) === "directa");
  const asi = lista.filter((v) => origenVenta(v, u) === "asistida");
  assert.equal(dir.length + asi.length, lista.length);
  assert.deepEqual(dir.map((v) => v.numero_contrato), ["00-0005", "00-0003"]);
  assert.deepEqual(asi.map((v) => v.numero_contrato), ["00-0002", "00-0004"]);
  assert.equal(resumenInicio({ ventas, cartera: [], cotizaciones: [], comisiones: [], hoy }).salidasProximas, lista.length);
  assert.deepEqual(lista.slice(0, 3).map((v) => v.numero_contrato), ["00-0002", "00-0004", "00-0005"]);
});

test("#99 cableado: tarjeta del inicio usa la regla compartida y Ventas abre en «Todas»", () => {
  const inicio = readFileSync(new URL("../app/portal/b2b/page.tsx", import.meta.url), "utf8");
  assert.match(inicio, /salidasProximasRango\(conjunto\.ventas, hoy\)\.slice\(0, 3\)/);
  const ventasPg = readFileSync(new URL("../app/portal/b2b/ventas/page.tsx", import.meta.url), "utf8");
  assert.match(ventasPg, /soloProximas \? "todas"/);
});

test("#96 inicio: contratos recientes usan el orden compartido (sin comparador propio), con prefijos mezclados", () => {
  const inicio = readFileSync(new URL("../app/portal/b2b/page.tsx", import.meta.url), "utf8");
  assert.doesNotMatch(inicio, /porNumeroDesc|localeCompare\(a\.numero_contrato/);
  assert.match(inicio, /ordenarContratosDesc\(conjunto\.ventas/);
  // el recorrido: orden compartido sobre el conjunto (ya ordenado) y filtro posterior conservan el orden
  const v = [sv("MIN-00-0999", null), sv("00-10000", null), sv("00-0999", null), sv("00-0451", null)];
  const o = ordenarContratosDesc(ordenarContratosDesc(v).filter(() => true)).map((x) => x.numero_contrato);
  assert.deepEqual(o, ["00-10000", "MIN-00-0999", "00-0999", "00-0451"]);
});
