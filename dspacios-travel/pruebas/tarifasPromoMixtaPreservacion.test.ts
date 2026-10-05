import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import {
  analizarMixta, generarTarifas, filaSustitucionMixta, aplicarAdultsOnly, valoresDeFila, renombrarTemporadaEnParams,
  type MixtaParams, type MixtaBase, type TarifaExistente,
} from "../lib/calc/calculadoras.ts";
import {
  resolverBasePromo, separarFilasVencidas, nombreVigenciaVencida, etiquetaFilaTarifa,
} from "../lib/calc/promoCalculadora.ts";
import {
  valoresPorRegimenIniciales, basesPorRegimen, basesDesdeValores, quitarValoresCelda, claveMixta,
} from "../lib/calc/mixtaValores.ts";
import { resumenVigenciaHistorica, diaBogota } from "../lib/calc/historialTarifas.ts";
import { liquidarHotelNochesConTemporadas, type TemporadaRango } from "../lib/calc/paquetes.ts";

// ─────────────────────────────────────────────────────────────────────────
// Pendientes #15 y #26 (TASKS.md): promoción −6 % en la calculadora Mixta,
// preservación de valores por régimen y de otras vigencias al generar, y
// etiqueta PROMO. La parte SQL (borrado acotado, historial, permisos) se prueba
// contra Postgres local en supabase/scripts/pruebas/test_203_*.sh.
// ─────────────────────────────────────────────────────────────────────────

const HOY = "2026-10-02";

function vig(v: Partial<TemporadaRango> & { nombre: string }): TemporadaRango {
  return { fecha_inicio: null, fecha_fin: null, prioridad: 1, tipo: "tarifa", compra_inicio: null, compra_fin: null, regimen_restringido: null, ...v };
}

// Caso real del pendiente #15: BAJA 2026, FULL, SUNSALE1 −6 % solo FULL.
const VIGENCIAS: TemporadaRango[] = [
  vig({ nombre: "BAJA 2026", fecha_inicio: "2026-10-01", fecha_fin: "2026-12-14", prioridad: 1 }),
  vig({ nombre: "SUNSALE1", fecha_inicio: "2026-10-05", fecha_fin: "2026-11-30", prioridad: 5, tipo: "descuento_pct", descuento_valor: 6, regimen_restringido: "FULL", compra_fin: "2026-10-31" }),
];

function base(categoria: string, temporada: string, v: Partial<MixtaBase> = {}): MixtaBase {
  return { categoria, temporada, sencilla: 0, doble: 0, triple: 0, multiple: 0, nino: 0, nino2: null, infante: null, ...v };
}

function paramsFull(extra: MixtaBase[] = []): MixtaParams {
  return {
    regimen: "FULL",
    iva_pct: 19,
    acom: { sencilla: { modo: "pax", iva: false }, doble: { modo: "pax", iva: false }, triple: { modo: "pax", iva: false }, multiple: { modo: "pax", iva: false } },
    nino: { iva: false },
    pax: { sencilla: 1, doble: 2, triple: 3, multiple: 4 },
    bases: [
      base("Estandar", "BAJA 2026", { sencilla: 514000, doble: 454000, triple: 454000, multiple: 454000, nino: 227000, nino2: 227000 }),
      base("Estandar", "SUNSALE1"),
      ...extra,
    ],
  };
}

describe("#15 — promoción −6 % materializada como precio final", () => {
  const { filas, promos } = analizarMixta(paramsFull(), { vigencias: VIGENCIAS, hoy: HOY });
  const fila = (t: string) => filas.find((f) => f.temporada === t && f.tipo_habitacion === "Estandar");

  test("la vista previa muestra el precio ya descontado (valores del caso real)", () => {
    const p = fila("SUNSALE1");
    assert.ok(p);
    assert.equal(p.neto_sencilla, 483160);
    assert.equal(p.neto_doble, 426760);
    assert.equal(p.neto_triple, 426760);
    assert.equal(p.neto_multiple, 426760);
    assert.equal(p.neto_nino, 213380);
    assert.equal(p.neto_nino2, 213380);
    assert.equal(p.alimentacion, "FULL");
  });

  test("queda marcada PROMO: precio_final_autoritativo + temporada_base de su base", () => {
    const p = fila("SUNSALE1")!;
    assert.equal(p.precio_final_autoritativo, true);
    assert.equal(p.temporada_base, "BAJA 2026");
    assert.deepEqual(etiquetaFilaTarifa(p, VIGENCIAS).etiqueta, "PROMO");
    const aviso = promos.find((a) => a.temporada === "SUNSALE1");
    assert.equal(aviso?.estado, "derivada");
    assert.equal(aviso?.pct, 6);
  });

  test("BAJA 2026 queda intacta y como BASE", () => {
    const b = fila("BAJA 2026")!;
    assert.equal(b.neto_sencilla, 514000);
    assert.equal(b.neto_doble, 454000);
    assert.equal(b.neto_nino, 227000);
    assert.equal(b.precio_final_autoritativo, undefined);
    assert.equal(etiquetaFilaTarifa(b, VIGENCIAS).etiqueta, "BASE");
  });

  test("el motor de cotización cobra la fila PROMO una sola vez (no vuelve a aplicar el 6 %)", () => {
    const r = liquidarHotelNochesConTemporadas({
      fechaIda: "2026-10-10", numNoches: 2, temporadas: VIGENCIAS, hoy: HOY, regimen: "FULL",
      netoPorTemporada: { "BAJA 2026": 454000, SUNSALE1: 426760 },
      precioFinalTemporadas: new Set(["SUNSALE1"]),
    });
    assert.ok(r);
    assert.equal(r.total, 426760 * 2); // nunca 426760 × 0,94
  });

  test("la generación del servidor usa el mismo cálculo (dispatcher con contexto)", () => {
    const servidor = generarTarifas("mixta", paramsFull(), { vigencias: VIGENCIAS, hoy: HOY });
    assert.deepEqual(servidor, filas);
  });

  test("sin contexto de vigencias, Mixta se comporta como antes (compatibilidad)", () => {
    const legado = analizarMixta(paramsFull());
    assert.equal(legado.filas.some((f) => f.precio_final_autoritativo), false);
    assert.equal(legado.promos.length, 0);
  });

  test("una promo restringida a FULL no genera nada al generar otro régimen", () => {
    const pc = { ...paramsFull(), regimen: "PC" };
    const r = analizarMixta(pc, { vigencias: VIGENCIAS, hoy: HOY });
    assert.equal(r.filas.some((f) => f.temporada === "SUNSALE1"), false);
    assert.equal(r.promos.find((a) => a.temporada === "SUNSALE1")?.estado, "no_aplica_regimen");
  });

  test("redondeo: un solo Math.round por valor sobre el valor por persona de la base", () => {
    const p = paramsFull();
    p.bases[0] = base("Estandar", "BAJA 2026", { sencilla: 333333, doble: 0, triple: 0, multiple: 0 });
    const r = analizarMixta(p, { vigencias: VIGENCIAS, hoy: HOY });
    assert.equal(r.filas.find((f) => f.temporada === "SUNSALE1")!.neto_sencilla, Math.round(333333 * 0.94));
  });
});

