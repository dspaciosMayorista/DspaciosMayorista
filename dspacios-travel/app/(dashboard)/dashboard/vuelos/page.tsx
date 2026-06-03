import { createClient } from "@/lib/supabase/server";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { formatFechaLarga } from "@/lib/utils";
import { EliminarBloqueoBtn } from "./EliminarBloqueoBtn";
import { CargaMasivaCSV } from "@/components/CargaMasivaCSV";
import { cargarBloqueosMasivo } from "./actions";

export const dynamic = "force-dynamic";

const COLS_BLOQUEOS = [
  { key: "record", label: "Record", ejemplo: "L93FYZ" },
  { key: "aerolinea", label: "Aerolínea", ejemplo: "JETSMART" },
  { key: "destino", label: "Destino", ejemplo: "CARTAGENA" },
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
  { key: "tarifa_para_empaquetar", label: "Tarifa empaquetar", ejemplo: "242022" },
  { key: "fecha_devolucion", label: "Fecha devolución", ejemplo: "2026-06-01" },
  { key: "fecha_emision", label: "Fecha emisión", ejemplo: "2026-05-20" },
  { key: "notas", label: "Notas", ejemplo: "" },
];

type Conteo = { disp: number; plazo: number; conf: number; dev: number; nven: number };

function ResumenCard({ label, valor, color }: { label: string; valor: number; color: string }) {
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

  // Conteo de sillas por estado para cada bloqueo (control de vuelos).
  const conteo = new Map<number, Conteo>();
  for (const s of sillas ?? []) {
    const c = conteo.get(s.bloqueo_id) ?? { disp: 0, plazo: 0, conf: 0, dev: 0, nven: 0 };
    if (s.estado === "disponible" || s.estado === "cambio_entrante") c.disp++;
    else if (s.estado === "en_plazo") c.plazo++;
    else if (s.estado === "confirmada") c.conf++;
    else if (s.estado === "devuelta") c.dev++;
    else if (s.estado === "no_vendida") c.nven++;
    conteo.set(s.bloqueo_id, c);
  }
  const cZero: Conteo = { disp: 0, plazo: 0, conf: 0, dev: 0, nven: 0 };
  const tot = (bloqueos ?? []).reduce(
    (a, b) => {
      const c = conteo.get(b.id) ?? cZero;
      return {
        disp: a.disp + c.disp, plazo: a.plazo + c.plazo, conf: a.conf + c.conf,
        dev: a.dev + c.dev, nven: a.nven + c.nven,
      };
    },
    { disp: 0, plazo: 0, conf: 0, dev: 0, nven: 0 }
  );

  return (
    <div className="mx-auto max-w-5xl p-4 md:p-8">
      <div className="mb-8 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold text-gray-900">Inventario de vuelos</h1>
          <p className="mt-1 text-sm text-gray-500">Bloqueos de sillas negociadas con la aerolínea</p>
        </div>
        <Link href="/dashboard/vuelos/nuevo">
          <Button style={{ backgroundColor: "var(--brand-primary)" }}>+ Nuevo bloqueo</Button>
        </Link>
      </div>

      <div className="mb-6">
        <CargaMasivaCSV
          titulo="Carga masiva de bloqueos (CSV)"
          descripcion="Cada fila = un bloqueo. El destino debe existir; las sillas se generan según 'cupos'. Fechas en formato AAAA-MM-DD."
          columnas={COLS_BLOQUEOS}
          onSubmit={cargarBloqueosMasivo}
          nombreArchivo="plantilla_bloqueos"
        />
      </div>

      {!bloqueos?.length ? (
        <div className="rounded-2xl border-2 border-dashed border-gray-200 py-20 text-center text-gray-400">
          <p className="text-lg">No hay bloqueos cargados</p>
          <p className="mt-1 text-sm">Crea el primer record con el botón “Nuevo bloqueo”.</p>
        </div>
      ) : (
        <>
          {/* Tarjetas resumen (control de vuelos) */}
          <div className="mb-6 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
            <ResumenCard label="Bloques" valor={bloqueos.length} color="var(--brand-primary)" />
            <ResumenCard label="Disponibles" valor={tot.disp} color="var(--brand-success)" />
            <ResumenCard label="En plazo" valor={tot.plazo} color="#C99A2E" />
            <ResumenCard label="Confirmadas" valor={tot.conf} color="var(--brand-accent)" />
            <ResumenCard label="Devueltas" valor={tot.dev} color="#C0392B" />
          </div>

          {/* Tabla de salidas */}
          <div className="overflow-x-auto rounded-xl border border-gray-200 bg-white">
            <table className="w-full min-w-[920px] text-sm">
              <thead>
                <tr className="bg-gray-50 text-left text-xs uppercase text-gray-400">
                  <th className="px-3 py-2">Record</th>
                  <th className="px-3 py-2">Aerolínea</th>
                  <th className="px-3 py-2">Ruta</th>
                  <th className="px-3 py-2">Ida</th>
                  <th className="px-3 py-2">Regreso</th>
                  <th className="px-3 py-2 text-center">Disp</th>
                  <th className="px-3 py-2 text-center">Plazo</th>
                  <th className="px-3 py-2 text-center">Conf</th>
                  <th className="px-3 py-2 text-center">Dev</th>
                  <th className="px-3 py-2 text-center">N.Ven</th>
                  <th className="px-3 py-2 text-center">Total</th>
                  <th className="px-3 py-2 text-center">Ocup.</th>
                  <th className="px-3 py-2">F. Dev.</th>
                  <th className="px-3 py-2"></th>
                </tr>
              </thead>
              <tbody>
                {bloqueos.map((b) => {
                  const c = conteo.get(b.id) ?? cZero;
                  const total = b.cupos_total ?? 0;
                  const ocup = total > 0 ? Math.round(((c.plazo + c.conf) / total) * 100) : 0;
                  return (
                    <tr key={b.id} className="border-t border-gray-50">
                      <td className="px-3 py-2">
                        <Link href={`/dashboard/vuelos/${b.id}`} className="font-mono text-sm font-semibold text-[#1D7C9A] hover:underline">{b.record}</Link>
                      </td>
                      <td className="px-3 py-2 text-gray-600">{b.aerolinea ?? "—"}</td>
                      <td className="px-3 py-2 text-gray-600">{b.ruta ?? "—"}</td>
                      <td className="px-3 py-2 text-xs text-gray-500">
                        {formatFechaLarga(b.fecha_ida)}{b.vuelo_ida ? ` · ${b.vuelo_ida}` : ""}
                      </td>
                      <td className="px-3 py-2 text-xs text-gray-500">
                        {formatFechaLarga(b.fecha_regreso)}{b.vuelo_regreso ? ` · ${b.vuelo_regreso}` : ""}
                      </td>
                      <td className="px-3 py-2 text-center font-semibold tabular-nums" style={{ color: "var(--brand-success)" }}>{c.disp}</td>
                      <td className="px-3 py-2 text-center tabular-nums" style={{ color: "#C99A2E" }}>{c.plazo}</td>
                      <td className="px-3 py-2 text-center tabular-nums" style={{ color: "var(--brand-accent)" }}>{c.conf}</td>
                      <td className="px-3 py-2 text-center tabular-nums text-red-600">{c.dev}</td>
                      <td className="px-3 py-2 text-center tabular-nums text-gray-400">{c.nven}</td>
                      <td className="px-3 py-2 text-center font-semibold tabular-nums">{total}</td>
                      <td className="px-3 py-2 text-center tabular-nums text-gray-500">{ocup}%</td>
                      <td className="px-3 py-2 text-xs text-gray-400">{formatFechaLarga(b.fecha_devolucion)}</td>
                      <td className="px-3 py-2 text-right"><EliminarBloqueoBtn id={b.id} record={b.record} /></td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  );
}
