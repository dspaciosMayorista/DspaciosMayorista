import { createClient } from "@/lib/supabase/server";
import { notFound } from "next/navigation";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { formatCOP, formatFechaLarga } from "@/lib/utils";
import { CotizacionAcciones } from "./CotizacionAcciones";
import { VigenciaCotizacion } from "./VigenciaCotizacion";

export const dynamic = "force-dynamic";

function Dato({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg bg-gray-50 px-3 py-2">
      <div className="text-[10px] font-semibold uppercase tracking-wide text-gray-400">{label}</div>
      <div className="text-sm text-gray-800">{value || "—"}</div>
    </div>
  );
}

export default async function CotizacionDetallePage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const sb = await createClient();
  const { data: c } = await sb
    .from("cotizaciones")
    .select("*")
    .eq("id", Number(id))
    .maybeSingle();

  if (!c) notFound();

  const { data: { user } } = await sb.auth.getUser();
  const { data: perfil } = user ? await sb.from("usuarios").select("rol").eq("id", user.id).single() : { data: null };
  const esSuperadmin = perfil?.rol === "superadmin";
  const { data: asesores } = await sb.from("asesores").select("nombre, email").eq("activo", true).order("nombre");
  const payload = (c.payload ?? {}) as { pasajeros?: unknown[]; infantes?: number; cliente?: { nombres?: string; apellidos?: string; tipoDoc?: string; numeroDoc?: string } };
  const tienePasajeros = Array.isArray(payload.pasajeros) && payload.pasajeros.length > 0;
  const clientePre = {
    nombres: payload.cliente?.nombres ?? "",
    apellidos: payload.cliente?.apellidos ?? "",
    tipoDoc: payload.cliente?.tipoDoc ?? "CC",
    numeroDoc: payload.cliente?.numeroDoc ?? "",
  };

  return (
    <div className="mx-auto max-w-3xl p-4 md:p-8">
      <Link href="/dashboard/cotizaciones" className="text-sm text-gray-400 hover:text-gray-600">
        ← Volver a cotizaciones
      </Link>

      <div className="mt-3 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="font-mono text-2xl font-semibold text-gray-900">{c.codigo}</h1>
          <p className="mt-1 text-sm text-gray-500">
            {c.cliente ?? "—"} · {c.destino ?? "—"} · Viaje {formatFechaLarga(c.fecha_salida)}
          </p>
          <span className="mt-2 inline-block rounded-full bg-amber-50 px-2 py-0.5 text-xs text-amber-700">
            {c.estado}
          </span>
        </div>
        <Link href={`/cotizacion/${id}`} target="_blank">
          <Button style={{ backgroundColor: "var(--brand-primary)" }}>Ver / Imprimir cotización →</Button>
        </Link>
      </div>

      <div className="mt-6 grid grid-cols-1 gap-4 sm:grid-cols-3">
        <div className="rounded-xl p-4 text-white" style={{ backgroundColor: "var(--brand-primary)" }}>
          <div className="text-xs opacity-80">Precio de venta</div>
          <div className="text-xl font-bold">{formatCOP(c.precio_venta ?? 0)}</div>
        </div>
        <Dato label="Pasajeros" value={String(c.pax ?? "—")} />
        <VigenciaCotizacion id={c.id} vigencia={c.vigencia_hasta} editable={c.estado === "abierta"} />
      </div>

      <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2">
        <Dato label="Hotel" value={c.hotel ?? "—"} />
        <Dato label="Plan" value={c.plan_nombre ?? "—"} />
        <Dato label="Fechas" value={`${formatFechaLarga(c.fecha_salida)} → ${formatFechaLarga(c.fecha_regreso)}`} />
        <Dato label="Asesor" value={c.asesor ?? "—"} />
      </div>

      <div className="mt-8 rounded-xl border border-gray-200 bg-white p-5">
        {c.estado === "abierta" ? (
          <CotizacionAcciones
            id={c.id}
            pax={c.pax ?? 1}
            infantes={payload.infantes ?? 0}
            tienePasajeros={tienePasajeros}
            cliente={clientePre}
            esSuperadmin={esSuperadmin}
            asesores={asesores ?? []}
          />
        ) : c.estado === "convertida" && c.numero_contrato ? (
          <div className="flex flex-wrap items-center justify-between gap-3">
            <p className="text-sm text-gray-600">
              Convertida en contrato <span className="font-mono font-medium text-gray-800">{c.numero_contrato}</span>.
            </p>
            <Link href={`/dashboard/contratos/${encodeURIComponent(c.numero_contrato)}`}>
              <Button style={{ backgroundColor: "var(--brand-primary)" }}>Ver contrato →</Button>
            </Link>
          </div>
        ) : (
          <p className="text-sm text-gray-500">Cotización descartada.</p>
        )}
      </div>
    </div>
  );
}
