// ─────────────────────────────────────────────────────────────────────────
// Regresión "Preview: no aparece ningún recomendado" (ni en global ni tras
// buscar por destino) — causa demostrada: `lib/tarifario/resumen.ts` leía
// `armado_hoteles.prioridad` con `sb` (cliente de la request, sujeto a la
// RLS de esa tabla — "armado_hoteles: interno", solo roles internos). Un
// visitante público/anónimo del tarifario nunca cumple esa RLS, así que la
// consulta devolvía SIEMPRE 0 filas SIN error (RLS filtra, no falla) →
// `prioridadesRecomendados` (persona) quedaba `{}` en todo request público.
// Como `prioridadesRecomendadasCombinadas` (page.tsx) parte de ese mismo
// mapa persona, AMBOS modos (global y por destino) se quedaban sin
// candidatos — exactamente el síntoma reportado, y exactamente por lo que
// no podía ser un defecto exclusivo de una sola función de selección.
//
// Esta prueba fija dos cosas:
//   1. Guarda de regresión de la CORRECCIÓN misma: `resumen.ts` debe leer
//      `armado_hoteles` con `admin` (bypassa RLS), nunca con `sb`.
//   2. Conductual: con el MISMO mapa de prioridades ya poblado (como lo
//      entregaría `admin` correctamente), ambos modos seleccionan lo
//      esperado y ninguna oferta recomendada desaparece por el estado de
//      filtro vacío/por defecto.
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import {
  claveOferta, ofertasConPrioridad, seleccionarRecomendadosGlobalInicial, seleccionarRecomendadosPorDestino,
} from "../lib/tarifario/recomendados.ts";
import { filtrarPorFiltros, filtrosVacios, type ItemResto } from "../lib/tarifario/inventarioResto.ts";

describe("Guarda de regresión — resumen.ts NO debe volver a leer armado_hoteles con `sb`", () => {
  const ruta = fileURLToPath(new URL("../lib/tarifario/resumen.ts", import.meta.url));
  const src = readFileSync(ruta, "utf8");

  test("la consulta a armado_hoteles usa `admin` (bypassa la RLS interna), nunca `sb`", () => {
    const inicio = src.indexOf('.from("armado_hoteles")');
    assert.notEqual(inicio, -1, "debe existir la consulta a armado_hoteles");
    const antes = src.slice(Math.max(0, inicio - 40), inicio);
    assert.match(antes, /admin\s*$/, "la consulta debe colgar de `admin`, no de `sb` (RLS de armado_hoteles solo permite roles internos)");
    assert.doesNotMatch(antes, /\bsb\s*$/, "usar `sb` aquí reproduce la regresión: RLS filtra en silencio y deja el mapa de prioridades en {}");
  });

  test("el bloque exige `admin` no-nulo antes de consultar (falla cerrado, nunca intenta con un cliente ausente)", () => {
    const inicio = src.indexOf('.from("armado_hoteles")');
    const bloqueAntes = src.slice(Math.max(0, inicio - 400), inicio);
    assert.match(bloqueAntes, /if\s*\(paqIdsConHotel\.length\s*&&\s*admin\)/, "debe verificar `admin` antes de consultar armado_hoteles");
  });
});

// ── Conductual: mismo mapa de prioridades ya poblado, ambos modos ──────────
type OfertaCandidata = { hotelId: number; paqueteId: number };

function tarjetaMinima(hotelId: number, paqueteId: number): ItemResto {
  return {
    hotelId, paqueteId, nombre: `Hotel ${hotelId}`, precio: 100000, estrellas: 4, zona: "Zona",
    petFriendly: false, adultsOnly: false, condicion: "desconocido", politica: "desconocido",
  };
}

describe("Con el MISMO mapa ya poblado (persona + Bernalo combinados), ambos modos reconocen recomendados", () => {
  // Paquete 10: prioridades 1..6 (persona). Paquete 20: prioridad 1 (Bernalo,
  // combinada al mismo mapa — misma clave hotelId:paqueteId).
  const prioridadesCombinadas: Record<string, number> = {
    [claveOferta(101, 10)]: 1,
    [claveOferta(102, 10)]: 2,
    [claveOferta(103, 10)]: 3,
    [claveOferta(104, 10)]: 4,
    [claveOferta(105, 10)]: 5,
    [claveOferta(106, 10)]: 6,
    [claveOferta(201, 20)]: 1, // Bernalo
  };

  const candidatasPersona: OfertaCandidata[] = [10, 10, 10, 10, 10, 10].map((paqueteId, i) => ({ hotelId: 101 + i, paqueteId }));
  const candidatasUnidad: OfertaCandidata[] = [{ hotelId: 201, paqueteId: 20 }];

  test("global (sin destino): devuelve las literales 1 y 2 del paquete 10, y también la 1 del paquete 20 (Bernalo)", () => {
    const ofertas = ofertasConPrioridad([...candidatasPersona, ...candidatasUnidad], prioridadesCombinadas);
    const seleccion = seleccionarRecomendadosGlobalInicial(ofertas);
    assert.deepEqual(
      seleccion.map((o) => `${o.hotelId}:${o.paqueteId}:${o.prioridad}`),
      ["101:10:1", "102:10:2", "201:20:1"]
    );
  });

  test("búsqueda por destino (paquetes 10 y 20 coincidentes): devuelve 1..6 del paquete 10 y 1 del paquete 20", () => {
    const ofertas = ofertasConPrioridad([...candidatasPersona, ...candidatasUnidad], prioridadesCombinadas);
    const seleccion = seleccionarRecomendadosPorDestino(ofertas, new Set([10, 20]));
    assert.deepEqual(
      seleccion.map((o) => `${o.hotelId}:${o.paqueteId}:${o.prioridad}`),
      ["101:10:1", "102:10:2", "103:10:3", "104:10:4", "105:10:5", "106:10:6", "201:20:1"]
    );
  });

  test("si el mapa combinado llega VACÍO (la regresión), ningún modo produce recomendados — confirma que ambos comparten el mismo insumo", () => {
    const ofertas = ofertasConPrioridad([...candidatasPersona, ...candidatasUnidad], {});
    assert.deepEqual(seleccionarRecomendadosGlobalInicial(ofertas), []);
    assert.deepEqual(seleccionarRecomendadosPorDestino(ofertas, new Set([10, 20])), []);
  });

  test("las claves candidatas coinciden EXACTAMENTE con las del mapa (hotelId:paqueteId) — ninguna se pierde por formato", () => {
    const clavesCandidatas = new Set([...candidatasPersona, ...candidatasUnidad].map((c) => claveOferta(c.hotelId, c.paqueteId)));
    const clavesMapa = new Set(Object.keys(prioridadesCombinadas));
    for (const clave of clavesMapa) {
      assert.ok(clavesCandidatas.has(clave), `la clave ${clave} del mapa de prioridades debe existir entre las ofertas candidatas`);
    }
  });

  test("ningún filtro vacío/por defecto elimina las ofertas recomendadas ya seleccionadas", () => {
    const ofertas = ofertasConPrioridad([...candidatasPersona, ...candidatasUnidad], prioridadesCombinadas);
    const seleccion = seleccionarRecomendadosGlobalInicial(ofertas);
    const items = seleccion.map((o) => tarjetaMinima(o.hotelId, o.paqueteId));
    const filtradas = filtrarPorFiltros(items, filtrosVacios());
    assert.deepEqual(filtradas.map((i) => `${i.hotelId}:${i.paqueteId}`), items.map((i) => `${i.hotelId}:${i.paqueteId}`));
  });
});
