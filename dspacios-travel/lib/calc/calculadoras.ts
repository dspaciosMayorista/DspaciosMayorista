// ─────────────────────────────────────────────────────────────────────────
// Calculadoras de tarifa por hotel (estructuras especiales)
// ─────────────────────────────────────────────────────────────────────────
// Cada hotel especial guarda un TIPO de calculadora + sus PARÁMETROS. Aquí
// viven las funciones PURAS que, a partir de esos parámetros, producen las
// filas normales de `tarifa_hotel`. Así "montamos el resultado" solos y el
// resto del sistema (tarifario, reservar, contrato) no cambia.
//
// Para sumar un hotel con OTRA estructura: se agrega un nuevo tipo + su función
// `generar...` y se registra en `generarTarifas()`. El marco (guardar params,
// botón Generar, escribir tarifa_hotel) se reutiliza.
// ─────────────────────────────────────────────────────────────────────────

/** Fila de tarifa lista para insertar en `tarifa_hotel` (sin hotel_id). */
export type TarifaGenerada = {
  tipo_habitacion: string;   // categoría (ej. "estandar", "superior")
  alimentacion: string;      // régimen (ej. "PC", "PAM")
  temporada: string;         // nombre de la temporada del hotel
  neto_sencilla: number;
  neto_doble: number;
  neto_triple: number;
  neto_multiple: number;
  neto_nino: number;
  neto_nino2: number | null;
  neto_infante: number | null;
  nota_infante: string | null;
};

// ── Calculadora "DUBAI" ────────────────────────────────────────────────────
// Una base por persona/noche (en DOBLE, con el régimen base incluido) por
// categoría y temporada, y el resto se deriva con modificadores:
//   sencilla = base × (1 + sencilla%)        (suplemento individual)
//   doble    = base
//   triple   = (base×2 + base×(1+3erPax%)) / 3
//   múltiple = (base×2 + base×(1+3erPax%) + base×(1+4toPax%)) / 4
//   niño     = base × (1 + niño%)
// Luego cada régimen suma un monto fijo por persona (el base suma 0).
// Promoción de temporada: descuento % sobre la BASE (antes de sumar el
// suplemento de régimen) — el suplemento NUNCA se descuenta. Genera una
// temporada NUEVA (`temporadaPromo`, debe existir como vigencia de `hotel_temporadas`
// con su propia vigencia de compra/fechas) a partir de una base ya cargada
// (`temporadaBase`), y SOLO para el régimen elegido (aunque el hotel tenga
// varios) — el resto de régimen no se tocan para esa temporada promocional.
export type DubaiPromo = {
  temporadaBase: string;
  temporadaPromo: string;
  regimen: string;
  descuentoPct: number;
};

export type DubaiParams = {
  regimen_base: string;                 // régimen incluido en la base (ej. "PC")
  modificadores: {
    sencilla_pct: number;               // +50  → ×1.5
    pax3_pct: number;                   // -20  → ×0.8
    pax4_pct: number;                   // -20
    nino_pct: number;                   // -50  → ×0.5
    infante_pct?: number;                // -100 → gratis (default si no se configura)
  };
  suplementos: { regimen: string; monto: number }[];   // PAM +45000, etc.
  bases: { categoria: string; temporada: string; precio: number }[];
  promos?: DubaiPromo[];
  infante_nota?: string;                 // nota general (ej. "comparte cama con los padres")
};

export function generarTarifasDubai(p: DubaiParams): TarifaGenerada[] {
  const m = p.modificadores ?? { sencilla_pct: 0, pax3_pct: 0, pax4_pct: 0, nino_pct: 0, infante_pct: -100 };
  const infantePct = m.infante_pct ?? -100;
  const f = (pct: number) => 1 + (Number(pct) || 0) / 100;
  const notaInfante = p.infante_nota?.trim() || null;
  const out: TarifaGenerada[] = [];

  // Régimen base (suplemento 0) + los suplementos configurados.
  const regimenBase = (p.regimen_base || "PC").trim();
  const regimenes = [
    { regimen: regimenBase, monto: 0 },
    ...(p.suplementos ?? []).filter((s) => s.regimen?.trim()),
  ];
  const suplementoDe = (regimen: string) => regimenes.find((r) => r.regimen === regimen)?.monto ?? 0;

  // Deriva sencilla/triple/múltiple/niño/infante a partir de una base + su
  // suplemento, igual fórmula para tarifa normal y para promo (la promo solo
  // cambia `base`).
  const derivar = (base: number, sup: number) => ({
    sencilla: Math.round(base * f(m.sencilla_pct) + sup),
    doble: Math.round(base + sup),
    triple: Math.round((base * 2 + base * f(m.pax3_pct)) / 3 + sup),
    multiple: Math.round((base * 2 + base * f(m.pax3_pct) + base * f(m.pax4_pct)) / 4 + sup),
    nino: Math.round(base * f(m.nino_pct) + sup),
    infante: Math.max(0, Math.round(base * f(infantePct) + sup)),
  });

  for (const b of p.bases ?? []) {
    const base = Number(b.precio) || 0;
    if (base <= 0 || !b.categoria?.trim() || !b.temporada?.trim()) continue;

    for (const r of regimenes) {
      const d = derivar(base, Number(r.monto) || 0);
      out.push({
        tipo_habitacion: b.categoria.trim(),
        alimentacion: r.regimen.trim(),
        temporada: b.temporada.trim(),
        neto_sencilla: d.sencilla,
        neto_doble: d.doble,
        neto_triple: d.triple,
        neto_multiple: d.multiple,
        neto_nino: d.nino,
        neto_nino2: null,
        neto_infante: d.infante,
        nota_infante: notaInfante,
      });
    }
  }

  // Promociones: % de descuento SOLO sobre la base, por régimen elegido.
  for (const promo of p.promos ?? []) {
    const regimen = promo.regimen?.trim();
    const temporadaPromo = promo.temporadaPromo?.trim();
    const pct = Number(promo.descuentoPct) || 0;
    if (!regimen || !temporadaPromo || pct <= 0) continue;
    const sup = suplementoDe(regimen);
    for (const b of p.bases ?? []) {
      if (b.temporada?.trim() !== promo.temporadaBase?.trim()) continue;
      const base = Number(b.precio) || 0;
      if (base <= 0 || !b.categoria?.trim()) continue;
      const basePromo = base * (1 - pct / 100);
      const d = derivar(basePromo, sup);
      out.push({
        tipo_habitacion: b.categoria.trim(),
        alimentacion: regimen,
        temporada: temporadaPromo,
        neto_sencilla: d.sencilla,
        neto_doble: d.doble,
        neto_triple: d.triple,
        neto_multiple: d.multiple,
        neto_nino: d.nino,
        neto_nino2: null,
        neto_infante: d.infante,
        nota_infante: notaInfante,
      });
    }
  }
  return out;
}

