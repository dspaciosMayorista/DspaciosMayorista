"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getTenant } from "@/lib/tenant.server";
import { numeroConTenant } from "@/lib/tenant";
import { parseUtilidades, parsePagos } from "@/lib/minorista/importMinorista";

type Result =
  | { ok: true; resumen: string; notas: string[] }
  | { ok: false; error: string };

const PLACEHOLDER_CLIENTE = "(Sin titular)";

function lotes<T>(arr: T[], n: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += n) out.push(arr.slice(i, i + n));
  return out;
}

// CANDADO de seguridad: la importación SOLO se permite en la agencia minorista,
// y SOLO a superadmin/administración — es una reescritura masiva de ventas y
// abonos históricos (delete+insert por contrato), no una operación de venta
// normal. Usa el cliente con sesión (RLS) antes de pasar al admin client.
async function tenantMinoristaOFalla(): Promise<
  { ok: true; tenant: "minorista" } | { ok: false; error: string }
> {
  const sb = await createClient();
  const { data: { user } } = await sb.auth.getUser();
  if (!user) return { ok: false, error: "No autenticado." };
  const { data: perfil } = await sb.from("usuarios").select("rol").eq("id", user.id).single();
  if (!perfil || !["superadmin", "administracion"].includes(perfil.rol))
    return { ok: false, error: "Solo superadmin / administración pueden importar el histórico." };

  const tenant = await getTenant();
  if (tenant !== "minorista")
    return {
      ok: false,
      error:
        "Estás en la agencia Mayorista. Cambia a Minorista (arriba a la izquierda) antes de importar el histórico.",
    };
  return { ok: true, tenant };
}

