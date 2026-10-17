import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { Button } from "@/components/ui/button";
import { ProgramasLista, type ProgramaListado } from "./ProgramasLista";

export const dynamic = "force-dynamic";

export default async function ProgramasPage() {
  const sb = await createClient();
  const { data: programas } = await sb
    .from("programas")
    .select("id, nombre, subtitulo, dias, noches, moneda, publicado, activo, destino_fijo_id, proveedores(nombre), programa_destinos_fijos(nombre, es_provisional)")
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

  const listado: ProgramaListado[] = (programas ?? []).map((p) => ({
    id: p.id,
    nombre: p.nombre,
    subtitulo: p.subtitulo,
    dias: p.dias,
    noches: p.noches,
    publicado: p.publicado,
    activo: p.activo,
    destino_fijo_id: p.destino_fijo_id,
    destino: (p.programa_destinos_fijos as unknown as { nombre: string } | null)?.nombre ?? null,
    destino_es_provisional: (p.programa_destinos_fijos as unknown as { es_provisional?: boolean | null } | null)?.es_provisional === true,
    proveedor: (p.proveedores as unknown as { nombre: string } | null)?.nombre ?? null,
    desde: desde.get(p.id) ?? null,
  }));

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
        <div className="flex items-center gap-2">
          <Link href="/dashboard/producto/programas/calculadora">
            <Button variant="secondary">🧮 Calculadora de precios</Button>
          </Link>
          <Link href="/dashboard/producto/programas/nuevo">
            <Button style={{ backgroundColor: "var(--brand-primary)" }}>+ Nuevo programa</Button>
          </Link>
        </div>
      </div>

      <ProgramasLista programas={listado} />
    </div>
  );
}