// Decisión del dueño (#15): el % se aplica a adultos, Niño 1 y Niño 2; infante
// NO se descuenta — fijo se conserva, 0 sigue en 0, vacío sigue vacío.
describe("#15 — infante no se descuenta en la promoción %", () => {
  const conInfante = (infante: number | null, extra: Partial<MixtaParams> = {}): MixtaParams => {
    const p = { ...paramsFull(), ...extra };
    p.bases = [base("Estandar", "BAJA 2026", { sencilla: 514000, doble: 454000, triple: 454000, multiple: 454000, nino: 227000, nino2: 150000, infante }), base("Estandar", "SUNSALE1")];
    return p;
  };
  const promo = (p: MixtaParams) => analizarMixta(p, { vigencias: VIGENCIAS, hoy: HOY }).filas.find((f) => f.temporada === "SUNSALE1" && f.tipo_habitacion === "Estandar")!;
  const baseFila = (p: MixtaParams) => analizarMixta(p, { vigencias: VIGENCIAS, hoy: HOY }).filas.find((f) => f.temporada === "BAJA 2026" && f.tipo_habitacion === "Estandar")!;

  test("infante con valor fijo: la promo conserva EXACTAMENTE el valor de la base", () => {
    const f = promo(conInfante(50000));
    assert.equal(f.neto_infante, 50000);
    assert.equal(f.neto_nino, 213380);                     // Niño 1 −6 %
    assert.equal(f.neto_nino2, Math.round(150000 * 0.94)); // Niño 2 −6 % (141.000)
    assert.equal(f.neto_doble, 426760);                    // adulto −6 %
  });

  test("infante gratis (0) sigue en 0", () => {
    assert.equal(promo(conInfante(0)).neto_infante, 0);
  });

  test("infante sin valor sigue vacío (no se inventa)", () => {
    assert.equal(promo(conInfante(null)).neto_infante, null);
  });

  test("con IVA de niños, el infante de la promo es el MISMO de la fila base (sin descuento)", () => {
    const p = conInfante(50000, { nino: { iva: true } });
    assert.equal(baseFila(p).neto_infante, Math.round(50000 * 1.19));
    assert.equal(promo(p).neto_infante, baseFila(p).neto_infante);
  });

  test("generación del servidor = vista previa también para infante", () => {
    const p = conInfante(50000);
    const servidor = generarTarifas("mixta", p, { vigencias: VIGENCIAS, hoy: HOY });
    assert.equal(servidor.find((f) => f.temporada === "SUNSALE1")!.neto_infante, 50000);
  });

  test("Sustituir aplica la misma regla: infante de la base intacto, Niño 2 descontado", () => {
    const p = conInfante(50000);
    const existentes: TarifaExistente[] = [{ tipo_habitacion: "Estandar", alimentacion: "FULL", temporada: "SUNSALE1", precio_final_autoritativo: false,
      neto_sencilla: 514000, neto_doble: 454000, neto_triple: 454000, neto_multiple: 454000, neto_nino: 227000, neto_nino2: 150000, neto_infante: 50000 }];
    const ctx = { vigencias: VIGENCIAS, hoy: HOY, tarifasExistentes: existentes };
    // Bloqueada por ser manual; la propuesta ya trae la regla.
    const bloqueo = analizarMixta(p, ctx).promos.find((a) => a.temporada === "SUNSALE1")!.bloqueadas![0];
    assert.equal(bloqueo.propuesta.neto_infante, 50000);
    const r = filaSustitucionMixta(p, ctx, { temporada: "SUNSALE1", regimen: "FULL", categoria: "Estandar" });
    assert.ok(r.ok);
    assert.equal(r.fila.neto_infante, 50000);
    assert.equal(r.fila.neto_nino2, 141000);
  });

  test("Adults Only: al guardar se descartan niño e infante igual que antes", () => {
    const [f] = aplicarAdultsOnly([promo(conInfante(50000))], true);
    assert.equal(f.neto_infante, null);
    assert.equal(f.neto_nino2, null);
  });
});

