// ─────────────────────────────────────────────────────────────────────────
// Resumen de precios del CLIENTE (#94/#52) — lógica PURA, solo presentación: nunca recalcula un importe acordado.
//
// El cliente ve GRUPOS de pasajeros con su precio completo por persona y su subtotal, más el total; lo incluido se describe sin importe por servicio.
//   · Un «cupo» es un pasajero anónimo de la cotización con identidad ESTABLE (`id`) y su base de alojamiento (la tarifa que le corresponde por su habitación y tipo).
//   · Un servicio con precio TOTAL se reparte por igual entre los cupos que cubre. La ESTRUCTURA guardada trabaja en centavos enteros (así la valida la base: tarifa × cantidad = subtotal), por lo que el residuo de un centavo vive
//     ahí, invisible; lo que ve el cliente NO es ese reparto: el documento muestra UNA tarifa por tipo con su precisión de cálculo (subtotal ÷ cantidad) y el total exacto (`filasDeUnidad`). Sin múltiplo de redondeo nuevo y sin línea de «ajuste».
//   · Un servicio con tarifas POR TIPO (adulto / niño / infante) se conserva: cada cupo cubierto paga la de su tipo. Si falta la de un tipo cubierto, se rechaza (no se inventa ni se promedia).
//   · Todo en centavos enteros. El resultado suma EXACTAMENTE: Σ subtotales = total (`ajusteCentavos` queda en 0; solo los resúmenes guardados antes de este cambio pueden traerlo).
// ─────────────────────────────────────────────────────────────────────────

export type TipoCupo = "adulto" | "nino" | "nino2" | "infante";

export const ETIQUETA_TIPO: Record<TipoCupo, string> = { adulto: "Adulto", nino: "Niño", nino2: "Niño 2", infante: "Infante" };

/** Un pasajero anónimo de la cotización. `id` estable mientras se edita (no se reasigna al reordenar). */
export type Cupo = { id: string; tipo: TipoCupo; baseCentavos: number };

/** `oculto`: el importe se reparte entre los cupos que cubre pero su NOMBRE no sale en «incluye» (#14-A: el recobro viaja dentro de la tarifa de adulto, sin identificarse). */
export type ServicioCobertura =
  | { id: string; nombre: string; modo: "total"; precioCentavos: number; cubre: "todos" | readonly string[]; oculto?: true }
  | { id: string; nombre: string; modo: "por_tipo"; tarifasCentavos: Partial<Record<TipoCupo, number>>; cubre: "todos" | readonly string[]; oculto?: true };

export type GrupoResumen = {
  tipo: TipoCupo;
  cantidad: number;
  /** Precio completo por persona (alojamiento + su parte de cada servicio cubierto) en centavos ENTEROS: la estructura que valida la base (tarifa × cantidad = subtotal). */
  tarifaCentavos: number;
  /** La MISMA tarifa con su precisión de cálculo (centavos con fracción, sin repartir el residuo entre pasajeros): es la que muestra el documento. Ausente en resúmenes anteriores (entonces vale `tarifaCentavos`). */
  tarifaExactaCentavos?: number;
  subtotalCentavos: number;
  /** Nombres de los servicios que cubre el grupo (sin importes), en el orden en que se agregaron. */
  incluye: string[];
  /** Ids de los cupos del grupo (trazabilidad; no son pasajeros reales). */
  cupos: string[];
};

export type UnidadResumen = {
  /** `ref` de la unidad del carrito (`item-N`). */
  ref: string;
  paquete: { id: number | null; nombre: string | null };
  hotel: string | null;
  categoria: string | null;
  regimen: string | null;
  grupos: GrupoResumen[];
  /** Heredado: los resúmenes nuevos lo dejan en 0 (el residuo va dentro de las tarifas por pasajero). Los guardados antes pueden traerlo; la presentación lo absorbe en las tarifas (`absorberAjuste`). */
  ajusteCentavos: number;
  totalCentavos: number;
};

export type ResumenPrecios = {
  version: 1;
  modalidad: "pvp" | "neto";
  moneda: string;
  totalCentavos: number;
  unidades: UnidadResumen[];
};

type Resultado<T> = { ok: true; valor: T } | { ok: false; error: string };

const entero = (n: unknown): n is number => typeof n === "number" && Number.isSafeInteger(n) && n >= 0;

