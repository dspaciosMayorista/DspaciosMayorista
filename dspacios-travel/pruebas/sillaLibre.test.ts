// ¿Silla libre de verdad? (lib/vuelos/sillaLibre.ts). Decide si el detalle
// del record ofrece "Mover", "Retirar cupo" y "+ Contrato manual", y cuenta
// los cupos libres de un record destino. Mismo criterio que `_silla_libre`
// en la base (migración 194), que es la que decide de verdad.
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { esSillaLibre, ESTADOS_SILLA_VENDIBLE, type SillaParaLibre } from "../lib/vuelos/sillaLibre.ts";

const vacia: SillaParaLibre = {
  estado: "disponible", numero_contrato: null, contrato_manual: null,
  pasajero_nombres: null, pasajero_apellidos: null, tipo_doc: null, numero_doc: null, nacimiento: null,
};

describe("esSillaLibre", () => {
  test("disponible o cambio_entrante, sin contrato ni pasajero → libre", () => {
    assert.deepEqual([...ESTADOS_SILLA_VENDIBLE], ["disponible", "cambio_entrante"]);
    assert.equal(esSillaLibre(vacia), true);
    assert.equal(esSillaLibre({ ...vacia, estado: "cambio_entrante" }), true);
  });

  test("campos de pasajero con solo espacios siguen siendo libres (mismo criterio que PasajeroAcciones)", () => {
    assert.equal(esSillaLibre({ ...vacia, pasajero_nombres: "  ", numero_doc: "" }), true);
  });

  test("otros estados nunca son libres", () => {
    for (const estado of ["en_plazo", "confirmada", "devuelta", "no_vendida", "cambio", "retirada"]) {
      assert.equal(esSillaLibre({ ...vacia, estado }), false, estado);
    }
    assert.equal(esSillaLibre({ ...vacia, estado: null }), false, "estado nulo");
  });

  test("con contrato orgánico o manual no es libre, aunque esté disponible", () => {
    assert.equal(esSillaLibre({ ...vacia, numero_contrato: "DTM-0001" }), false);
    assert.equal(esSillaLibre({ ...vacia, contrato_manual: "00-0541" }), false);
    assert.equal(esSillaLibre({ ...vacia, contrato_manual: "   " }), false, "manual con solo espacios: conservador");
  });

  test("cualquier dato de pasajero (carga masiva o residuo) la hace no libre", () => {
    for (const campo of ["pasajero_nombres", "pasajero_apellidos", "tipo_doc", "numero_doc", "nacimiento"] as const) {
      assert.equal(esSillaLibre({ ...vacia, [campo]: campo === "nacimiento" ? "1990-01-01" : "X" }), false, campo);
    }
  });
});

describe("esSillaLibre: el resto del grupo D (misma regla que _silla_con_datos, migración 194)", () => {
  for (const campo of ["asesor", "hotel", "acomodacion", "plazo", "agencia", "inf_nombres", "inf_apellidos", "inf_tipo_doc",
                       "inf_numero", "inf_nacimiento", "responsable_menor"] as const) {
    test(`un dato residual en ${campo} → no está libre`, () => {
      assert.equal(esSillaLibre({ ...vacia, [campo]: "x" }), false);
      assert.equal(esSillaLibre({ ...vacia, [campo]: "   " }), true, "solo espacios no cuenta como dato");
    });
  }
});