describe("#15 — relación promo ↔ base con solapamientos (falla cerrado)", () => {
  test("cruza dos bases → no se elige ninguna", () => {
    const v = [
      vig({ nombre: "BAJA", fecha_inicio: "2026-10-01", fecha_fin: "2026-10-31" }),
      vig({ nombre: "ALTA", fecha_inicio: "2026-11-01", fecha_fin: "2026-12-31" }),
      vig({ nombre: "PROMO", fecha_inicio: "2026-10-20", fecha_fin: "2026-11-10", prioridad: 5, tipo: "descuento_pct", descuento_valor: 10 }),
    ];
    const r = resolverBasePromo("PROMO", v, "FULL");
    assert.equal(r.ok, false);
    assert.equal(!r.ok && r.motivo, "varias_bases");
  });

  test("dos bases empatadas en prioridad la misma noche → no se elige ninguna", () => {
    const v = [
      vig({ nombre: "BAJA A", fecha_inicio: "2026-10-01", fecha_fin: "2026-10-31" }),
      vig({ nombre: "BAJA B", fecha_inicio: "2026-10-01", fecha_fin: "2026-10-31" }),
      vig({ nombre: "PROMO", fecha_inicio: "2026-10-10", fecha_fin: "2026-10-12", prioridad: 5, tipo: "descuento_pct", descuento_valor: 10 }),
    ];
    const r = resolverBasePromo("PROMO", v, "FULL");
    assert.equal(!r.ok && r.motivo, "base_empatada");
  });

  test("la promo sin mayor prioridad que su base no se deriva", () => {
    const v = [
      vig({ nombre: "BAJA", fecha_inicio: "2026-10-01", fecha_fin: "2026-10-31", prioridad: 3 }),
      vig({ nombre: "PROMO", fecha_inicio: "2026-10-10", fecha_fin: "2026-10-12", prioridad: 3, tipo: "descuento_pct", descuento_valor: 10 }),
    ];
    assert.equal((resolverBasePromo("PROMO", v, "FULL") as { motivo?: string }).motivo, "prioridad_insuficiente");
  });

  test("noches sin base → no se deriva", () => {
    const v = [
      vig({ nombre: "BAJA", fecha_inicio: "2026-10-01", fecha_fin: "2026-10-05" }),
      vig({ nombre: "PROMO", fecha_inicio: "2026-10-04", fecha_fin: "2026-10-08", prioridad: 5, tipo: "descuento_pct", descuento_valor: 10 }),
    ];
    assert.equal((resolverBasePromo("PROMO", v, "FULL") as { motivo?: string }).motivo, "sin_base");
  });

  test("una base restringida a otro régimen no cuenta", () => {
    const v = [
      vig({ nombre: "BAJA PC", fecha_inicio: "2026-10-01", fecha_fin: "2026-10-31", regimen_restringido: "PC" }),
      vig({ nombre: "BAJA", fecha_inicio: "2026-10-01", fecha_fin: "2026-10-31" }),
      vig({ nombre: "PROMO", fecha_inicio: "2026-10-10", fecha_fin: "2026-10-12", prioridad: 5, tipo: "descuento_pct", descuento_valor: 10 }),
    ];
    const r = resolverBasePromo("PROMO", v, "FULL");
    assert.deepEqual(r, { ok: true, base: "BAJA", pct: 10 });
  });

  test("blackout de la promo: las noches excluidas no fuerzan otra base", () => {
    const v = [
      vig({ nombre: "BAJA", fecha_inicio: "2026-10-01", fecha_fin: "2026-10-31" }),
      vig({ nombre: "ALTA", fecha_inicio: "2026-11-01", fecha_fin: "2026-11-30" }),
      vig({ nombre: "PROMO", fecha_inicio: "2026-10-20", fecha_fin: "2026-11-05", prioridad: 5, tipo: "descuento_pct", descuento_valor: 10,
        blackouts: [{ fecha_inicio: "2026-11-01", fecha_fin: "2026-11-05" }] }),
    ];
    assert.deepEqual(resolverBasePromo("PROMO", v, "FULL"), { ok: true, base: "BAJA", pct: 10 });
  });

  test("promo sobre promo: cada una se calcula desde la BASE, nunca desde el precio final de la otra", () => {
    const v = [
      ...VIGENCIAS,
      vig({ nombre: "FLASH", fecha_inicio: "2026-10-10", fecha_fin: "2026-10-12", prioridad: 9, tipo: "descuento_pct", descuento_valor: 10 }),
    ];
    const r = analizarMixta(paramsFull([base("Estandar", "FLASH")]), { vigencias: v, hoy: HOY });
    const flash = r.filas.find((f) => f.temporada === "FLASH")!;
    assert.equal(flash.temporada_base, "BAJA 2026");
    assert.equal(flash.neto_doble, Math.round(454000 * 0.9));
    assert.notEqual(flash.neto_doble, Math.round(426760 * 0.9));
    assert.equal(r.filas.find((f) => f.temporada === "SUNSALE1")!.neto_doble, 426760);
  });

  test("ambigua en Mixta: no genera fila ni toma una base arbitraria", () => {
    const v = [
      vig({ nombre: "BAJA 2026", fecha_inicio: "2026-10-01", fecha_fin: "2026-10-31" }),
      vig({ nombre: "ALTA 2026", fecha_inicio: "2026-11-01", fecha_fin: "2026-12-31" }),
      vig({ nombre: "SUNSALE1", fecha_inicio: "2026-10-20", fecha_fin: "2026-11-10", prioridad: 5, tipo: "descuento_pct", descuento_valor: 6 }),
    ];
    const r = analizarMixta(paramsFull([base("Estandar", "ALTA 2026", { doble: 600000, sencilla: 700000 })]), { vigencias: v, hoy: HOY });
    assert.equal(r.filas.some((f) => f.temporada === "SUNSALE1"), false);
    assert.equal(r.promos.find((a) => a.temporada === "SUNSALE1")?.estado, "varias_bases");
  });

  test("valores tecleados a mano en la promo: esa categoría no se escribe y queda con su propuesta", () => {
    const p = paramsFull();
    p.bases[1] = base("Estandar", "SUNSALE1", { sencilla: 514000, doble: 454000 });
    const r = analizarMixta(p, { vigencias: VIGENCIAS, hoy: HOY });
    assert.equal(r.filas.some((f) => f.temporada === "SUNSALE1"), false);
    const aviso = r.promos.find((a) => a.temporada === "SUNSALE1")!;
    assert.equal(aviso.estado, "valores_manuales");
    assert.deepEqual(aviso.bloqueadas?.map((b) => [b.categoria, b.origen]), [["Estandar", ["calculadora"]]]);
    assert.equal(aviso.bloqueadas?.[0].propuesta.neto_doble, 426760);
  });
});

