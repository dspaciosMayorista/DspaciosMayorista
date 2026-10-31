// Presentación de los avisos del tarifario: el diagnóstico crudo (una sola cadena) se parte en secciones legibles,
// sin marcadores de formato y sin que el texto libre del «Incluye» confunda el corte.
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { limpiarMarcado, separarAvisos } from "../lib/paquetes/avisosTarifario.ts";
import { diagnosticoDisponibilidad } from "../lib/tarifario/disponibilidadServicios.ts";
import { estadoTarifarioVista } from "../lib/paquetes/armadoPestanas.ts";

const ids = (t: string) => separarAvisos(t).map((s) => s.id);

describe("limpiarMarcado", () => {
  it("quita ##, **, __ y comillas invertidas y colapsa espacios", () => {
    assert.equal(limpiarMarcado("## **Traslado**  `aeropuerto`\n__x__"), "Traslado aeropuerto x");
  });
});

describe("separarAvisos", () => {
  it("vacío o solo el conteo → sin secciones", () => {
    assert.deepEqual(separarAvisos(null), []);
    assert.deepEqual(separarAvisos("1881 tarifas persona publicadas en el tarifario."), []);
  });

  it("infante: sección propia con el nombre del servicio como ítem", () => {
    const [s] = separarAvisos("12 tarifas persona publicadas en el tarifario. Atención: el servicio Tour Isla no tiene precio de infante: los menores de 2 años pagarán como adulto en él. Configúralo en Producto → Servicios.");
    assert.equal(s.id, "infante");
    assert.deepEqual(s.bloques[0].items, ["Tour Isla"]);
  });

  it("caso largo realista: orden de secciones, ítems por servicio, sin marcadores y sin cortar dentro de «…»", () => {
    const texto = [
      "1881 tarifas persona publicadas en el tarifario.",
      "3 de 40 salidas no se publican porque un servicio incluido no tiene vigencia confirmada: «Traslado ## aeropuerto» (2 salida(s), desde 01/11/2026 hasta 05/11/2026; sin tarifa vigente); «Tour; Isla» (1 salida(s), desde 09/11/2026; vencida).",
      "Servicios incluidos omitidos por falta de tarifa vigente (esas salidas se ofrecen SIN el servicio): «Cena» (4 salida(s); sin vigencia); «Show» (1 salida(s); sin vigencia).",
      "ATENCIÓN operador: en las salidas con servicios omitidos el texto «Incluye» (libre) no se presenta como inclusión cierta. Líneas afectadas: «**Cena** en el hotel. Atención: texto»; «## Show».",
      "Atención: los servicios Tour A, Tour B no tienen precio de infante: los menores de 2 años pagarán como adulto en ellos. Configúralo en Producto → Servicios.",
    ].join(" ");
    const sec = separarAvisos(texto);
    assert.deepEqual(sec.map((s) => s.id), ["omitidos", "infante", "incluye"]);
    const omit = sec[0];
    assert.equal(omit.bloques.length, 2);
    assert.equal(omit.bloques[0].items.length, 2, "«Tour; Isla» no se parte por el ; interno");
    assert.match(omit.bloques[0].items[0], /^«Traslado aeropuerto» \(2 salida\(s\)/);
    assert.equal(omit.bloques[1].items.length, 2);
    assert.equal(sec[2].bloques.length, 1, "«Atención: texto» dentro de comillas no abre otra sección");
    assert.doesNotMatch(JSON.stringify(sec), /##|\*\*/);
  });

  it("cola truncada por el tope de 1800 caracteres no rompe", () => {
    const largo = "Servicios incluidos omitidos por falta de tarifa vigente (esas salidas se ofrecen SIN el servicio): " + Array.from({ length: 80 }, (_, i) => `«S${i}» (1 salida(s); x)`).join("; ").slice(0, 1700) + "…";
    const sec = separarAvisos(largo);
    assert.equal(sec.length, 1);
    assert.ok(sec[0].bloques[0].items.length > 10);
  });

  it("acople con diagnosticoDisponibilidad: lo que genera hoy se reparte en las secciones esperadas", () => {
    const d = diagnosticoDisponibilidad({
      salidasEvaluadas: 5,
      salidasOmitidas: [{ fechaIda: "2026-11-01", fechaRegreso: null, motivos: [{ servicio: "Traslado", error: "sin tarifa vigente" }] }],
      opcionalesOcultos: [{ servicio: "Tour opc", motivo: "sin vigencia" }],
      opcionalesParciales: [],
      incluidosOmitidos: [{ fechaIda: "2026-12-01", fechaRegreso: null, servicios: [{ servicioId: 1, servicio: "Cena", motivo: "sin vigencia" }] }],
      lineasIncluyeAfectadas: { retiradas: ["Cena"], noConfirmadas: ["Spa **libre**"] },
    }, true)!;
    const sec = ids(d);
    for (const id of ["omitidos", "incluye", "opcionales"]) assert.ok(sec.includes(id as never), `${id} en ${sec.join(",")}`);
    assert.ok(!sec.includes("otros" as never), "ninguna frase conocida cae en «Otros avisos»");
  });
});

describe("estadoTarifarioVista con diagnóstico", () => {
  it("encabezado compacto: etiqueta «Publicado con avisos», sin el diagnóstico en el detalle", () => {
    const e = estadoTarifarioVista("listo", null, true, "3 de 4 salidas no se publican porque un servicio incluido no tiene vigencia confirmada: «X» (1 salida(s); y).");
    assert.equal(e.etiqueta, "Publicado con avisos");
    assert.equal(e.detalle, null);
    assert.match(e.avisos ?? "", /^3 de 4 salidas/);
    assert.equal(estadoTarifarioVista("listo", null, true, "Sin oferta vendible.").etiqueta, "Publicado sin oferta vendible");
    assert.equal(estadoTarifarioVista("listo", null, true, null).avisos, undefined);
  });
});
