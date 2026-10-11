// Conversión de una cotización de carrito a contrato(s) con servicios
// vinculados a su hotel (`payload.tours[].hotelRef`). Lógica PURA que usan
// tanto `convertirCotizacionCarrito` (app/(dashboard)/dashboard/reservar/
// actions.ts) como su vista previa (`ConvertirCarritoBtn.tsx`) — mismo
// criterio que pruebas/carritoConversionFlujo.test.ts: la conversión completa
// escribe en muchas tablas, así que la decisión se prueba en la función que
// el servidor usa TAL CUAL, más un cableado que confirma que la usa.
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import {
  agruparUnidadesCarrito, armarGruposConversion, resolverVinculosCotizacion, validarPasajerosServiciosVinculados,
} from "../lib/reservar/vinculoServiciosCheckout.ts";
import { agruparIndicesPorDestino } from "../lib/reservar/carritoAsignaciones.ts";

const raiz = join(dirname(fileURLToPath(import.meta.url)), "..");
const leer = (rel: string) => readFileSync(join(raiz, rel), "utf8");

// Payload guardado por el checkout: dos hoteles del MISMO paquete (10) en
// destinos distintos, cada uno con su propio servicio vinculado, cuyo texto de
// destino viene escrito distinto ("Cartagena " vs "CARTAGENA"), y un tour
// independiente de Receptivos.
const itemsPayload = [
  { ref: "item-0", paqueteId: 10, hotelNombre: "Hotel Almirante", destino: "CARTAGENA" },
  { ref: "item-1", paqueteId: 10, hotelNombre: "Hotel Rodadero", destino: "SANTA MARTA" },
];
const toursPayload = [
  { nombre: "Islas del Rosario", paqueteId: 10, hotelRef: "item-0", destino: "Cartagena " },
  { nombre: "Tayrona", paqueteId: 10, hotelRef: "item-1", destino: null },
  { nombre: "City tour", paqueteId: 40, hotelRef: null, destino: "CARTAGENA" },
  { nombre: "Chiva", paqueteId: 41, destino: "Cartagena " }, // sin hotelRef: independiente
];

describe("resolverVinculosCotizacion — valida el hotelRef persistido", () => {
  test("dos hoteles del mismo paquete: cada servicio resuelve a SU hotel; los independientes quedan null", () => {
    assert.deepEqual(resolverVinculosCotizacion(toursPayload, itemsPayload), { ok: true, hotelDeTour: [0, 1, null, null] });
  });
  test("cotización ANTERIOR (sin hotelRef ni ref en ítems): todo independiente, se sigue convirtiendo", () => {
    const r = resolverVinculosCotizacion([{ nombre: "A", paqueteId: 1 }, { nombre: "B" }], [{ hotelNombre: "H" }]);
    assert.deepEqual(r, { ok: true, hotelDeTour: [null, null] });
  });
  test("vínculo inválido (hotel inexistente, ref repetido o tipo raro): rechaza con mensaje claro", () => {
    for (const malo of ["item-7", 5]) {
      const r = resolverVinculosCotizacion([{ nombre: "Islas", hotelRef: malo }], itemsPayload);
      assert.equal(r.ok, false);
      assert.match((r as { error: string }).error, /«Islas» está vinculado a un hotel que no se encuentra en esta cotización/);
    }
    const repetido = resolverVinculosCotizacion([{ nombre: "Islas", hotelRef: "item-0" }], [{ ref: "item-0" }, { ref: "item-0" }]);
    assert.equal(repetido.ok, false);
  });
  test("vínculo a un hotel de OTRO paquete: rechaza", () => {
    const r = resolverVinculosCotizacion([{ nombre: "Islas", paqueteId: 99, hotelRef: "item-0" }], itemsPayload);
    assert.equal(r.ok, false);
    assert.match((r as { error: string }).error, /«Islas» no pertenece al paquete de «Hotel Almirante»/);
  });
});

