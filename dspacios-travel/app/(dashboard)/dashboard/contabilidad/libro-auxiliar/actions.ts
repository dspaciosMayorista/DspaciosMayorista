"use server";

import { createClient } from "@/lib/supabase/server";
import { getTenant } from "@/lib/tenant.server";

export type LineaAuxiliar = {
  id: number;
  fecha: string;
  numeroAsiento: number;
  descripcionAsiento: string;
  tercero: string | null;
  descripcionLinea: string | null;
  debe: number;
  haber: number;
  saldo: number;
};

export type Auxiliar = {
  cuenta: { id: number; codigo: string; nombre: string; naturaleza: string };
  saldoInicial: number;
  lineas: LineaAuxiliar[];
  totalDebe: number;
  totalHaber: number;
  saldoFinal: number;
};

export async function listarCuentasParaAuxiliar(): Promise<{ ok: true; cuentas: { id: number; codigo: string; nombre: string }[] } | { ok: false; error: string }> {
  const sb = await createClient();
  const tenant = await getTenant();
  const { data, error } = await sb.from("puc_cuentas").select("id, codigo, nombre").eq("tenant", tenant).eq("permite_movimiento", true).order("codigo");
  if (error) return { ok: false, error: error.message };
  return { ok: true, cuentas: data ?? [] };
}

// Libro auxiliar de UNA cuenta: todos los movimientos con saldo corrido. Si se
// filtra por fecha, el saldo inicial arrastra los movimientos anteriores al
// rango (para que el saldo corrido siga siendo correcto).
export async function obtenerAuxiliar(cuentaId: number, desde?: string, hasta?: string): Promise<{ ok: true; datos: Auxiliar } | { ok: false; error: string }> {
  const sb = await createClient();
  const tenant = await getTenant();

  const { data: cuenta } = await sb.from("puc_cuentas").select("id, codigo, nombre, naturaleza").eq("id", cuentaId).eq("tenant", tenant).maybeSingle();
  if (!cuenta) return { ok: false, error: "Cuenta no encontrada." };

  type Raw = { id: number; tercero: string | null; descripcion: string | null; debe: number; haber: number; asientos_contables: { numero: number; fecha: string; descripcion: string } | null };
  const { data, error } = await sb
    .from("asiento_lineas")
    .select("id, tercero, descripcion, debe, haber, asientos_contables(numero, fecha, descripcion)")
    .eq("cuenta_id", cuentaId)
    .eq("tenant", tenant);
  if (error) return { ok: false, error: error.message };

  const todas = ((data ?? []) as unknown as Raw[])
    .filter((r) => r.asientos_contables)
    .map((r) => ({
      id: r.id, fecha: r.asientos_contables!.fecha, numeroAsiento: r.asientos_contables!.numero, descripcionAsiento: r.asientos_contables!.descripcion,
      tercero: r.tercero, descripcionLinea: r.descripcion, debe: Number(r.debe) || 0, haber: Number(r.haber) || 0,
    }))
    .sort((a, b) => (a.fecha < b.fecha ? -1 : a.fecha > b.fecha ? 1 : a.numeroAsiento - b.numeroAsiento));

  const esDebito = cuenta.naturaleza === "debito";
  const efecto = (debe: number, haber: number) => (esDebito ? debe - haber : haber - debe);

  let saldoInicial = 0;
  for (const l of todas) {
    if (desde && l.fecha < desde) saldoInicial += efecto(l.debe, l.haber);
  }

  const enRango = todas.filter((l) => (!desde || l.fecha >= desde) && (!hasta || l.fecha <= hasta));
  let saldo = saldoInicial;
  let totalDebe = 0, totalHaber = 0;
  const lineas: LineaAuxiliar[] = enRango.map((l) => {
    saldo += efecto(l.debe, l.haber);
    totalDebe += l.debe; totalHaber += l.haber;
    return { ...l, saldo };
  });

  return {
    ok: true,
    datos: { cuenta, saldoInicial, lineas, totalDebe, totalHaber, saldoFinal: saldo },
  };
}
