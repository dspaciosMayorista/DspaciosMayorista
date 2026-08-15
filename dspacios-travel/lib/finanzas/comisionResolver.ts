import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { calcComisionB2B } from "@/lib/calc/finanzas";
import { accesoDocumentoContrato } from "@/lib/auth/accesoDocumentoContrato";
import { elegirFichaAliado, explicarFicha, resolverAliadoIdContrato, type FichaAliado } from "@/lib/finanzas/fichaAliado";

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



/**
 * Resuelve una comisión B2B por número de contrato, con control de acceso:
 * la ve un rol interno o el aliado dueño de la comisión. Comparte la lógica
 * entre la cuenta de cobro y el estado de cuenta de abonos.
 */
export async function resolverComisionB2B(numero: string): Promise<ComisionResuelta | null> {
  const sb = await createClient();
  const { data: { user } } = await sb.auth.getUser();
  if (!user) return null;
  const { data: perfil } = await sb
    .from("usuarios")
    .select("nombre, rol, tenant, activo, aliado_id")
    .eq("id", user.id)
    .maybeSingle();

  const admin = createAdminClient();
  const { data: v } = await admin
    .from("ventas")
    .select("numero_contrato, cliente, destino, fecha_salida, precio_venta, moneda, modo_compra, comision_b2b, b2b_usuario_id, aliado_id, agencia_nombre, freelance_nombre, tipo_asesor, tenant")
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

  // La autorización de esta página NO la hace la RLS: se lee con service-role.
  // La decide `accesoDocumentoContrato`, compartida con el estado de cuenta.
  //
  // El id del aliado sale de donde esté: `ventas.aliado_id` en el flujo
  // tarifario B2B, o `aliados_b2b.aliado_id` en las comisiones cargadas a mano
  // (migración 133) — que es el único camino en minorista. Si ninguno de los
  // dos está puesto, queda null y solo entonces se mira el nombre.
  const aliadoIdContrato = resolverAliadoIdContrato({
    esVentasB2B,
    aliadoIdVentas: (v.aliado_id as number | null) ?? null,
    aliadoIdComisionManual: aliadoB2B?.aliadoId ?? null,
  });

  const acceso = accesoDocumentoContrato(
    perfil
      ? {
          id: user.id,
          rol: perfil.rol as string | null,
          tenant: perfil.tenant as string | null,
          nombre: perfil.nombre as string | null,
          activo: (perfil.activo as boolean | null) ?? null,
          aliadoId: (perfil.aliado_id as number | null) ?? null,
        }
      : null,
    {
      tenant: (v.tenant as string | null) ?? null,
      b2bUsuarioId: (v.b2b_usuario_id as string | null) ?? null,
      aliadoId: aliadoIdContrato,
      // En la vía 2 el nombre del aliado vive en `aliados_b2b.aliado`, no en
      // `ventas`; se pasan los tres para que el respaldo legacy cubra ambas.
      nombreAliado: [
        v.agencia_nombre as string | null,
        v.freelance_nombre as string | null,
        aliadoNombre ?? null,
      ],
    }
  );
  if (!acceso.permitido) return null;
  const esInterno = acceso.esInterno;
  const esDueno = acceso.esDueno;

  const aliado = aliadoNombre || perfil?.nombre || "";

  // ── Datos del aliado (documento, dirección, CUENTA BANCARIA) ────────────
  // Con `aliado_id` se lee por id, en los DOS flujos: el tarifario
  // (`ventas.aliado_id`) también lo tiene y antes no se usaba, solo el de
  // comisión manual. Sin id se cae al camino legacy, que exige coincidencia
  // exacta y una sola ficha — nunca `ilike` ni `limit(1)`, porque `%` y `_` son
  // comodines y un `limit(1)` sin orden elige un homónimo cualquiera. Esto sale
  // impreso en una cuenta de cobro: equivocarse es pagarle a otra persona.
  const COLS_ALIADO =
    "id, nombre, tipo_documento, nit, direccion, telefono, email, banco, tipo_cuenta, numero_cuenta";

  let fichaPorId: FichaAliado | null = null;
  if (aliadoIdContrato != null) {
    const { data } = await admin.from("aliados").select(COLS_ALIADO).eq("id", aliadoIdContrato).maybeSingle();
    fichaPorId = (data as FichaAliado | null) ?? null;
  }

  // Solo se consulta por nombre si NO hay id, y se traen TODAS las coincidencias:
  // contarlas es lo que detecta la ambigüedad. `eq` es comparación literal, así
  // que un nombre con `%` o `_` no actúa como patrón.
  let fichasPorNombre: FichaAliado[] = [];
  if (aliadoIdContrato == null && aliadoNombre) {
    const { data } = await admin.from("aliados").select(COLS_ALIADO).eq("nombre", aliadoNombre);
    fichasPorNombre = (data as FichaAliado[] | null) ?? [];
    // Y si el nombre guardado difiere en mayúsculas o espacios, se reintenta con
    // la normalización de la regla. `ilike` aquí sería un patrón; se evita
    // trayendo el catálogo y comparando en memoria, que además es lo que permite
    // ver si hay más de una.
    if (fichasPorNombre.length === 0) {
      const { data: todas } = await admin.from("aliados").select(COLS_ALIADO);
      const objetivo = aliadoNombre.trim().toLowerCase();
      fichasPorNombre = ((todas as FichaAliado[] | null) ?? []).filter(
        (f) => (f.nombre ?? "").trim().toLowerCase() === objetivo
      );
    }
  }

  const eleccion = elegirFichaAliado(fichaPorId, aliadoIdContrato != null, aliadoNombre, fichasPorNombre);
  const aliadoInfo: AliadoCatalogo | null = eleccion.ficha;

  // Evidencia para el servidor cuando NO se pudo resolver. No se expone al
  // cliente ni se sustituye por una ficha "parecida".
  const aviso = explicarFicha(eleccion, aliadoNombre);
  if (aviso) console.warn(`[cuenta de cobro ${v.numero_contrato}] ${aviso}`);

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
