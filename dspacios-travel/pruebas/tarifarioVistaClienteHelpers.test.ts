import { test, describe } from "node:test";
import assert from "node:assert/strict";
import {
  fusionarEnriquecimiento, moduloDeSub, subDeModulo, pageSizeDe, type Enriquecimiento,
} from "../lib/tarifario/vistaClienteHelpers.ts";
import { PAGE_SIZE_BLOQUEO, PAGE_SIZE_PUBLICO } from "../lib/tarifario/consulta.ts";

// EJECUCIÓN REAL de la lógica pura del cliente de tarifario (TarifarioPublic.tsx
// no es importable con ejecución real bajo `node --test`: es un componente
// cliente con JSX de verdad, y `--experimental-strip-types` solo borra
// anotaciones de tipo, no transforma JSX — un import de VALOR revienta al
// cargar el módulo. Por eso esta lógica vive aparte, en un .ts sin JSX.

function enrVacio(): Enriquecimiento {
  return {
    cuposPorBloqueo: {}, origenPorBloqueo: {}, fotosPorHotel: {}, fotosPorServicio: {},
    infoPorHotel: {}, planesInfo: {}, capPorHotel: {}, ventanaPorPaquete: {}, incluidosPorPaquete: {}, filasAddon: [],
  };
}

describe("fusionarEnriquecimiento() — 'Cargar más' AGREGA, nunca reemplaza el enriquecimiento ya cargado", () => {
  test("mapas disjuntos: el resultado tiene las claves de AMBOS lados", () => {
    const prev = { ...enrVacio(), fotosPorHotel: { 1: "foto1.jpg" } };
    const nuevo = { ...enrVacio(), fotosPorHotel: { 2: "foto2.jpg" } };
    const r = fusionarEnriquecimiento(prev, nuevo);
    assert.deepEqual(r.fotosPorHotel, { 1: "foto1.jpg", 2: "foto2.jpg" });
  });

  test("cupos/origen: el valor NUEVO siempre gana sobre el mismo id (lectura EN VIVO más reciente, nunca se sirve algo viejo)", () => {
    const prev = { ...enrVacio(), cuposPorBloqueo: { 10: 5 }, origenPorBloqueo: { 10: "BOG" } };
    const nuevo = { ...enrVacio(), cuposPorBloqueo: { 10: 2 }, origenPorBloqueo: { 10: "BOG" } };
    const r = fusionarEnriquecimiento(prev, nuevo);
    assert.equal(r.cuposPorBloqueo[10], 2, "el cupo recién leído (2) debe ganar sobre el viejo (5)");
  });

  test("filasAddon se CONCATENA (nunca se pierde lo ya cargado de una página anterior)", () => {
    const prev = { ...enrVacio(), filasAddon: [{ modulo: "servicios" as const, bloqueo_label: null, precio_pvp: 1, categoria: null, regimen: null, acomodacion: null, fecha_ida: null, fecha_regreso: null, noches: null, destino_nombre: null, paquete_nombre: null, hotel_nombre: null }] };
    const nuevo = { ...enrVacio(), filasAddon: [{ modulo: "servicios" as const, bloqueo_label: null, precio_pvp: 2, categoria: null, regimen: null, acomodacion: null, fecha_ida: null, fecha_regreso: null, noches: null, destino_nombre: null, paquete_nombre: null, hotel_nombre: null }] };
    const r = fusionarEnriquecimiento(prev, nuevo);
    assert.equal(r.filasAddon.length, 2);
  });

  test("todos los demás mapas (fotosPorServicio/infoPorHotel/planesInfo/capPorHotel/ventanaPorPaquete/incluidosPorPaquete) se unen por clave sin perder lo previo", () => {
    const prev = {
      ...enrVacio(),
      fotosPorServicio: { 1: "a" }, infoPorHotel: { 1: { estrellas: 4, clasificacion: null, descripcion: null, ubicacion: null } },
      planesInfo: { PC: { nombre: "Plan Completo", descripcion: null, nota_especial: null } },
      capPorHotel: { 1: { paxMin: 1, paxMax: 4, acom: [] } },
      ventanaPorPaquete: { 1: { min: "2026-01-01", max: "2026-12-31" } },
      incluidosPorPaquete: { 1: ["Traslados"] },
    };
    const nuevo = {
      ...enrVacio(),
      fotosPorServicio: { 2: "b" }, infoPorHotel: { 2: { estrellas: 5, clasificacion: null, descripcion: null, ubicacion: null } },
      planesInfo: { PAM: { nombre: "Plan Americano Modificado", descripcion: null, nota_especial: null } },
      capPorHotel: { 2: { paxMin: 2, paxMax: 6, acom: [] } },
      ventanaPorPaquete: { 2: { min: "2026-02-01", max: "2026-11-30" } },
      incluidosPorPaquete: { 2: ["Desayuno"] },
    };
    const r = fusionarEnriquecimiento(prev, nuevo);
    assert.deepEqual(Object.keys(r.fotosPorServicio).sort(), ["1", "2"]);
    assert.deepEqual(Object.keys(r.infoPorHotel).sort(), ["1", "2"]);
    assert.deepEqual(Object.keys(r.planesInfo).sort(), ["PAM", "PC"]);
    assert.deepEqual(Object.keys(r.capPorHotel).sort(), ["1", "2"]);
    assert.deepEqual(Object.keys(r.ventanaPorPaquete).sort(), ["1", "2"]);
    assert.deepEqual(Object.keys(r.incluidosPorPaquete).sort(), ["1", "2"]);
  });

  test("fusionar no MUTA ninguno de los dos objetos de entrada (prev/nuevo quedan intactos)", () => {
    const prev = { ...enrVacio(), fotosPorHotel: { 1: "a" } };
    const nuevo = { ...enrVacio(), fotosPorHotel: { 2: "b" } };
    const prevAntes = JSON.stringify(prev);
    const nuevoAntes = JSON.stringify(nuevo);
    fusionarEnriquecimiento(prev, nuevo);
    assert.equal(JSON.stringify(prev), prevAntes);
    assert.equal(JSON.stringify(nuevo), nuevoAntes);
  });
});

