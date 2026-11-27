// #18: voucher de servicio aéreo. Se arma SOLO con lo que está guardado en `contrato_vuelos` y `contrato_pasajeros`; lo que falta se muestra como «No registrado»,
// nunca se infiere ni se completa. Decisiones del dueño aún ABIERTAS (no se inventan aquí):
// Política aprobada por el dueño (ADL-041, 2026-11-23):
//   · PNR: se muestra el PNR GUARDADO en el voucher aéreo PAGADO (contrato 100 % pagado; lo decide la página al abrirlo). Su ausencia nunca impide generar. El contrato al cliente NO lo muestra.
//   · UN voucher por contrato Y POR SERVICIO CONTRATADO (nunca por pasajero). ADL-042: el PNR NO define el servicio. Servicio = los tramos que comparten `contrato_vuelos.servicio_aereo` (asociación GUARDADA);
//     la clave del voucher es ese uuid. Ida y regreso con PNR distintos pueden ser UN servicio; dos servicios con el mismo PNR (o sin PNR) siguen siendo dos. Un tramo sin servicio asociado NO se adivina:
//     se rechaza la generación hasta que se asocie en el editor de vuelos. El PNR guardado de cada tramo se muestra en ESE tramo.
//   · ¿qué tramo corresponde a qué pasajero? → no existe vínculo guardado: el voucher lista pasajeros y tramos por separado y NO afirma que cada pasajero viaje todos los tramos (Codex F4).
import { formatHora24 } from "@/lib/utils";

export const NO_REGISTRADO = "No registrado";

// Rev2 B1-05/B1-06: textos ÚNICOS de la limitación «no hay pasajero↔tramo» (los renderiza el documento para CUALQUIER visitante: interno o aliado, en pantalla e impresión).
export const NOTA_PASAJEROS_TRAMOS = "Pasajeros y tramos se listan por separado: no hay registrada una asignación de pasajero a tramo.";
export const avisoVariosServiciosAereos = (n: number) =>
  `Esta reserva tiene ${n} servicios aéreos. El sistema no registra qué pasajero viaja en cada vuelo: la lista de pasajeros corresponde a toda la reserva, no a este vuelo en particular. No se debe entender que todos los pasajeros viajan en todos los vuelos.`;

export type TramoVoucherVuelo = {
  tipo: "Ida" | "Regreso" | "Tramo";
  aerolinea: string;
  numeroVuelo: string;
  origen: string;
  destino: string;
  fecha: string; // ISO o «No registrado»
  horaSalida: string;
  horaLlegada: string;
  equipaje: string;
  /** PNR guardado de ESTE tramo (ausente = no hay PNR guardado). Solo se MUESTRA con el contrato 100 % pagado: la página lo quita si no (ver sinPnr). */
  pnr?: string;
};

export type VoucherVueloContenido = {
  clase: "vuelo";
  emision: string;
  nReserva: string;
  vendedor: string;
  elaboradoPor: string;
  contactoEmpresa: string;
  titular: string;
  /** Nombres de los pasajeros del CONTRATO (sin vínculo a un tramo concreto). */
  pasajeros: string[];
  tramos: TramoVoucherVuelo[];
  /** Una línea por dato ausente de cada tramo (para mostrarlo explícito). */
  datosFaltantes: string[];
};

export type FilaVueloBasica = {
  id: number; record: string | null; /** ADL-042: servicio aéreo guardado al que pertenece el tramo (null = sin asociar). */ servicio_aereo: string | null;
  aerolinea: string | null; direccion: string | null; origen_codigo: string | null; origen_ciudad: string | null;
  destino_codigo: string | null; destino_ciudad: string | null; numero_vuelo: string | null; fecha_salida: string | null;
  hora_salida: string | null; hora_llegada: string | null; servicios: string | null; orden: number | null;
  // Filas anteriores a la 135 (ida y regreso en una sola fila).
  vuelo_ida: string | null; vuelo_regreso: string | null; hora_salida_ida: string | null; hora_llegada_ida: string | null;
  hora_salida_reg: string | null; hora_llegada_reg: string | null; fecha_regreso: string | null;
};

