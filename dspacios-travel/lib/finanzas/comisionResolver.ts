import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { calcComisionB2B } from "@/lib/calc/finanzas";

// Detalle de cómo se llegó al valor a cobrar. La vía 2 (aliados_b2b) trae el
// desglose completo (calcComisionB2B); la vía 1 (ventas.comision_b2b, flujo
// tarifario B2B de mayorista) solo guarda el total ya calculado, sin
// desglose granular — se muestra un % "efectivo" (comisión/PVP) en vez del
// % contratado real.
export type DetalleComision = {
  pvp: number;
  baseComisionable: number | null;
  pctComision: number;
  esPctEfectivo: boolean;
  comisionBase: number | null;
  recobroAliado: number | null;
  aplicaRetencion: boolean | null;
  pctRetencion: number | null;
  retencion: number | null;
  totalPagar: number;
};

export type AliadoCatalogo = {
  nombre: string;
  tipo_documento: string | null;
  nit: string | null;
  direccion: string | null;
  telefono: string | null;
  email: string | null;
  banco: string | null;
  tipo_cuenta: string | null;
  numero_cuenta: string | null;
};

export type ComisionResuelta = {
  numeroContrato: string;
  cliente: string | null;
  destino: string | null;
  fechaSalida: string | null;
  moneda: string;
  tenant: string;
  aliado: string;
  aliadoInfo: AliadoCatalogo | null;
  tipoAsesorEfectivo: string | null;
  detalle: DetalleComision;
  esInterno: boolean;
  esDueno: boolean;
  // Solo vía 2 (aliados_b2b) — necesario para leer comision_b2b_pagos. La
  // vía 1 (flujo tarifario B2B de mayorista) no tiene log de abonos: el
  // estado de cuenta de abonos no aplica ahí (queda null).
  aliadoB2bId: number | null;
};

const ROLES_INTERNOS = ["superadmin", "administracion", "gerencia", "operaciones"];

/**
 * Resuelve una comisión B2B por número de contrato, con control de acceso:
 * la ve un rol interno o el aliado dueño de la comisión. Comparte la lógica
 * entre la cuenta de cobro y el estado de cuenta de abonos.
 */
export async function resolverComisionB2B(numero: string): Promise<ComisionResuelta | null> {
  const sb = await createClient();
  const { data: { user } } = await sb.auth.getUser();
  if (!user) return null;
  const { data: perfil } = await sb.from("usuarios").select("nombre, rol").eq("id", user.id).maybeSingle();

  const admin = createAdminClient();
  const { data: v } = await admin
    .from("ventas")
    .select("numero_contrato, cliente, destino, fecha_salida, precio_venta, moneda, modo_compra, comision_b2b, b2b_usuario_id, agencia_nombre, freelance_nombre, tipo_asesor, tenant")
    .eq("numero_contrato", numero)
    .maybeSingle();
  if (!v) return null;

  // Vía 1: flujo tarifario/reservar B2B (solo mayorista) — la comisión ya
  // queda en `ventas.comision_b2b`. Vía 2: comisión agregada a mano desde el
  // contrato (`aliados_b2b`) — único camino en minorista (sin tarifario/
  // reservar), también usado en mayorista para comisiones manuales.
  const esVentasB2B = v.modo_compra === "comisionable" && !!v.comision_b2b;
  let aliadoB2B: { aliado: string | null; tipoAliado: string | null; aliadoId: number | null; id: number; detalle: DetalleComision } | null = null;
  if (!esVentasB2B) {
    const { data: b } = await admin
      .from("aliados_b2b")
      .select("id, aliado, tipo_aliado, aliado_id, base_comision, pct_comision, recobro_total, pct_recobro_aliado, aplica_retencion, pct_retencion")
      .eq("numero_contrato", numero)
      .order("id", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (b) {
      const c = calcComisionB2B({
        precioVenta: v.precio_venta ?? 0,
        baseComisionable: b.base_comision,
        pctComision: b.pct_comision,
        recobroTotal: b.recobro_total,
        pctRecobroAliado: b.pct_recobro_aliado,
        aplicaRetencion: b.aplica_retencion,
        pctRetencion: b.pct_retencion,
      });
      aliadoB2B = {
        id: b.id,
        aliado: b.aliado,
        tipoAliado: b.tipo_aliado,
        aliadoId: b.aliado_id,
        detalle: {
          pvp: v.precio_venta ?? 0,
          baseComisionable: b.base_comision,
          pctComision: b.pct_comision,
          esPctEfectivo: false,
          comisionBase: c.comisionBase,
          recobroAliado: c.recobroAliado,
          aplicaRetencion: b.aplica_retencion,
          pctRetencion: b.pct_retencion,
          retencion: c.retencion,
          totalPagar: c.totalPagar,
        },
      };
    }
  }
  if (!esVentasB2B && !aliadoB2B) return null;

  const tipoAsesorEfectivo = esVentasB2B ? v.tipo_asesor : aliadoB2B!.tipoAliado;
  const aliadoNombre = esVentasB2B ? (v.freelance_nombre || v.agencia_nombre) : aliadoB2B!.aliado;
  const pvp = v.precio_venta ?? 0;
  const detalle: DetalleComision = esVentasB2B
    ? {
        pvp,
        baseComisionable: null,
        pctComision: pvp > 0 ? Number(v.comision_b2b) / pvp : 0,
        esPctEfectivo: true,
        comisionBase: null,
        recobroAliado: null,
        aplicaRetencion: null,
        pctRetencion: null,
        retencion: null,
        totalPagar: Number(v.comision_b2b),
      }
    : aliadoB2B!.detalle;

  const esInterno = ROLES_INTERNOS.includes(perfil?.rol ?? "");
  const esDueno = esVentasB2B
    ? v.b2b_usuario_id === user.id || [v.agencia_nombre, v.freelance_nombre].includes(perfil?.nombre ?? "")
    : !!aliadoNombre && aliadoNombre === (perfil?.nombre ?? "");
  if (!esInterno && !esDueno) return null;

  const aliado = aliadoNombre || perfil?.nombre || "";

  // Datos del aliado (documento/dirección/cuenta bancaria) — desde el
  // catálogo `aliados` si la comisión quedó enlazada (aliado_id) o, si no,
  // por coincidencia de nombre (comisiones tipeadas a mano antes de que
  // existiera el enlace).
  let aliadoInfo: AliadoCatalogo | null = null;
  if (!esVentasB2B && aliadoB2B?.aliadoId) {
    const { data } = await admin
      .from("aliados")
      .select("nombre, tipo_documento, nit, direccion, telefono, email, banco, tipo_cuenta, numero_cuenta")
      .eq("id", aliadoB2B.aliadoId)
      .maybeSingle();
    aliadoInfo = data;
  } else if (aliado) {
    const { data } = await admin
      .from("aliados")
      .select("nombre, tipo_documento, nit, direccion, telefono, email, banco, tipo_cuenta, numero_cuenta")
      .ilike("nombre", aliado)
      .limit(1)
      .maybeSingle();
    aliadoInfo = data;
  }

  return {
    numeroContrato: v.numero_contrato,
    cliente: v.cliente,
    destino: v.destino,
    fechaSalida: v.fecha_salida,
    moneda: v.moneda ?? "COP",
    tenant: v.tenant ?? "mayorista",
    aliado,
    aliadoInfo,
    tipoAsesorEfectivo,
    detalle,
    esInterno,
    esDueno,
    aliadoB2bId: esVentasB2B ? null : (aliadoB2B?.id ?? null),
  };
}
