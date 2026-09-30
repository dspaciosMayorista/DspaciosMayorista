import { createClient } from "@/lib/supabase/server";
import Link from "next/link";
import { NuevoDestinoDialog } from "../../tarifario/NuevoDestinoDialog";
import { CargarDestinosSugeridos } from "./CargarDestinosSugeridos";
import { DestinosLista } from "./DestinosLista";
import { CATEGORIAS_RECEPTIVO, agruparReceptivosPorDestino, cargarReceptivosSegunRol, filaReceptivoConNombre } from "@/lib/producto/receptivos";
import { puedeEscribir } from "@/lib/roles";

export const dynamic = "force-dynamic";

export default async function DestinosPage() {
  const sb = await createClient();
  // Receptivos = servicios_adicionales con categoría de receptivo
  // (CATEGORIAS_RECEPTIVO, derivada en lib/producto/receptivos.ts) asignados a
  // este destino (destino_id).
  // Sin agregados de PostgREST: carga paginada de `id, nombre, destino_id`,
  // agrupada aquí. De esas MISMAS filas salen el conteo de cada tarjeta y la
  // lista precargada de los destinos chicos (el diálogo abre sin petición;
  // topes en lib/producto/receptivos.ts) — insignia y lista no pueden
  // divergir. Va en paralelo con el listado y NUNCA lo condiciona: cualquier
  // resultado distinto de "ok" deja conteos y precargas en null (se omite la
  // insignia; jamás un 0 no verificado).
  // Primero se resuelve el rol: `servicios_adicionales` solo es legible por
  // ESCRITURA.producto (policy "servicios_adicionales: interno"). Para otro
  // rol que entra a Producto (control_vuelo) la RLS devolvería vacío SIN
  // error, así que ni se consulta. Error al obtener el rol = no se consulta.
  const [{ data: destinos }, receptivos] = await Promise.all([
    sb.from("destinos").select("id, nombre, codigo_iata, pais, hoteles(id, nombre)").order("nombre"),
    cargarReceptivosSegunRol({
      obtenerRol: () => sb.rpc("mi_rol"),
      puedeLeer: (rol) => puedeEscribir("producto", rol),
      pedirPagina: (desde, hasta) =>
        sb
          .from("servicios_adicionales")
          .select("id, nombre, destino_id")
          .in("categoria", [...CATEGORIAS_RECEPTIVO])
          .not("destino_id", "is", null)
          .order("nombre")
          .order("id")
          .range(desde, hasta),
      filaValida: filaReceptivoConNombre,
    }),
  ]);
  if (receptivos.estado === "error_rol" || receptivos.estado === "error_consulta") {
    console.error(`[producto/destinos] etapa=conteo_receptivos estado=${receptivos.estado} detalle=`, receptivos.error);
  }
  const agrupados =
    receptivos.estado === "ok" ? agruparReceptivosPorDestino(receptivos.filas, (destinos ?? []).map((d) => d.id)) : null;

  return (
    <div className="mx-auto max-w-6xl p-4 md:p-8">
      <Link href="/dashboard/producto" className="text-sm text-gray-400 hover:text-gray-600">← Producto</Link>
      <div className="mb-8 mt-2 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold text-gray-900">Destinos</h1>
          <p className="mt-1 text-sm text-gray-500">Ciudades / destinos donde operas (nombre en mayúsculas + código IATA).</p>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <CargarDestinosSugeridos />
          <NuevoDestinoDialog />
        </div>
      </div>

      {!destinos?.length ? (
        <div className="rounded-2xl border-2 border-dashed border-gray-200 py-20 text-center text-gray-400">
          <p className="text-lg">No hay destinos cargados</p>
          <p className="mt-1 text-sm">Crea el primero con “Nuevo destino”.</p>
        </div>
      ) : (
        <DestinosLista
          destinos={destinos}
          receptivosPorDestino={agrupados?.conteos ?? null}
          receptivosPrecargados={agrupados?.precargados ?? null}
        />
      )}
    </div>
  );
}
