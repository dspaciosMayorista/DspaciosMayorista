import { createClient } from "@/lib/supabase/server";
import Link from "next/link";
import { BloqueosTabla } from "../BloqueosTabla";
import { ControlVuelosTabla, type ControlFila } from "../ControlVuelosTabla";
import { EmpaquetadosTabla } from "../EmpaquetadosTabla";
import { VistaTabs, vistaDeParam } from "../VistaTabs";
import { conteoPorBloqueo, sumarConteos, esPasado, ventaPct, ocupacionPct, conteoCero, type ConteoSillas } from "@/lib/vuelos/stats";
import { hoyISO } from "@/lib/calc/paquetes";
import { normalizarModalidadLegible, type ModalidadControl } from "@/lib/vuelos/control";
import { miRol, ROLES_CONTRATO_COMPLETO, ROLES_EDITOR_VUELOS_CONTRATO } from "@/lib/roles";

export const dynamic = "force-dynamic";

function Card({ label, valor, color, sub }: { label: string; valor: number | string; color?: string; sub?: string }) {
  return (
    <div className="rounded-xl border border-gray-200 bg-white p-4">
      <div className="text-xs uppercase tracking-wide text-gray-400">{label}</div>
      <div className="mt-1 text-2xl font-bold tabular-nums" style={{ color: color ?? "var(--brand-primary)" }}>{valor}</div>
      {sub && <div className="mt-0.5 text-[11px] text-gray-400">{sub}</div>}
    </div>
  );
}

