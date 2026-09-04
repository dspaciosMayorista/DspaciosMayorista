// ─────────────────────────────────────────────────────────────────────────
// Pruebas PURAS del resolver de condiciones PERMANENTES del contrato
// (lib/contrato/condicionesContrato.ts, Commit 6). Sin Supabase. `npm run
// test:unit`. Es el MISMO resolver que usan la ficha del dashboard y el PDF
// (ContratoDocumento.tsx) — estas pruebas cubren la matemática/presentación
// que ambas superficies comparten.
//
// Cubre:
//   · contrato mixto 100%+30% por componente: DOS líneas, nunca una etiqueta
//     global (caso del dueño: hotel A 100% + hotel B 30% normal);
//   · restricción en un solo componente no marca los demás;
//   · varias condiciones con fecha/plazo de saldo (derivado desde días+fecha
//     de viaje cuando no hay fecha_limite guardada);
//   · contrato histórico sin filas → hayCondiciones=false, no inventa nada;
//   · override aplicado deja de mostrar restringida la fila, pero el
//     snapshot que llega como INPUT no se muta (inmutabilidad es del
//     candado de BD; aquí se prueba que el resolver tampoco la reescribe);
//   · override más reciente gana si hay más de uno para la misma fila.
// ─────────────────────────────────────────────────────────────────────────
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import {
  resolverCondicionesContrato,
  type FilaCondicionContratoRow,
  type OverrideContratoRow,
} from "../lib/contrato/condicionesContrato.ts";

function fila(over: Partial<FilaCondicionContratoRow> = {}): FilaCondicionContratoRow {
  return {
    id: 1,
    orden: 0,
    tipo_componente: "hotel",
    referencia_externa: "Hotel A",
    valor_componente: 5_000_000,
    condicion_pago_tipo: "normal",
    condicion_pago_pct_aplicable: null,
    condicion_pago_dias_saldo: null,
    condicion_pago_fecha_limite: null,
    monto_exigido: 1_500_000,
    restriccion_comercial: "normal",
    moneda: "COP",
    trm: 1,
    ...over,
  };
}