// ── IMPORTACIÓN CRUZADA (Relación de utilidades × Resumen de pagos) ─────────
// REGLA: un contrato SOLO se guarda si su número aparece en LAS DOS hojas.
// Si está en una sola, se OMITE por completo (ni venta ni abonos).
export async function importarHistorico(textoRelacion: string, textoResumen: string): Promise<Result> {
  const gate = await tenantMinoristaOFalla();
  if (!gate.ok) return gate;
  const tenant = gate.tenant;

  const rel = parseUtilidades(textoRelacion);
  const pag = parsePagos(textoResumen);
  if (!rel.filas.length && !pag.filas.length)
    return { ok: false, error: "No se detectaron filas. Pega el contenido de AMBAS hojas." };
  if (!rel.filas.length) return { ok: false, error: "Falta la hoja “Relación de utilidades” (o no se detectaron sus filas)." };
  if (!pag.filas.length) return { ok: false, error: "Falta la hoja “Resumen de pagos” (o no se detectaron sus filas)." };

  // Mapas por número CRUDO (00-XXXX); la última fila de cada número gana.
  const relPorNum = new Map(rel.filas.map((f) => [f.numero, f]));
  const pagPorNum = new Map(pag.filas.map((f) => [f.numero, f]));

  const enAmbos: string[] = [];
  const soloRelacion: string[] = [];
  const soloResumen: string[] = [];
  for (const num of relPorNum.keys()) (pagPorNum.has(num) ? enAmbos : soloRelacion).push(num);
  for (const num of pagPorNum.keys()) if (!relPorNum.has(num)) soloResumen.push(num);

  const notas: string[] = [...rel.notas, ...pag.notas];
  if (soloRelacion.length) notas.push(`OMITIDOS (${soloRelacion.length}) — solo están en Relación de utilidades, no en Resumen de pagos: ${soloRelacion.slice(0, 40).join(", ")}${soloRelacion.length > 40 ? "…" : ""}`);
  if (soloResumen.length) notas.push(`OMITIDOS (${soloResumen.length}) — solo están en Resumen de pagos, no en Relación de utilidades: ${soloResumen.slice(0, 40).join(", ")}${soloResumen.length > 40 ? "…" : ""}`);

  if (!enAmbos.length)
    return { ok: false, error: "Ningún contrato aparece en AMBAS hojas; no hay nada que importar. Revisa que los números coincidan." };

  const sb = createAdminClient();

  // (a) Venta = merge de ambas hojas (costos de Relación + titular/asesor/doc de Resumen).
  // El "vendedor" de Resumen de pagos es un freelance externo que se gana una
  // comisión B2B (confirmado con el dueño) -- no solo un dato informativo. Se
  // marca la venta como B2B/freelance para que aparezca en la lista "Por
  // definir" de /dashboard/comisiones; el % de comisión NO viene en la hoja,
  // así que no se inventa aquí -- se define a mano una vez, por vendedor.
  const ventasPayload = enAmbos.map((num) => {
    const r = relPorNum.get(num)!;
    const p = pagPorNum.get(num)!;
    const tieneVendedor = !!p.asesor?.trim();
    return {
      numero_contrato: numeroConTenant(num, tenant),
      tenant,
      cliente: p.cliente ?? PLACEHOLDER_CLIENTE,
      asesor: p.asesor,
      cliente_documento: p.cliente_documento,
      fecha_venta: r.fecha_venta ?? p.fecha_venta ?? undefined,
      moneda: r.moneda,
      precio_venta: r.precio_venta > 0 ? r.precio_venta : (p.precio_venta ?? 0),
      fecha_salida: r.fecha_salida,
      aerolinea: r.aerolinea,
      hotel: r.hotel,
      receptivo: r.receptivo, // proveedor de traslados (puede ir null; el costo igual se guarda)
      costo_aereo: r.costo_aereo,
      costo_hotel: r.costo_hotel,
      costo_receptivo: r.costo_receptivo,
      costo_asistencia: r.costo_asistencia,
      otros_costos: r.otros_costos,
      estado: "confirmado",
      pax: 1,
      tipo_asesor: tieneVendedor ? "freelance" : null,
      canal: tieneVendedor ? "B2B" : null,
      freelance_nombre: tieneVendedor ? p.asesor : null,
    };
  });
  let nVentas = 0;
  for (const lote of lotes(ventasPayload, 400)) {
    const { error } = await sb.from("ventas").upsert(lote, { onConflict: "numero_contrato" });
    if (error) return { ok: false, error: error.message };
    nVentas += lote.length;
  }

  // (b) Abonos: re-importar limpio → borra los previos de estos contratos y re-inserta.
  const numeros = enAmbos.map((num) => numeroConTenant(num, tenant));
  for (const lote of lotes(numeros, 200)) {
    const { error } = await sb.from("abonos").delete().eq("tenant", tenant).in("numero_contrato", lote);
    if (error) return { ok: false, error: error.message };
  }
  const abonosPayload = enAmbos.flatMap((num) => {
    const p = pagPorNum.get(num)!;
    const numero_contrato = numeroConTenant(num, tenant);
    return p.abonos.map((a) => ({
      numero_contrato,
      tenant,
      cliente: p.cliente,
      fecha_abono: a.fecha ?? p.fecha_venta ?? undefined,
      valor_abono: a.valor,
      monto_cop: a.valor, // histórico en COP
      forma_pago: null as string | null,
      recibido_por: p.asesor,
      observacion: [a.observacion, p.donde_ingreso].filter(Boolean).join(" · ") || null,
    }));
  });
  let nAbonos = 0;
  for (const lote of lotes(abonosPayload, 400)) {
    if (!lote.length) continue;
    const { error } = await sb.from("abonos").insert(lote);
    if (error) return { ok: false, error: error.message };
    nAbonos += lote.length;
  }

  // (c) Cuentas por pagar (proveedores) por cada costo con valor > 0. Sin nombre
  // en la hoja → "Sin especificar" (editable luego). NO duplica: solo agrega los
  // tipos (hotel/aereo/receptivo/asistencia/otro) que le falten a cada contrato,
  // así re-importar sirve también para completar los contratos ya importados
  // antes de este fix, sin pisar ediciones manuales de proveedor ya hechas.
  const SIN_ESPECIFICAR = "Sin especificar";
  const { data: existentesCxP } = await sb
    .from("cuentas_por_pagar")
    .select("numero_contrato, tipo_proveedor")
    .eq("tenant", tenant)
    .in("numero_contrato", numeros);
  const tiposPorContrato = new Map<string, Set<string>>();
  for (const c of existentesCxP ?? []) {
    if (!c.tipo_proveedor) continue;
    const s = tiposPorContrato.get(c.numero_contrato) ?? new Set<string>();
    s.add(c.tipo_proveedor);
    tiposPorContrato.set(c.numero_contrato, s);
  }

  type CxpRow = { numero_contrato: string; proveedor: string; tipo: string; servicio: string; valor: number; fecha: string | null; moneda: string };
  const cxpRows: CxpRow[] = [];
  for (const num of enAmbos) {
    const r = relPorNum.get(num)!;
    const p = pagPorNum.get(num)!;
    const numero_contrato = numeroConTenant(num, tenant);
    const ya = tiposPorContrato.get(numero_contrato) ?? new Set<string>();
    const fecha = r.fecha_venta ?? p.fecha_venta ?? null;
    const add = (tipo: string, proveedor: string | null, servicio: string, valor: number) => {
      if (valor <= 0 || ya.has(tipo)) return;
      cxpRows.push({ numero_contrato, proveedor: proveedor?.trim() || SIN_ESPECIFICAR, tipo, servicio, valor, fecha, moneda: r.moneda });
    };
    add("hotel", r.hotelProveedor, "Hotel", r.costo_hotel);
    add("aereo", r.aerolinea, `Aéreo ${r.aerolinea ?? ""}`.trim(), r.costo_aereo);
    add("receptivo", r.receptivo, "Traslados", r.costo_receptivo);
    add("asistencia", r.proveedorAsistencia, "Asistencia médica", r.costo_asistencia);
    add("otro", r.proveedorTours, "Tours / otros costos", r.otros_costos);
  }

  let nCxP = 0;
  if (cxpRows.length) {
    const nombres = [...new Set(cxpRows.map((r) => r.proveedor).filter((n) => n !== SIN_ESPECIFICAR))];
    const { data: provs } = nombres.length
      ? await sb.from("proveedores").select("nombre, aplica_retencion, pct_retencion").in("nombre", nombres)
      : { data: [] as { nombre: string; aplica_retencion: boolean; pct_retencion: number }[] };
    const provMap = new Map((provs ?? []).map((p) => [p.nombre, p]));
    const hoy = new Date().toISOString().slice(0, 10);
    const cxpPayload = cxpRows.map((r) => {
      const pr = provMap.get(r.proveedor);
      return {
        numero_contrato: r.numero_contrato,
        tenant,
        proveedor: r.proveedor,
        tipo_proveedor: r.tipo,
        servicio: r.servicio,
        valor_total: r.valor,
        moneda: r.moneda,
        fecha_obligacion: r.fecha ?? hoy,
        aplica_retencion: pr?.aplica_retencion ?? false,
        pct_retencion: pr?.pct_retencion ?? 0,
      };
    });
    for (const lote of lotes(cxpPayload, 400)) {
      const { error } = await sb.from("cuentas_por_pagar").insert(lote);
      if (error) return { ok: false, error: error.message };
      nCxP += lote.length;
    }
  }

  revalidatePath("/dashboard/contratos");
  revalidatePath("/dashboard/ventas");
  revalidatePath("/dashboard/cartera");
  revalidatePath("/dashboard/pagos");
  const omitidos = soloRelacion.length + soloResumen.length;
  return {
    ok: true,
    resumen: `${nVentas} contratos importados (en ambas hojas) con ${nAbonos} abonos y ${nCxP} cuenta(s) por pagar generada(s).${omitidos ? ` ${omitidos} omitido(s) por estar en una sola hoja.` : ""}`,
    notas,
  };
}
