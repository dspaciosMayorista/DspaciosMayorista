import { createClient } from "@/lib/supabase/server";
import Link from "next/link";
import { ServiciosClient } from "./ServiciosClient";
import { CargaMasivaCSV } from "@/components/CargaMasivaCSV";
import { cargarServiciosMasivo } from "./actions";
import { Alcance262Provider, type Datos262 } from "./Alcance262";

export const dynamic = "force-dynamic";

const COLS_SERVICIOS = [
  { key: "nombre", label: "Nombre", ejemplo: "Tour Islas del Rosario" },
  { key: "destino", label: "Destino (vacío = todos)", ejemplo: "CARTAGENA" },
  { key: "alcance", label: "Alcance si no hay destino (nacional/internacional)", ejemplo: "nacional" },
  { key: "proveedor", label: "Proveedor", ejemplo: "" },
  { key: "tarifa_neta", label: "Precio por persona (neto)", ejemplo: "120000" },
  { key: "precio_grupo", label: "Precio por grupo (pax_desde-pax_hasta:precio | …)", ejemplo: "1-4:500000|5-10:400000" },
  { key: "categoria", label: "Categoría (tour_traslado / asistencia / otro)", ejemplo: "tour_traslado" },
  { key: "rangos_edad", label: "Rangos de edad (nombres separados por |)", ejemplo: "" },
  { key: "temporada", label: "Temporada", ejemplo: "" },
  { key: "liquidacion", label: "Liquidación (dia/noche/paquete)", ejemplo: "paquete" },
  { key: "descripcion", label: "Descripción del tour", ejemplo: "" },
  { key: "recargo_individual", label: "Recargo individual (1 pax)", ejemplo: "0" },
  { key: "precio_infante", label: "Precio de infante 0-1,99 años (neto; vacío = paga como adulto, 0 = gratis)", ejemplo: "" },
];

