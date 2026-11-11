import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  reusoSujetoAElegibilidad,
  describirBloqueoReuso,
  describirBloqueosReuso,
  codigosDeErrorReuso,
} from "../lib/contrato/reciclaje.ts";

// #75 (migración 282): un contrato DTM- (mayorista) ya NO se descarta de entrada para reciclar su
// consecutivo, pero SOLO se libera si la base lo declara elegible (pendiente, nunca confirmado, vacío salvo el
// titular). Minorista (MIN-… y 00-NNNN históricos) conserva su comportamiento sin condiciones.
describe("reusoSujetoAElegibilidad — migración 282", () => {
  test("un contrato DTM- pasa por la elegibilidad", () => {
    assert.equal(reusoSujetoAElegibilidad("DTM-0001"), true);
    assert.equal(reusoSujetoAElegibilidad("DTM-9999"), true);
  });

  test("Minorista (MIN-…) y los históricos 00-NNNN NO pasan por la elegibilidad: igual que siempre", () => {
    assert.equal(reusoSujetoAElegibilidad("MIN-00-0533"), false);
    assert.equal(reusoSujetoAElegibilidad("MIN-ABC123"), false);
    assert.equal(reusoSujetoAElegibilidad("00-0482"), false);
  });

  test("es sensible a mayúsculas en el prefijo (el formato real siempre es DTM- en mayúscula)", () => {
    assert.equal(reusoSujetoAElegibilidad("dtm-0001"), false);
  });
});

describe("describirBloqueoReuso — traduce los códigos de la base sin inventar permisos", () => {
  test("relaciones comerciales, financieras y operativas", () => {
    assert.match(describirBloqueoReuso("RELACION_CONTRATO_PASAJEROS"), /pasajeros/);
    assert.match(describirBloqueoReuso("RELACION_ABONOS"), /pagos/);
    assert.match(describirBloqueoReuso("RELACION_ABONOS_ANULADOS"), /pagos anulados/);
    assert.match(describirBloqueoReuso("RELACION_ALIADOS_B2B"), /comisiones/);
    assert.match(describirBloqueoReuso("RELACION_CONTRATO_VUELOS"), /vuelos/);
    assert.match(describirBloqueoReuso("RELACION_SILLAS"), /sillas/);
    assert.match(describirBloqueoReuso("RELACION_CONTRATO_SERVICIOS"), /servicios/);
    assert.match(describirBloqueoReuso("RELACION_CONTRATO_SOPORTES_PAGO"), /soportes/);
    assert.match(describirBloqueoReuso("ARCHIVOS_EN_STORAGE"), /archivos/);
    assert.match(describirBloqueoReuso("REUSO_DESHABILITADO"), /deshabilitada/);
  });

  test("una tabla futura sin traducción igual produce un motivo legible (la base bloquea sin tocar el código)", () => {
    assert.match(describirBloqueoReuso("RELACION_TABLA_NUEVA_2027"), /tabla nueva 2027/i);
  });

  test("estado, campos comerciales y lecturas fallidas", () => {
    assert.match(describirBloqueoReuso("ESTADO_ACTUAL_CONFIRMADO"), /confirmado/);
    assert.match(describirBloqueoReuso("CAMPO_COMERCIAL_PRECIO_VENTA"), /datos comerciales.*precio venta/);
    assert.match(describirBloqueoReuso("LECTURA_FALLIDA_ABONOS"), /por seguridad/);
    assert.match(describirBloqueoReuso("LECTURA_FALLIDA: lo que sea"), /por seguridad/);
  });

  test("describirBloqueosReuso conserva el orden y la cantidad", () => {
    assert.equal(describirBloqueosReuso(["RELACION_ABONOS", "ESTADO_ACTUAL_ACTIVO"]).length, 2);
  });
});

describe("codigosDeErrorReuso", () => {
  test("extrae los códigos del error de eliminar_contrato", () => {
    assert.deepEqual(codigosDeErrorReuso("REUSO_NO_ELEGIBLE: RELACION_ABONOS, RELACION_CUOTAS"), ["RELACION_ABONOS", "RELACION_CUOTAS"]);
  });
  test("ignora el pie (HINT/CONTEXT) y otros errores devuelven null", () => {
    assert.deepEqual(codigosDeErrorReuso("REUSO_NO_ELEGIBLE: NO_EXISTE\nHINT: No se cambió nada."), ["NO_EXISTE"]);
    assert.equal(codigosDeErrorReuso("Solo un superadmin puede eliminar contratos."), null);
    assert.equal(codigosDeErrorReuso(null), null);
  });
});

describe("289: los motivos nuevos de la elegibilidad ampliada tienen frase propia (no el genérico «Motivo de bloqueo»)", () => {
  test("cada código de compromiso real se traduce", () => {
    for (const c of ["SILLAS_NO_LIBERABLES", "VUELO_EMITIDO", "FACTURACION_EMITIDA", "CXP_CON_PAGOS", "CXP_CON_RETENCIONES", "CXP_63_PROTEGIDA", "COMISION_EXIGIBLE",
      "COMISION_CON_PAGOS", "COMISION_CON_REVISION", "PLAN_COMISION_SIN_LIBERACION_97", "REFERENCIA_MANUAL_EN_SILLA"]) {
      assert.doesNotMatch(describirBloqueoReuso(c), /^Motivo de bloqueo/, c);
    }
  });
  test("el código de la migración 289 solo emite motivos que la interfaz conoce", () => {
    const sql = readFileSync(new URL("../supabase/migrations/20260601000289_elegibilidad_dtm_ampliada.sql", import.meta.url), "utf8");
    const emitidos = [...sql.matchAll(/b := b \|\| '([A-Z0-9_]+)'::text/g)].map((m) => m[1]);
    assert.ok(emitidos.length >= 10);
    for (const c of emitidos) assert.doesNotMatch(describirBloqueoReuso(c), /^Motivo de bloqueo/, c);
  });
});