describe("#26 — vigencias vencidas: se conservan, no se regeneran", () => {
  const v = [
    vig({ nombre: "BAJA 2027", fecha_inicio: "2027-01-01", fecha_fin: "2027-03-31" }),
    vig({ nombre: "TARIFA PROMOCIONAL BAJA (NO APLICA FESTIVOS)", fecha_inicio: "2026-09-01", fecha_fin: "2026-11-30", prioridad: 5, tipo: "descuento_pct", descuento_valor: 10, compra_fin: "2026-09-30" }),
  ];

  test("compra cerrada = vencida aunque el viaje siga vigente", () => {
    assert.equal(nombreVigenciaVencida("TARIFA PROMOCIONAL BAJA (NO APLICA FESTIVOS)", v, HOY), true);
    assert.equal(nombreVigenciaVencida("BAJA 2027", v, HOY), false);
    assert.equal(nombreVigenciaVencida("NO EXISTE", v, HOY), false);
  });

  test("varias filas con el mismo nombre: vencida solo si TODAS cerraron la compra", () => {
    const dup = [...v, vig({ nombre: "BAJA 2027", compra_fin: "2026-01-01" })];
    assert.equal(nombreVigenciaVencida("BAJA 2027", dup, HOY), false);
  });

  test("separarFilasVencidas aparta las filas de la vigencia vencida", () => {
    const filas = [{ temporada: "BAJA 2027" }, { temporada: "TARIFA PROMOCIONAL BAJA (NO APLICA FESTIVOS)" }];
    const r = separarFilasVencidas(filas, v, HOY);
    assert.deepEqual(r.generables, [{ temporada: "BAJA 2027" }]);
    assert.deepEqual(r.vencidas, ["TARIFA PROMOCIONAL BAJA (NO APLICA FESTIVOS)"]);
  });
});

describe("#26 — la calculadora Mixta conserva los valores de cada régimen", () => {
  const categorias = ["Estandar"];
  const temporadas = ["BAJA 2026"];

  test("alternar de régimen, guardar y recargar conserva PC y PAM", () => {
    // Estado del editor tras cargar PC, cambiar a PAM y cargar PAM.
    const estado = {
      PC: { [claveMixta("Estandar", "BAJA 2026", "doble")]: "300000", [claveMixta("Estandar", "BAJA 2026", "nino")]: "150000" },
      PAM: { [claveMixta("Estandar", "BAJA 2026", "doble")]: "350000", [claveMixta("Estandar", "BAJA 2026", "infante")]: "0" },
    };
    const guardado: MixtaParams = {
      ...paramsFull(), regimen: "PAM",
      bases: basesDesdeValores(estado.PAM, categorias, temporadas),
      bases_por_regimen: basesPorRegimen(estado),
    };
    const recargado = valoresPorRegimenIniciales(JSON.parse(JSON.stringify(guardado)));
    assert.equal(recargado.PC[claveMixta("Estandar", "BAJA 2026", "doble")], "300000");
    assert.equal(recargado.PC[claveMixta("Estandar", "BAJA 2026", "nino")], "150000");
    assert.equal(recargado.PAM[claveMixta("Estandar", "BAJA 2026", "doble")], "350000");
    assert.equal(recargado.PAM[claveMixta("Estandar", "BAJA 2026", "infante")], "0", "infante gratis (0) explícito se conserva");
  });

  test("configuración guardada antes del cambio (solo `bases`) sigue cargando su régimen", () => {
    const legado: MixtaParams = { ...paramsFull(), regimen: "PC", bases: [base("Estandar", "BAJA 2026", { doble: 250000 })] };
    delete legado.bases_por_regimen;
    const r = valoresPorRegimenIniciales(legado);
    assert.deepEqual(Object.keys(r), ["PC"]);
    assert.equal(r.PC[claveMixta("Estandar", "BAJA 2026", "doble")], "250000");
  });

  test("limpiar la celda de una promo no toca otras categorías ni temporadas", () => {
    const vals = {
      [claveMixta("Estandar", "SUNSALE1", "doble")]: "454000",
      [claveMixta("Estandar", "SUNSALE1", "nino")]: "227000",
      [claveMixta("Superior", "SUNSALE1", "doble")]: "500000",
      [claveMixta("Estandar", "BAJA 2026", "doble")]: "454000",
    };
    assert.deepEqual(quitarValoresCelda(vals, "Estandar", "SUNSALE1"), {
      [claveMixta("Superior", "SUNSALE1", "doble")]: "500000",
      [claveMixta("Estandar", "BAJA 2026", "doble")]: "454000",
    });
  });

  test("renombrar una temporada también renombra los valores guardados de cada régimen", () => {
    const params: Record<string, unknown> = {
      regimen: "PAM",
      bases: [base("Estandar", "BAJA 2027", { doble: 1 })],
      bases_por_regimen: { PC: [base("Estandar", "BAJA 2027", { doble: 2 })], PAM: [base("Estandar", "BAJA 2027", { doble: 1 })] },
    };
    assert.equal(renombrarTemporadaEnParams("mixta", params, "BAJA 2027", "BAJA 2027 B"), true);
    const porRegimen = params.bases_por_regimen as Record<string, MixtaBase[]>;
    assert.equal(porRegimen.PC[0].temporada, "BAJA 2027 B");
    assert.equal(porRegimen.PAM[0].temporada, "BAJA 2027 B");
    assert.equal((params.bases as MixtaBase[])[0].temporada, "BAJA 2027 B");
  });
});

