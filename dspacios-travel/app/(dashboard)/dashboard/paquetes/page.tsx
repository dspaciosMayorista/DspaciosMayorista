import { createClient } from "@/lib/supabase/server";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { formatCOP } from "@/lib/utils";
import { EliminarPaqueteBtn } from "./EliminarPaqueteBtn";

export const dynamic = "force-dynamic";

export default async function PaquetesPage() {
  const sb = await createClient();
  const { data: paquetesRaw } = await sb
    .from("armado_paquetes")
    .select("id, nombre, activo, pct_mk, fecha_viaje_inicio, fecha_viaje_fin, destinos(nombre)")
    .order("id", { ascending: false });

  type Item = {
    id: number;
    nombre: string;
    activo: boolean;
    pct_mk: number;
    fecha_viaje_inicio: string | null;
    fecha_viaje_fin: string | null;
    destinos: { nombre: string } | null;
  };
  const paquetes = (paquetesRaw ?? []) as unknown as Item[];

  // Conteo de tarifas resultantes y "desde" por paquete
  const ids = paquetes.map((p) => p.id);
  const conteo = new Map<number, number>();
  const desdePorPaquete = new Map<number, number>();
  if (ids.length) {
    const { data: res } = await sb
      .from("tarifario_resultado")
      .select("paquete_id, precio_pvp")
      .in("paquete_id", ids);
    for (const r of res ?? []) {
      conteo.set(r.paquete_id, (conteo.get(r.paquete_id) ?? 0) + 1);
      const prev = desdePorPaquete.get(r.paquete_id);
      if (prev == null || r.precio_pvp < prev) desdePorPaquete.set(r.paquete_id, r.precio_pvp);
    }
  }

  return (
    <div className="mx-auto max-w-5xl p-4 md:p-8">
      <div className="mb-2 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold text-gray-900">Paquetes</h1>
          <p className="mt-1 text-sm text-gray-500">
            Armas el paquete sobre el Producto (costos) y le pones el margen. El resultado se publica en el Tarifario.
          </p>
        </div>
        <Link href="/dashboard/paquetes/nuevo">
          <Button style={{ backgroundColor: "var(--brand-primary)" }}>+ Nuevo paquete</Button>
        </Link>
      </div>

      {!paquetes.length ? (
        <div className="mt-6 rounded-2xl border-2 border-dashed border-gray-200 py-20 text-center text-gray-400">
          <p className="text-lg">No hay paquetes armados</p>
          <p className="mt-1 text-sm">Crea el primero con “Nuevo paquete”.</p>
        </div>
      ) : (
        <div className="mt-6 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {paquetes.map((p) => {
            const destino = p.destinos?.nombre;
            const nTarifas = conteo.get(p.id) ?? 0;
            const desde = desdePorPaquete.get(p.id);
            return (
              <div
                key={p.id}
                className="flex flex-col rounded-xl border border-gray-200 bg-white p-4 transition hover:border-[var(--brand-accent)] hover:shadow-sm"
              >
                <Link href={`/dashboard/paquetes/${p.id}`} className="block">
                  <div className="flex items-start justify-between gap-2">
                    <span
                      className="rounded-full px-2 py-0.5 text-xs font-medium text-white"
                      style={{ backgroundColor: p.activo ? "var(--brand-success)" : "#9ca3af" }}
                    >
                      {p.activo ? "Activo" : "Inactivo"}
                    </span>
                    <span className="text-xs text-gray-400">mk {Math.round((p.pct_mk ?? 0) * 100)}%</span>
                  </div>
                  <h2 className="mt-2 font-semibold text-gray-900">{p.nombre}</h2>
                  <p className="text-xs text-gray-500">
                    {destino ?? "Sin destino"}
                    {p.fecha_viaje_inicio ? ` · viaje ${p.fecha_viaje_inicio} → ${p.fecha_viaje_fin ?? ""}` : ""}
                  </p>
                  <div className="mt-3 flex items-center justify-between">
                    <span className="text-xs text-gray-500">
                      {nTarifas > 0 ? `${nTarifas} tarifas publicadas` : "Sin publicar"}
                    </span>
                    {desde != null && desde > 0 && (
                      <span className="text-sm">
                        Desde <b style={{ color: "var(--brand-primary)" }}>{formatCOP(desde)}</b>
                      </span>
                    )}
                  </div>
                </Link>
                <div className="mt-2 flex justify-end border-t border-gray-100 pt-2">
                  <EliminarPaqueteBtn id={p.id} nombre={p.nombre} />
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