export function esVoucherVuelo(c: unknown): c is VoucherVueloContenido {
  return !!c && typeof c === "object" && (c as { clase?: unknown }).clase === "vuelo";
}

const txt = (v: string | null | undefined) => (v ?? "").trim();
const normPnr = (r: string | null | undefined) => txt(r).toUpperCase();
const lugar = (codigo: string | null, ciudad: string | null) => {
  const c = txt(codigo), n = txt(ciudad);
  return c && n ? `${n} (${c})` : c || n || "";
};
const hora = (h: string | null) => formatHora24(h) ?? "";

/** Una fila de `contrato_vuelos` → uno o dos tramos (las filas viejas traen ida+regreso juntos). */
export function tramosDeFila(f: FilaVueloBasica): { tramo: TramoVoucherVuelo; faltantes: string[] }[] {
  const base = { aerolinea: txt(f.aerolinea), equipaje: txt(f.servicios) };
  const pnr = normPnr(f.record);
  const armar = (tipo: TramoVoucherVuelo["tipo"], o: { numeroVuelo: string; origen: string; destino: string; fecha: string; horaSalida: string; horaLlegada: string }) => {
    const campos: [string, string][] = [["aerolínea", base.aerolinea], ["número de vuelo", o.numeroVuelo], ["origen", o.origen], ["destino", o.destino], ["fecha", o.fecha], ["hora de salida", o.horaSalida], ["hora de llegada", o.horaLlegada]];
    const faltantes = campos.filter(([, v]) => !v).map(([k]) => k);
    const v = (s: string) => s || NO_REGISTRADO;
    const tramo: TramoVoucherVuelo = {
      tipo, aerolinea: v(base.aerolinea), numeroVuelo: v(o.numeroVuelo), origen: v(o.origen), destino: v(o.destino), fecha: v(o.fecha),
      horaSalida: v(o.horaSalida), horaLlegada: v(o.horaLlegada), equipaje: v(base.equipaje), ...(pnr ? { pnr } : {}),
    };
    return { tramo, faltantes };
  };
  const esLegacyDoble = !txt(f.numero_vuelo) && !txt(f.hora_salida) && !!(f.vuelo_ida || f.vuelo_regreso || f.hora_salida_ida || f.hora_salida_reg);
  const o = lugar(f.origen_codigo, f.origen_ciudad), d = lugar(f.destino_codigo, f.destino_ciudad);
  // RC-2: el regreso heredado (columnas vuelo_regreso/…_reg/fecha_regreso) es dato GUARDADO. El editor operativo solo escribe los campos modernos del tramo de ida y nunca toca esas columnas,
  // así que editar solo la ida (que llena numero_vuelo/hora_salida) NO debe hacer desaparecer el regreso del itinerario emitido.
  const regresoHeredado = (!!f.fecha_regreso || !!f.vuelo_regreso || !!f.hora_salida_reg || !!f.hora_llegada_reg)
    ? [armar("Regreso", { numeroVuelo: txt(f.vuelo_regreso), origen: d, destino: o, fecha: txt(f.fecha_regreso), horaSalida: hora(f.hora_salida_reg), horaLlegada: hora(f.hora_llegada_reg) })] : [];
  if (esLegacyDoble) {
    return [armar("Ida", { numeroVuelo: txt(f.vuelo_ida), origen: o, destino: d, fecha: txt(f.fecha_salida), horaSalida: hora(f.hora_salida_ida), horaLlegada: hora(f.hora_llegada_ida) }), ...regresoHeredado];
  }
  const tipo = f.direccion === "ida" ? "Ida" : f.direccion === "regreso" ? "Regreso" : "Tramo";
  return [armar(tipo, { numeroVuelo: txt(f.numero_vuelo), origen: o, destino: d, fecha: txt(f.fecha_salida), horaSalida: hora(f.hora_salida), horaLlegada: hora(f.hora_llegada) }), ...regresoHeredado];
}

export type ServicioAereo = { clave: string; filas: FilaVueloBasica[] };

