import { createClient } from "@/lib/supabase/server";
import Link from "next/link";
import { comisionMes, type EscalaRango } from "@/lib/calc/escalas";
import { LiquidacionTable, type FilaLiquidacion } from "./LiquidacionTable";

export const dynamic = "force-dynamic";

const ESTADOS_VALIDOS = ["activo", "confirmado", "confirmada"];

function rangoMes(mes: string): { ini: string; fin: string } {
  // mes = "YYYY-MM" → [primer día, primer día del mes siguiente)
  const [y, m] = mes.split("-").map(Number);
  const ini = `${mes}-01`;
  const ny = m === 12 ? y + 1 : y;
  const nm = m === 12 ? 1 : m + 1;
  const fin = `${ny}-${String(nm).padStart(2, "0")}-01`;
  return { ini, fin };
}

export default async function LiquidacionPage({ searchParams }: { searchParams: Promise<{ mes?: string }> }) {
  const sb = await createClient();
  const { data: { user } } = await sb.auth.getUser();
  const { data: perfil } = user ? await sb.from("usuarios").select("rol").eq("id", user.id).single() : { data: null };
  const admin = ["superadmin", "administracion", "gerencia"].includes(perfil?.rol ?? "");
  if (!admin) {
    return (
      <div className="mx-auto max-w-3xl p-8">
        <h1 className="text-2xl font-semibold text-gray-900">Liquidación de comisiones</h1>
        <p className="mt-3 rounded-lg bg-amber-50 px-4 py-3 text-sm text-amber-700">Solo administración / gerencia.</p>
      </div>
    );
  }

  const sp = await searchParams;
  const hoy = new Date().toLocaleDateString("en-CA", { timeZone: "America/Bogota" });
  const mes = sp.mes && /^\d{4}-\d{2}$/.test(sp.mes) ? sp.mes : hoy.slice(0, 7);
  const { ini, fin } = rangoMes(mes);

  const [{ data: ventas }, { data: vendedores }, { data: rangos }, { data: params }, { data: descuentosRows }] = await Promise.all([
    sb.from("ventas").select("asesor_firma_nombre, precio_venta, impuesto, estado, fecha_venta").gte("fecha_venta", ini).lt("fecha_venta", fin),
    sb.from("usuarios").select("id, nombre, escala_id, aplica_retencion").eq("rol", "venta").order("nombre"),
    sb.from("escala_rangos").select("escala_id, pvp_desde, pvp_hasta, pct"),
    sb.from("parametros_tributarios").select("valor").eq("parametro", "RETENCION_HONORARIOS").maybeSingle(),
    sb.from("liquidacion_descuentos").select("id, usuario_id, valor, descripcion, numero_contrato").eq("mes", mes),
  ]);

  const retH = Number(params?.valor) || 0.11;

  // Acumula por nombre del asesor (solo estados válidos).
  const acum = new Map<string, { pvp: number; base: number; n: number }>();
  for (const v of ventas ?? []) {
    if (!ESTADOS_VALIDOS.includes((v.estado ?? "").toLowerCase())) continue;
    const nombre = (v.asesor_firma_nombre ?? "").trim();
    if (!nombre) continue;
    const pvp = Number(v.precio_venta) || 0;
    const base = Math.max(0, pvp - (Number(v.impuesto) || 0));
    const a = acum.get(nombre.toLowerCase()) ?? { pvp: 0, base: 0, n: 0 };
    a.pvp += pvp; a.base += base; a.n += 1;
    acum.set(nombre.toLowerCase(), a);
  }

  const rangosPorEscala = new Map<number, EscalaRango[]>();
  for (const r of rangos ?? []) {
    const arr = rangosPorEscala.get(r.escala_id) ?? [];
    arr.push({ pvp_desde: Number(r.pvp_desde), pvp_hasta: r.pvp_hasta == null ? null : Number(r.pvp_hasta), pct: Number(r.pct) });
    rangosPorEscala.set(r.escala_id, arr);
  }

  const descuentosPorUsuario = new Map<string, FilaLiquidacion["descuentos"]>();
  for (const d of descuentosRows ?? []) {
    const arr = descuentosPorUsuario.get(d.usuario_id) ?? [];
    arr.push({ id: d.id, valor: d.valor, descripcion: d.descripcion, numero_contrato: d.numero_contrato });
    descuentosPorUsuario.set(d.usuario_id, arr);
  }

  // Filas: cada asesor interno (usuario rol venta) con su acumulado del mes.
  const filas: FilaLiquidacion[] = (vendedores ?? []).map((a) => {
    const ac = acum.get(a.nombre.trim().toLowerCase()) ?? { pvp: 0, base: 0, n: 0 };
    const rgs = a.escala_id ? rangosPorEscala.get(a.escala_id) ?? [] : [];
    const aplicaRet = a.aplica_retencion ?? true;
    const liq = comisionMes({ sumaPvp: ac.pvp, sumaBase: ac.base, rangos: rgs, retHonorarios: aplicaRet ? retH : 0 });
    return {
      id: a.id, nombre: a.nombre, sinEscala: !a.escala_id, contratos: ac.n, pvp: ac.pvp, base: ac.base, ...liq,
      descuentos: descuentosPorUsuario.get(a.id) ?? [],
    };
  }).filter((f) => f.contratos > 0 || !f.sinEscala);

  return (
    <div className="mx-auto max-w-5xl p-4 md:p-8">
      <Link href="/dashboard" className="text-sm text-gray-400 hover:text-gray-600">← Dashboard</Link>
      <h1 className="mb-1 mt-2 text-2xl font-semibold text-gray-900">Liquidación de comisiones (asesores internos)</h1>
      <p className="mb-4 text-sm text-gray-500">
        Mensual y acumulada por escala: la suma del PVP del mes ubica el rango; ese % se aplica a la base comisionable (PVP − BNC).
      </p>

      <form method="get" className="mb-5 flex items-end gap-2">
        <div>
          <label className="mb-1 block text-xs font-medium text-gray-600">Mes</label>
          <input type="month" name="mes" defaultValue={mes} className="rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm" />
        </div>
        <button type="submit" className="rounded-lg px-4 py-2 text-sm font-medium text-white" style={{ backgroundColor: "var(--brand-primary)" }}>Ver mes</button>
      </form>

      <LiquidacionTable filas={filas} mes={mes} />

      <p className="mt-3 text-xs text-gray-400">
        Cuenta contratos en estado activo/confirmado por <b>fecha de venta</b>. El asesor interno (usuario rol venta) y su escala se
        configuran en <b>Configuración → Escala y retención por asesor interno</b>. Retención de honorarios {Math.round(retH * 100)}%.
      </p>
    </div>
  );
}
