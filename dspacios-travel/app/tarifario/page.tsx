import { createClient } from "@/lib/supabase/server";
import { TarifarioView } from "./TarifarioView";

export const revalidate = 300; // revalida cada 5 min

export default async function TarifarioPublicoPage() {
  const sb = await createClient();

  // Detectar si hay sesión (para mostrar tarifa neta a agencias)
  const { data: { user } } = await sb.auth.getUser();
  let esAgencia = false;
  if (user) {
    const { data: perfil } = await sb.from("usuarios").select("rol").eq("id", user.id).single();
    esAgencia = !!perfil && ["agencia", "freelance", "superadmin", "operaciones", "gerencia", "administracion"].includes(perfil.rol);
  }

  // Destinos con hoteles y sus tarifas
  const { data: destinos } = await sb
    .from("destinos")
    .select(`
      id, nombre, codigo_iata,
      inclusiones(tipo, texto, orden),
      hoteles(
        id, nombre, zona,
        tarifas(
          id, noches, comisionable, impuesto_no_comisionable, notas, costo_base, pct_mk,
          planes_alimentacion(codigo, nombre),
          temporadas(nombre, anio),
          tarifa_precios(acomodacion, precio)
        )
      )
    `)
    .eq("activo", true)
    .order("nombre");

  return (
    <div className="min-h-screen bg-gray-50">
      <header className="text-white py-8 px-6" style={{ backgroundColor: "var(--brand-primary)" }}>
        <div className="max-w-6xl mx-auto flex items-end justify-between">
          <div>
            <h1 className="text-3xl font-semibold">D&apos;spacios Travel</h1>
            <p className="text-sm opacity-80 mt-1">Mayorista de Turismo — Tarifario 2026</p>
          </div>
          {esAgencia && (
            <span className="text-xs bg-white/20 px-3 py-1.5 rounded-full font-medium">
              Modo agencia — Tarifa neta visible
            </span>
          )}
        </div>
      </header>

      <main className="max-w-6xl mx-auto px-6 py-10">
        {!destinos?.length ? (
          <p className="text-center text-gray-400 py-20">Tarifario en preparación.</p>
        ) : (
          <TarifarioView destinos={destinos as any} esAgencia={esAgencia} />
        )}
      </main>
    </div>
  );
}
