import { createClient } from "@/lib/supabase/server";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { CargaMasivaCSV } from "@/components/CargaMasivaCSV";
import { cargarBloqueosMasivo } from "./actions";
import { BloqueosTabla } from "./BloqueosTabla";
import { ControlVuelosTabla, type ControlFila } from "./ControlVuelosTabla";
import { EmpaquetadosTabla } from "./EmpaquetadosTabla";
import { VistaTabs, vistaDeParam } from "./VistaTabs";
import { History } from "lucide-react";
import { conteoPorBloqueo, sumarConteos, esPasado, ocupacionPct, conteoCero, type ConteoSillas } from "@/lib/vuelos/stats";
import { hoyISO } from "@/lib/calc/paquetes";
import { normalizarModalidadLegible, type ModalidadControl } from "@/lib/vuelos/control";
import { miRol, ROLES_CONTRATO_COMPLETO, ROLES_EDITOR_VUELOS_CONTRATO } from "@/lib/roles";

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
  { key: "fecha_emision", label: "Fecha límite de emisión", ejemplo: "2026-05-20" },
  { key: "rangos_edad", label: "Rangos de edad (nombres separados por |)", ejemplo: "" },
  { key: "modalidad_emision", label: "Modalidad de emisión (serie/grupo)", ejemplo: "serie" },
  { key: "estado_emision", label: "Estado de emisión (pendiente/emitido, opcional)", ejemplo: "pendiente" },
  { key: "estado_pago", label: "Estado de pago (pendiente/pagado, opcional)", ejemplo: "pendiente" },
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

