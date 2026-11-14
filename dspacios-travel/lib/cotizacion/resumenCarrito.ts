// ─────────────────────────────────────────────────────────────────────────
// Resumen de precios de una cotización del CARRITO (#94/#52) — lógica PURA. Construye `ResumenPrecios` solo con lo que el servidor ya liquidó al cotizar
// (tarifas por persona y por menor de cada hotel; precio y pasajeros de cada servicio); no lee tarifas vigentes ni reparte nada que no esté declarado:
//   · un servicio SIEMPRE pertenece a un hotel declarado (`hotelRef`): nunca se asigna por ser «el único hotel». Sin hotel → motivo explícito;
//   · cubre a TODOS los pasajeros de su hotel solo si su `pax` es el de ese hotel; si cubre a menos y no trae cupos elegidos (`cubre`), no hay reparto
//     verificable → motivo explícito y NO se genera resumen (el caso queda PENDIENTE de captura, no resuelto);
//   · los cupos tienen identidad ESTABLE `clave#ordinal` (`cuposEstables.ts`); el servidor solo acepta ordinales cuya cantidad coincide con lo liquidado;
//   · el servicio incluido por grupo del hotel solo se reparte si no hay infantes (con infantes no se sabe a cuántos cubrió el cobro por grupo).
// ─────────────────────────────────────────────────────────────────────────
import { resumenCotizacion, resumenUnidad, type ResumenPrecios, type ServicioCobertura, type TipoCupo, type UnidadResumen } from "./resumenPrecios.ts";

/** Clase de pasajero con su tarifa, tal como la liquidó el motor. `clave` identifica el grupo de tarifa dentro del hotel (`adulto:doble`, `nino:25000000`…). */
export type PersonaBase = { clave: string; etiqueta: string; tipo: TipoCupo; cantidad: number; tarifa: number };

export type UnidadBase = {
  ref: string;
  paquete: { id: number | null; nombre: string | null };
  hotel: string | null;
  categoria: string | null;
  regimen: string | null;
  /** Pasajeros del hotel (incluye menores e infantes). */
  paxTotal: number;
  infantes: number;
  /** Tarifa por persona de cada clase de pasajero (unidades de moneda, no centavos). */
  personas: PersonaBase[];
  /** Ordinales ACTIVOS por clave, enviados por el carrito (identidad estable). Ausente = 1..n, solo válido si ningún servicio trae `cubre`. */
  cuposActivos?: Record<string, number[]> | null;
  /** Importe del servicio incluido por grupo (parte del precio del hotel que no está en las tarifas por persona). */
  grupoIncluido: number;
};

export type ServicioEntrada = {
  id: string;
  nombre: string;
  precio: number;
  pax: number;
  hotelRef: string | null;
  /** Cupos elegidos (`clave#ordinal`). Ausente = cubre a todos solo si `pax` es el del hotel. */
  cubre?: readonly string[] | null;
};

/** Lo único que el navegador necesita para elegir cupos: clave, tipo, etiqueta y cantidad. Sin tarifas ni netos. */
export type CupoPublico = { clave: string; tipo: TipoCupo; etiqueta: string; cantidad: number };

const cent = (n: number) => Math.round(n * 100);

/** Une las líneas de una misma clave (misma tarifa) y rechaza una clave con dos tarifas: no habría un cupo único. */
export function cuposDeUnidad(personas: readonly PersonaBase[]): { ok: true; cupos: (CupoPublico & { tarifa: number })[] } | { ok: false; error: string } {
  const por = new Map<string, CupoPublico & { tarifa: number }>();
  for (const p of personas) {
    if (!(p.cantidad > 0)) continue;
    const previo = por.get(p.clave);
    if (previo) {
      if (cent(previo.tarifa) !== cent(p.tarifa)) return { ok: false, error: `«${p.etiqueta}» tiene dos tarifas distintas en el mismo hotel; no se puede identificar a cada pasajero.` };
      previo.cantidad += p.cantidad;
    } else por.set(p.clave, { clave: p.clave, tipo: p.tipo, etiqueta: p.etiqueta, cantidad: p.cantidad, tarifa: p.tarifa });
  }
  return { ok: true, cupos: [...por.values()] };
}

/**
 * `rechazar: true` marca los fallos de la COBERTURA declarada (parcial sin selección, cantidad incorrecta, pasajeros inexistentes, repetidos o desfasados): en la
 * cotización normal soportada la emisión se rechaza, no se degrada a «pendiente». El resto de motivos (cuadre, infantes con servicio por grupo…) son «pendiente».
 */
