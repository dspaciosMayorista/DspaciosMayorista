// ─────────────────────────────────────────────────────────────────────────
// Editor de dominio para `hotel_tarifas_unidad` (fase 2 Bernalo — UI interna
// dentro del detalle de hotel, PR sobre la migración 173).
//
// Igual que `lib/calc/tarifaAlojamientoPersistida.ts`, este archivo es PURO:
// sin Supabase, sin Next (`next/cache`, `next/navigation`), sin `Date`
// aleatorio salvo `node:crypto` (determinista en el sentido de que no
// depende de reloj/red — un `randomUUID()` no es más "impuro" que lo que ya
// usa `lib/observabilidad/medicion.ts` para IDs server-side). Esto permite
// probarlo con `node --test` sin arrancar Next/Supabase, y evita que la capa
// de Server Actions tenga que "adivinar" ninguna regla de negocio: aquí solo
// se CONSTRUYEN los objetos; la autoridad de aceptar/rechazar sigue siendo
// 100% del motor (`validarTarifaAlojamiento`) y del adaptador
// (`adaptarTarifaAlojamientoPersistida`) — este archivo no reimplementa
// ninguna de sus reglas, solo las invoca.
//
// Alcance (igual que la fase 1): SOLO tarifas regulares de alojamiento por
// noche. Sin día de sol, Navidad/Año Nuevo, tarifa especial de una noche,
// paquetes de 2 noches/3 días ni condiciones generales. Sin integración con
// reservar, tarifario público, cotizaciones, contratos, costos ni CxP —
// este editor solo administra el catálogo de `hotel_tarifas_unidad`. El
// neto que produce el motor será, más adelante, el COSTO que consuma esa
// integración — no ocurre en esta fase.
//
// Comisión Bernalo (ronda 8, confirmada): la tarifa capturada por este
// editor es BRUTA/comisionable — `EntradaFormularioTarifaUnidad.comisionPct`
// es obligatoria (junto a la temporada) y se conserva tal cual al editar un
// borrador (se re-envía en el formulario) y al duplicar una versión (el
// clon de `construirDuplicado` copia la tarifa completa, comisión incluida).
// La AUTORIDAD del cálculo (cuánto es el neto) sigue siendo 100% del motor
// (`cotizarUnidadAlojamiento`) — este archivo no calcula ni un peso.
//
// Fechas: `hotel_tarifas_unidad` NO tiene columnas `fecha_desde`/`fecha_hasta`
// (migración 173) — el calendario autoritativo es `hotel_temporadas` (rangos
// múltiples, blackouts y prioridad); esta tabla solo guarda el NOMBRE de la
// temporada como espejo de clasificación (igual que `tarifa_hotel.temporada`).
// Por eso este archivo nunca construye ni menciona esas columnas: no hay nada
// que omitir porque no existen.
// ─────────────────────────────────────────────────────────────────────────

import { randomUUID } from "node:crypto";
import {
  esBloqueado,
  validarTarifaAlojamiento,
  type CapacidadUnidad,
  type CategoriaMenor,
  type CategoriaTarifaria,
  type PeriodicidadCobro,
  type ReglaEdadMenor,
  type SuplementoConfigurado,
  type TarifaAlojamiento,
  type UnidadCobro,
} from "./unidadAlojamiento.ts";
import {
  adaptarTarifaAlojamientoPersistida,
  type EstadoTarifaUnidad,
} from "./tarifaAlojamientoPersistida.ts";

export type { EstadoTarifaUnidad } from "./tarifaAlojamientoPersistida.ts";

