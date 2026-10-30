// ─────────────────────────────────────────────────────────────────────────
// PVP fijo de la clase «infante» del hotel, configurable por paquete (`armado_paquetes.pvp_infante_fijo`, en la moneda de publicación).
//
// «Infante» lo define el HOTEL (su rango de edad puede llegar a 5 años); la edad de vuelo/servicios (menor de 2) es otra cosa y por eso
// el precio tiene dos rutas ya existentes: `precio_pvp_menor2` (menor de 2) y `precio_pvp` de la fila infante (2 años o más).
//
// El PVP fijo REEMPLAZA el precio de venta completo de ese infante (hotel, servicios y asistencia incluidos) SOLO cuando no tiene
// ningún cargo positivo atribuible de vuelo ni de servicios. La asistencia NO cuenta como cargo para decidir. Un vuelo o servicio
// gratuito ($0) tampoco desactiva la regla. Si un servicio incluido por GRUPO podría cobrarle (los de 2+ años cuentan para el rango)
// no se puede asegurar que no haya cargo → fórmula normal. Los costos/CxP no pasan por aquí: salen de sus fuentes reales.
// Función pura, sin I/O ni alias `@/` (se importa directo desde `node --test`).
// ─────────────────────────────────────────────────────────────────────────

export type CargosInfante = {
  /** Cargo de venta del vuelo para ESTE infante: su fee (menor de 2) o el vuelo de adulto (2 años o más). */
  vuelo: number;
  /** Servicios incluidos por persona que le cobran (sin la categoría asistencia). */
  servicios: number;
  /** El paquete tiene algún servicio incluido por grupo. */
  grupoIncluido: boolean;
  menorDeDos: boolean;
};

/** Valor válido del campo: número finito ≥ 0 (0 es válido y distinto de «sin configurar» = null). */
export function pvpInfanteFijoValido(v: unknown): number | null {
  if (v == null || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) && n >= 0 ? n : null;
}

/** ¿El PVP fijo reemplaza el precio normal de este infante? */
export function aplicaPvpInfanteFijo(fijo: number | null | undefined, c: CargosInfante): boolean {
  if (pvpInfanteFijoValido(fijo) == null) return false;
  if (c.vuelo > 0 || c.servicios > 0) return false;
  // shortcut: un servicio por grupo solo se descarta para <2 años (no cuentan para el rango); para 2+ no se puede determinar el cargo → fórmula normal.
  return !(c.grupoIncluido && !c.menorDeDos);
}

/** Servicio OPCIONAL realmente seleccionado, con lo que cobra por persona (PVP, ya con markup y temporada). */
export type ServicioOpcionalSeleccionado = {
  categoria?: string | null;
  modo: "persona" | "grupo";
  personaPvp: number | null;
  /** Precio de infante (menor de 2 años); null = paga como adulto (NULL ≠ $0). */
  infantePvp: number | null;
};

/**
 * ¿Este servicio opcional le cobra un importe positivo al infante? La asistencia nunca cuenta. Por persona: el menor de 2 años paga su precio de
 * infante (o el de adulto si no lo configuró) y el de 2+ el de adulto. Por grupo: el menor de 2 no cuenta para el rango ni paga; el de 2+ sí
 * cuenta para el rango y no se puede asegurar que no se le cobre → se trata como cargo (fórmula normal).
 */
export function servicioOpcionalCobraInfante(s: ServicioOpcionalSeleccionado, menorDeDos: boolean): boolean {
  if (s.categoria === "asistencia") return false;
  if (s.modo === "grupo") return !menorDeDos;
  const cargo = menorDeDos ? (s.infantePvp ?? s.personaPvp ?? 0) : (s.personaPvp ?? 0);
  return cargo > 0;
}

/**
 * Precio final del infante en una ruta: `fijo` es el que trae el tarifario (ya con el PVP fijo si lo reemplazó); `normal` el que traería sin él
 * (null = el fijo no se aplicó, nada que decidir). Si algún servicio opcional seleccionado le cobra, vuelve a la fórmula normal COMPLETA; si todos
 * son gratuitos (o no hay), conserva el fijo. Nunca devuelve una suma de ambos.
 */
export function precioInfanteConServiciosOpcionales(
  fijo: number,
  normal: number | null | undefined,
  servicios: readonly ServicioOpcionalSeleccionado[],
  menorDeDos: boolean
): number {
  if (normal == null) return fijo;
  return servicios.some((s) => servicioOpcionalCobraInfante(s, menorDeDos)) ? normal : fijo;
}

/**
 * Un tour/receptivo del carrito vinculado a un hotel entra a la decisión del infante con su total cotizado: el carrito lo cobra por persona
 * (infantes incluidos, a tarifa de adulto), así que un total positivo es un cargo para el infante y uno de $0 no lo es.
 */
export const opcionalDeTourCarrito = (t: { categoria?: string | null; precio: number }): ServicioOpcionalSeleccionado =>
  ({ categoria: t.categoria ?? null, modo: "persona", personaPvp: t.precio, infantePvp: t.precio });
