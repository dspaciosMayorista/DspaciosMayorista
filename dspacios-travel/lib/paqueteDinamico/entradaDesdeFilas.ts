// Filas de la base (paquete_din + hijos) → entrada del editor del paquete dinámico. PURO. Lo comparten la edición (`total/[id]`) y la DUPLICACIÓN (#61, `total/nuevo?copiarDe=`).
import type { EntradaPaqueteTotal } from "@/lib/paqueteDinamico/entrada";

type Fila = Record<string, unknown>;
const str = (x: unknown) => (x == null ? "" : String(x));

export function entradaDesdeFilas(p: Fila, vuelos: Fila[], hoteles: Fila[], servicios: Fila[], pid?: number): EntradaPaqueteTotal {
  return {
    id: pid, nombre: str(p.nombre), destinoId: (p.destino_id as number | null) ?? null, multidestino: p.multidestino === true, destinosExtra: (p.destinos_extra as number[]) ?? [],
    moneda: p.moneda === "USD" ? "USD" : "COP", esquema: p.esquema === "solo_pvp" ? "solo_pvp" : "neta_markup", pvpModo: (p.pvp_modo as "general" | "por_componente" | null) ?? null,
    pctMkPct: Math.round(Number(p.pct_mk) * 100 * 1e4) / 1e4, usaVuelo: p.usa_vuelo === true, usaHotel: p.usa_hotel === true, usaServicios: p.usa_servicios === true,
    noches: Number(p.noches) || 3, compraInicio: str(p.compra_inicio), compraFin: str(p.compra_fin), viajeInicio: str(p.viaje_inicio), viajeFin: str(p.viaje_fin),
    pvpGeneral: (p.pvp_general as EntradaPaqueteTotal["pvpGeneral"]) ?? null, totalDeclarado: (p.total_declarado as EntradaPaqueteTotal["totalDeclarado"]) ?? null,
    descripcion: str(p.descripcion), incluye: str(p.incluye), noIncluye: str(p.no_incluye),
    vuelos: vuelos.map((x) => ({ empaquetadoId: (x.empaquetado_id as number | null) ?? null, destinoId: (x.destino_id as number | null) ?? null, aerolinea: str(x.aerolinea), ruta: str(x.ruta), origenIata: str(x.origen_iata), destinoIata: str(x.destino_iata), fechaIda: str(x.fecha_ida), fechaRegreso: str(x.fecha_regreso), proveedor: str(x.proveedor), neto: (x.neto as object) ?? {}, pvp: (x.pvp as object) ?? {} })),
    hoteles: hoteles.map((x) => ({ hotelId: (x.hotel_id as number | null) ?? null, nombre: str(x.nombre), categoria: str(x.categoria), regimen: str(x.regimen), descripcion: str(x.descripcion), fotoUrl: str(x.foto_url), estrellas: x.estrellas == null ? null : Number(x.estrellas), ubicacion: str(x.ubicacion), proveedor: str(x.proveedor), neto: (x.neto as object) ?? {}, pvp: (x.pvp as object) ?? {}, pvpGeneral: (x.pvp_general as object | null) ?? null, capacidadNinos: x.capacidad_ninos == null ? null : Number(x.capacidad_ninos), edadInfanteMax: x.edad_infante_max == null ? null : Number(x.edad_infante_max), edadNinoMax: x.edad_nino_max == null ? null : Number(x.edad_nino_max) })),
    servicios: servicios.map((x) => ({ servicioId: (x.servicio_id as number | null) ?? null, destinoId: (x.destino_id as number | null) ?? null, nombre: str(x.nombre), proveedor: str(x.proveedor), proveedorId: (x.proveedor_id as number | null) ?? null, neto: x.neto == null ? null : Number(x.neto), pvp: x.pvp == null ? null : Number(x.pvp), pvpInfante: x.pvp_infante == null ? null : Number(x.pvp_infante) })),
  };
}

/**
 * B95-5: una lectura que FALLÓ no es una lista vacía. Si alguna de las lecturas de la fuente (cabecera o hijos) devolvió error, el paquete leído está incompleto y NO debe presentarse
 * (ni como copia ni como edición): quien llama muestra el fallo en vez de «copiado». PURO.
 */
export function lecturaFuenteConError(...lecturas: ({ error?: unknown } | null | undefined)[]): boolean {
  return lecturas.some((l) => l == null || (l.error != null && l.error !== false));
}

/** Copia para guardar como paquete NUEVO (#61): sin identidad (el guardado inserta), nombre «(copia)». La publicación no es parte de la entrada: la base la deja en «no publicado». */
export function entradaParaCopia(origen: EntradaPaqueteTotal): EntradaPaqueteTotal {
  const base = origen.nombre.trim();
  return { ...origen, id: undefined, nombre: base ? `${base} (copia)` : "Copia" };
}