describe("#26 — etiqueta: una promoción nunca se muestra como BASE", () => {
  test("fila manual de una vigencia promocional → PROMO", () => {
    assert.equal(etiquetaFilaTarifa({ temporada: "SUNSALE1" }, [{ nombre: "SUNSALE1", tipo: "descuento_pct" }]).etiqueta, "PROMO");
  });
  test("fila de temporada base → BASE", () => {
    assert.equal(etiquetaFilaTarifa({ temporada: "BAJA 2026" }, [{ nombre: "BAJA 2026", tipo: "tarifa" }]).etiqueta, "BASE");
  });
});

// ── #15 — SUNSALE escrita a mano: caso exacto de la captura ───────────────
// En `tarifa_hotel` existe SUNSALE1 · Estandar · FULL guardada a mano con los
// MISMOS valores de la base (514.000 / 454.000 / 227.000, etiquetada BASE) y la
// calculadora todavía conserva esos valores tecleados en la fila de la promo.
const CAPTURA_EXISTENTES: TarifaExistente[] = [
  { tipo_habitacion: "Estandar", alimentacion: "FULL", temporada: "BAJA 2026", precio_final_autoritativo: false,
    neto_sencilla: 514000, neto_doble: 454000, neto_triple: 454000, neto_multiple: 454000, neto_nino: 227000, neto_nino2: 227000, neto_infante: null },
  { tipo_habitacion: "Estandar", alimentacion: "FULL", temporada: "SUNSALE1", precio_final_autoritativo: false,
    neto_sencilla: 514000, neto_doble: 454000, neto_triple: 454000, neto_multiple: 454000, neto_nino: 227000, neto_nino2: 227000, neto_infante: null },
  { tipo_habitacion: "Estandar", alimentacion: "PC", temporada: "BAJA 2026", precio_final_autoritativo: false,
    neto_sencilla: 300000, neto_doble: 250000, neto_triple: 250000, neto_multiple: 250000, neto_nino: 120000, neto_nino2: null, neto_infante: null },
];

function paramsCaptura(): MixtaParams {
  const p = paramsFull([
    base("Superior", "BAJA 2026", { sencilla: 600000, doble: 500000, triple: 500000, multiple: 500000, nino: 250000 }),
    base("Superior", "SUNSALE1"),
  ]);
  // Valores tecleados en la fila de la promo (los mismos de la base).
  p.bases[1] = base("Estandar", "SUNSALE1", { sencilla: 514000, doble: 454000, triple: 454000, multiple: 454000, nino: 227000, nino2: 227000 });
  return p;
}
const CTX_CAPTURA = { vigencias: VIGENCIAS, hoy: HOY, tarifasExistentes: CAPTURA_EXISTENTES };

