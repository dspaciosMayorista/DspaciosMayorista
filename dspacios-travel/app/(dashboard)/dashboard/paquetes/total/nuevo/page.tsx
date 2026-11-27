import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { PaqueteTotalForm, ENTRADA_VACIA } from "../PaqueteTotalForm";
import { cargarCatalogos } from "../catalogos";
import { entradaDesdeFilas, entradaParaCopia, lecturaFuenteConError } from "@/lib/paqueteDinamico/entradaDesdeFilas";
import { idCopiaValido } from "@/lib/vuelos/duplicarVuelo";

export const dynamic = "force-dynamic";

type Fila = Record<string, unknown>;

export default async function NuevoPaqueteTotalPage({ searchParams }: { searchParams: Promise<{ copiarDe?: string | string[] }> }) {
  const cat = await cargarCatalogos();
  // #61: duplicar. La fuente se lee con la sesión de quien consulta (RLS). Se copian cabecera, vuelos, hoteles y servicios como borrador NUEVO: sin identidad, sin publicar, con las
  // fechas y precios para REVISAR antes de guardar. Nunca se copian cotizaciones, versiones, ventas ni la publicación (el guardado inserta con publicado = false).
  const copiarDe = idCopiaValido((await searchParams).copiarDe);
  let inicial = ENTRADA_VACIA;
  let fuenteNombre: string | null = null;
  let noEncontrado = false;
  let falloLectura = false;
  if (copiarDe) {
    // Tablas nuevas (274) sin tipos generados.
    const sb = (await createClient()) as unknown as { from: (t: string) => { select: (s: string) => { eq: (k: string, v: number) => { order: (k: string) => Promise<{ data: Fila[] | null; error: unknown }>; maybeSingle: () => Promise<{ data: Fila | null; error: unknown }> } } } };
    const cab = await sb.from("paquete_din").select("*").eq("id", copiarDe).maybeSingle();
    const p = cab.data;
    if (lecturaFuenteConError(cab)) falloLectura = true;       // B95-5: un error de lectura NO es «no encontrado» ni una lista vacía
    else if (!p) noEncontrado = true;
    else {
      const [v, h, s] = await Promise.all([
        sb.from("paquete_din_vuelos").select("*").eq("paquete_id", copiarDe).order("orden"),
        sb.from("paquete_din_hoteles").select("*").eq("paquete_id", copiarDe).order("orden"),
        sb.from("paquete_din_servicios").select("*").eq("paquete_id", copiarDe).order("orden"),
      ]);
      if (lecturaFuenteConError(v, h, s)) falloLectura = true; // sin vuelos/hoteles/servicios completos NO se arma una copia «válida pero incompleta»
      else {
        inicial = entradaParaCopia(entradaDesdeFilas(p, v.data ?? [], h.data ?? [], s.data ?? [], copiarDe));
        fuenteNombre = String(p.nombre ?? "");
      }
    }
  }
  return (
    <div className="mx-auto max-w-4xl p-4 md:p-8">
      <Link href="/dashboard/paquetes" className="text-sm text-gray-400 hover:text-gray-600">← Volver a paquetes</Link>
      <h1 className="mb-1 mt-2 text-2xl font-bold" style={{ color: "var(--brand-primary)" }}>Nuevo paquete dinámico total</h1>
      <p className="mb-4 text-sm text-gray-500">Producto reutilizable armado con vuelo, hotel y servicios propios. No es el tipo «dinámico» con vuelo de sistema ni una cotización manual.</p>
      {fuenteNombre != null && (
        <p className="mb-4 rounded-lg border border-[var(--brand-accent)] bg-[rgba(38,187,217,0.06)] px-4 py-3 text-sm text-gray-700" data-testid="aviso-duplicado">
          Duplicando «{fuenteNombre}»: se copiaron la configuración, los vuelos, los hoteles y los servicios como un borrador <b>sin publicar</b>. Revisa las fechas (compra y viaje) y los precios antes de guardar y publicar; el paquete original no cambia.
        </p>
      )}
      {noEncontrado && <p className="mb-4 rounded-lg bg-amber-50 px-4 py-3 text-sm text-amber-800" role="alert">No se encontró el paquete a duplicar; el formulario está vacío.</p>}
      {falloLectura ? (
        <p className="mb-4 rounded-lg bg-red-50 px-4 py-3 text-sm text-red-800" role="alert" data-testid="fallo-lectura-copia">
          No se pudo leer completo el paquete a duplicar (vuelos, hoteles o servicios), así que no se armó ninguna copia. Vuelve a intentarlo; si se repite, avisa a soporte.
        </p>
      ) : (
        <PaqueteTotalForm inicial={inicial} {...cat} />
      )}
    </div>
  );
}