export default async function VuelosPage({ searchParams }: { searchParams: Promise<{ vista?: string }> }) {
  const { vista: vistaParam } = await searchParams;
  const vista = vistaDeParam(vistaParam);

  const vistaInventario = vista === "inventario";
  const vistaEmpaquetados = vista === "empaquetados";
  const vistaControl = vista === "control-vuelos";
  const sb = await createClient();

  // Control Vuelos no usa sillas (sin columnas de sillas ni ocupación) — se
  // consulta SOLO en Inventario, para no descargar filas que esa vista nunca
  // usa (criterio ya existente). `bloqueos_vuelo` y `empaquetados` se
  // consultan siempre, una sola vez cada una — ambas son tablas pequeñas
  // (inventario operativo, no transaccional) y las necesitan varias vistas
  // (Empaquetados y Control comparten `empaquetados`; Inventario y Control
  // comparten `bloqueos_vuelo`), así que optimizar por vista aquí solo
  // agregaría complejidad de tipos sin un ahorro real.
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
    // Migración 157: estado de emisión real (contrato_vuelo_control) y
    // estado de pago derivado de las CxP aéreas reales — ya NO se hardcodean
    // a null como antes.
    estado_emision: string | null; estado_pago: string | null;
  };

  const [{ data: bloqueos }, { data: sillas }, { data: empaquetadosData }, { data: dinamicosData, error: dinamicosError }, rol] = await Promise.all([
    sb.from("bloqueos_vuelo").select("*").order("fecha_ida", { ascending: true }),
    vistaInventario
      ? sb.from("sillas").select("bloqueo_id, estado")
      : Promise.resolve({ data: null as { bloqueo_id: number; estado: string | null }[] | null }),
    sb.from("empaquetados").select("*").order("fecha_ida", { ascending: true }),
    // Records/vuelos "por sistema" que YA existen como contratos reales,
    // dinámicos O reservados desde un Empaquetado (defecto 3 original +
    // hallazgo 2 de la revisión posterior — "LISTA UNIFICADA Y RLS"). Se lee
    // por la vista `ventas_vuelo_sistema` (migración 156), NUNCA por
    // `public.ventas` directo: esa tabla no tiene ninguna policy de SELECT
    // para `control_vuelo` (que sí entra a este módulo), así que consultarla
    // directo dejaba la pestaña vacía para ese rol sin ningún aviso — y de
    // paso, la vista nunca expone costo/precio/cliente (evita mostrar
    // finanzas por esta pantalla operativa, ver hallazgo 3 "columna
    // engañosa": ya no hay una cifra que se pueda confundir con una tarifa
    // unitaria). Solo se consulta en la pestaña Empaquetados. `error` se
    // conserva (hallazgo 3, ronda siguiente, "ERRORES DE CONSULTA"): antes se
    // descartaba y un fallo de lectura se veía IDÉNTICO a "no hay
    // empaquetados/contratos", afirmando algo falso ante el usuario.
    vistaEmpaquetados
      ? sb.from("ventas_vuelo_sistema").select("*").order("fecha_salida", { ascending: true })
      : Promise.resolve({ data: null as FilaVentaVueloSistema[] | null, error: null as { message: string } | null }),
    miRol(),
  ]);

  // Rol con acceso real a /dashboard/contratos/[numero] (hallazgo 2, ronda
  // siguiente, "ENLACE DE CONTRATO") — ver el comentario junto a
  // `ROLES_CONTRATO_COMPLETO` en lib/roles.ts.
  const puedeVerContrato = !!rol && ROLES_CONTRATO_COMPLETO.includes(rol);
  // Rol con acceso al editor operativo de vuelos del contrato (migración
  // 157) — incluye control_vuelo a propósito, a diferencia de puedeVerContrato.
  const puedeEditarVuelo = !!rol && ROLES_EDITOR_VUELOS_CONTRATO.includes(rol);

  // Activos vs pasados: una fila cuya fecha de ida ya pasó queda INACTIVA y
  // se mueve al histórico (/dashboard/vuelos/historico). Mismo criterio
  // (esPasado) para bloqueos Y empaquetados.
  const hoy = hoyISO();
  const todos = bloqueos ?? [];
  const activos = todos.filter((b) => !esPasado(b.fecha_ida, hoy));
  const pasados = todos.filter((b) => esPasado(b.fecha_ida, hoy));

  // Empaquetados: "activo" (defecto 3, revisión de PR #268) — un empaquetado
  // apagado a mano (activo=false) NUNCA debe aparecer como si estuviera
  // vigente, sin importar su fecha de ida. Antes solo se filtraba por fecha
  // (esPasado), así que un empaquetado desactivado con fecha_ida futura
  // seguía apareciendo en "Empaquetados activos". Los desactivados-futuros
  // (activo=false, fecha_ida aún no pasa) se muestran junto a los históricos
  // reales (fecha ya pasada) en /dashboard/vuelos/historico — un registro
  // ya no vigente por cualquiera de los dos motivos deja de estar en la
  // vista "activa" y pasa al histórico, que es exactamente el lugar donde
  // ya se consultan registros fuera de rotación.
  const todosEmp = empaquetadosData ?? [];
  const empActivos = todosEmp.filter((e) => e.activo && !esPasado(e.fecha_ida, hoy));
  const empPasados = todosEmp.filter((e) => !e.activo || esPasado(e.fecha_ida, hoy));

  // Origen "Contrato" (defecto 3): sin columna `activo` propia — un contrato
  // no se "desactiva", así que el único criterio es la fecha de salida ya
  // pasada (mismo criterio `esPasado` que el resto de esta pantalla).
  const todosDinamicos = dinamicosData ?? [];
  const dinamicosActivos = todosDinamicos.filter((d) => !esPasado(d.fecha_salida, hoy));

  // Conteo de sillas por estado para cada bloqueo — solo tiene sentido (y solo
  // se calcula) en Inventario; Control Vuelos/Empaquetados no cuentan sillas.
  const conteo: Map<number, ConteoSillas> = vistaInventario ? conteoPorBloqueo(sillas) : new Map();
  const cZero = conteoCero();
  const tot = vistaInventario ? sumarConteos(conteo, activos.map((b) => b.id)) : conteoCero();
  const ocup = vistaInventario ? ocupacionPct(tot) : 0;

  // Filas fusionadas de Control Vuelos: bloqueos (Serie/Grupo) + empaquetados
  // (Sistema, modalidad fija) — clave discriminada, nunca un id crudo compartido.
  const filasControl: ControlFila[] = vistaControl
    ? [
        ...activos.map((b) => ({
          id: `bloqueo:${b.id}`, origen: "bloqueo" as const, numericId: b.id,
          record: b.record, aerolinea: b.aerolinea, ruta: b.ruta,
          fecha_ida: b.fecha_ida, vuelo_ida: b.vuelo_ida, fecha_regreso: b.fecha_regreso, vuelo_regreso: b.vuelo_regreso,
          fecha_emision: b.fecha_emision,
          // Normaliza 'individual' (nombre pre-155, posible durante la
          // ventana de transición 155→157) a 'serie' — nunca se muestra
          // como si fuera un valor distinto ni se cuela sin normalizar.
          modalidad: normalizarModalidadLegible(b.modalidad_emision) as ModalidadControl | null,
          estado_emision: b.estado_emision, estado_pago: b.estado_pago,
        })),
        ...empActivos.map((e) => ({
          id: `sistema:${e.id}`, origen: "sistema" as const, numericId: e.id,
          record: e.record, aerolinea: e.aerolinea, ruta: e.ruta,
          fecha_ida: e.fecha_ida, vuelo_ida: e.vuelo_ida, fecha_regreso: e.fecha_regreso, vuelo_regreso: e.vuelo_regreso,
          fecha_emision: null,
          modalidad: "sistema" as ModalidadControl,
          estado_emision: e.estado_emision, estado_pago: e.estado_pago,
        })),
      ]
    : [];

  const tituloVista = vistaInventario ? "Inventario de vuelos" : vistaEmpaquetados ? "Empaquetados" : "Control vuelos";
  const subtituloVista = vistaInventario
    ? "Bloqueos de sillas negociadas con la aerolínea"
    : vistaEmpaquetados
      ? "Tarifas de Sistema para armar promociones — sin cupo negociado, sin sillas"
      : "Modalidad, emisión y pago por record (bloqueos + empaquetados)";
  const nuevoHref = vistaEmpaquetados ? "/dashboard/vuelos/empaquetados/nuevo" : "/dashboard/vuelos/nuevo";
  const nuevoLabel = vistaEmpaquetados ? "+ Nuevo empaquetado" : "+ Nuevo bloqueo";
  const totalPasados = vistaEmpaquetados ? empPasados.length : pasados.length;

  return (
    <div className="mx-auto max-w-[1500px] p-4 md:p-8">
      <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold text-gray-900">{tituloVista}</h1>
          <p className="mt-1 text-sm text-gray-500">{subtituloVista}</p>
        </div>
        <div className="flex items-center gap-2">
          <Link href={`/dashboard/vuelos/historico?vista=${vista}`}>
            <Button variant="outline" className="gap-2"><History size={16} /> Histórico ({totalPasados})</Button>
          </Link>
          <Link href={nuevoHref}>
            <Button style={{ backgroundColor: "var(--brand-primary)" }}>{nuevoLabel}</Button>
          </Link>
        </div>
      </div>

      <VistaTabs basePath="/dashboard/vuelos" vista={vista} />

      {vistaInventario && (
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
      )}

      {vistaEmpaquetados ? (
        <>
          {/* Hallazgo 3 (ronda siguiente, "ERRORES DE CONSULTA"): un fallo de
              la consulta a `ventas_vuelo_sistema` (RLS, red, timeout) NO debe
              verse igual que "no hay contratos por sistema" — antes
              `dinamicosData` quedaba `null` en cualquiera de los dos casos y
              la pantalla afirmaba "No hay empaquetados activos" aunque en
              realidad la consulta hubiera fallado. Las tarifas promocionales
              (`empaquetadosData`) son una consulta aparte y se siguen
              mostrando normalmente si esa sí tuvo éxito. */}
          {dinamicosError && (
            <div className="mb-4 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
              No se pudieron cargar los vuelos por contrato (dinámicos/empaquetados vinculados a una venta real): {dinamicosError.message}. Los datos de esta sección pueden estar incompletos — intenta recargar la página.
            </div>
          )}
          {!empActivos.length && !dinamicosActivos.length && !dinamicosError ? (
            <div className="rounded-2xl border-2 border-dashed border-gray-200 py-20 text-center text-gray-400">
              <p className="text-lg">No hay empaquetados activos</p>
              <p className="mt-1 text-sm">Crea el primero con el botón “Nuevo empaquetado”.</p>
            </div>
          ) : !empActivos.length && !dinamicosActivos.length && dinamicosError ? null : (
          <EmpaquetadosTabla
            puedeVerContrato={puedeVerContrato}
            puedeEditarVuelo={puedeEditarVuelo}
            filas={[
              ...empActivos.map((e) => ({
                id: `promocion:${e.id}`, origen: "promocion" as const, record: e.record, numeroContrato: null,
                aerolinea: e.aerolinea, ruta: e.ruta,
                fecha_ida: e.fecha_ida, vuelo_ida: e.vuelo_ida, fecha_regreso: e.fecha_regreso, vuelo_regreso: e.vuelo_regreso,
                tarifa_para_empaquetar: e.tarifa_para_empaquetar, estado_emision: e.estado_emision, estado_pago: e.estado_pago,
                activo: e.activo,
              })),
              // Origen "Contrato" (defecto 3 + hallazgo 3 "columna
              // engañosa") — sin backfill/fusión con `empaquetados`: cada
              // contrato es su propia fila, con SOLO los campos que
              // `ventas_vuelo_sistema` realmente tiene. Nunca se muestra
              // costo_aereo (ni se divide entre pax para "inventar" una
              // tarifa unitaria) — la vista ni siquiera lo expone, así que
              // esta columna queda en "—" a propósito para los orígenes
              // "Contrato": no hay una tarifa unitaria verificable que
              // mostrar, mezclar el total del contrato con una tarifa por
              // asiento sería engañoso.
              //
              // Detalle aéreo (ronda siguiente, hallazgo 1 "CONECTAR
              // CONTRATO_VUELOS CON LA LISTA"): `record`/`ruta`/`vuelo_ida`/
              // `vuelo_regreso` ahora vienen de `contrato_vuelos` (vía la
              // vista) para contratos NUEVOS que sí lo insertan — quedan
              // `null` sin inventar nada para el histórico que no lo tiene.
              // `fecha_ida`/`fecha_regreso` siguen viniendo de `ventas`
              // (columnas ya existentes, sin cambio) — son las fechas del
              // VIAJE, no del tramo puntual.
              // Estado de emisión/pago (migración 157): REALES — el de
              // emisión sale de `contrato_vuelo_control` (1:1 por contrato,
              // editable desde el editor operativo nuevo); el de pago se
              // deriva en la vista misma de las CxP aéreas reales (nunca un
              // valor monetario, solo el estado). Antes se fijaban a `null`
              // a mano, así que TODA fila de origen Contrato mostraba
              // siempre "Por confirmar" sin importar el estado real.
              ...dinamicosActivos.map((d) => ({
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
          <div className="rounded-2xl border-2 border-dashed border-gray-200 py-20 text-center text-gray-400">
            <p className="text-lg">No hay vuelos activos</p>
            <p className="mt-1 text-sm">Ni bloqueos ni empaquetados activos por ahora.</p>
          </div>
        ) : (
          <ControlVuelosTabla filas={filasControl} />
        )
      ) : !todos.length ? (
        <div className="rounded-2xl border-2 border-dashed border-gray-200 py-20 text-center text-gray-400">
          <p className="text-lg">No hay bloqueos cargados</p>
          <p className="mt-1 text-sm">Crea el primer record con el botón “Nuevo bloqueo”.</p>
        </div>
      ) : !activos.length ? (
        <div className="rounded-2xl border-2 border-dashed border-gray-200 py-16 text-center text-gray-400">
          <p className="text-lg">No hay vuelos activos</p>
          <p className="mt-1 text-sm">Todos los bloqueos ya pasaron su fecha de ida. Revisa el <Link href={`/dashboard/vuelos/historico?vista=${vista}`} className="text-[var(--brand-accent)] hover:underline">histórico ({pasados.length})</Link>.</p>
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
