import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { Button } from "@/components/ui/button";
import { formatMoneda } from "@/lib/utils";

export const dynamic = "force-dynamic";

export default async function ProgramasPage() {
  const sb = await createClient();
  const { data: programas } = await sb
    .from("programas")
    .select("id, nombre, subtitulo, dias, noches, moneda, publicado, proveedores(nombre)")
    .order("created_at", { ascending: false });

  // Precio "desde" por programa (mínimo neto publicado, informativo).
  const ids = (programas ?? []).map((p) => p.id);
  const desde = new Map<number, { neto: number; moneda: string }>();
  if (ids.length) {
    const { data: precios } = await sb
      .from("programa_precios")
      .select("neto, programa_categorias(programa_id)")
      .not("neto", "is", null);
    for (const row of precios ?? []) {
      const pid = (row.programa_categorias as unknown as { programa_id: number } | null)?.programa_id;
      const neto = row.neto ?? 0;
      if (pid == null || neto <= 0) continue;
      const prev = desde.get(pid);
      if (!prev || neto < prev.neto) desde.set(pid, { neto, moneda: "USD" });
    }
  }

  return (
    <div className="mx-auto max-w-5xl p-4 md:p-8">
      <Link href="/dashboard/producto" className="text-sm text-gray-400 hover:text-gray-700">
        ← Producto
      </Link>
      <div className="mt-2 mb-8 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold text-gray-900">Programas (circuitos)</h1>
          <p className="mt-1 text-sm text-gray-500">
            Circuitos completos de un proveedor (multi-ciudad, en USD). Monta el del proveedor,
            ajusta tu markup y publícalo al tarifario.
          </p>
        </div>
        <Link href="/dashboard/producto/programas/nuevo">
          <Button style={{ backgroundColor: "var(--brand-primary)" }}>+ Nuevo programa</Button>
        </Link>
      </div>

      {!programas?.length ? (
        <div className="rounded-2xl border-2 border-dashed border-gray-200 py-20 text-center text-gray-400">
          <p className="text-lg">Aún no hay programas</p>
          <p className="mt-1 text-sm">Crea el primero con el botón “Nuevo programa”.</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-3">
          {programas.map((p) => {
            const d = desde.get(p.id);
            return (
              <Link
                key={p.id}
                href={`/dashboard/producto/programas/${p.id}`}
                className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-gray-200 bg-white p-5 transition-all hover:border-[#1D7C9A] hover:shadow-sm"
              >
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="font-semibold text-gray-800">{p.nombre}</span>
                    {p.publicado ? (
                      <span className="rounded-full bg-green-100 px-2 py-0.5 text-xs text-green-700">
                        Publicado
                      </span>
                    ) : (
                      <span className="rounded-full bg-gray-100 px-2 py-0.5 text-xs text-gray-500">
                        Borrador
                      </span>
                    )}
                  </div>
                  <p className="truncate text-xs text-gray-500">
                    {p.subtitulo ?? "—"}
                    {p.dias ? ` · ${p.dias}d/${p.noches ?? ""}n` : ""}
                    {(p.proveedores as unknown as { nombre: string } | null)?.nombre
                      ? ` · ${(p.proveedores as unknown as { nombre: string }).nombre}`
                      : ""}
                  </p>
                </div>
                {d && (
                  <div className="text-right">
                    <div className="text-xs text-gray-400">desde (neto)</div>
                    <div className="font-semibold" style={{ color: "var(--brand-primary)" }}>
                      {formatMoneda(d.neto, d.moneda)}
                    </div>
                  </div>
                )}
              </Link>
            );
          })}
        </div>
      )}
    </div>
  );
}