/** Agrupa los cupos de UNA unidad con sus servicios. No inventa nada: ante dato faltante o inconsistente devuelve el motivo. */
export function resumenUnidad(
  entrada: { cupos: readonly Cupo[]; servicios: readonly ServicioCobertura[] } & Pick<UnidadResumen, "ref" | "paquete" | "hotel" | "categoria" | "regimen">,
): Resultado<UnidadResumen> {
  const { cupos, servicios } = entrada;
  if (!cupos.length) return { ok: false, error: "La unidad no tiene pasajeros." };
  const idsCupo = new Set<string>();
  for (const c of cupos) {
    if (!c.id || idsCupo.has(c.id)) return { ok: false, error: "Los pasajeros de la unidad deben tener identificador único." };
    if (!entero(c.baseCentavos)) return { ok: false, error: "La tarifa de alojamiento de un pasajero no es válida." };
    idsCupo.add(c.id);
  }
  const idsServicio = new Set<string>();
  const precio = new Map<string, number>(cupos.map((c) => [c.id, c.baseCentavos]));
  const exacto = new Map<string, number>(cupos.map((c) => [c.id, c.baseCentavos])); // lo mismo con precisión de cálculo: sin repartir el residuo
  const incluidos = new Map<string, string[]>(cupos.map((c) => [c.id, []]));
  const ajuste = 0;
  let sumaEsperada = cupos.reduce((s, c) => s + c.baseCentavos, 0);
  for (const s of servicios) {
    if (!s.id || idsServicio.has(s.id)) return { ok: false, error: "Los servicios deben tener identificador único." };
    idsServicio.add(s.id);
    const cubiertos = s.cubre === "todos" ? cupos.map((c) => c.id) : [...s.cubre];
    if (!cubiertos.length) return { ok: false, error: `Selecciona los pasajeros que cubre «${s.nombre}».` };
    if (new Set(cubiertos).size !== cubiertos.length || cubiertos.some((id) => !idsCupo.has(id))) {
      return { ok: false, error: `«${s.nombre}» cubre un pasajero que no existe en la cotización. Vuelve a seleccionar los pasajeros cubiertos.` };
    }
    if (s.modo === "total") {
      if (!entero(s.precioCentavos)) return { ok: false, error: `El precio de «${s.nombre}» no es válido.` };
      // El residuo (menos de un centavo por cupo) se reparte de a UN centavo entre los primeros cupos cubiertos: es el límite del dinero y lo que la base exige (enteros). Determinista y sin efecto visible:
      // el documento muestra la tarifa con precisión de cálculo por tipo, no este reparto.
      const parte = Math.floor(s.precioCentavos / cubiertos.length);
      const resto = s.precioCentavos - parte * cubiertos.length;
      cubiertos.forEach((id, i) => precio.set(id, (precio.get(id) ?? 0) + parte + (i < resto ? 1 : 0)));
      for (const id of cubiertos) exacto.set(id, (exacto.get(id) ?? 0) + s.precioCentavos / cubiertos.length);
      sumaEsperada += s.precioCentavos;
    } else {
      for (const id of cubiertos) {
        const tipo = cupos.find((c) => c.id === id)!.tipo;
        const t = s.tarifasCentavos[tipo];
        if (!entero(t)) return { ok: false, error: `«${s.nombre}» no tiene tarifa de ${ETIQUETA_TIPO[tipo].toLowerCase()}; no se asume gratis ni se promedia.` };
        precio.set(id, (precio.get(id) ?? 0) + t);
        exacto.set(id, (exacto.get(id) ?? 0) + t);
        sumaEsperada += t;
      }
    }
    if (!s.oculto) for (const id of cubiertos) incluidos.get(id)!.push(s.nombre);
  }
  // Grupos: mismo tipo, misma tarifa y mismo conjunto de servicios. Orden determinista e independiente del orden de entrada: tipo, tarifa descendente, servicios.
  const ordenTipo: TipoCupo[] = ["adulto", "nino", "nino2", "infante"];
  const grupos = new Map<string, GrupoResumen>();
  const sumaExacta = new Map<string, number>();
  for (const c of cupos) {
    const tarifa = precio.get(c.id)!;
    const nombres = incluidos.get(c.id)!;
    // La exacta entra en la clave: dos cupos con la misma tarifa entera pero distinta tarifa real (p. ej. 100,00 + residuo y 100,01 + residuo) no pueden quedar en un grupo cuya exacta sería un promedio.
    const clave = `${c.tipo}|${tarifa}|${Math.round((exacto.get(c.id) ?? tarifa) * 1e4)}|${nombres.join("\u0001")}`;
    const g = grupos.get(clave) ?? { tipo: c.tipo, cantidad: 0, tarifaCentavos: tarifa, subtotalCentavos: 0, incluye: nombres, cupos: [] };
    g.cantidad += 1; g.subtotalCentavos += tarifa; g.cupos.push(c.id);
    sumaExacta.set(clave, (sumaExacta.get(clave) ?? 0) + (exacto.get(c.id) ?? tarifa));
    grupos.set(clave, g);
  }
  for (const [clave, g] of grupos) g.tarifaExactaCentavos = Math.round((sumaExacta.get(clave)! / g.cantidad) * 1e4) / 1e4;
  const lista = [...grupos.values()].sort((a, b) =>
    ordenTipo.indexOf(a.tipo) - ordenTipo.indexOf(b.tipo) || b.tarifaCentavos - a.tarifaCentavos || a.incluye.join("|").localeCompare(b.incluye.join("|")));
  const total = lista.reduce((s, g) => s + g.subtotalCentavos, 0) + ajuste;
  if (total !== sumaEsperada) return { ok: false, error: "El resumen de precios no cuadra con las tarifas; no se genera." };
  return { ok: true, valor: { ref: entrada.ref, paquete: entrada.paquete, hotel: entrada.hotel, categoria: entrada.categoria, regimen: entrada.regimen, grupos: lista, ajusteCentavos: ajuste, totalCentavos: total } };
}

