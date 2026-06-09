"use server";

import { createClient } from "@/lib/supabase/server";
import { revalidatePath } from "next/cache";
import { formatFechaLarga } from "@/lib/utils";
import type { Json } from "@/types/database";

type Result = { ok: true; creados?: number } | { ok: false; error: string };

// Contenido editable de un voucher de servicios (uno por proveedor).
export type VoucherContenido = {
  emision: string;
  nReserva: string;
  vendedor: string;
  elaboradoPor: string;
  contactoEmpresa: string;
  proveedor: string;
  hotel: string;
  destino: string;
  fechaIngreso: string;
  tipoPax: string;
  noches: string;
  tipoPlan: string;
  titular: string;
  adultos: string;
  ninos: string;
  checkIn: string;
  checkOut: string;
  incluye: string[];
  infoImportante: string;
  noIncluye: string;
};

const noches = (a: string | null, b: string | null): number => {
  if (!a || !b) return 0;
  return Math.max(0, Math.round((new Date(`${b}T00:00:00`).getTime() - new Date(`${a}T00:00:00`).getTime()) / 86_400_000));
};

// Genera (o regenera) los vouchers de servicios de un contrato: agrupa los
// servicios por proveedor y crea un voucher por cada uno, auto-armado y editable.
export async function generarVouchersServicios(numero: string): Promise<Result> {
  const sb = await createClient();

  const [{ data: venta }, { data: hoteles }, { data: items }] = await Promise.all([
    sb.from("ventas").select("*").eq("numero_contrato", numero).single(),
    sb.from("contrato_hoteles").select("*").eq("numero_contrato", numero).order("orden"),
    sb.from("contrato_items").select("descripcion").eq("numero_contrato", numero),
  ]);
  if (!venta) return { ok: false, error: "Contrato no encontrado." };

  // Nombres de los servicios contratados (se guardan como "Servicio · {nombre}").
  const nombresSel = (items ?? [])
    .map((it) => it.descripcion ?? "")
    .filter((d) => d.startsWith("Servicio · "))
    .map((d) => d.replace(/^Servicio · /, "").trim());
  if (!nombresSel.length) return { ok: false, error: "Este contrato no tiene servicios para generar vouchers." };

  // Reconstruye proveedor por servicio desde el paquete (el contrato no guarda ids).
  const provPorNombre = new Map<string, { proveedor: string; voucherContacto: string | null }>();
  if (venta.paquete_armado_id) {
    const { data: arm } = await sb
      .from("armado_servicios")
      .select("servicios_adicionales(nombre, proveedores(nombre, voucher_contacto, contacto))")
      .eq("paquete_id", venta.paquete_armado_id);
    for (const a of arm ?? []) {
      const s = a.servicios_adicionales as unknown as { nombre: string | null; proveedores: { nombre: string; voucher_contacto: string | null; contacto: string | null } | null } | null;
      if (!s?.nombre) continue;
      const prov = s.proveedores;
      provPorNombre.set(s.nombre.trim(), {
        proveedor: prov?.nombre ?? "Proveedor",
        voucherContacto: prov?.voucher_contacto ?? prov?.contacto ?? null,
      });
    }
  }

  // Agrupa los servicios contratados por proveedor.
  const porProveedor = new Map<string, { contacto: string | null; servicios: string[] }>();
  for (const nombre of nombresSel) {
    const info = provPorNombre.get(nombre);
    const key = info?.proveedor ?? "Sin proveedor";
    const g = porProveedor.get(key) ?? { contacto: info?.voucherContacto ?? null, servicios: [] };
    if (!g.contacto && info?.voucherContacto) g.contacto = info.voucherContacto;
    g.servicios.push(nombre);
    porProveedor.set(key, g);
  }

  const h0 = (hoteles ?? [])[0];
  const ingreso = h0?.fecha_ingreso ?? venta.fecha_salida;
  const salida = h0?.fecha_salida ?? venta.fecha_regreso;
  const hoy = new Date().toISOString().slice(0, 10);
  const vendedor = venta.asesor_firma_nombre ?? venta.asesor ?? "";

  // Regenera: borra los vouchers de servicios previos de este contrato.
  await sb.from("vouchers").delete().eq("numero_contrato", numero).eq("tipo", "servicios");

  const filas: { numero_contrato: string; tipo: string; proveedor: string; contenido: Json }[] = [];
  for (const [proveedor, g] of porProveedor) {
    const contenido: VoucherContenido = {
      emision: hoy,
      nReserva: numero,
      vendedor,
      elaboradoPor: "ÁREA DE RESERVAS",
      contactoEmpresa: "(+57) 321-2094015",
      proveedor,
      hotel: h0?.nombre ?? venta.hotel ?? "",
      destino: venta.destino ?? "",
      fechaIngreso: ingreso && salida ? `${formatFechaLarga(ingreso)} al ${formatFechaLarga(salida)}` : "",
      tipoPax: "Adultos",
      noches: String(noches(ingreso, salida) || ""),
      tipoPlan: g.servicios.join(" · "),
      titular: venta.cliente ?? "",
      adultos: String(venta.pax ?? ""),
      ninos: "0",
      checkIn: "",
      checkOut: "",
      incluye: g.servicios,
      infoImportante: g.contacto
        ? `Podrá encontrar al proveedor de servicios en la salida del aeropuerto. En caso de no encontrarlo puede comunicarse al ${g.contacto}.`
        : "Podrá encontrar al proveedor de servicios en el punto de encuentro indicado.",
      noIncluye: "Gastos no especificados en este documento.",
    };
    filas.push({ numero_contrato: numero, tipo: "servicios", proveedor, contenido: contenido as unknown as Json });
  }

  const { error } = await sb.from("vouchers").insert(filas);
  if (error) return { ok: false, error: error.message };
  revalidatePath(`/dashboard/contratos/${numero}`);
  return { ok: true, creados: filas.length };
}

export async function actualizarVoucher(id: number, contenido: VoucherContenido, numero: string): Promise<Result> {
  const sb = await createClient();
  const { error } = await sb.from("vouchers").update({ contenido: contenido as unknown as Json }).eq("id", id);
  if (error) return { ok: false, error: error.message };
  revalidatePath(`/dashboard/contratos/${numero}`);
  return { ok: true };
}

export async function eliminarVoucher(id: number, numero: string): Promise<Result> {
  const sb = await createClient();
  const { error } = await sb.from("vouchers").delete().eq("id", id);
  if (error) return { ok: false, error: error.message };
  revalidatePath(`/dashboard/contratos/${numero}`);
  return { ok: true };
}
