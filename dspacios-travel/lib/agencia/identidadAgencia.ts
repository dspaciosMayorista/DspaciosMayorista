// #49 — Identidad fiscal de la agencia DUEÑA del documento, leída SOLO de la fila `agencias` de su tenant («Datos de la agencia»).
// Sin fallback: la constante `EMPRESA` de plantilla.ts es la identidad de MINORISTA (RNT/NIT/cuenta de esa agencia) y nunca debe sustituir a la de Mayorista.
// Razón social, NIT y RNT son obligatorios: fila ausente o alguno nulo/vacío/solo espacios → error explícito (el documento no se genera). Correo y datos
// bancarios son opcionales: si faltan se devuelven vacíos y el documento omite esa línea (nunca se imprime la cuenta de otra agencia).
import type { Agencia } from "@/types/database";

export type FilaAgencia = Partial<Pick<Agencia, "tenant" | "razon_social" | "nit" | "rnt" | "correo" | "banco" | "tipo_cuenta" | "numero_cuenta">>;

export type IdentidadAgencia = {
  razonSocial: string; nit: string; rnt: string; correo: string; banco: string; tipoCuenta: string; numeroCuenta: string;
};

const NOMBRE: Record<string, string> = { mayorista: "Mayorista", minorista: "Minorista" };
const limpio = (v: unknown) => (typeof v === "string" ? v.trim() : "");

/** Campos obligatorios que faltan en la fila (vacío = completa). */
export function camposFaltantesIdentidad(ag: FilaAgencia | null | undefined): string[] {
  const faltan: string[] = [];
  if (!limpio(ag?.razon_social)) faltan.push("razón social");
  if (!limpio(ag?.nit)) faltan.push("NIT");
  if (!limpio(ag?.rnt)) faltan.push("RNT");
  return faltan;
}

export function mensajeIdentidadIncompleta(tenant: string | null | undefined, faltan: string[]): string {
  const nombre = NOMBRE[tenant ?? ""] ?? "de la agencia";
  const que = faltan.length ? `falta ${faltan.join(", ")} en «Datos de la agencia»` : "no existe la fila de la agencia";
  return `No se pudo acreditar la identidad fiscal ${tenant ? `de ${nombre}` : nombre} para este documento (${que}). No se genera el documento para no imprimir la identidad de otra agencia.`;
}

export function identidadAgencia(ag: FilaAgencia | null | undefined, tenant?: string | null): IdentidadAgencia {
  const faltan = ag ? camposFaltantesIdentidad(ag) : [];
  if (!ag || faltan.length) throw new Error(mensajeIdentidadIncompleta(tenant ?? ag?.tenant, faltan));
  return {
    razonSocial: limpio(ag.razon_social), nit: limpio(ag.nit), rnt: limpio(ag.rnt), correo: limpio(ag.correo),
    banco: limpio(ag.banco), tipoCuenta: limpio(ag.tipo_cuenta), numeroCuenta: limpio(ag.numero_cuenta),
  };
}
