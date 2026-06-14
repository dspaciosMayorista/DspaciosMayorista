import { notFound } from "next/navigation";
import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { PrintButton } from "@/components/contrato/PrintButton";
import { formatMoneda, formatFechaLarga } from "@/lib/utils";

export const dynamic = "force-dynamic";

export default async function CuentaCobroPage({ params }: { params: Promise<{ numero: string }> }) {
  const { numero } = await params;
  const sb = await createClient();
  const { data: { user } } = await sb.auth.getUser();
  if (!user) notFound();
  const { data: perfil } = await sb.from("usuarios").select("nombre, rol").eq("id", user.id).maybeSingle();

  const admin = createAdminClient();
  const { data: v } = await admin
    .from("ventas")
    .select("numero_contrato, cliente, destino, fecha_salida, precio_venta, moneda, modo_compra, comision_b2b, comision_estado, b2b_usuario_id, agencia_nombre, freelance_nombre")
    .eq("numero_contrato", numero)
    .maybeSingle();
  if (!v) notFound();

  // Seguridad: solo el aliado dueño del contrato (o un interno) puede verla.
  const esInterno = ["superadmin", "administracion", "gerencia", "operaciones"].includes(perfil?.rol ?? "");
  const esDueno = v.b2b_usuario_id === user.id || [v.agencia_nombre, v.freelance_nombre].includes(perfil?.nombre ?? "");
  if (!esInterno && !esDueno) notFound();
  if (v.modo_compra !== "comisionable" || !v.comision_b2b) notFound();

  const moneda = v.moneda ?? "COP";
  const aliado = v.freelance_nombre || v.agencia_nombre || perfil?.nombre || "";
  const hoy = new Date().toISOString().slice(0, 10);

  return (
    <div className="min-h-screen bg-gray-100 py-6">
      <div className="mx-auto mb-4 flex max-w-3xl items-center justify-between px-4 print:hidden">
        <Link href="/portal/b2b" className="text-sm text-gray-500 hover:text-gray-800">← Mis contratos</Link>
        <PrintButton />
      </div>
      <div className="mx-auto max-w-3xl px-4 print:max-w-none print:px-0">
        <div className="cuenta-doc rounded-xl bg-white p-8 shadow-sm print:rounded-none print:shadow-none">
          <h1 className="text-2xl font-bold" style={{ color: "var(--brand-primary)" }}>CUENTA DE COBRO</h1>
          <p className="mt-1 text-sm text-gray-500">Fecha: {formatFechaLarga(hoy)}</p>

          <div className="mt-6 text-sm text-gray-700">
            <p>Señores</p>
            <p className="font-semibold">D&apos;SPACIOS TRAVEL — Mayorista de Turismo</p>
          </div>

          <p className="mt-4 text-sm text-gray-700">
            Yo, <b>{aliado}</b>, en mi calidad de aliado comercial, me permito cobrar la comisión correspondiente
            a la siguiente venta:
          </p>

          <table className="mt-4 w-full border-collapse text-sm">
            <tbody>
              <tr className="border-b border-gray-100"><td className="py-2 text-gray-500">Contrato</td><td className="py-2 text-right font-mono font-semibold">{v.numero_contrato}</td></tr>
              <tr className="border-b border-gray-100"><td className="py-2 text-gray-500">Cliente</td><td className="py-2 text-right">{v.cliente}</td></tr>
              <tr className="border-b border-gray-100"><td className="py-2 text-gray-500">Destino</td><td className="py-2 text-right">{v.destino ?? "—"}</td></tr>
              <tr className="border-b border-gray-100"><td className="py-2 text-gray-500">Fecha de viaje</td><td className="py-2 text-right">{formatFechaLarga(v.fecha_salida)}</td></tr>
              <tr className="border-b border-gray-100"><td className="py-2 text-gray-500">Valor del paquete</td><td className="py-2 text-right tabular-nums">{formatMoneda(Number(v.precio_venta ?? 0), moneda)}</td></tr>
            </tbody>
          </table>

          <div className="mt-6 flex items-center justify-between rounded-lg bg-[rgba(29,124,154,0.06)] px-4 py-3">
            <span className="text-sm font-semibold text-gray-700">Total a cobrar (comisión)</span>
            <span className="text-xl font-bold" style={{ color: "var(--brand-primary)" }}>{formatMoneda(Number(v.comision_b2b), moneda)}</span>
          </div>

          <div className="mt-10 text-sm text-gray-600">
            <div className="border-t border-gray-300 pt-2" style={{ width: 260 }}>Firma</div>
            <p className="mt-1">{aliado}</p>
          </div>

          <footer className="mt-8 border-t border-gray-200 pt-3 text-center text-[10px] text-gray-400">
            Documento generado por el Portal B2B de D&apos;spacios Travel.
          </footer>
        </div>
      </div>
      <style dangerouslySetInnerHTML={{ __html: `
        .cuenta-doc, .cuenta-doc * { -webkit-print-color-adjust: exact !important; print-color-adjust: exact !important; }
        @page { size: A4; margin: 14mm; }
        @media print { html, body { background: #fff !important; } }
      ` }} />
    </div>
  );
}