export function resumenCotizacion(e: { modalidad: "pvp" | "neto"; moneda: string; unidades: readonly UnidadResumen[] }): ResumenPrecios {
  return { version: 1, modalidad: e.modalidad, moneda: e.moneda, totalCentavos: e.unidades.reduce((s, u) => s + u.totalCentavos, 0), unidades: [...e.unidades] };
}

/**
 * ¿Este resumen guardado es aplicable al documento? Solo si su estructura suma sin residuos y coincide con el ACUERDO vigente del documento
 * (modalidad, moneda de la oferta y total). Cualquier diferencia → null: el documento no muestra un reparto que ya no corresponde.
 */
export function resumenAplicable(
  crudo: unknown,
  acuerdo: { modalidad: "pvp" | "neto"; moneda: string; totalCentavos: number },
): ResumenPrecios | null {
  const r = crudo as Partial<ResumenPrecios> | null;
  if (!r || typeof r !== "object" || r.version !== 1 || !Array.isArray(r.unidades) || !r.unidades.length) return null;
  if (r.modalidad !== acuerdo.modalidad || r.moneda !== acuerdo.moneda || r.totalCentavos !== acuerdo.totalCentavos) return null;
  let total = 0;
  for (const u of r.unidades) {
    if (!u || !Array.isArray(u.grupos) || !u.grupos.length || !entero(u.ajusteCentavos) || !entero(u.totalCentavos)) return null;
    let s = u.ajusteCentavos;
    for (const g of u.grupos) {
      if (!g || !entero(g.cantidad) || g.cantidad < 1 || !entero(g.tarifaCentavos) || g.subtotalCentavos !== g.cantidad * g.tarifaCentavos || !Array.isArray(g.incluye)) return null;
      s += g.subtotalCentavos;
    }
    if (s !== u.totalCentavos) return null;
    total += u.totalCentavos;
  }
  return total === r.totalCentavos ? (r as ResumenPrecios) : null;
}

/**
 * #94 — Resumen que se congela en UN contrato al convertir una cotización: solo las unidades (`ref` `item-N`) del grupo que ese contrato cubre, con el total
 * recalculado, y únicamente si cuadra con lo EXIGIBLE del contrato (modalidad, moneda y total). Sin resumen guardado, con una unidad desconocida o sin cuadre
 * devuelve null: el contrato conserva su presentación de siempre y NUNCA se inventa un reparto.
 */
export function resumenParaContrato(
  crudo: unknown,
  refs: readonly string[],
  acuerdo: { modalidad: "pvp" | "neto"; moneda: string; totalCentavos: number },
): ResumenPrecios | null {
  const r = crudo as Partial<ResumenPrecios> | null;
  if (!r || typeof r !== "object" || r.version !== 1 || !Array.isArray(r.unidades) || !refs.length) return null;
  const unidades: UnidadResumen[] = [];
  for (const ref of new Set(refs)) {
    const u = r.unidades.find((x) => x && x.ref === ref);
    if (!u) return null;
    unidades.push(u);
  }
  if (r.modalidad !== acuerdo.modalidad || r.moneda !== acuerdo.moneda) return null;
  return resumenAplicable({ ...r, unidades, totalCentavos: unidades.reduce((s, u) => s + (entero(u.totalCentavos) ? u.totalCentavos : NaN), 0) }, acuerdo);
}
