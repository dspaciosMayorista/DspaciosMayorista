"use server";

import { createClient } from "@/lib/supabase/server";
import { revalidatePath } from "next/cache";
import { postearAsiento, reversarYRegistrar, anticipoNetoDeContrato, CUENTA } from "@/lib/contabilidad/asientos";

type Result = { ok: true } | { ok: false; error: string };

// Asiento de facturación: reconoce el PVP completo contra Clientes, separa el
// IRT (pasivo — plata de terceros, NO es ingreso propio) del ingreso propio de
// la agencia, y aplica contra Clientes el anticipo NETO que ya se hubiera
// acumulado de abonos previos a la factura (Debe Anticipos / Haber Clientes)
// — así, si el contrato ya estaba 100% pagado por adelantado, Clientes y
// Anticipos quedan ambos en $0 para ese contrato. Usa REVERSIÓN (no
// reemplazo): esta factura puede haberse presentado a la DIAN.
async function postearAsientoFacturacion(numeroContrato: string, pvp: number, irt: number, ingresoPropio: number): Promise<void> {
  const referencia = `facturacion:${numeroContrato}`;
  // 1) Reversa cualquier asiento de facturación anterior de este contrato.
  await reversarYRegistrar("facturacion", referencia, null);
  if (pvp <= 0) return;

  // 2) Anticipo NETO acumulado para este contrato (después de la reversión).
  const anticipoNeto = Math.min(await anticipoNetoDeContrato(numeroContrato), pvp);

  const lineas = [
    { cuentaCodigo: CUENTA.CLIENTES, tercero: numeroContrato, descripcion: "Reconocimiento de factura", debe: pvp, haber: 0 },
    ...(irt > 0 ? [{ cuentaCodigo: CUENTA.IRT, tercero: numeroContrato, descripcion: "Ingreso recibido para terceros", debe: 0, haber: irt }] : []),
    ...(ingresoPropio > 0 ? [{ cuentaCodigo: CUENTA.INGRESOS_PROPIOS, tercero: numeroContrato, descripcion: "Ingreso propio (intermediación)", debe: 0, haber: ingresoPropio }] : []),
    ...(anticipoNeto > 0 ? [
      { cuentaCodigo: CUENTA.ANTICIPOS_CLIENTES, tercero: numeroContrato, descripcion: "Aplicación de anticipo", debe: anticipoNeto, haber: 0 },
      { cuentaCodigo: CUENTA.CLIENTES, tercero: numeroContrato, descripcion: "Aplicación de anticipo", debe: 0, haber: anticipoNeto },
    ] : []),
  ];
  await postearAsiento({ fecha: new Date().toISOString().slice(0, 10), descripcion: `Factura ${numeroContrato}`, origen: "facturacion", referencia, lineas });
}

// Guarda (o actualiza) la configuración de facturación de un contrato:
// IRT (para terceros) e ingreso exento/excluido. La base gravable y el ingreso
// propio se derivan del PVP: ingreso propio = PVP − IRT; base gravable = ingreso
// propio − exento.
export async function guardarFacturacion(input: {
  numeroContrato: string;
  pvp: number;
  irt: number;
  ingresoExento: number;
  tipoExento?: "exento" | "excluido" | null;
  observacion?: string;
}): Promise<Result> {
  const sb = await createClient();
  const pvp = Math.max(0, Number(input.pvp) || 0);
  const irt = Math.max(0, Number(input.irt) || 0);
  // El exento no puede pasarse de lo que queda para ingreso propio (PVP − IRT).
  const ingresoExento = Math.min(Math.max(0, Number(input.ingresoExento) || 0), Math.max(0, pvp - irt));
  const ingresoPropio = Math.max(0, pvp - irt); // snapshot para rentabilidad

  const { error } = await sb.from("contrato_facturacion").upsert(
    {
      numero_contrato: input.numeroContrato,
      irt,
      ingreso_propio: ingresoPropio,
      ingreso_exento: ingresoExento,
      tipo_exento: ingresoExento > 0 ? (input.tipoExento ?? "exento") : null,
      observacion: input.observacion?.trim() || null,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "numero_contrato" }
  );
  if (error) return { ok: false, error: error.message };

  await postearAsientoFacturacion(input.numeroContrato, pvp, irt, ingresoPropio);
  revalidatePath("/dashboard/contabilidad/facturacion");
  revalidatePath("/dashboard/rentabilidad");
  revalidatePath("/dashboard/contabilidad/libro-diario");
  revalidatePath("/dashboard/contabilidad/libro-auxiliar");
  return { ok: true };
}

// Marca (o desmarca) un contrato como facturado y emitido a la DIAN.
export async function marcarDian(numeroContrato: string, emitida: boolean): Promise<Result> {
  const sb = await createClient();
  const { error } = await sb.from("contrato_facturacion").upsert(
    {
      numero_contrato: numeroContrato,
      dian_emitida: emitida,
      dian_fecha: emitida ? new Date().toISOString().slice(0, 10) : null,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "numero_contrato" }
  );
  if (error) return { ok: false, error: error.message };
  revalidatePath("/dashboard/contabilidad/facturacion");
  return { ok: true };
}

// Quita la configuración (el contrato vuelve al cálculo por defecto en rentabilidad).
export async function quitarFacturacion(numeroContrato: string): Promise<Result> {
  const sb = await createClient();
  const { error } = await sb.from("contrato_facturacion").delete().eq("numero_contrato", numeroContrato);
  if (error) return { ok: false, error: error.message };
  await reversarYRegistrar("facturacion", `facturacion:${numeroContrato}`, null);
  revalidatePath("/dashboard/contabilidad/libro-diario");
  revalidatePath("/dashboard/contabilidad/libro-auxiliar");
  revalidatePath("/dashboard/contabilidad/facturacion");
  revalidatePath("/dashboard/rentabilidad");
  return { ok: true };
}