export default async function ServiciosPage() {
  const sb = await createClient();
  const [{ data: serviciosRaw }, { data: proveedores }, { data: destinos }, { data: rangos }, { data: temporadasRaw }] = await Promise.all([
    sb.from("servicios_adicionales").select("id, nombre, temporada, precio_persona, proveedor_id, destino_id, alcance, moneda, rangos_edad, categoria, liquidacion, descripcion, recargo_individual, precio_infante, foto_url, proveedores(nombre), destinos(nombre), servicio_tarifa_pax(pax_desde, pax_hasta, precio, temporada)").order("nombre"),
    sb.from("proveedores").select("id, nombre").eq("tipo", "servicios").order("nombre"),
    sb.from("destinos").select("id, nombre, codigo_iata").order("nombre"),
    sb.from("rangos_edad").select("id, denominacion, edad_min, edad_max").order("edad_min"),
    sb.from("servicio_temporadas").select("id, servicio_id, nombre, fecha_inicio, fecha_fin, compra_inicio, compra_fin, prioridad, precio_persona, precio_infante, recargo_individual, servicio_suplementos_franja(id, hora_desde, hora_hasta, tramo, tipo, valor, cobro)").order("prioridad", { ascending: false }),
  ]);
  // Si la migración 255 aún no está aplicada la lectura con franjas falla: se vuelve a leer sin ellas y el editor avisa (no se rompe la página).
  let temporadasLeidas = temporadasRaw as unknown as Array<Record<string, unknown> & { id: number; servicio_id: number; nombre: string }> | null;
  let franjasDisponibles = true;
  if (!temporadasLeidas) {
    franjasDisponibles = false;
    const { data: sinFranjas } = await sb.from("servicio_temporadas").select("id, servicio_id, nombre, fecha_inicio, fecha_fin, compra_inicio, compra_fin, prioridad, precio_persona, precio_infante, recargo_individual").order("prioridad", { ascending: false });
    temporadasLeidas = sinFranjas as unknown as typeof temporadasLeidas;
  }
  // 262 (provisional): tipo de receptivo, precios por trayecto y rango de pasajeros de las franjas. Lecturas APARTE y tolerantes: si la migración no está
  // aplicada (columna/tabla inexistente) el editor lo avisa y la página sigue funcionando como antes.
  const datos262: Datos262 = { disponible: false, clasif: {}, precios: {} };
  const clasifRes = await sb.from("servicios_adicionales").select("id, tipo_receptivo, combo_incluye_traslado, combo_traslado_alcance");
  if (!clasifRes.error) {
    datos262.disponible = true;
    for (const r of (clasifRes.data ?? []) as unknown as Array<{ id: number; tipo_receptivo: Datos262["clasif"][number]["tipo_receptivo"]; combo_incluye_traslado: boolean | null; combo_traslado_alcance: Datos262["clasif"][number]["combo_traslado_alcance"] }>) {
      datos262.clasif[r.id] = { tipo_receptivo: r.tipo_receptivo ?? null, combo_incluye_traslado: r.combo_incluye_traslado ?? null, combo_traslado_alcance: r.combo_traslado_alcance ?? null };
    }
    const preciosRes = await sb.from("servicio_precio_alcance").select("servicio_temporada_id, alcance, pax_desde, pax_hasta, precio").order("alcance").order("pax_desde", { nullsFirst: true });
    if (preciosRes.error) datos262.disponible = false; // sin la tabla no hay editor de precios (la migración 262 no está aplicada)
    else for (const r of (preciosRes.data ?? []) as unknown as Array<{ servicio_temporada_id: number; alcance: "trayecto" | "ida_regreso"; pax_desde: number | null; pax_hasta: number | null; precio: number }>) {
      (datos262.precios[r.servicio_temporada_id] ??= []).push({ alcance: r.alcance, pax_desde: r.pax_desde, pax_hasta: r.pax_hasta, precio: Number(r.precio) });
    }
    const pax = await sb.from("servicio_suplementos_franja").select("id, pax_desde, pax_hasta");
    if (!pax.error) {
      const porId = new Map(((pax.data ?? []) as unknown as Array<{ id: number; pax_desde: number | null; pax_hasta: number | null }>).map((x) => [x.id, x]));
      for (const t of temporadasLeidas ?? []) {
        const fr = (t as unknown as { servicio_suplementos_franja?: Array<Record<string, unknown> & { id: number }> }).servicio_suplementos_franja;
        for (const f of fr ?? []) { const x = porId.get(f.id); if (x) { f.pax_desde = x.pax_desde; f.pax_hasta = x.pax_hasta; } }
      }
    }
  }
  const servicios = (serviciosRaw ?? []) as unknown as Parameters<typeof ServiciosClient>[0]["servicios"];

  // Rangos por grupo de cada TEMPORADA (servicio_tarifa_pax.temporada != GENERAL),
  // tomados de los rangos ya embebidos en cada servicio. Clave: servicioId|temporada.
  type Tier = { pax_desde: number; pax_hasta: number; precio: number; temporada?: string | null };
  const gruposTemp: Record<string, Tier[]> = {};
  for (const s of serviciosRaw ?? []) {
    for (const t of ((s as unknown as { servicio_tarifa_pax?: Tier[] }).servicio_tarifa_pax ?? [])) {
      const tmp = t.temporada ?? "GENERAL";
      if (tmp !== "GENERAL") (gruposTemp[`${s.id}|${tmp}`] ??= []).push(t);
    }
  }

  // Agrupa las temporadas por servicio (con sus rangos por grupo) para el cliente.
  type TempRow = Parameters<typeof ServiciosClient>[0]["temporadas"][number][number];
  const temporadasPorServicio: Record<number, TempRow[]> = {};
  for (const t of temporadasLeidas ?? []) {
    const { servicio_suplementos_franja, ...resto } = t as typeof t & { servicio_suplementos_franja?: TempRow["franjas"] };
    (temporadasPorServicio[t.servicio_id] ??= []).push({
      ...(resto as unknown as TempRow), grupos: gruposTemp[`${t.servicio_id}|${t.nombre}`] ?? [],
      franjas: franjasDisponibles ? (servicio_suplementos_franja ?? []).map((f) => ({ ...f, valor: Number(f.valor) })) : null,
    });
  }

  return (
    <div className="mx-auto max-w-7xl p-4 md:p-8">
      <Link href="/dashboard/producto" className="text-sm text-gray-400 hover:text-gray-600">← Producto</Link>
      <h1 className="mb-1 mt-2 text-2xl font-semibold text-gray-900">Servicios adicionales</h1>
      <p className="mb-6 text-sm text-gray-500">Asistencias, traslados y tours (costo neto).</p>
      <div className="mb-6">
        <CargaMasivaCSV
          titulo="Carga masiva de servicios (CSV)"
          nota="Crea primero los Destinos (Producto → Destinos) y, si lo asignarás, el Proveedor de servicios (Producto → Proveedores). Los Rangos de edad se crean en Configuración (menú lateral)."
          descripcion="Cada fila = un servicio. Precio por persona y/o por grupo (rangos de pax: 1-4:500000|5-10:400000). Categoría: tour_traslado, asistencia u otro. Rangos de edad por nombre, separados por |. El destino y el proveedor (si los pones) deben existir."
          columnas={COLS_SERVICIOS}
          onSubmit={cargarServiciosMasivo}
          nombreArchivo="plantilla_servicios"
        />
      </div>
      <Alcance262Provider value={datos262}>
        <ServiciosClient servicios={servicios} proveedores={proveedores ?? []} destinos={destinos ?? []} rangos={rangos ?? []} temporadas={temporadasPorServicio} />
      </Alcance262Provider>
    </div>
  );
}