describe("moduloDeSub()/subDeModulo() — mapeo entre la etiqueta de Vista Booking ('receptivos') y el módulo real de datos ('servicios')", () => {
  test("moduloDeSub: 'receptivos' → 'servicios'; el resto pasa igual", () => {
    assert.equal(moduloDeSub("receptivos"), "servicios");
    assert.equal(moduloDeSub("bloqueo"), "bloqueo");
    assert.equal(moduloDeSub("porcion_terrestre"), "porcion_terrestre");
  });

  test("subDeModulo: 'servicios' → 'receptivos'; 'porcion_terrestre' pasa igual; cualquier otro (incluido 'dinamico', que Vista Booking no tiene como pestaña) cae a 'bloqueo'", () => {
    assert.equal(subDeModulo("servicios"), "receptivos");
    assert.equal(subDeModulo("porcion_terrestre"), "porcion_terrestre");
    assert.equal(subDeModulo("bloqueo"), "bloqueo");
    assert.equal(subDeModulo("dinamico"), "bloqueo");
    assert.equal(subDeModulo("programas"), "bloqueo");
  });

  test("round-trip: moduloDeSub(subDeModulo(m)) es la identidad para los 3 módulos que Vista Booking sí tiene", () => {
    for (const m of ["bloqueo", "porcion_terrestre", "servicios"] as const) {
      assert.equal(moduloDeSub(subDeModulo(m)), m);
    }
  });
});

describe("pageSizeDe() — el módulo 'bloqueo' (Paquetes) usa una página más grande que el resto", () => {
  test("bloqueo usa PAGE_SIZE_BLOQUEO (necesita cubrir el selector Origen/Destino/Salida)", () => {
    assert.equal(pageSizeDe("bloqueo"), PAGE_SIZE_BLOQUEO);
  });
  test("dinamico/porcion_terrestre/servicios usan PAGE_SIZE_PUBLICO (más chico)", () => {
    assert.equal(pageSizeDe("dinamico"), PAGE_SIZE_PUBLICO);
    assert.equal(pageSizeDe("porcion_terrestre"), PAGE_SIZE_PUBLICO);
    assert.equal(pageSizeDe("servicios"), PAGE_SIZE_PUBLICO);
  });
  test("PAGE_SIZE_BLOQUEO es sustancialmente más chico que las 17.197 filas medidas en el incidente real", () => {
    assert.ok(PAGE_SIZE_BLOQUEO < 17_197 / 50, "debe ser al menos ~50x más chico que el catálogo completo medido");
  });
});