describe("resolverCondicionesContrato — contrato PERMANENTE (Commit 6)", () => {
  test("contrato histórico sin snapshot: hayCondiciones=false, no inventa nada", () => {
    const r = resolverCondicionesContrato([], [], { monedaContrato: "COP" });
    assert.equal(r.hayCondiciones, false);
    assert.equal(r.filas.length, 0);
    assert.equal(r.restringidas.length, 0);
    assert.equal(r.resumen, null);
  });

  test("mixto 100%+30%: DOS líneas independientes, resumen agregado con desglose (nunca un global)", () => {
    const r = resolverCondicionesContrato(
      [
        fila({ id: 1, orden: 0, referencia_externa: "Hotel A", valor_componente: 6_000_000, condicion_pago_tipo: "pago_total", monto_exigido: 6_000_000 }),
        fila({ id: 2, orden: 1, referencia_externa: "Hotel B", valor_componente: 4_000_000, condicion_pago_tipo: "normal", monto_exigido: 1_200_000 }),
      ],
      [],
      { monedaContrato: "COP", precioVenta: 10_000_000 },
    );
    assert.equal(r.hayCondiciones, true);
    assert.equal(r.filas.length, 2);
    assert.equal(r.resumen?.montoMinimoExigidoTotal, 7_200_000);
    assert.equal(r.resumen?.pctEfectivoInformativo, 72);
    assert.match(r.resumen!.texto, /Pago mínimo requerido/);
    assert.match(r.resumen!.texto, /72 % informativo/);
    // Cada línea conserva SU PROPIA condición — nunca se colapsan en una sola.
    // (El % "normal" configurable de una condición neutra no se congela por
    // fila —vive en config_cobros_componente, resuelto en cotización-tiempo—
    // así que la frase queda genérica; mismo criterio ya establecido por
    // `condicionesParaUI.ts`, este resolver no inventa un dato que no tiene.)
    assert.equal(r.filas[0].condicionTexto, "Pago total al reservar");
    assert.equal(r.filas[1].condicionTexto, "Condición estándar");
  });

  test("restricción en UN componente no marca los demás como restringidos", () => {
    const r = resolverCondicionesContrato(
      [
        fila({ id: 1, referencia_externa: "Hotel A", restriccion_comercial: "no_reembolsable_no_endosable", monto_exigido: 1000 }),
        fila({ id: 2, referencia_externa: "Hotel B", restriccion_comercial: "normal", monto_exigido: 500 }),
      ],
      [],
      { monedaContrato: "COP" },
    );
    assert.equal(r.restringidas.length, 1);
    assert.equal(r.restringidas[0].referencia, "Hotel A");
    assert.equal(r.filas.find((f) => f.referencia === "Hotel B")?.esRestringidaEfectiva, false);
    assert.match(r.filas.find((f) => f.referencia === "Hotel A")!.restriccionTexto, /no es reembolsable/i);
    assert.match(r.filas.find((f) => f.referencia === "Hotel A")!.restriccionTexto, /no es endosable/i);
  });

  test("fecha límite: usa la guardada si existe; si no, la deriva de días + fecha de viaje", () => {
    const r = resolverCondicionesContrato(
      [
        fila({ id: 1, condicion_pago_tipo: "anticipo_saldo", condicion_pago_dias_saldo: 15, condicion_pago_fecha_limite: null, monto_exigido: 100 }),
        fila({ id: 2, condicion_pago_tipo: "anticipo_saldo", condicion_pago_dias_saldo: 10, condicion_pago_fecha_limite: "2026-11-01", monto_exigido: 100 }),
      ],
      [],
      { monedaContrato: "COP", fechaViaje: "2026-12-01" },
    );
    assert.equal(r.filas[0].fechaLimite, "2026-11-16"); // 2026-12-01 - 15 días
    assert.equal(r.filas[1].fechaLimite, "2026-11-01"); // la guardada manda, no se recalcula
  });

  test("sin fechaViaje en el contexto: no deriva fecha límite (queda null, no inventa)", () => {
    const r = resolverCondicionesContrato(
      [fila({ condicion_pago_tipo: "anticipo_saldo", condicion_pago_dias_saldo: 15, monto_exigido: 100 })],
      [],
      { monedaContrato: "COP" },
    );
    assert.equal(r.filas[0].fechaLimite, null);
  });

  test("override vigente: la fila deja de mostrarse restringida, el INPUT original no se muta", () => {
    const filas: FilaCondicionContratoRow[] = [
      fila({ id: 7, restriccion_comercial: "no_reembolsable_no_endosable", monto_exigido: 100 }),
    ];
    const filasCopia = JSON.parse(JSON.stringify(filas));
    const overrides: OverrideContratoRow[] = [
      { contrato_condicion_id: 7, restriccion_afectada: "no_reembolsable_no_endosable", motivo: "excepción autorizada", usuario_email: "super@x.com", creado_en: "2026-01-01T00:00:00Z" },
    ];
    const r = resolverCondicionesContrato(filas, overrides, { monedaContrato: "COP" });
    assert.equal(r.filas[0].esRestringidaOriginal, true, "la condición ORIGINAL sigue marcada como restringida");
    assert.equal(r.filas[0].esRestringidaEfectiva, false, "la PRESENTACIÓN ya no la trata como restringida");
    assert.equal(r.restringidas.length, 0);
    assert.equal(r.huboRestriccionOriginal, true, "el aviso de 'hubo restricción, ya excepcionada' debe poder distinguirse");
    assert.equal(r.filas[0].override?.motivo, "excepción autorizada");
    // El INPUT (lo que representaría contrato_condiciones) no se tocó.
    assert.deepEqual(filas, filasCopia);
  });

  test("dos overrides para la misma fila: gana el MÁS RECIENTE por fecha", () => {
    const filas: FilaCondicionContratoRow[] = [
      fila({ id: 9, restriccion_comercial: "promocional_no_reembolsable_no_endosable", monto_exigido: 100 }),
    ];
    const overrides: OverrideContratoRow[] = [
      { contrato_condicion_id: 9, restriccion_afectada: "promocional_no_reembolsable_no_endosable", motivo: "primero", usuario_email: "a@x.com", creado_en: "2026-01-01T00:00:00Z" },
      { contrato_condicion_id: 9, restriccion_afectada: "promocional_no_reembolsable_no_endosable", motivo: "segundo (más reciente)", usuario_email: "b@x.com", creado_en: "2026-02-01T00:00:00Z" },
    ];
    const r = resolverCondicionesContrato(filas, overrides, { monedaContrato: "COP" });
    assert.equal(r.filas[0].override?.motivo, "segundo (más reciente)");
  });

  test("moneda por fila prevalece; fallback a la del contrato si la fila no la trae", () => {
    const r = resolverCondicionesContrato(
      [fila({ moneda: null, monto_exigido: 100 })],
      [],
      { monedaContrato: "USD" },
    );
    assert.equal(r.filas[0].moneda, "USD");
    assert.equal(r.moneda, "USD");
  });

  test("filas con monto_exigido=0 no aportan (mismo criterio que condicionesParaUI)", () => {
    const r = resolverCondicionesContrato(
      [fila({ monto_exigido: 0 })],
      [],
      { monedaContrato: "COP" },
    );
    assert.equal(r.filas.length, 0);
    assert.equal(r.resumen, null);
  });

  test("valores/tipos desconocidos caen a un default seguro (defensa, mismo criterio que condicionesParaUI)", () => {
    const r = resolverCondicionesContrato(
      [fila({ tipo_componente: "no-existe", condicion_pago_tipo: "no-existe", restriccion_comercial: "no-existe", monto_exigido: 100 })],
      [],
      { monedaContrato: "COP" },
    );
    assert.equal(r.filas[0].tipoComponente, "servicio");
    assert.equal(r.filas[0].restriccion, "normal");
    assert.equal(r.filas[0].esRestringidaOriginal, false);
  });
});

