import { createClient } from "@/lib/supabase/server";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { CargaMasivaCSV } from "@/components/CargaMasivaCSV";
import { cargarBloqueosMasivo } from "./actions";
import { BloqueosTabla } from "./BloqueosTabla";
import { History } from "lucide-react";
import { conteoPorBloqueo, sumarConteos, esPasado, ocupacionPct } from "@/lib/vuelos/stats";
import { hoyISO } from "@/lib/calc/paquetes";

export const dynamic = "force-dynamic";

const COLS_BLOQUEOS = [
  { key: "record", label: "Record", ejemplo: "L93FYZ" },
  { key: "aerolinea", label: "Aerolínea", ejemplo: "JETSMART" },
  { key: "proveedor", label: "Proveedor aéreo", ejemplo: "" },
  { key: "destino", label: "Destino", ejemplo: "CARTAGENA" },
  { key: "origen", label: "Origen", ejemplo: "MDE" },
  { key: "ruta", label: "Ruta", ejemplo: "MDE - CTG - MDE" },
  { key: "vuelo_ida", label: "Vuelo ida", ejemplo: "5410" },
  { key: "fecha_ida", label: "Fecha ida (AAAA-MM-DD)", ejemplo: "2026-06-16" },
  { key: "hora_salida_ida", label: "Hora salida ida", ejemplo: "08:30" },
  { key: "hora_llegada_ida", label: "Hora llegada ida", ejemplo: "09:45" },
  { key: "vuelo_regreso", label: "Vuelo regreso", ejemplo: "5414" },
  { key: "fecha_regreso", label: "Fecha regreso (AAAA-MM-DD)", ejemplo: "2026-06-19" },
  { key: "hora_salida_reg", label: "Hora salida reg", ejemplo: "18:00" },
  { key: "hora_llegada_reg", label: "Hora llegada reg", ejemplo: "19:15" },
  { key: "cupos_total", label: "Cupos", ejemplo: "30" },
  { key: "tarifa_neta", label: "Tarifa neta (pago aerolínea)", ejemplo: "200000" },
  { key: "tarifa_para_empaquetar", label: "Tarifa empaquetar (reventa)", ejemplo: "242022" },
  { key: "fecha_devolucion", label: "Fecha devolución", ejemplo: "2026-06-01" },
  { key: "fecha_emision", label: "Fecha emisión", ejemplo: "2026-05-20" },
  { key: "rangos_edad", label: "Rangos de edad (nombres separados por |)", ejemplo: "" },
  { key: "notas", label: "Notas", ejemplo: "" },
];

function ResumenCard({ label, valor, color }: { label: string; valor: number | string; color: string }) {
  return (
    <div className="rounded-xl border border-gray-200 bg-white p-4">
      <div className="text-xs uppercase tracking-wide text-gray-400">{label}</div>
      <div className="mt-1 text-2xl font-bold tabular-nums" style={{ color }}>{valor}</div>
    </div>
  );
}