// ── Calculadora "MIXTA" ────────────────────────────────────────────────────
// El hotel mezcla tarifas POR HABITACIÓN y POR PERSONA, con IVA opcional por
// acomodación. Por cada acomodación se elige modo (hab/pax) y si lleva IVA (19%).
// Como el resto del sistema trabaja POR PERSONA:
//   - modo 'hab': valor / pax de la habitación  → por persona
//   - modo 'pax': el valor ya es por persona
//   - si IVA: × (1 + iva%)
// Los valores se cargan por categoría × temporada (uno por acomodación).
export type MixtaAcom = "sencilla" | "doble" | "triple" | "multiple";
export const MIXTA_ACOMS: MixtaAcom[] = ["sencilla", "doble", "triple", "multiple"];

export type MixtaParams = {
  regimen: string;
  iva_pct: number;                                    // 19
  acom: Record<MixtaAcom, { modo: "hab" | "pax"; iva: boolean }>;
  nino: { iva: boolean };
  pax: Record<MixtaAcom, number>;                     // pax por habitación (1/2/3/4)
  bases: {
    categoria: string; temporada: string;
    sencilla: number; doble: number; triple: number; multiple: number;
    nino: number; nino2: number | null; infante?: number | null;
  }[];
  infante_nota?: string;                               // nota general (ej. "comparte cama con los padres")
};

export function generarTarifasMixta(p: MixtaParams): TarifaGenerada[] {
  const ivaPct = Number(p.iva_pct) || 19;
  const conIva = (v: number, iva: boolean) => (iva ? v * (1 + ivaPct / 100) : v);
  const notaInfante = p.infante_nota?.trim() || null;
  // Por persona, según modo de la acomodación.
  const pp = (valor: number, acom: MixtaAcom) => {
    const v = Number(valor) || 0;
    if (v <= 0) return 0;
    const cfg = p.acom?.[acom] ?? { modo: "pax" as const, iva: false };
    const paxRoom = Math.max(1, Number(p.pax?.[acom]) || 1);
    const base = cfg.modo === "hab" ? v / paxRoom : v;
    return Math.round(conIva(base, cfg.iva));
  };
  // Niño 1/2 e Infante siempre son por persona; comparten el mismo IVA.
  const ppNino = (valor: number) => {
    const v = Number(valor) || 0;
    if (v <= 0) return 0;
    return Math.round(conIva(v, p.nino?.iva ?? false));
  };

  const out: TarifaGenerada[] = [];
  for (const b of p.bases ?? []) {
    if (!b.categoria?.trim() || !b.temporada?.trim()) continue;
    const sencilla = pp(b.sencilla, "sencilla");
    const doble = pp(b.doble, "doble");
    const triple = pp(b.triple, "triple");
    const multiple = pp(b.multiple, "multiple");
    if (sencilla + doble + triple + multiple <= 0) continue; // fila sin valores
    out.push({
      tipo_habitacion: b.categoria.trim(),
      alimentacion: (p.regimen || "").trim(),
      temporada: b.temporada.trim(),
      neto_sencilla: sencilla,
      neto_doble: doble,
      neto_triple: triple,
      neto_multiple: multiple,
      neto_nino: ppNino(b.nino),
      neto_nino2: b.nino2 != null ? ppNino(b.nino2) : null,
      neto_infante: b.infante != null ? ppNino(b.infante) : null,
      nota_infante: notaInfante,
    });
  }
  return out;
}

// ── Registro de calculadoras ───────────────────────────────────────────────
export type CalcTipo = "dubai" | "mixta";

export function generarTarifas(tipo: string, params: unknown): TarifaGenerada[] {
  switch (tipo) {
    case "dubai":
      return generarTarifasDubai(params as DubaiParams);
    case "mixta":
      return generarTarifasMixta(params as MixtaParams);
    default:
      return [];
  }
}