describe("armarGruposConversion — el servicio vinculado SIEMPRE va al contrato de su hotel", () => {
  const vinculos = resolverVinculosCotizacion(toursPayload, itemsPayload) as { ok: true; hotelDeTour: (number | null)[] };
  const nombres = (g: { items: { hotelNombre: string }[]; tours: { nombre: string }[] }) => [...g.items.map((i) => i.hotelNombre), ...g.tours.map((t) => t.nombre)];

  test("agrupar=todo: un solo contrato con todo", () => {
    const g = armarGruposConversion({ modo: "todo", items: itemsPayload, tours: toursPayload, hotelDeTour: vinculos.hotelDeTour });
    assert.equal(g.length, 1);
    assert.equal(g[0].destino, null);
    assert.deepEqual(nombres(g[0]), ["Hotel Almirante", "Hotel Rodadero", "Islas del Rosario", "Tayrona", "City tour", "Chiva"]);
  });

  test("agrupar=por_destino: destinos distintos/escritos diferente — cada servicio en el contrato de SU hotel", () => {
    const g = armarGruposConversion({ modo: "por_destino", items: itemsPayload, tours: toursPayload, hotelDeTour: vinculos.hotelDeTour });
    assert.deepEqual(g.map((x) => [x.destino, nombres(x)]), [
      // "Islas" ("Cartagena ") va con Almirante; "City tour" (independiente, "CARTAGENA") también por su destino.
      ["CARTAGENA", ["Hotel Almirante", "Islas del Rosario", "City tour"]],
      // "Tayrona" (destino null) va con Rodadero, NO a un contrato "sin destino".
      ["SANTA MARTA", ["Hotel Rodadero", "Tayrona"]],
      // Independiente con texto distinto: su propio contrato, como siempre (B17).
      ["Cartagena ", ["Chiva"]],
    ]);
  });

  test("sin vínculos (cotización anterior o solo Receptivos), por_destino agrupa EXACTAMENTE como antes", () => {
    const casos: (string | null)[][] = [
      ["A", "B", "A", null, "B", null],
      ["A"],
      [null, null],
      ["X", "Y", "Z", "X"],
    ];
    for (const destinos of casos) {
      const nItems = Math.ceil(destinos.length / 2);
      const nuevo = agruparUnidadesCarrito({
        modo: "por_destino", destinosItems: destinos.slice(0, nItems), destinosTours: destinos.slice(nItems),
        hotelDeTour: destinos.slice(nItems).map(() => null),
      }).map((g) => g.unidades);
      assert.deepEqual(nuevo, agruparIndicesPorDestino(destinos, "por_destino"), JSON.stringify(destinos));
    }
  });

  test("con vínculo, el destino del servicio NO crea un contrato extra (dos hoteles, mismo paquete, mismo destino escrito distinto)", () => {
    const items = [
      { hotelNombre: "H1", destino: "CARTAGENA" },
      { hotelNombre: "H2", destino: "CARTAGENA" },
    ];
    const tours = [{ nombre: "S1", destino: "cartagena" }, { nombre: "S2", destino: "Cartagena" }];
    const g = armarGruposConversion({ modo: "por_destino", items, tours, hotelDeTour: [0, 1] });
    assert.equal(g.length, 1);
    assert.deepEqual(nombres(g[0]), ["H1", "H2", "S1", "S2"]);
  });
});

describe("validarPasajerosServiciosVinculados — subconjunto de los pasajeros del hotel", () => {
  const base = { nombresItems: ["Hotel Almirante", "Hotel Rodadero"], nombresTours: ["Islas", "City tour"] };
  test("pasajeros del servicio dentro de los del hotel: válido (aunque sean menos)", () => {
    assert.equal(validarPasajerosServiciosVinculados({ ...base, asignacionesItems: [[1, 2, 3], [4]], asignacionesTours: [[1, 3], [4]], hotelDeTour: [0, null] }), null);
  });
  test("misma CANTIDAD pero un pasajero ajeno al hotel: rechaza, nombrando servicio, pasajero y hotel", () => {
    const e = validarPasajerosServiciosVinculados({ ...base, asignacionesItems: [[1, 2], [3]], asignacionesTours: [[1, 3]], hotelDeTour: [0] });
    assert.match(e!, /Islas: el pasajero 3 no viaja en «Hotel Almirante»/);
  });
  test("tour independiente: sin restricción (comportamiento de siempre)", () => {
    assert.equal(validarPasajerosServiciosVinculados({ ...base, asignacionesItems: [[1], [2]], asignacionesTours: [[2], [1]], hotelDeTour: [null, null] }), null);
  });
});

describe("cableado — la conversión y su vista previa usan estas mismas funciones", () => {
  const acciones = leer("app/(dashboard)/dashboard/reservar/actions.ts");
  const inicio = acciones.indexOf("export async function convertirCotizacionCarrito(");
  const cuerpo = acciones.slice(inicio, acciones.indexOf("\nexport ", inicio + 10));
  test("valida vínculo y pasajeros ANTES de la primera escritura (createAdminClient)", () => {
    const iVinc = cuerpo.indexOf("resolverVinculosCotizacion(tours, itemsCrudos)");
    const iPax = cuerpo.indexOf("validarPasajerosServiciosVinculados({");
    const iAdmin = cuerpo.indexOf("const admin = createAdminClient();");
    assert.ok(iVinc > 0 && iPax > iVinc && iAdmin > iPax, `${iVinc} ${iPax} ${iAdmin}`);
    assert.match(cuerpo, /if \(!vVinculos\.ok\) return \{ ok: false, error: vVinculos\.error \};/);
    assert.match(cuerpo, /if \(errPasajerosVinculados\) return \{ ok: false, error: errPasajerosVinculados \};/);
  });
  test("los grupos salen de armarGruposConversion (sin la agrupación por destino escrita a mano)", () => {
    assert.match(cuerpo, /armarGruposConversion<ItemCarritoConAsignacion, TourCarritoConAsignacion>\(\{\s*\n\s*modo: opts\.agrupar, items, tours: toursAsign, hotelDeTour,/);
    assert.doesNotMatch(cuerpo, /grupoDe\(t\.destino/);
  });
  test("la vista previa agrupa con agruparUnidadesCarrito y valida el subconjunto; page.tsx pasa el vínculo validado", () => {
    const btn = leer("app/(dashboard)/dashboard/cotizaciones/[id]/ConvertirCarritoBtn.tsx");
    assert.doesNotMatch(btn, /agruparIndicesPorDestino/);
    assert.match(btn, /agruparUnidadesCarrito\(\{/);
    assert.match(btn, /validarPasajerosServiciosVinculados\(\{/);
    const page = leer("app/(dashboard)/dashboard/cotizaciones/[id]/page.tsx");
    assert.match(page, /resolverVinculosCotizacion\(toursCarrito, itemsCarrito\)/);
    assert.match(page, /hotelIndice: hotelDeTourCarrito\[j\] \?\? null/);
    assert.match(page, /vinculoError=\{vinculosCarrito\.ok \? null : vinculosCarrito\.error\}/);
  });
});