// ── Identidad ────────────────────────────────────────────────────────────
// `tarifa_id` se genera UNA sola vez, al crear el borrador, y viaja igual en
// toda edición/publicación/duplicación posterior — es la identidad estable
// que exige el motor (`TarifaAlojamiento.id`) y la llave de la unique
// GLOBAL `unique (tarifa_id, version_tarifario)` de la migración 173 — esa
// restricción NO incluye `hotel_id`: dos hoteles nunca podrán colisionar en
// la misma (tarifa_id, version_tarifario) aunque compartan nombre de
// tarifa, precisamente porque el prefijo "bernalo-" + UUID v4 es
// globalmente único, no solo dentro del hotel.
export function generarTarifaId(): string {
  return `bernalo-${randomUUID()}`;
}

// ── Entrada cruda del formulario ────────────────────────────────────────
export type SuplementosFormulario = {
  adultoAdicional: number | null;
  personaSola: number | null; // solo tiene sentido para "pareja"
  menorAdicionalNino: number | null;
  menorAdicionalInfante: number | null;
};

export type ReglaEdadFormulario = {
  categoria: CategoriaTarifaria;
  edadMinAnios: number;
  edadMaxAnios: number;
};

export type EntradaFormularioTarifaUnidad = {
  versionTarifario: string;
  temporada: string | null;
  // Comisión Bernalo (ronda 8, confirmada): la tarifa capturada es BRUTA/
  // comisionable; este porcentaje depende de la temporada y se aplica UNA
  // vez sobre el total bruto completo — ver `lib/calc/unidadAlojamiento.ts`.
  // Obligatorio: `number` (no `number | null`) a propósito — un campo vacío
  // en la UI se traduce a `NaN` (mismo criterio que `valorBase`/`minPax`),
  // nunca a un 0% implícito; el motor (`validarTarifaAlojamiento`) rechaza
  // `NaN` con `configuracion_invalida`.
  comisionPct: number;
  categoria: string | null;
  alimentacion: string | null;
  unidadCobro: UnidadCobro;
  valorBase: number;
  // Solo se usan si unidadCobro === "persona" — ver `construirTarifaDesdeFormulario`.
  nino: number | null;
  infante: number | null;
  periodicidadInfante: PeriodicidadCobro | null;
  capacidad: { minPax: number; maxPax: number | null; paxIncluidos: number };
  suplementos: SuplementosFormulario;
  reglasEdad: ReglaEdadFormulario[];
  fuenteDocumento: string | null;
  fuentePagina: number | null;
};

export type ResultadoConstruccion =
  | { ok: true; tarifa: TarifaAlojamiento }
  | { ok: false; error: string };

// Capacidad incluida por unidad de cobro que el motor exige como invariante
// ESTRUCTURAL (no comercial): "persona" no la usa en el precio (debe ser
// exactamente 0) y "pareja" siempre representa 2 adultos (debe ser
// exactamente 2) — ver `validarCoherenciaCapacidad` en el motor. Forzarlo
// aquí no es "inventar un default comercial" (no es plata ni una regla de
// negocio): es la misma constante que el motor ya documenta como fija: la
// UI ni siquiera pide ese número para persona/pareja.
function paxIncluidosEstructural(unidadCobro: UnidadCobro, capturado: number): number {
  if (unidadCobro === "persona") return 0;
  if (unidadCobro === "pareja") return 2;
  return capturado;
}

// Suplementos compatibles con cada unidad de cobro — SOLO para decidir qué
// campos arma este constructor a partir del formulario. Es un espejo de
// conveniencia (evita mandar al motor una combinación que ya se sabe
// incoherente), NO la autoridad: si este mapa llegara a divergir del motor,
// `validarTarifaAlojamiento` sigue siendo quien acepta o rechaza, así que
// nunca se persiste una tarifa incoherente por un desajuste aquí.
function suplementosDesdeFormulario(unidadCobro: UnidadCobro, s: SuplementosFormulario): SuplementoConfigurado[] {
  if (unidadCobro === "persona") return [];
  const out: SuplementoConfigurado[] = [];
  if (s.adultoAdicional != null) out.push({ tipo: "adulto_adicional", valor: s.adultoAdicional });
  if (unidadCobro === "pareja" && s.personaSola != null) out.push({ tipo: "persona_sola", valor: s.personaSola });
  if (s.menorAdicionalNino != null) out.push({ tipo: "menor_adicional", categoriaMenor: "nino" as CategoriaMenor, valor: s.menorAdicionalNino });
  if (s.menorAdicionalInfante != null) out.push({ tipo: "menor_adicional", categoriaMenor: "infante" as CategoriaMenor, valor: s.menorAdicionalInfante });
  return out;
}

