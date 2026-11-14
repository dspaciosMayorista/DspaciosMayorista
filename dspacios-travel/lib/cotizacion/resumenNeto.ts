// #14-A (N4) — Resumen del cliente en NETO con tarifas por ADULTO y por NIÑO (y servicios adicionales), lógica PURA y solo presentación.
// Reutiliza lo ya aprobado, sin repartos nuevos:
//   · la comisión ordinaria se reparte entre las LÍNEAS del plan (cada hotel y cada servicio) solo sobre su parte COMISIONABLE (PVP − valor no comisionable, que queda íntegro), como
//     `netoDePlan` (#94) pero con `repartir` (#50, mayor resto, sobrante a la menor posición); si el recobro se queda en la base, el del hotel suma a su base;
//   · dentro de cada hotel la ordinaria baja a sus personas (adultos y niños) con `tarifasNetoPorPersona` y la participación del recobro se descuenta de los adultos que lo llevan;
//   · el NETO de cada servicio (PVP − su parte) se reparte entre los pasajeros que cubre con la misma cobertura del resumen PVP (`construirResumenCarrito`).
// Todo suma EXACTAMENTE el total exigible. Casos sin regla aplicable (no se inventa): servicio incluido por grupo del hotel, servicio no asignado a un hotel o con cobertura parcial sin
// pasajeros elegidos — `construirResumenCarrito` devuelve el motivo concreto y el documento muestra el total exigible.
// VARIOS HOTELES: tampoco hay regla única. La comisión (ordinaria y participación) se liquida POR CONTRATO (`planesDeGruposB2B`: round(base × %) y reparto de la participación en pesos enteros) y
// los contratos se agrupan DESPUÉS de cotizar (uno solo o uno por destino). Un reparto por pasajero hecho en la cotización solo coincidiría con la liquidación de un agrupamiento concreto y, con el
// otro, el contrato no cuadraría con su resumen. Por eso, con más de un hotel el resumen NETO no se genera (queda el motivo) y cada contrato muestra su total exigible. Con UN hotel (y sus servicios)
// la cotización y el contrato son la misma liquidación y el resumen cuadra siempre.
import { repartirRecobroEntreAdultos, tarifasNetoPorPersona, type PersonaNeto } from "./recobroCarrito.ts";
import { aCentavos, repartir } from "./netoHija.ts";
import { construirResumenCarrito, type ResultadoResumenCarrito, type ServicioEntrada, type UnidadBase } from "./resumenCarrito.ts";

const B0 = BigInt(0);

/**
 * @param impuestoPorUnidad valor NO comisionable (BNC) de cada hotel, en unidades de moneda. Se reparte entre sus personas en proporción a su tarifa.
 * @param servicios servicios adicionales del carrito (con su `id` = clave de la línea del plan: `tour-N` / `manual-N`) y @param impuestoServicio su valor no comisionable por id.
 * @param recobroTotal recobro del carrito (0 = sin recobro): por igual entre TODOS los adultos (misma función que el documento y el contrato).
 * @param participacion participación del aliado en el recobro (> 0 ⇒ el recobro sale de la base comisionable).
 * @param comisionTotalAliado ordinaria + participación (= `plan.comision`).
 */