// ── Decisión del dueño: toda restricción es SIEMPRE no reembolsable Y no
//    endosable a la vez (nunca una sola). `promocional_*` solo identifica el
//    ORIGEN — el efecto y las etiquetas son idénticas a `no_reembolsable_no_endosable`. ──
describe("resolverCondicionesContrato — restriccionEtiquetas (mismo resolver que la ficha y el PDF)", () => {
  test("normal → sin etiquetas", () => {
    const r = resolverCondicionesContrato([fila({ restriccion_comercial: "normal", monto_exigido: 100 })], [], { monedaContrato: "COP" });
    assert.deepEqual(r.filas[0].restriccionEtiquetas, []);
  });

  test("promoción restringida → ambas etiquetas, valor exacto preservado (snapshot congelado)", () => {
    const r = resolverCondicionesContrato(
      [fila({ restriccion_comercial: "promocional_no_reembolsable_no_endosable", monto_exigido: 100 })],
      [], { monedaContrato: "COP" },
    );
    assert.equal(r.filas[0].restriccion, "promocional_no_reembolsable_no_endosable");
    assert.deepEqual(r.filas[0].restriccionEtiquetas.slice().sort(), ["No endosable", "No reembolsable"]);
  });

  test("tarifa normal restringida → ambas etiquetas, mismo efecto que la promocional", () => {
    const r = resolverCondicionesContrato(
      [fila({ restriccion_comercial: "no_reembolsable_no_endosable", monto_exigido: 100 })],
      [], { monedaContrato: "COP" },
    );
    assert.equal(r.filas[0].restriccion, "no_reembolsable_no_endosable");
    assert.deepEqual(r.filas[0].restriccionEtiquetas.slice().sort(), ["No endosable", "No reembolsable"]);
  });

  test("contrato mixto: solo los componentes restringidos llevan ambas etiquetas, el resto ninguna", () => {
    const r = resolverCondicionesContrato(
      [
        fila({ id: 1, orden: 0, tipo_componente: "hotel", restriccion_comercial: "no_reembolsable_no_endosable", monto_exigido: 5_000_000 }),
        fila({ id: 2, orden: 1, tipo_componente: "hotel", referencia_externa: "Hotel B", restriccion_comercial: "normal", monto_exigido: 1_500_000 }),
        fila({ id: 3, orden: 2, tipo_componente: "servicio", restriccion_comercial: "promocional_no_reembolsable_no_endosable", monto_exigido: 300_000 }),
      ],
      [], { monedaContrato: "COP" },
    );
    assert.equal(r.filas.length, 3);
    assert.equal(r.filas[0].restriccionEtiquetas.length, 2);
    assert.deepEqual(r.filas[1].restriccionEtiquetas, []);
    assert.equal(r.filas[2].restriccionEtiquetas.length, 2);
    // El alcance es por componente, nunca una etiqueta global del contrato.
    assert.equal(r.restringidas.length, 2);
  });
});