// Construye un `TarifaAlojamiento` candidato desde el formulario y lo valida
// con el MOTOR COMPLETO (`validarTarifaAlojamiento`: forma + coherencia por
// unidad + numérica + capacidad). No hay ninguna regla de aceptación propia
// aquí — solo se decide qué claves incluir (omitir una clave que el
// formulario dejó vacía, no inventar un valor para ella).
export function construirTarifaDesdeFormulario(
  tarifaId: string,
  input: EntradaFormularioTarifaUnidad
): ResultadoConstruccion {
  const version = input.versionTarifario.trim();
  if (!version) return { ok: false, error: "La versión del tarifario es obligatoria." };

  const valores: TarifaAlojamiento["valores"] = { adulto: input.valorBase };
  if (input.unidadCobro === "persona") {
    if (input.nino != null) valores.nino = input.nino;
    if (input.infante != null) {
      valores.infante = input.infante;
      if (input.periodicidadInfante) valores.periodicidadInfante = input.periodicidadInfante;
    }
  }

  const capacidad: CapacidadUnidad = {
    minPax: input.capacidad.minPax,
    maxPax: input.capacidad.maxPax,
    paxIncluidos: paxIncluidosEstructural(input.unidadCobro, input.capacidad.paxIncluidos),
  };

  const suplementos = suplementosDesdeFormulario(input.unidadCobro, input.suplementos);

  const reglas: ReglaEdadMenor[] = input.reglasEdad.map((r) => ({
    categoria: r.categoria,
    edadMinAnios: r.edadMinAnios,
    edadMaxAnios: r.edadMaxAnios,
  }));

  const temporada = input.temporada?.trim() || null;
  const categoria = input.categoria?.trim() || null;
  const alimentacion = input.alimentacion?.trim() || null;
  const documento = input.fuenteDocumento?.trim() || null;

  const tarifa: TarifaAlojamiento = {
    id: tarifaId,
    unidadCobro: input.unidadCobro,
    valores,
    capacidad,
    suplementos,
    reglaMenores: { reglas },
    comisionPct: input.comisionPct,
    versionTarifario: version,
    ...(temporada !== null ? { temporada } : {}),
    ...(categoria !== null ? { categoria } : {}),
    ...(alimentacion !== null ? { alimentacion } : {}),
    ...(documento !== null ? { fuente: { documento, pagina: input.fuentePagina ?? null } } : {}),
  };

  const validacion = validarTarifaAlojamiento(tarifa);
  if (esBloqueado(validacion)) return { ok: false, error: validacion.mensaje };
  return { ok: true, tarifa: validacion.tarifa };
}

// ── Duplicar como nueva versión ─────────────────────────────────────────
// Conserva `id` (tarifa_id — la identidad de negocio) tal cual; exige una
// `versionTarifario` distinta de la que se está duplicando (si fuera igual,
// la unique de la migración 173 la rechazaría de todas formas, pero fallar
// acá da un mensaje claro sin tocar la base). El resto de la tarifa se
// clona textual: el punto de partida de la nueva versión es la anterior, no
// un formulario en blanco.
export function construirDuplicado(
  origen: TarifaAlojamiento,
  nuevaVersionTarifario: string
): ResultadoConstruccion {
  const nueva = nuevaVersionTarifario.trim();
  if (!nueva) return { ok: false, error: "La nueva versión no puede estar vacía." };
  if (nueva === origen.versionTarifario) {
    return { ok: false, error: "La nueva versión debe ser distinta de la versión que estás duplicando." };
  }
  const clon = JSON.parse(JSON.stringify(origen)) as TarifaAlojamiento;
  clon.versionTarifario = nueva;
  const validacion = validarTarifaAlojamiento(clon);
  if (esBloqueado(validacion)) return { ok: false, error: validacion.mensaje };
  return { ok: true, tarifa: validacion.tarifa };
}

