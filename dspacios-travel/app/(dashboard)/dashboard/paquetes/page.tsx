import { createClient } from "@/lib/supabase/server";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { formatCOP } from "@/lib/utils";
import { EliminarPaqueteBtn } from "./EliminarPaqueteBtn";

export const dynamic = "force-dynamic";

const CAT_LABEL: Record<string, string> = {
  bloqueo: "Bloqueo",
  porcion_terrestre: "Porción terrestre",
};

export default async function PaquetesPage() {
  const sb = await createClient();
  const { data: paquetesRaw } = await sb
    .from("paquetes")
    .select("id, categoria, nombre, plan_alimentacion, noches, activo, destinos(nombre), paquete_precios(acomodacion, precio), bloqueos_vuelo(record)")
    .order("id", { ascending: false });

  type PaqueteItem = {
    id: number;
    categoria: string;
    nombre: string;
    plan_alimentacion: string | null;
    noches: number;
    activo: boolean;
    destinos: { nombre: string } | null;
    paquete_precios: { acomodacion: string; precio: number }[];
    bloqueos_vuelo: { record: string } | null;
  };
  const paquetes = (paquetesRaw ?? []) as unknown as PaqueteItem[];

  return (
    <div className="mx-auto max-w-5xl p-4 md:p-8">
      <div className="mb-8 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold text-gray-900">Módulo de Producto — Paquetes</h1>
          <p className="mt-1 text-sm text-gray-500">Productos negociados prearmados (bloqueo y porción terrestre)</p>
        </div>
        <Link href="/dashboard/paquetes/nuevo">
          <Button style={{ backgroundColor: "var(--brand-primary)" }}>+ Nuevo paquete</Button>
        </Link>
      </div>

      {!paquetes.length ? (
        <div className="rounded-2xl border-2 border-dashed border-gray-200 py-20 text-center text-gray-400">
          <p className="text-lg">No hay paquetes cargados</p>
          <p className="mt-1 text-sm">Crea el primero con “Nuevo paquete”.</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {paquetes.map((p) => {
            const precios = (p.paquete_precios ?? []) as { acomodacion: string; precio: number }[];
            const desde = precios.length ? Math.min(...precios.map((x) => x.precio)) : 0;
            const destino = (p.destinos as unknown as { nombre: string } | null)?.nombre;
            const record = (p.bloqueos_vuelo as unknown as { record: string } | null)?.record;
            return (
              <div key={p.id} className="rounded-xl border border-gray-200 bg-white p-4">
                <div className="flex items-start justify-between gap-2">
                  <span className="rounded-full px-2 py-0.5 text-xs font-medium text-white"
                    style={{ backgroundColor: p.categoria === "bloqueo" ? "var(--brand-primary)" : "var(--brand-success)" }}>
                    {CAT_LABEL[p.categoria] ?? p.categoria}
                  </span>
                  <EliminarPaqueteBtn id={p.id} nombre={p.nombre} />
                </div>
                <h2 className="mt-2 font-semibold text-gray-900">{p.nombre}</h2>
                <p className="text-xs text-gray-500">
                  {destino ?? "—"} · {p.noches}N {p.plan_alimentacion ? `· ${p.plan_alimentacion}` : ""}
                  {record ? ` · ${record}` : ""}
                </p>
                {desde > 0 && (
                  <p className="mt-2 text-sm text-gray-600">Desde <b style={{ color: "var(--brand-primary)" }}>{formatCOP(desde)}</b> /pax</p>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