export function resumenNetoCarrito(e: {
  unidades: readonly UnidadBase[];
  servicios: readonly ServicioEntrada[];
  impuestoPorUnidad: Readonly<Record<string, number>>;
  impuestoServicio: Readonly<Record<string, number>>;
  recobroTotal: number;
  participacion: number;
  comisionTotalAliado: number;
  moneda: string;
  exigible: number;
}): ResultadoResumenCarrito {
  if (!e.unidades.length) return { ok: false, motivo: "La cotización no tiene hoteles con tarifa por persona." };
  if (e.unidades.length > 1) return { ok: false, motivo: "En NETO la comisión se liquida por contrato y los contratos se agrupan después de cotizar: con varios hoteles no hay un reparto único por pasajero; cada contrato muestra su total exigible." };
  if (e.unidades.some((u) => u.grupoIncluido > 0)) return { ok: false, motivo: "Hay un servicio incluido por grupo: en NETO no hay una regla aprobada para repartirlo por pasajero; el documento muestra el total exigible." };

  const adultosPorUnidad = e.unidades.map((u) => ({ ref: u.ref, adultos: u.personas.filter((p) => p.tipo === "adulto").reduce((n, p) => n + p.cantidad, 0) }));
  const rec = repartirRecobroEntreAdultos(e.recobroTotal, adultosPorUnidad);
  if (!rec.ok) return { ok: false, motivo: rec.error };
  const participacionCent = aCentavos(e.participacion);
  const excluyeRecobro = participacionCent > B0;

  // Personas de cada hotel en el orden del carrito, con su recobro y su peso comisionable; `llaves` = identidad (unidad|clase|posición) que usa el resumen.
  type Persona = PersonaNeto & { llave: string };
  const porUnidad: Persona[][] = [];
  let adultoGlobal = 0;
  for (const u of e.unidades) {
    const filas: { tipo: PersonaNeto["tipo"]; pvp: bigint; clave: string }[] = [];
    for (const c of u.personas) for (let k = 0; k < c.cantidad; k++) filas.push({ tipo: c.tipo, pvp: aCentavos(c.tarifa), clave: c.clave });
    const bnc = repartir(aCentavos(e.impuestoPorUnidad[u.ref] ?? 0), filas.map((f) => f.pvp));
    const posicion = new Map<string, number>();
    porUnidad.push(filas.map((f, i) => {
      const k = posicion.get(f.clave) ?? 0; posicion.set(f.clave, k + 1);
      const recobro = f.tipo === "adulto" ? rec.valor.porAdulto[adultoGlobal++] ?? B0 : B0;
      return { tipo: f.tipo, pvpCent: f.pvp, recobroCent: recobro, pesoCent: f.pvp > bnc[i] ? f.pvp - bnc[i] : B0, llave: `${u.ref}|${f.clave}|${k}` };
    }));
  }

  // Líneas del plan: cada hotel (base comisionable de sus personas, + su recobro si éste se queda en la base) y cada servicio (PVP − su valor no comisionable).
  const baseUnidad = porUnidad.map((ps) => ps.reduce((s, p) => s + (p.pesoCent ?? p.pvpCent) + (excluyeRecobro ? B0 : p.recobroCent), B0));
  const baseServicio = e.servicios.map((s) => { const b = aCentavos(s.precio) - aCentavos(e.impuestoServicio[s.id] ?? 0); return b > B0 ? b : B0; });
  const ordinariaCent = aCentavos(e.comisionTotalAliado) - participacionCent;
  if (ordinariaCent < B0) return { ok: false, motivo: "La comisión del plan no cuadra con la participación del recobro." };
  const ordLineas = repartir(ordinariaCent, [...baseUnidad, ...baseServicio]);
  if (ordinariaCent > B0 && ordLineas.reduce((s, x) => s + x, B0) !== ordinariaCent) return { ok: false, motivo: "No hay tarifas sobre las que repartir la comisión." };
  const ordUnidad = ordLineas.slice(0, e.unidades.length), ordServicio = ordLineas.slice(e.unidades.length);

  // La participación se descuenta de los adultos que llevan el recobro: primero por hotel (según su recobro) y dentro de cada hotel por adulto.
  const partUnidad = repartir(participacionCent, porUnidad.map((ps) => ps.reduce((s, p) => s + p.recobroCent, B0)));

  const netoPorCupo: Record<string, number> = {};
  for (let iu = 0; iu < e.unidades.length; iu++) {
    const t = tarifasNetoPorPersona({ personas: porUnidad[iu], ordinariaCent: ordUnidad[iu], participacionCent: partUnidad[iu], excluyeRecobro });
    if (!t.ok) return { ok: false, motivo: t.error };
    t.valor.forEach((x, i) => { netoPorCupo[porUnidad[iu][i].llave] = Number(x.netoCent); });
  }
  const netoServicio: Record<string, number> = {};
  for (let i = 0; i < e.servicios.length; i++) {
    const neto = aCentavos(e.servicios[i].precio) - ordServicio[i];
    if (neto < B0) return { ok: false, motivo: `«${e.servicios[i].nombre}» quedaría con un NETO negativo; no se genera el detalle por pasajero.` };
    netoServicio[e.servicios[i].id] = Number(neto);
  }

  return construirResumenCarrito({ unidades: e.unidades, servicios: e.servicios, modalidad: "neto", moneda: e.moneda, total: e.exigible, netoPorCupo, netoServicio });
}