export default async function VuelosPage() {
  const sb = await createClient();
  const [{ data: bloqueos }, { data: sillas }] = await Promise.all([
    sb.from("bloqueos_vuelo").select("*").order("fecha_ida", { ascending: true }),
    sb.from("sillas").select("bloqueo_id, estado"),
  ]);

  // Activos vs pasados: un bloqueo cuya fecha de ida ya pasó queda INACTIVO y se
  // mueve al histórico (/dashboard/vuelos/historico). El control solo ve activos.
  const hoy = hoyISO();
  const todos = bloqueos ?? [];
  const activos = todos.filter((b) => !esPasado(b.fecha_ida, hoy));
  const pasados = todos.filter((b) => esPasado(b.fecha_ida, hoy));

  // Conteo de sillas por estado para cada bloqueo (control de vuelos).
  const conteo = conteoPorBloqueo(sillas);
  const cZero = { disp: 0, plazo: 0, conf: 0, dev: 0, nven: 0, total: 0 };
  const tot = sumarConteos(conteo, activos.map((b) => b.id));
  const ocup = ocupacionPct(tot);

  return (
    <div className="mx-auto max-w-[1500px] p-4 md:p-8">
      <div className="mb-8 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold text-gray-900">Inventario de vuelos</h1>
          <p className="mt-1 text-sm text-gray-500">Bloqueos de sillas negociadas con la aerolínea</p>
        </div>
        <div className="flex items-center gap-2">
          <Link href="/dashboard/vuelos/historico">
            <Button variant="outline" className="gap-2"><History size={16} /> Histórico ({pasados.length})</Button>
          </Link>
          <Link href="/dashboard/vuelos/nuevo">
            <Button style={{ backgroundColor: "var(--brand-primary)" }}>+ Nuevo bloqueo</Button>
          </Link>
        </div>
      </div>

      <div className="mb-6">
        <CargaMasivaCSV
          titulo="Carga masiva de bloqueos (CSV)"
          nota="Crea primero los Destinos (Producto → Destinos) y, si lo asignarás, el Proveedor aéreo (Producto → Proveedores). Los Rangos de edad se crean en Configuración (menú lateral)."
          descripcion="Cada fila = un bloqueo. El destino debe existir; las sillas se generan según 'cupos'. Fechas en formato AAAA-MM-DD."
          columnas={COLS_BLOQUEOS}
          onSubmit={cargarBloqueosMasivo}
          nombreArchivo="plantilla_bloqueos"
        />
      </div>

      {!todos.length ? (
        <div className="rounded-2xl border-2 border-dashed border-gray-200 py-20 text-center text-gray-400">
          <p className="text-lg">No hay bloqueos cargados</p>
          <p className="mt-1 text-sm">Crea el primer record con el botón “Nuevo bloqueo”.</p>
        </div>
      ) : !activos.length ? (
        <div className="rounded-2xl border-2 border-dashed border-gray-200 py-16 text-center text-gray-400">
          <p className="text-lg">No hay vuelos activos</p>
          <p className="mt-1 text-sm">Todos los bloqueos ya pasaron su fecha de ida. Revisa el <Link href="/dashboard/vuelos/historico" className="text-[var(--brand-accent)] hover:underline">histórico ({pasados.length})</Link>.</p>
        </div>
      ) : (
        <>
          {/* Mini-dashboard de vuelos ACTIVOS (fecha de ida futura) */}
          <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-gray-400">Vuelos activos</div>
          <div className="mb-6 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
            <ResumenCard label="Bloques activos" valor={activos.length} color="var(--brand-primary)" />
            <ResumenCard label="Disponibles" valor={tot.disp} color="var(--brand-success)" />
            <ResumenCard label="En plazo" valor={tot.plazo} color="#C99A2E" />
            <ResumenCard label="Confirmadas" valor={tot.conf} color="var(--brand-accent)" />
            <ResumenCard label="Devueltas" valor={tot.dev} color="#C0392B" />
            <ResumenCard label="Ocupación" valor={`${ocup}%`} color="var(--brand-primary)" />
          </div>

          {/* Tabla de salidas ACTIVAS con filtros (Ruta, Mes) y totales */}
          <BloqueosTabla
            filas={activos.map((b) => {
              const c = conteo.get(b.id) ?? cZero;
              return {
                id: b.id, record: b.record, aerolinea: b.aerolinea, ruta: b.ruta,
                fecha_ida: b.fecha_ida, vuelo_ida: b.vuelo_ida, fecha_regreso: b.fecha_regreso, vuelo_regreso: b.vuelo_regreso,
                fecha_devolucion: b.fecha_devolucion, cupos_total: b.cupos_total ?? 0,
                disp: c.disp, plazo: c.plazo, conf: c.conf, dev: c.dev, nven: c.nven,
              };
            })}
          />
        </>
      )}
    </div>
  );
}