/** Agrupa los tramos por el servicio GUARDADO (`servicio_aereo`). No mira PNR, orden, id ni nombres. Los tramos sin servicio no se asignan: se devuelven aparte (`sinAsociar`). */
export function agruparServiciosAereos(filas: FilaVueloBasica[]): { servicios: ServicioAereo[]; sinAsociar: FilaVueloBasica[] } {
  const grupos = new Map<string, FilaVueloBasica[]>();
  const sinAsociar: FilaVueloBasica[] = [];
  for (const f of filas) {
    const k = txt(f.servicio_aereo).toLowerCase();
    if (!k) { sinAsociar.push(f); continue; }
    grupos.set(k, [...(grupos.get(k) ?? []), f]);
  }
  // Orden de presentación (no de identidad): por el menor `orden` de sus tramos, luego por la clave.
  const servicios = [...grupos.entries()].map(([clave, fs]) => ({ clave, filas: fs }))
    .sort((a, b) => Math.min(...a.filas.map((f) => f.orden ?? 0)) - Math.min(...b.filas.map((f) => f.orden ?? 0)) || a.clave.localeCompare(b.clave));
  return { servicios, sinAsociar };
}

/** El voucher sin PNR (antes de pagar o para quien no debe verlo): copia sin el campo, de modo que el dato ni siquiera viaje a la página. */
export function sinPnr(c: VoucherVueloContenido): VoucherVueloContenido {
  const { pnr: _legado, ...resto } = c as VoucherVueloContenido & { pnr?: string };
  return { ...resto, tramos: c.tramos.map(({ pnr: _p, ...t }) => t) };
}

/** ¿Algún tramo del voucher trae un PNR guardado? (también el campo `pnr` de nivel servicio de la primera versión de la 338, solo en bases desechables). */
export function tienePnr(c: VoucherVueloContenido): boolean { return c.tramos.some((t) => !!t.pnr) || !!(c as VoucherVueloContenido & { pnr?: string }).pnr; }

/** `null` = el contrato no tiene ningún tramo guardado: no se emite un voucher vacío. */
export function construirVoucherVuelo(p: {
  filas: FilaVueloBasica[]; pasajeros: string[]; titular: string; nReserva: string; vendedor: string; emision: string;
}): VoucherVueloContenido | null {
  const orden = [...p.filas].sort((a, b) => (a.orden ?? 0) - (b.orden ?? 0));
  const out = orden.flatMap(tramosDeFila);
  if (!out.length) return null;
  const datosFaltantes = out.flatMap((x, i) => x.faltantes.map((k) => `Tramo ${i + 1} (${x.tramo.tipo.toLowerCase()}): ${k}`));
  return {
    clase: "vuelo", emision: p.emision, nReserva: p.nReserva, vendedor: p.vendedor, elaboradoPor: "ÁREA DE RESERVAS", contactoEmpresa: "(+57) 321-2094015",
    titular: p.titular, pasajeros: p.pasajeros.map((n) => n.trim()).filter(Boolean), tramos: out.map((x) => x.tramo), datosFaltantes,
  };
}

/** Un voucher por SERVICIO CONTRATADO guardado (ADL-041/042). `tramos` = ids de los tramos del servicio (el servidor los compara con lo guardado). `sinAsociar` = ids de tramos sin servicio: quien llama debe rechazar la generación. */
export function construirVouchersVuelo(p: {
  filas: FilaVueloBasica[]; pasajeros: string[]; titular: string; nReserva: string; vendedor: string; emision: string;
}): { servicios: { clave: string; tramos: number[]; contenido: VoucherVueloContenido }[]; sinAsociar: number[] } {
  const { servicios: grupos, sinAsociar } = agruparServiciosAereos(p.filas);
  const servicios = grupos.flatMap((g) => {
    const contenido = construirVoucherVuelo({ ...p, filas: g.filas });
    return contenido ? [{ clave: g.clave, tramos: g.filas.map((f) => f.id).sort((a, b) => a - b), contenido }] : [];
  });
  return { servicios, sinAsociar: sinAsociar.map((f) => f.id).sort((a, b) => a - b) };
}