export default async function HistoricoVuelosPage({ searchParams }: { searchParams: Promise<{ vista?: string }> }) {
  const { vista: vistaParam } = await searchParams;
  const vista = vistaDeParam(vistaParam);

  const vistaInventario = vista === "inventario";
  const vistaEmpaquetados = vista === "empaquetados";
  const vistaControl = vista === "control-vuelos";
  const sb = await createClient();

  // Detalle aéreo mínimo desde contrato_vuelos (ronda siguiente, hallazgo 1
  // "CONECTAR CONTRATO_VUELOS CON LA LISTA") — NULL para contratos sin
  // contrato_vuelos (todo el histórico dinámico anterior a esa migración).
  type FilaVentaVueloSistema = {
    numero_contrato: string; tenant: string; tipo_paquete: string | null; aerolinea: string | null;
    fecha_salida: string | null; fecha_regreso: string | null; empaquetado_ref_id: number | null;
    origen: "dinamico" | "empaquetado";
    record: string | null; origen_codigo: string | null; destino_codigo: string | null; ruta: string | null;
    vuelo_ida: string | null; vuelo_regreso: string | null;
    hora_salida_ida: string | null; hora_llegada_ida: string | null;
    hora_salida_reg: string | null; hora_llegada_reg: string | null;
    vuelo_fecha_ida: string | null; vuelo_fecha_regreso: string | null;
    // Migración 157: estado de emisión real y de pago derivado — ya NO se
    // hardcodean a null como antes.
    estado_emision: string | null; estado_pago: string | null;
  };

  // Control Vuelos no usa sillas — se consulta SOLO en Inventario (ver misma
  // nota en ../page.tsx). `bloqueos_vuelo`/`empaquetados` se consultan
  // siempre, una sola vez cada una (mismo criterio que ../page.tsx).
  //
  // Hallazgo 5 (ronda siguiente, "ALCANCE FUNCIONAL"): el histórico de
  // Empaquetados solo mostraba promociones (`empaquetados`) — los contratos
  // dinámicos/empaquetado_ref_id YA PASADOS nunca aparecían aquí, aunque
  // `../page.tsx` sí los mostrara mientras estaban activos. Se consulta la
  // MISMA vista mínima y con el MISMO aislamiento estricto que la pantalla
  // activa (`ventas_vuelo_sistema`, migración 156 — ver
  // `acceso_ventas_vuelo_sistema()`) — nunca `public.ventas` directo. Sin
  // backfill de nada: solo aparecen los contratos que la vista ya expone.
  const [{ data: bloqueos }, { data: sillas }, { data: empaquetadosData }, { data: dinamicosData, error: dinamicosError }, rol] = await Promise.all([
    sb.from("bloqueos_vuelo").select("*").order("fecha_ida", { ascending: false }),
    vistaInventario
      ? sb.from("sillas").select("bloqueo_id, estado")
      : Promise.resolve({ data: null as { bloqueo_id: number; estado: string | null }[] | null }),
    sb.from("empaquetados").select("*").order("fecha_ida", { ascending: false }),
    vistaEmpaquetados
      ? sb.from("ventas_vuelo_sistema").select("*").order("fecha_salida", { ascending: false })
      : Promise.resolve({ data: null as FilaVentaVueloSistema[] | null, error: null as { message: string } | null }),
    miRol(),
  ]);

  const puedeVerContrato = !!rol && ROLES_CONTRATO_COMPLETO.includes(rol);
  const puedeEditarVuelo = !!rol && ROLES_EDITOR_VUELOS_CONTRATO.includes(rol);

  const hoy = hoyISO();
  const todos = bloqueos ?? [];
  const pasados = todos.filter((b) => esPasado(b.fecha_ida, hoy));
  const conteo: Map<number, ConteoSillas> = vistaInventario ? conteoPorBloqueo(sillas) : new Map();
  const cZero = conteoCero();

  // Mismo criterio que ../page.tsx (defecto 3, revisión de PR #268): el
  // histórico agrupa TODO lo que ya no está en la vista "activa" — fecha de
  // ida pasada O desactivado a mano (activo=false), aunque su fecha de ida
  // todavía no llegue. Un desactivado-futuro no tiene otro lugar donde
  // consultarse una vez sale de "Empaquetados activos".
  const todosEmp = empaquetadosData ?? [];
  const empPasados = todosEmp.filter((e) => !e.activo || esPasado(e.fecha_ida, hoy));

  // Origen "Contrato" en el histórico (hallazgo 5, "ALCANCE FUNCIONAL"):
  // mismo criterio `esPasado` que ../page.tsx usa para los activos — un
  // contrato no se "desactiva", así que lo único que lo mueve al histórico
  // es que su fecha de salida ya pasó.
  const todosDinamicos = dinamicosData ?? [];
  const dinamicosPasados = todosDinamicos.filter((d) => esPasado(d.fecha_salida, hoy));

  // Conteo HISTÓRICO GENERAL = de TODOS los bloqueos (vida del inventario).
  // Solo tiene sentido (y solo se calcula) en Inventario.
  const gen = vistaInventario ? sumarConteos(conteo, todos.map((b) => b.id)) : conteoCero();
  // Conteo de los bloqueos ya pasados (la lista del histórico).
  const totPas = vistaInventario ? sumarConteos(conteo, pasados.map((b) => b.id)) : conteoCero();

  const filasControl: ControlFila[] = vistaControl
    ? [
        ...pasados.map((b) => ({
          id: `bloqueo:${b.id}`, origen: "bloqueo" as const, numericId: b.id,
          record: b.record, aerolinea: b.aerolinea, ruta: b.ruta,
          fecha_ida: b.fecha_ida, vuelo_ida: b.vuelo_ida, fecha_regreso: b.fecha_regreso, vuelo_regreso: b.vuelo_regreso,
          fecha_emision: b.fecha_emision,
          modalidad: normalizarModalidadLegible(b.modalidad_emision) as ModalidadControl | null,
          estado_emision: b.estado_emision, estado_pago: b.estado_pago,
        })),
        ...empPasados.map((e) => ({
          id: `sistema:${e.id}`, origen: "sistema" as const, numericId: e.id,
          record: e.record, aerolinea: e.aerolinea, ruta: e.ruta,
          fecha_ida: e.fecha_ida, vuelo_ida: e.vuelo_ida, fecha_regreso: e.fecha_regreso, vuelo_regreso: e.vuelo_regreso,
          fecha_emision: null,
          modalidad: "sistema" as ModalidadControl,
          estado_emision: e.estado_emision, estado_pago: e.estado_pago,
        })),
      ]
    : [];

  const tituloVista = vistaInventario ? "Histórico de vuelos" : vistaEmpaquetados ? "Empaquetados histórico" : "Control vuelos histórico";
  const subtituloVista = vistaInventario
    ? "Bloqueos cuya fecha de ida ya pasó (inactivos). Entra a un record para ver sus pasajeros."
    : vistaEmpaquetados
      ? "Empaquetados cuya fecha de ida ya pasó, o que fueron desactivados a mano."
      : "Modalidad, emisión y pago de los records ya pasados (bloqueos + empaquetados).";

  return (
    <div className="mx-auto max-w-[1500px] p-4 md:p-8">
      <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
        <div>
          <Link href={`/dashboard/vuelos?vista=${vista}`} className="text-sm text-gray-400 hover:text-gray-600">← Inventario de vuelos</Link>
          <h1 className="mt-1 text-2xl font-semibold text-gray-900">{tituloVista}</h1>
          <p className="mt-1 text-sm text-gray-500">{subtituloVista}</p>
        </div>
      </div>

      <VistaTabs basePath="/dashboard/vuelos/historico" vista={vista} />

      {vistaInventario && (
        <>
          {/* Conteo histórico GENERAL (todos los bloqueos de la operación) */}
          <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-gray-400">Conteo histórico general (toda la operación)</div>
          <div className="mb-8 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
            <Card label="Bloques totales" valor={todos.length} />
            <Card label="Sillas totales" valor={gen.total} color="var(--brand-primary)" />
            <Card label="Vendidas" valor={gen.conf} color="var(--brand-accent)" sub={`${ventaPct(gen)}% del total`} />
            <Card label="En plazo" valor={gen.plazo} color="#C99A2E" />
            <Card label="Devueltas" valor={gen.dev} color="#C0392B" />
            <Card label="No vendidas" valor={gen.nven} color="#6b7280" />
          </div>
        </>
      )}

      {/* Contratos dinámicos/empaquetado_ref_id ya pasados (hallazgo 5,
          ronda siguiente, "ALCANCE FUNCIONAL") — mismo origen "Contrato" y
          la MISMA vista mínima (`ventas_vuelo_sistema`) que ../page.tsx usa
          para los activos, ya no acotado a solo promociones. */}
      {vistaEmpaquetados ? (
        <>
          {dinamicosError && (
            <div className="mb-4 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
              No se pudieron cargar los vuelos por contrato (dinámicos/empaquetados vinculados a una venta real): {dinamicosError.message}. Los datos de esta sección pueden estar incompletos — intenta recargar la página.
            </div>
          )}
          {!empPasados.length && !dinamicosPasados.length && !dinamicosError ? (
            <div className="rounded-2xl border-2 border-dashed border-gray-200 py-16 text-center text-gray-400">
              <p className="text-lg">Aún no hay empaquetados en el histórico</p>
              <p className="mt-1 text-sm">Pasan aquí automáticamente cuando su fecha de ida queda atrás.</p>
            </div>
          ) : !empPasados.length && !dinamicosPasados.length && dinamicosError ? null : (
          <EmpaquetadosTabla
            puedeVerContrato={puedeVerContrato}
            puedeEditarVuelo={puedeEditarVuelo}
            filas={[
              ...empPasados.map((e) => ({
                id: `promocion:${e.id}`, origen: "promocion" as const, record: e.record, numeroContrato: null,
                aerolinea: e.aerolinea, ruta: e.ruta,
                fecha_ida: e.fecha_ida, vuelo_ida: e.vuelo_ida, fecha_regreso: e.fecha_regreso, vuelo_regreso: e.vuelo_regreso,
                tarifa_para_empaquetar: e.tarifa_para_empaquetar, estado_emision: e.estado_emision, estado_pago: e.estado_pago,
                activo: e.activo,
              })),
              // Estado de emisión/pago REALES (migración 157) — ver el mismo
              // comentario en ../page.tsx.
              ...dinamicosPasados.map((d) => ({
                id: `contrato:${d.numero_contrato}`, origen: "contrato" as const, record: d.record, numeroContrato: d.numero_contrato,
                aerolinea: d.aerolinea, ruta: d.ruta,
                fecha_ida: d.fecha_salida, vuelo_ida: d.vuelo_ida, fecha_regreso: d.fecha_regreso, vuelo_regreso: d.vuelo_regreso,
                tarifa_para_empaquetar: null, estado_emision: d.estado_emision, estado_pago: d.estado_pago,
                activo: true,
              })),
            ]}
          />
          )}
        </>
      ) : vistaControl ? (
        !filasControl.length ? (
          <div className="rounded-2xl border-2 border-dashed border-gray-200 py-16 text-center text-gray-400">
            <p className="text-lg">Aún no hay vuelos en el histórico</p>
            <p className="mt-1 text-sm">Pasan aquí automáticamente cuando su fecha de ida queda atrás.</p>
          </div>
        ) : (
          <ControlVuelosTabla filas={filasControl} />
        )
      ) : !pasados.length ? (
        <div className="rounded-2xl border-2 border-dashed border-gray-200 py-16 text-center text-gray-400">
          <p className="text-lg">Aún no hay vuelos en el histórico</p>
          <p className="mt-1 text-sm">Los bloqueos pasan aquí automáticamente cuando su fecha de ida queda atrás.</p>
        </div>
      ) : (
        <>
          <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-gray-400">
            Bloqueos pasados ({pasados.length}) · vendidas {totPas.conf}/{totPas.total} · ocupación {ocupacionPct(totPas)}%
          </div>
          <BloqueosTabla
            filas={pasados.map((b) => {
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