describe("#15 — SUNSALE con valores ya escritos (captura): no se borran solos", () => {
  test("generar NO escribe SUNSALE1 · Estandar (escrita a mano) y sí deriva Superior", () => {
    const filas = generarTarifas("mixta", paramsCaptura(), CTX_CAPTURA);
    assert.equal(filas.some((f) => f.temporada === "SUNSALE1" && f.tipo_habitacion === "Estandar"), false);
    const sup = filas.find((f) => f.temporada === "SUNSALE1" && f.tipo_habitacion === "Superior")!;
    assert.equal(sup.neto_doble, 470000);
    assert.equal(sup.precio_final_autoritativo, true);
  });

  test("bloquea también si SOLO la fila guardada es manual (la calculadora ya está limpia)", () => {
    const p = paramsCaptura();
    p.bases[1] = base("Estandar", "SUNSALE1");
    const aviso = analizarMixta(p, CTX_CAPTURA).promos.find((a) => a.temporada === "SUNSALE1")!;
    assert.deepEqual(aviso.bloqueadas?.map((b) => [b.categoria, b.origen]), [["Estandar", ["tarifa_guardada"]]]);
    assert.equal(aviso.bloqueadas?.[0].actual.neto_doble, 454000);
  });

  test("una fila de promo ya calculada (precio final) no bloquea: se recalcula normal", () => {
    const existentes = CAPTURA_EXISTENTES.map((t) => t.temporada === "SUNSALE1" ? { ...t, precio_final_autoritativo: true, neto_doble: 426760 } : t);
    const p = paramsCaptura();
    p.bases[1] = base("Estandar", "SUNSALE1");
    const r = analizarMixta(p, { ...CTX_CAPTURA, tarifasExistentes: existentes });
    assert.equal(r.filas.find((f) => f.temporada === "SUNSALE1" && f.tipo_habitacion === "Estandar")?.neto_doble, 426760);
  });

  test("Sustituir: la vista previa y lo que escribe el servidor coinciden, con los valores de la captura", () => {
    const objetivo = { temporada: "SUNSALE1", regimen: "FULL", categoria: "Estandar" };
    // Cliente: limpia la celda y calcula la vista previa.
    const p = paramsCaptura();
    p.bases[1] = base("Estandar", "SUNSALE1");
    const vista = filaSustitucionMixta(p, CTX_CAPTURA, objetivo);
    assert.ok(vista.ok);
    // Servidor: recalcula con lo guardado.
    const servidor = filaSustitucionMixta(JSON.parse(JSON.stringify(p)), CTX_CAPTURA, objetivo);
    assert.ok(servidor.ok);
    assert.deepEqual(valoresDeFila(aplicarAdultsOnly([servidor.fila], false)[0]), valoresDeFila(aplicarAdultsOnly([vista.fila], false)[0]));
    assert.deepEqual(valoresDeFila(vista.fila), {
      neto_sencilla: 483160, neto_doble: 426760, neto_triple: 426760, neto_multiple: 426760,
      neto_nino: 213380, neto_nino2: 213380, neto_infante: null,
    });
    assert.equal(vista.fila.temporada_base, "BAJA 2026");
    assert.equal(vista.fila.precio_final_autoritativo, true);
  });

  test("Sustituir aprueba SOLO esa clave: Superior y el régimen PC no cambian", () => {
    const p = paramsCaptura();
    p.bases[1] = base("Estandar", "SUNSALE1");
    const sinAprobar = analizarMixta(p, CTX_CAPTURA).filas;
    const aprobado = analizarMixta(p, { ...CTX_CAPTURA, sustituir: new Set(["Estandar|FULL|SUNSALE1"]) }).filas;
    const resto = (fs: typeof aprobado) => fs.filter((f) => !(f.temporada === "SUNSALE1" && f.tipo_habitacion === "Estandar"));
    assert.deepEqual(resto(aprobado), resto(sinAprobar));
    assert.equal(aprobado.every((f) => f.alimentacion === "FULL"), true);
  });

  test("Sustituir en otro régimen distinto al guardado se rechaza", () => {
    const r = filaSustitucionMixta(paramsCaptura(), CTX_CAPTURA, { temporada: "SUNSALE1", regimen: "PC", categoria: "Estandar" });
    assert.equal(r.ok, false);
  });

  test("las promos que cruzan varias bases siguen bloqueadas también para Sustituir", () => {
    const v = [
      vig({ nombre: "BAJA 2026", fecha_inicio: "2026-10-01", fecha_fin: "2026-10-31" }),
      vig({ nombre: "ALTA 2026", fecha_inicio: "2026-11-01", fecha_fin: "2026-12-31" }),
      vig({ nombre: "SUNSALE1", fecha_inicio: "2026-10-20", fecha_fin: "2026-11-10", prioridad: 5, tipo: "descuento_pct", descuento_valor: 6 }),
    ];
    const r = filaSustitucionMixta(paramsFull(), { vigencias: v, hoy: HOY }, { temporada: "SUNSALE1", regimen: "FULL", categoria: "Estandar" });
    assert.equal(r.ok, false);
    assert.match(!r.ok ? r.error : "", /varias temporadas base/);
  });
});

// ── #26 — historial con la vigencia de ESE momento ────────────────────────
describe("#26 — el historial muestra la vigencia del momento del cambio", () => {
  const foto = [{ nombre: "SUNSALE1", tipo: "descuento_pct", descuento_valor: 6, prioridad: 5, regimen_restringido: "FULL",
    fecha_inicio: "2026-10-05", fecha_fin: "2026-11-30", compra_inicio: null, compra_fin: "2026-10-31" }];

  test("estado a la fecha del cambio en Bogotá, no a hoy", () => {
    const vigente = resumenVigenciaHistorica(foto, "actual", "2026-10-15T15:00:00Z");
    assert.equal(vigente.estado, "vigente");
    assert.deepEqual(vigente.viaje, ["2026-10-05 → 2026-11-30"]);
    assert.deepEqual(vigente.compra, ["… → 2026-10-31"]);
    assert.equal(vigente.descuento, "−6%");
    assert.equal(vigente.regimen, "FULL");
    assert.equal(resumenVigenciaHistorica(foto, "actual", "2026-11-05T15:00:00Z").estado, "compra_cerrada");
    // 2026-11-01 00:30 UTC todavía es 31 de octubre en Bogotá: compra abierta.
    assert.equal(diaBogota("2026-11-01T00:30:00Z"), "2026-10-31");
    assert.equal(resumenVigenciaHistorica(foto, "actual", "2026-11-01T00:30:00Z").estado, "vigente");
  });

  test("vigencia renombrada o eliminada antes del cambio: lo dice y usa su versión de entonces", () => {
    const r = resumenVigenciaHistorica(foto, "historial", "2026-10-15T15:00:00Z");
    assert.match(r.nota ?? "", /renombrada o eliminada/);
    assert.deepEqual(r.viaje, ["2026-10-05 → 2026-11-30"]);
  });

  test("sin vigencia registrada: no inventa fechas", () => {
    const r = resumenVigenciaHistorica([], "no_encontrada", "2026-10-15T15:00:00Z");
    assert.equal(r.estado, "sin_vigencia");
    assert.deepEqual([r.viaje, r.compra], [[], []]);
  });

  test("rangos múltiples de viaje se muestran todos", () => {
    const r = resumenVigenciaHistorica([{ ...foto[0], rangos: [
      { fecha_inicio: "2026-10-05", fecha_fin: "2026-10-20" }, { fecha_inicio: "2026-11-01", fecha_fin: "2026-11-30" },
    ] }], "actual", "2026-10-15T15:00:00Z");
    assert.deepEqual(r.viaje, ["2026-10-05 → 2026-10-20", "2026-11-01 → 2026-11-30"]);
  });
});

