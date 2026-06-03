import { createClient } from "@/lib/supabase/server";
import { TarifarioPublic, type FilaTarifario } from "./TarifarioPublic";

export const revalidate = 120; // revalida cada 2 min

export default async function TarifarioPublicoPage() {
  const sb = await createClient();

  // Detectar sesión (badge de agencia + permiso de reservar)
  const { data: { user } } = await sb.auth.getUser();
  let esAgencia = false;
  let puedeReservar = false;
  if (user) {
    const { data: perfil } = await sb.from("usuarios").select("rol").eq("id", user.id).single();
    esAgencia = !!perfil && ["agencia", "freelance", "superadmin", "operaciones", "gerencia", "administracion"].includes(perfil.rol);
    puedeReservar = !!perfil && ["superadmin", "operaciones", "gerencia", "administracion", "venta", "agencia", "freelance"].includes(perfil.rol);
  }

  // Resultado del tarifario (solo paquetes activos). Paginado por si supera 1000.
  const filas: FilaTarifario[] = [];
  const PAGE = 1000;
  for (let from = 0; ; from += PAGE) {
    const { data: page } = await sb
      .from("tarifario_resultado")
      .select(
        "modulo, bloqueo_label, bloqueo_id, paquete_id, hotel_id, servicio_nombre, tipo_tarifa, pax_desde, pax_hasta, fecha_ida, fecha_regreso, noches, destino_nombre, paquete_nombre, hotel_nombre, categoria, regimen, acomodacion, precio_pvp"
      )
      .eq("paquete_activo", true)
      .order("destino_nombre")
      .order("bloqueo_label")
      .order("hotel_nombre")
      .order("categoria")
      .order("regimen")
      .range(from, from + PAGE - 1);
    if (!page || page.length === 0) break;
    filas.push(...(page as unknown as FilaTarifario[]));
    if (page.length < PAGE) break;
  }

  return (
    <div className="min-h-screen bg-gray-50">
      <header className="px-6 py-8 text-white" style={{ backgroundColor: "var(--brand-primary)" }}>
        <div className="mx-auto flex max-w-6xl items-end justify-between">
          <div>
            <h1 className="text-3xl font-semibold">D&apos;spacios Travel</h1>
            <p className="mt-1 text-sm opacity-80">Mayorista de Turismo — Tarifario 2026</p>
          </div>
          {esAgencia && (
            <span className="rounded-full bg-white/20 px-3 py-1.5 text-xs font-medium">Modo agencia</span>
          )}
        </div>
      </header>

      <main className="mx-auto max-w-6xl px-4 py-8 md:px-6">
        {!filas.length ? (
          <p className="py-20 text-center text-gray-400">Tarifario en preparación.</p>
        ) : (
          <TarifarioPublic filas={filas} puedeReservar={puedeReservar} />
        )}
      </main>
    </div>
  );
}