export type ResultadoResumenCarrito = { ok: true; resumen: ResumenPrecios } | { ok: false; motivo: string; rechazar?: boolean };

export function construirResumenCarrito(e: {
  unidades: readonly UnidadBase[];
  servicios: readonly ServicioEntrada[];
  modalidad: "pvp" | "neto";
  moneda: string;
  total: number;
  /** #14-A: recobro de cada unidad (unidades de moneda). Va DENTRO de la tarifa de adulto como un servicio oculto que cubre a sus adultos: se reparte por igual y el residuo queda dentro de las tarifas de algunos adultos (sin línea de ajuste). `total` ya lo incluye. */
  recobroPorUnidad?: Readonly<Record<string, number>>;
  /**
   * #14-A (NETO): tarifa NETO de cada pasajero (centavos), ya calculada con la regla aprobada, por `${ref}|${clave}|${posición}` (posición = orden del pasajero dentro de su clase en la unidad).
   * Con esto el resumen NO usa las tarifas PVP: cada cupo parte de su NETO. Una clave ausente se rechaza (nunca se mezcla PVP con NETO).
   */
  netoPorCupo?: Readonly<Record<string, number>>;
  /** #14-A (NETO): importe NETO de cada servicio (centavos) por id. Obligatorio para cada servicio cuando hay `netoPorCupo`. */
  netoServicio?: Readonly<Record<string, number>>;
}): ResultadoResumenCarrito {
  if (!e.unidades.length) return { ok: false, motivo: "La cotización no tiene hoteles con tarifa por persona." };
  const porUnidad = new Map<string, ServicioCobertura[]>(e.unidades.map((u) => [u.ref, []]));
  for (const s of e.servicios) {
    const unidad = s.hotelRef ? e.unidades.find((u) => u.ref === s.hotelRef) : undefined;
    if (!unidad) {
      // Nunca se asigna por ser el único hotel; pero un servicio que cubre a menos pasajeros que ese hotel único sin decir a cuáles tampoco se emite.
      const unico = e.unidades.length === 1 ? e.unidades[0] : null;
      if (unico && s.pax < unico.paxTotal) return { ok: false, rechazar: true, motivo: `«${s.nombre}» cubre ${s.pax} de los ${unico.paxTotal} pasajeros de ${unico.hotel ?? "el hotel"}: selecciona los pasajeros cubiertos.` };
      return { ok: false, motivo: `«${s.nombre}» no está asignado a un hotel de la cotización: elige a cuál pertenece.` };
    }
    const parcial = s.pax < unidad.paxTotal;
    const elegidos = s.cubre && s.cubre.length ? [...s.cubre] : null;
    if (parcial && !elegidos) return { ok: false, rechazar: true, motivo: `«${s.nombre}» cubre ${s.pax} de los ${unidad.paxTotal} pasajeros de ${unidad.hotel ?? "el hotel"}: selecciona los pasajeros cubiertos.` };
    const cubre = elegidos ?? (s.pax === unidad.paxTotal ? ("todos" as const) : null);
    if (!cubre) return { ok: false, motivo: `«${s.nombre}» cubre ${s.pax} de los ${unidad.paxTotal} pasajeros de ${unidad.hotel ?? "el hotel"}.` };
    if (Array.isArray(cubre) && cubre.length !== s.pax) return { ok: false, rechazar: true, motivo: `«${s.nombre}» cubre ${s.pax} pasajeros y se seleccionaron ${cubre.length}: corrige la selección.` };
    let precioServicio = cent(s.precio);
    if (e.netoPorCupo) {
      const n = e.netoServicio?.[s.id];
      if (n === undefined || !Number.isSafeInteger(n) || n < 0) return { ok: false, motivo: `«${s.nombre}» no tiene un importe NETO calculado: el detalle por pasajero en NETO no se genera.` };
      precioServicio = n;
    }
    porUnidad.get(unidad.ref)!.push({ id: s.id, nombre: s.nombre, modo: "total", precioCentavos: precioServicio, cubre });
  }
  const unidades: UnidadResumen[] = [];
  for (const u of e.unidades) {
    const agrupado = cuposDeUnidad(u.personas);
    if (!agrupado.ok) return { ok: false, motivo: agrupado.error };
    if (agrupado.cupos.reduce((n, c) => n + c.cantidad, 0) !== u.paxTotal) return { ok: false, motivo: `No se pudo identificar a todos los pasajeros de ${u.hotel ?? "el hotel"}; no se reparte por pasajero.` };
    const servicios = [...(porUnidad.get(u.ref) ?? [])];
    // La identidad de los pasajeros solo importa cuando un servicio elige a quiénes cubre; con cobertura total no se exige ni se valida.
    const usaSeleccion = servicios.some((x) => x.cubre !== "todos");
    const cupos = [];
    for (const c of agrupado.cupos) {
      const ordinales = usaSeleccion ? u.cuposActivos?.[c.clave] : undefined;
      if (usaSeleccion) {
        if (!ordinales) return { ok: false, rechazar: true, motivo: `Falta la identidad de los pasajeros de ${u.hotel ?? "el hotel"} (${c.etiqueta}): vuelve a seleccionar los pasajeros que cubre cada servicio.` };
        if (ordinales.length !== c.cantidad || new Set(ordinales).size !== ordinales.length || ordinales.some((n) => !Number.isSafeInteger(n) || n < 1)) {
          return { ok: false, rechazar: true, motivo: `Los pasajeros de ${u.hotel ?? "el hotel"} cambiaron (${c.etiqueta}): vuelve a seleccionar los pasajeros que cubre cada servicio.` };
        }
      }
      let posicion = 0;
      for (const n of ordinales ?? Array.from({ length: c.cantidad }, (_, i) => i + 1)) {
        let base = cent(c.tarifa);
        if (e.netoPorCupo) {
          const neto = e.netoPorCupo[`${u.ref}|${c.clave}|${posicion}`];
          if (neto === undefined || !Number.isSafeInteger(neto) || neto < 0) return { ok: false, motivo: `No hay tarifa NETO para un pasajero de ${u.hotel ?? "el hotel"} (${c.etiqueta}); no se genera el detalle por pasajero.` };
          base = neto;
        }
        posicion++;
        cupos.push({ id: `${c.clave}#${n}`, tipo: c.tipo, baseCentavos: base });
      }
    }
    if (usaSeleccion) {
      // Ordinales activos de una clave que ya no existe: el carrito quedó desfasado → se rechaza, no se ignora.
      for (const clave of Object.keys(u.cuposActivos ?? {})) {
        if (!agrupado.cupos.some((c) => c.clave === clave) && (u.cuposActivos?.[clave]?.length ?? 0) > 0) {
          return { ok: false, rechazar: true, motivo: `Los pasajeros de ${u.hotel ?? "el hotel"} cambiaron: vuelve a seleccionar los pasajeros que cubre cada servicio.` };
        }
      }
      const vivos = new Set(cupos.map((c) => c.id));
      for (const x of servicios) {
        if (x.cubre === "todos") continue;
        if (new Set(x.cubre).size !== x.cubre.length) return { ok: false, rechazar: true, motivo: `«${x.nombre}» repite un pasajero en su selección.` };
        if (x.cubre.some((id) => !vivos.has(id))) return { ok: false, rechazar: true, motivo: `«${x.nombre}» cubre un pasajero que no existe en la cotización. Vuelve a seleccionar los pasajeros cubiertos.` };
      }
    }
    const recobroUnidad = e.recobroPorUnidad?.[u.ref] ?? 0;
    if (recobroUnidad > 0) {
      const adultos = cupos.filter((c) => c.tipo === "adulto").map((c) => c.id);
      if (!adultos.length) return { ok: false, motivo: `${u.hotel ?? "El hotel"} no tiene adultos a quienes cargar el recobro.` };
      servicios.push({ id: `oculto:${u.ref}`, nombre: "", modo: "total", precioCentavos: cent(recobroUnidad), cubre: adultos, oculto: true });
    }
    if (u.grupoIncluido > 0) {
      if (e.netoPorCupo) return { ok: false, motivo: `${u.hotel ?? "El hotel"} tiene un servicio incluido por grupo: en NETO no hay una regla aprobada para repartirlo por pasajero.` };
      if (u.infantes > 0) return { ok: false, motivo: `${u.hotel ?? "El hotel"} tiene un servicio incluido por grupo y viajan infantes: no se puede repartir por pasajero.` };
      servicios.push({ id: `grupo:${u.ref}`, nombre: "Servicios incluidos del paquete", modo: "total", precioCentavos: cent(u.grupoIncluido), cubre: "todos" });
    }
    const r = resumenUnidad({ ref: u.ref, paquete: u.paquete, hotel: u.hotel, categoria: u.categoria, regimen: u.regimen, cupos, servicios });
    if (!r.ok) return { ok: false, motivo: r.error };
    unidades.push(r.valor);
  }
  const resumen = resumenCotizacion({ modalidad: e.modalidad, moneda: e.moneda, unidades });
  if (resumen.totalCentavos !== cent(e.total)) return { ok: false, motivo: "El resumen por pasajero no cuadra con el total de la cotización; no se genera." };
  return { ok: true, resumen };
}