// ── Fila candidata para persistir ───────────────────────────────────────
// Sin `fecha_desde`/`fecha_hasta`: esa columnas no existen en
// `hotel_tarifas_unidad` (ver cabecera del archivo), así que esta fila no
// las declara. Se corre por el MISMO adaptador que usará cualquier lectura
// futura (`adaptarTarifaAlojamientoPersistida`) antes de devolver la fila a
// persistir — así la coherencia columnas-espejo↔payload se verifica con la
// autoridad real, no con una copia de su criterio.
export type FilaCandidataTarifaUnidad = {
  hotel_id: number;
  tarifa_id: string;
  version_tarifario: string;
  temporada: string | null;
  categoria: string | null;
  alimentacion: string | null;
  estado: EstadoTarifaUnidad;
  fuente_documento: string | null;
  fuente_pagina: number | null;
  // Espejo de `payload.comisionPct` (migración 175) — mismo criterio que
  // temporada/categoria/alimentacion: se escribe SIEMPRE (la tarifa ya la
  // trae obligatoria) y el adaptador verifica que coincida con el payload.
  comision_pct: number;
  payload: TarifaAlojamiento;
};

export function construirFilaCandidata(
  hotelId: number,
  tarifa: TarifaAlojamiento,
  estado: EstadoTarifaUnidad
): { ok: true; fila: FilaCandidataTarifaUnidad } | { ok: false; error: string } {
  const fila: FilaCandidataTarifaUnidad = {
    hotel_id: hotelId,
    tarifa_id: tarifa.id,
    version_tarifario: tarifa.versionTarifario,
    temporada: tarifa.temporada ?? null,
    categoria: tarifa.categoria ?? null,
    alimentacion: tarifa.alimentacion ?? null,
    estado,
    fuente_documento: tarifa.fuente?.documento ?? null,
    fuente_pagina: tarifa.fuente?.pagina ?? null,
    comision_pct: tarifa.comisionPct,
    payload: tarifa,
  };

  const adaptada = adaptarTarifaAlojamientoPersistida({ ...fila, id: null });
  if (!adaptada.ok) {
    const sufijo = adaptada.codigoMotor ? ` (${adaptada.codigoMotor})` : "";
    return { ok: false, error: `${adaptada.mensaje}${sufijo}` };
  }
  return { ok: true, fila };
}

// ── Máquina de estados editorial ────────────────────────────────────────
// Único lugar donde vive "qué transición es válida" — server actions y UI
// consultan estas funciones en vez de comparar `estado === "..."` sueltos
// en varios sitios, para que la regla de negocio 9 ("nunca se edita el
// payload de una publicada; solo pasa a inactiva") tenga una sola fuente.
//
//   borrador  → editar payload, eliminar, publicar (→ publicada), duplicar.
//   publicada → duplicar como nueva versión, inactivar (→ inactiva). Nunca
//               editar ni eliminar, y nunca "publicar" de nuevo (ya lo está).
//   inactiva  → solo duplicar como nueva versión (estado final editorial).
export function puedeEditarPayload(estado: EstadoTarifaUnidad): boolean {
  return estado === "borrador";
}
export function puedeEliminar(estado: EstadoTarifaUnidad): boolean {
  return estado === "borrador";
}
export function puedePublicar(estado: EstadoTarifaUnidad): boolean {
  return estado === "borrador";
}
export function puedeInactivar(estado: EstadoTarifaUnidad): boolean {
  return estado === "publicada";
}