// ── Histórico interno NO publicable ────────────────────────────────────────
const RAIZ = join(dirname(fileURLToPath(import.meta.url)), "..");
function archivos(dir: string): string[] {
  return readdirSync(dir).flatMap((n) => {
    const p = join(dir, n);
    return statSync(p).isDirectory() ? archivos(p) : /\.(ts|tsx)$/.test(n) ? [p] : [];
  });
}
const rel = (p: string) => p.slice(RAIZ.length + 1).replace(/\\/g, "/");
const CODIGO = [...archivos(join(RAIZ, "app")), ...archivos(join(RAIZ, "lib")), ...archivos(join(RAIZ, "components"))];

describe("#26 — el historial interno no participa en cotización, reserva ni publicación", () => {
  test("solo la acción de historial de la ficha del hotel consulta las tablas/funciones de historial", () => {
    const lectores = CODIGO
      .filter((p) => /from\("(tarifa_hotel_historial|hotel_temporadas_historial)"\)|rpc\("(consultar_historial_tarifas|reconstruir_tarifas_desde_auditoria)"/.test(readFileSync(p, "utf8")))
      .map(rel);
    assert.deepEqual(lectores, ["app/(dashboard)/dashboard/producto/hoteles/[id]/historial-actions.ts"]);
  });

  test("ningún módulo de cotización, reserva, tarifario o paquetes importa el historial", () => {
    const motor = CODIGO.filter((p) => /lib\/(reservar|tarifario|cotizacion)\/|app\/tarifario\/|dashboard\/(reservar|paquetes|cotizaciones|contratos)\//.test(rel(p)));
    assert.ok(motor.length > 10);
    const culpables = motor.filter((p) => /historialTarifas|historial-actions|TarifasHistorial/.test(readFileSync(p, "utf8"))).map(rel);
    assert.deepEqual(culpables, []);
  });

  test("la vista del historial no ofrece restaurar ni escribir", () => {
    const src = readFileSync(join(RAIZ, "app/(dashboard)/dashboard/producto/hoteles/[id]/TarifasHistorial.tsx"), "utf8");
    assert.doesNotMatch(src, /from "\.\.\/actions"|\.insert\(|\.update\(|\.delete\(|restaurar[A-Z(]/);
    const accion = readFileSync(join(RAIZ, "app/(dashboard)/dashboard/producto/hoteles/[id]/historial-actions.ts"), "utf8");
    assert.doesNotMatch(accion, /\.insert\(|\.update\(|\.delete\(|\.upsert\(|generar_tarifas/);
    assert.match(accion, /p_cursor_registrado: cursor\?\.registrado_en \?\? null/);
  });
});

describe("#26 — wiring de la generación acotada y la sustitución", () => {
  const src = readFileSync(join(RAIZ, "app/(dashboard)/dashboard/producto/hoteles/actions.ts"), "utf8");
  const cuerpo = (firma: string) => {
    const ini = src.indexOf(firma);
    assert.notEqual(ini, -1, firma);
    const fin = src.indexOf("\nexport ", ini + 10);
    return src.slice(ini, fin === -1 ? undefined : fin);
  };
  const generar = cuerpo("export async function generarTarifasCalculadora(");
  const sustituir = cuerpo("export async function sustituirPromoManualMixta(");
  const contexto = readFileSync(join(RAIZ, "lib/hoteles/contextoGeneracionTarifas.ts"), "utf8");

  test("generar llama a la RPC acotada (no a la que borraba todo el régimen)", () => {
    assert.match(generar, /sb\.rpc\("generar_tarifas_hotel_calculadora", \{/);
    assert.match(generar, /p_reemplazar_todo: modo === "reemplazar",/);
    assert.doesNotMatch(generar, /reemplazar_tarifas_hotel_calculadora|p_regimenes/);
  });

  test("la generación conoce las filas actuales y aparta las vencidas antes de escribir", () => {
    assert.match(contexto, /from\("tarifa_hotel"\)\s*\.select\("tipo_habitacion, alimentacion, temporada, precio_final_autoritativo/);
    assert.match(generar, /await contextoGeneracion\(sb, hotelId\)/);
    assert.match(generar, /generarTarifas\(calc\.tipo, calc\.params, ctx\)/);
    assert.match(generar, /separarFilasVencidas\(calculadas, ctx\.vigencias, hoy\)/);
  });

  test("'Reemplazar TODAS' se niega si borraría promociones escritas a mano", () => {
    assert.match(generar, /if \(modo === "reemplazar" && promosManualesIntactas\.length > 0\) \{\s*return \{\s*ok: false,/);
  });

  test("sustituir escribe UNA fila con motivo propio, solo si coincide con la vista previa, y regenera", () => {
    assert.match(sustituir, /filaSustitucionMixta\(calc\.params as unknown as MixtaParams, ctx, objetivo\)/);
    assert.match(sustituir, /CAMPOS_VALOR_TARIFA\.find\(\(c\) => \(final\[c\] \?\? null\) !== \(esperado\[c\] \?\? null\)\)/);
    assert.match(sustituir, /p_filas: \[final\] as unknown as Json,/);
    assert.match(sustituir, /p_reemplazar_todo: false,/);
    assert.match(sustituir, /p_motivo: "calculadora_sustituir_manual",/);
    assert.match(sustituir, /await regenerarTarifariosDeHotel\(hotelId\);/);
    const posComparar = sustituir.indexOf("CAMPOS_VALOR_TARIFA.find");
    const posRpc = sustituir.indexOf("sb.rpc(");
    assert.ok(posComparar > 0 && posComparar < posRpc, "la comparación con la vista previa va ANTES de escribir");
  });

  test("el renombre de temporada cascada también a bases_por_regimen", () => {
    assert.match(src, /const cambio = renombrarTemporadaEnParams\(calc\.tipo, params, nombreViejo, nombreNuevo\);/);
  });

  test("concurrencia: generar y sustituir exigen la foto de la vista previa y la envían a la RPC", () => {
    for (const cuerpoFn of [generar, sustituir]) {
      assert.match(cuerpoFn, /previas: FotoTarifa\[\],/, "previas es obligatorio (sin valor por defecto)");
      assert.match(cuerpoFn, /if \(!Array\.isArray\(previas\)\) return \{ ok: false, error: SIN_FOTO \};/);
      assert.match(cuerpoFn, /p_previas: fotoTarifas\(previas\) as unknown as Json,/);
    }
  });

  test("concurrencia: los TRES editores (Dubai, Mixta, Corporativa) mandan la foto con la que cargaron", () => {
    const editor = readFileSync(join(RAIZ, "app/(dashboard)/dashboard/producto/hoteles/[id]/CalculadoraEditor.tsx"), "utf8");
    assert.equal((editor.match(/generarTarifasCalculadora\(hotelId, modo, fotoTarifas\(tarifasExistentes\)\)/g) ?? []).length, 3);
    assert.match(editor, /sustituirPromoManualMixta\(hotelId, \{ temporada: t, regimen, categoria: c \}, valoresDeFila\(esperada\), fotoTarifas\(tarifasExistentes\)\)/);
    assert.match(editor, /<DubaiForm [^>]*tarifasExistentes=\{tarifasExistentes\}/);
    assert.match(editor, /<CorporativaForm [^>]*tarifasExistentes=\{tarifasExistentes\}/);
  });

  test("la RPC (203) bloquea y compara en la MISMA transacción, y usa la fecha de negocio común", () => {
    const sql = readFileSync(join(RAIZ, "supabase/migrations/20260601000203_tarifas_generacion_acotada_historial.sql"), "utf8");
    const ini = sql.indexOf("create or replace function public.generar_tarifas_hotel_calculadora(");
    const fn = sql.slice(ini, sql.indexOf("\n$$;", ini));
    const pos = (re: RegExp) => { const m = fn.search(re); assert.notEqual(m, -1, String(re)); return m; };
    const bloqueo = pos(/perform 1 from public\.hoteles where id = p_hotel_id for update;/);
    pos(/perform 1 from public\.tarifa_hotel where hotel_id = p_hotel_id for update;/);
    const foto = pos(/_tarifa_huella\(p_previas\)/);
    const manual = pos(/es una promoción escrita a mano; no se sobrescribe al generar/);
    const borrado = pos(/delete from public\.tarifa_hotel t/);
    assert.ok(bloqueo < foto && foto < manual && manual < borrado, "bloqueo → foto → promos manuales → borrado");
    assert.match(fn, /v_hoy\s+date := public\.fecha_negocio\(\);/);
    assert.doesNotMatch(fn, /at time zone 'America\/Bogota'/);
  });
});

describe("fecha de negocio común en el frente de tarifas", () => {
  test("historial y ficha del hotel usan fechaNegocio (no la zona del navegador)", () => {
    const hist = readFileSync(join(RAIZ, "lib/calc/historialTarifas.ts"), "utf8");
    const ficha = readFileSync(join(RAIZ, "app/(dashboard)/dashboard/producto/hoteles/[id]/HotelDetalleClient.tsx"), "utf8");
    assert.match(hist, /return fechaNegocio\(new Date\(iso\)\);/);
    assert.match(ficha, /const hoyLocal = \(\) => fechaNegocio\(\);/);
    assert.doesNotMatch(hist + ficha, /toLocaleDateString\("en-CA"/);
  });
  test("diaBogota da el día de Bogotá también desde las 19:00 (cuando UTC ya cambió de día)", () => {
    assert.equal(diaBogota("2026-10-01T00:30:00Z"), "2026-09-30"); // 19:30 Bogotá
    assert.equal(diaBogota("2026-10-01T05:30:00Z"), "2026-10-01");
  });
});
