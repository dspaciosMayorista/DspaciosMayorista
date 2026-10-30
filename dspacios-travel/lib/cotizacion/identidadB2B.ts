// #102 (Preview #403) — Identidad comercial de una venta B2B asistida: reglas PURAS (sin I/O).
//
// En NETO el comprador es el ALIADO (agencia o freelance): su identidad fiscal sale SIEMPRE del catálogo `aliados` (nunca de texto que mande el
// navegador) y la persona cuyos datos se capturan es el «Titular de la reserva», que se conserva APARTE (`titular_*`; el detalle completo sigue
// en `payload.cliente`). En PVP con comisión y en B2C el cliente sigue siendo la persona, como siempre.
import type { ModoCompra } from "@/lib/reservar/comisionReserva";
import { tipoDocumentoParaVenta } from "../personas/tiposDocumento.ts";

const limpio = (v: unknown): string | null => {
  if (typeof v !== "string") return null;
  const t = v.trim();
  return t ? t : null;
};

/** Identidad fiscal y de contacto de un aliado, tal como está en el catálogo. */
export type FiscalAliado = {
  nombre: string;
  /** Número de documento (NIT o cédula) sin el tipo. */
  documento: string | null;
  tipoDocumento: string | null;
  telefono: string | null;
  email: string | null;
  direccion: string | null;
};

export type FilaFiscalAliado = {
  nombre?: string | null; nit?: string | null; tipo_documento?: string | null; telefono?: string | null; email?: string | null; direccion?: string | null;
};

export function fiscalDeFilaAliado(fila: FilaFiscalAliado | null | undefined): FiscalAliado {
  return {
    nombre: limpio(fila?.nombre) ?? "",
    documento: limpio(fila?.nit),
    tipoDocumento: limpio(fila?.tipo_documento),
    telefono: limpio(fila?.telefono),
    email: limpio(fila?.email),
    direccion: limpio(fila?.direccion),
  };
}

/** Persona que viaja / contrata, como la capturó el checkout (`payload.cliente`). */
export type ClienteCaptura = { nombres?: string | null; apellidos?: string | null; numeroDoc?: string | null; tipoDoc?: string | null; telefono?: string | null; email?: string | null };

export type TitularReserva = { nombre: string; documento: string | null; tipoDocumento: string | null; telefono: string | null; email: string | null };

export function titularDeCliente(c: ClienteCaptura | null | undefined): TitularReserva {
  return {
    nombre: `${limpio(c?.nombres) ?? ""} ${limpio(c?.apellidos) ?? ""}`.trim(),
    documento: limpio(c?.numeroDoc),
    tipoDocumento: tipoDocumentoParaVenta(c?.tipoDoc, c?.numeroDoc),
    telefono: limpio(c?.telefono),
    email: limpio(c?.email),
  };
}

/** Columnas de cliente y titular que reciben `ventas` (y el snapshot de la cotización). */
export type CamposCliente = {
  cliente: string;
  cliente_documento: string | null;
  /** #40 E2: tipo del documento de `cliente_documento` (en NETO, el del ALIADO; nunca el del titular). */
  cliente_tipo_documento: string | null;
  cliente_telefono: string | null;
  cliente_email: string | null;
  cliente_direccion: string | null;
  titular_nombre: string | null;
  titular_documento: string | null;
  titular_tipo_documento: string | null;
  titular_telefono: string | null;
  titular_email: string | null;
};

/**
 * NETO ⇒ cliente = aliado (identidad del catálogo) y titular = la persona. Cualquier otro caso (B2C, PVP con comisión) ⇒ cliente = la persona y
 * sin titular aparte. `modo` ausente = no es una venta asistida.
 */
export function camposClienteVenta(args: { modo: ModoCompra | null | undefined; fiscal: FiscalAliado | null | undefined; titular: TitularReserva }): CamposCliente {
  const { modo, fiscal, titular } = args;
  if (modo === "neta" && fiscal && fiscal.nombre) {
    return {
      cliente: fiscal.nombre,
      cliente_documento: fiscal.documento,
      cliente_tipo_documento: tipoDocumentoParaVenta(fiscal.tipoDocumento, fiscal.documento),
      cliente_telefono: fiscal.telefono,
      cliente_email: fiscal.email,
      cliente_direccion: fiscal.direccion,
      titular_nombre: titular.nombre || null,
      titular_documento: titular.documento,
      titular_tipo_documento: titular.tipoDocumento,
      titular_telefono: titular.telefono,
      titular_email: titular.email,
    };
  }
  return {
    cliente: titular.nombre,
    cliente_documento: titular.documento,
    cliente_tipo_documento: titular.tipoDocumento,
    cliente_telefono: titular.telefono,
    cliente_email: titular.email,
    cliente_direccion: null,
    titular_nombre: null, titular_documento: null, titular_tipo_documento: null, titular_telefono: null, titular_email: null,
  };
}

/** Nombre del aliado según su tipo, en las columnas que leen las firmas del documento. */
export function camposVendedorAliado(aliado: { nombre: string; tipo: "agencia" | "freelance" } | null | undefined):
  { tipo_asesor: "agencia" | "freelance"; agencia_nombre: string | null; freelance_nombre: string | null } | null {
  const nombre = limpio(aliado?.nombre);
  if (!aliado || !nombre) return null;
  return { tipo_asesor: aliado.tipo, agencia_nombre: aliado.tipo === "agencia" ? nombre : null, freelance_nombre: aliado.tipo === "freelance" ? nombre : null };
}

/**
 * Nombre de quien elabora: el asesor elegido en pantalla si lo hay; si no, el usuario interno autenticado. Nunca se inventa: sin ninguno de los dos
 * devuelve null (el documento muestra «—»).
 */
export function nombreQuienElabora(elegido: string | null | undefined, usuarioSesion: string | null | undefined): string | null {
  return limpio(elegido) ?? limpio(usuarioSesion);
}

// ── Listado de cotizaciones ──────────────────────────────────────────────────

export type ValorListado =
  | { etiqueta: "NETO" | "PVP" | null; valor: number; moneda: string; revisar?: undefined }
  /** NETO sin total exigible congelado válido: no se muestra ningún importe (ni el PVP, que no es lo que se cobra). */
  | { etiqueta: null; valor: null; moneda: string; revisar: true };

/**
 * Qué importe y qué indicación lleva una fila del listado. NETO ⇒ el total exigible congelado; PVP con comisión ⇒ el PVP. Sin modalidad
 * (cotización histórica o B2C) ⇒ el precio guardado, SIN etiqueta (no se afirma NETO ni PVP de lo que no se sabe). Marcada NETO pero sin total
 * exigible válido ⇒ `revisar`: el PVP no es lo que se cobra en NETO, así que no se muestra ningún importe.
 */
export function valorParaListado(args: { modo?: string | null; precioVenta?: number | string | null; totalExigible?: number | string | null; moneda?: string | null }): ValorListado {
  const moneda = args.moneda || "COP";
  const precio = Number(args.precioVenta ?? 0);
  const precioOk = Number.isFinite(precio) ? precio : 0;
  const exigible = args.totalExigible == null || args.totalExigible === "" ? NaN : Number(args.totalExigible);
  if (args.modo === "neta") {
    if (Number.isFinite(exigible) && exigible > 0) return { etiqueta: "NETO", valor: exigible, moneda };
    return { etiqueta: null, valor: null, moneda, revisar: true };
  }
  if (args.modo === "comisionable") return { etiqueta: "PVP", valor: precioOk, moneda };
  return { etiqueta: null, valor: precioOk, moneda };
}
