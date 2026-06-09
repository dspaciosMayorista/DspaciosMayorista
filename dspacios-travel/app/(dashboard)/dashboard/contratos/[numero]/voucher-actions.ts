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

  // Gating: solo se generan vouchers si el contrato está 100% pago, o si quien lo
  // genera es superadmin (override).
  const { data: { user } } = await sb.auth.getUser();
  const { data: perfil } = user ? await sb.from("usuarios").select("rol").eq("id", user.id).single() : { data: null };
  const esSuperadmin = perfil?.rol === "superadmin";
  if (!esSuperadmin) {
    const { data: abonos } = await sb.from("abonos").select("valor_abono").eq("numero_contrato", numero);
    const pagado = (abonos ?? []).reduce((s, a) => s + (a.valor_abono ?? 0), 0);
    if (pagado < (venta.precio_venta ?? 0)) {
      return { ok: false, error: "El contrato debe estar 100% pago para generar los vouchers (o pídelo a un superadmin)." };
    }
  }

  // Servicios add-on seleccionados (se guardan como "Servicio · {nombre}").
  const addonNames = new Set(
    (items ?? [])
      .map((it) => it.descripcion ?? "")
      .filter((d) => d.startsWith("Servicio · "))
      .map((d) => d.replace(/^Servicio · /, "").trim())
  );

  // Servicios del paquete agrupados por proveedor: los INCLUIDOS (siempre van) +
  // los add-on seleccionados. El proveedor se reconstruye desde el paquete (el
  // contrato no guarda los ids de servicio).
  const porProveedor = new Map<string, { contacto: string | null; servicios: string[] }>();
  if (venta.paquete_armado_id) {
    const { data: arm } = await sb
      .from("armado_servicios")
      .select("incluido, servicios_adicionales(nombre, proveedores(nombre, voucher_contacto, contacto))")
      .eq("paquete_id", venta.paquete_armado_id);
    for (const a of arm ?? []) {
      const s = a.servicios_adicionales as unknown as { nombre: string | null; proveedores: { nombre: string; voucher_contacto: string | null; contacto: string | null } | null } | null;
      if (!s?.nombre) continue;
      const nombre = s.nombre.trim();
      const incluido = (a as { incluido?: boolean | null }).incluido === true;
      if (!incluido && !addonNames.has(nombre)) continue; // no es del contrato
      const prov = s.proveedores;
      const key = prov?.nombre ?? "Sin proveedor";
      const contacto = prov?.voucher_contacto ?? prov?.contacto ?? null;
      const g = porProveedor.get(key) ?? { contacto, servicios: [] };
      if (!g.contacto && contacto) g.contacto = contacto;
      if (!g.servicios.includes(nombre)) g.servicios.push(nombre);
      porProveedor.set(key, g);
    }
  }
  // Si no se detectan servicios (contratos viejos o paquetes sin servicios
  // cargados), igual se crea UN voucher en blanco para que el asesor lo complete.
  if (!porProveedor.size) porProveedor.set("(por definir)", { contacto: null, servicios: [] });

  const h0 = (hoteles ?? [])[0];
  const ingreso = h0?.fecha_ingreso ?? venta.fecha_salida;
  const salida = h0?.fecha_salida ?? venta.fecha_regreso;
  const hoy = new Date().toISOString().slice(0, 10);
  // Vendedor: agencia → asesor de la agencia; freelance → nombre del freelance;
  // B2C/interno → asesor interno que gestionó la reserva.
  const vendedor =
    venta.tipo_asesor === "agencia" ? (venta.agencia_asesor ?? venta.agencia_nombre ?? "")
    : venta.tipo_asesor === "freelance" ? (venta.freelance_nombre ?? "")
    : (venta.asesor_firma_nombre ?? venta.asesor ?? "");

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
      // Tipo de plan = régimen de alimentación elegido en la reserva; si no hay
      // (paquete de solo servicios), cae a los servicios.
      tipoPlan: venta.plan_nombre || g.servicios.join(" · "),
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
