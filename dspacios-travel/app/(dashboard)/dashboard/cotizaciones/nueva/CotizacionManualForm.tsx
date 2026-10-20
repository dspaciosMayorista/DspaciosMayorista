"use client";

import { DateInput } from "@/components/ui/DateInput";
import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { formatMoneda } from "@/lib/utils";
import { Plane, Hotel, Car, HeartPulse, Plus, Trash2, GitCompareArrows, Search, TriangleAlert, type LucideIcon } from "lucide-react";
import { crearCotizacionManual, crearComparativaManual, type ServicioManual } from "../manual-actions";
import {
  buscarClienteDocumento,
  type CampoCliente, type CampoClienteCotizacion, type ResultadoBuscarCliente, type ValorCliente,
} from "./buscar-cliente-actions";
import { COOKIE_TENANT, numeroVisible } from "@/lib/tenant";
import { OPCIONES_REF, MAX_OPCIONES, type OpcionRef } from "@/lib/cotizacion/comparativa";
import { sugerirIncluye, NO_INCLUYE_DEFAULT } from "@/lib/cotizacion/incluye";
import { hoyBogota, vigenciaInicial } from "@/lib/cotizacion/vigencia";

type Asesor = { nombre: string | null; email: string };
type Aliado = { id: number; nombre: string; tipo: string | null };

const TIPOS: { value: string; label: string; icon: LucideIcon }[] = [
  { value: "aereo", label: "Aéreo", icon: Plane },
  { value: "hotel", label: "Hotel", icon: Hotel },
  { value: "traslado", label: "Traslado", icon: Car },
  { value: "asistencia", label: "Asistencia médica", icon: HeartPulse },
  { value: "otro", label: "Otro", icon: Plus },
];

type Fila = ServicioManual & { _id: number; opcionRef?: OpcionRef | null };
let _seq = 1;

const lbl = "mb-1 block text-xs font-medium text-gray-600";
const hoy = hoyBogota();

// ── #40 · Búsqueda explícita del cliente por documento ───────────────────────
type Cliente = { nombres: string; apellidos: string; tipoDoc: string; numeroDoc: string; telefono: string; email: string; nacimiento: string };
type ClienteEncontrado = Extract<ResultadoBuscarCliente, { ok: true }>;
type EstadoBusqueda =
  | { fase: "reposo" }
  | { fase: "buscando" }
  | { fase: "error"; mensaje: string }
  | { fase: "listo"; resultado: ClienteEncontrado };

/** Campo del registro central → campo del formulario. El tipo y el número son la clave, no se aplican. */
const CAMPO_FORM: Record<CampoClienteCotizacion, "nombres" | "apellidos" | "telefono" | "email" | "nacimiento"> = {
  nombres: "nombres", apellidos: "apellidos", telefono: "telefono", email: "email", fecha_nacimiento: "nacimiento",
};
const ETIQUETA_CAMPO: Record<CampoClienteCotizacion, string> = {
  nombres: "Nombres", apellidos: "Apellidos", telefono: "Teléfono", email: "Email", fecha_nacimiento: "Fecha de nacimiento",
};
const ETIQUETA_FUENTE: Record<string, string> = {
  captura_interna: "Captura interna", contrato_pasajero: "Pasajero de contrato", cotizacion: "Cotización",
};
const MSG_BUSQUEDA_FALLIDA = "No se pudo consultar el documento. Revisa tu conexión e intenta de nuevo; puedes seguir llenando los datos a mano.";

/** Cookie de agencia activa (no es HttpOnly): sirve para descartar una respuesta de otra agencia. */
function leerTenantCookie(): string {
  if (typeof document === "undefined") return "";
  const m = document.cookie.split("; ").find((c) => c.startsWith(`${COOKIE_TENANT}=`));
  return m ? m.slice(COOKIE_TENANT.length + 1) : "";
}

function fechaProcedencia(iso: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleDateString("es-CO", { timeZone: "America/Bogota", day: "2-digit", month: "short", year: "numeric" });
}

/** Un valor solo es aplicable si cabe en el control del formulario (la fecha de nacimiento es AAAA-MM-DD). */
function valorAplicable(campo: CampoClienteCotizacion, valor: string): boolean {
  if (campo !== "fecha_nacimiento") return true;
  return /^\d{4}-\d{2}-\d{2}$/.test(valor) && !Number.isNaN(Date.parse(valor));
}

function PanelClienteEncontrado({ resultado, cli, confirmando, onUsar, onConfirmar, onCancelar }: {
  resultado: ClienteEncontrado;
  cli: Cliente;
  confirmando: { campo: CampoClienteCotizacion; valor: string } | null;
  onUsar: (campo: CampoClienteCotizacion, valor: string) => void;
  onConfirmar: () => void;
  onCancelar: () => void;
}) {
  if (resultado.estado === "sin_registro") {
    return (
      <p className="rounded-lg bg-gray-50 px-3 py-2 text-xs text-gray-600">
        No hay datos previos para este documento. Continúa llenando los datos del cliente a mano.
      </p>
    );
  }
  const { incompleto, campos } = resultado;
  return (
    <div className="space-y-3 rounded-lg border border-gray-200 bg-gray-50 p-3 text-xs text-gray-700">
      <p className="font-medium text-gray-700">
        Datos de registros anteriores con este documento. No se aplica nada solo: elige cada dato que quieras usar.
      </p>
      {incompleto && (
        <p role="alert" className="flex items-start gap-1.5 rounded-md bg-amber-50 px-2 py-1.5 text-amber-800">
          <TriangleAlert size={14} className="mt-0.5 shrink-0" />
          <span>Lectura incompleta: hay más registros de los que se pueden mostrar. No se ofrece aplicar datos; llénalos a mano.</span>
        </p>
      )}
      {campos.length === 0 && !incompleto && (
        <p className="text-gray-500">Hay un registro, pero sin datos que se puedan aplicar a este formulario.</p>
      )}
      {campos.map((c: CampoCliente) => (
        <div key={c.campo} data-campo={c.campo} className="space-y-1.5">
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-semibold text-gray-700">{ETIQUETA_CAMPO[c.campo]}</span>
            {c.divergencia && <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[11px] font-medium text-amber-800">Valores distintos: elige uno</span>}
            {c.omitidos > 0 && <span className="text-[11px] text-amber-800">+{c.omitidos} sin mostrar</span>}
          </div>
          {c.valores.map((v: ValorCliente) => {
            const actual = cli[CAMPO_FORM[c.campo]];
            const igual = actual === v.valor;
            const sustituye = actual.trim() !== "" && !igual;
            const enConfirmacion = confirmando?.campo === c.campo && confirmando.valor === v.valor;
            const aplicable = !incompleto && valorAplicable(c.campo, v.valor);
            return (
              <div key={v.valor} className="rounded-md border border-gray-200 bg-white px-2.5 py-2">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="font-medium text-gray-800">{v.valor}</span>
                  {aplicable && !enConfirmacion && (
                    <button type="button" disabled={igual} onClick={() => onUsar(c.campo, v.valor)}
                      aria-label={`${sustituye ? "Reemplazar" : "Usar"} ${ETIQUETA_CAMPO[c.campo].toLowerCase()}: ${v.valor}`}
                      className="rounded-md border border-[color:var(--brand-primary)] px-2 py-0.5 text-[11px] font-medium text-[color:var(--brand-primary)] disabled:cursor-default disabled:border-gray-200 disabled:text-gray-400">
                      {igual ? "Ya coincide" : sustituye ? "Reemplazar" : "Usar"}
                    </button>
                  )}
                </div>
                <p className="mt-0.5 text-[11px] text-gray-500">
                  {v.nCapturas} {v.nCapturas === 1 ? "registro" : "registros"}
                  {v.procedencia.map((p, i) => (
                    <span key={i} className="block">
                      {ETIQUETA_FUENTE[p.fuente] ?? "Otra fuente"}
                      {p.contratoNumero ? ` · contrato ${numeroVisible(p.contratoNumero)}` : ""}
                      {p.cotizacionId != null ? ` · cotización #${p.cotizacionId}` : ""}
                      {fechaProcedencia(p.capturadoEn) ? ` · ${fechaProcedencia(p.capturadoEn)}` : ""}
                    </span>
                  ))}
                </p>
                {!incompleto && !valorAplicable(c.campo, v.valor) && (
                  <p className="mt-0.5 text-[11px] text-amber-800">Este valor no tiene un formato que el formulario pueda recibir; escríbelo a mano.</p>
                )}
                {enConfirmacion && (
                  <div role="alertdialog" aria-label={`Confirmar reemplazo de ${ETIQUETA_CAMPO[c.campo].toLowerCase()}`} className="mt-1.5 space-y-1.5 rounded-md bg-amber-50 px-2 py-1.5">
                    <p className="text-amber-900">Ya escribiste «{actual}». ¿Reemplazarlo por «{v.valor}»?</p>
                    <div className="flex gap-2">
                      <button type="button" onClick={onConfirmar} className="rounded-md bg-[color:var(--brand-primary)] px-2 py-0.5 text-[11px] font-medium text-white">Sí, reemplazar</button>
                      <button type="button" onClick={onCancelar} className="rounded-md border border-gray-300 px-2 py-0.5 text-[11px] font-medium text-gray-600">Conservar lo escrito</button>
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      ))}
    </div>
  );
}

function valor(f: { costoNeto: number; modo: "mk" | "ta"; pctMarkup: number; ta: number }): number {
  const c = Number(f.costoNeto) || 0;
  if (f.modo === "ta") return Math.round(Math.max(0, c) + (Number(f.ta) || 0));
  const m = (Number(f.pctMarkup) || 0) / 100;
  if (c <= 0 || m >= 1) return 0;
  return Math.round(c / (1 - m));
}

export function CotizacionManualForm({ asesores, aliados, miNombre, miRolVenta, pctAliadoB2B }: {
  asesores: Asesor[]; aliados: Aliado[]; miNombre: string; miRolVenta: boolean; pctAliadoB2B: number;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [err, setErr] = useState("");

  // Cliente / cabecera
  const [cli, setCli] = useState<Cliente>({ nombres: "", apellidos: "", tipoDoc: "CC", numeroDoc: "", telefono: "", email: "", nacimiento: "" });

  // #40 · Búsqueda del cliente por documento. `busquedaSeq` numera las consultas: cualquier cambio de
  // documento, canal o modo (y desmontar) la incrementa EN EL MISMO EVENTO, así una respuesta tardía
  // ya no coincide con el número vigente y se descarta sin tocar el formulario.
  const [busqueda, setBusqueda] = useState<EstadoBusqueda>({ fase: "reposo" });
  const [confirmando, setConfirmando] = useState<{ campo: CampoClienteCotizacion; valor: string } | null>(null);
  const busquedaSeq = useRef(0);
  useEffect(() => {
    const seq = busquedaSeq;
    return () => { seq.current += 1; };
  }, []);
  function invalidarBusqueda() {
    busquedaSeq.current += 1;
    setBusqueda({ fase: "reposo" });
    setConfirmando(null);
  }

  const [destino, setDestino] = useState("");
  const [fechaIda, setFechaIda] = useState("");
  const [fechaRegreso, setFechaRegreso] = useState("");
  const [pax, setPax] = useState("1");
  const [numNinos, setNumNinos] = useState("0");
  const [tarifaNino, setTarifaNino] = useState("0");
  const [moneda, setMoneda] = useState("COP");
  // Recobro: mayor valor cobrado (oculto al cliente). Distribución según canal.
  const [recobro, setRecobro] = useState("0");
  const [recobroAliado, setRecobroAliado] = useState("0");
  const [plazo, setPlazo] = useState("");
  const [vigencia, setVigencia] = useState(vigenciaInicial(hoy, null, 3));
  const [observaciones, setObservaciones] = useState("");
  const [incluye, setIncluye] = useState("");
  const [noIncluye, setNoIncluye] = useState("");

  // Canal
  const [tipoAsesor, setTipoAsesor] = useState<"interno" | "agencia" | "freelance">("interno");
  const [asesorInterno, setAsesorInterno] = useState(miRolVenta ? miNombre : "");
  const [aliadoNombre, setAliadoNombre] = useState("");

  // Modo explícito «Cotización comparativa» (#35). Apagado por defecto: el flujo simple no cambia.
  const [comparativa, setComparativa] = useState(false);

  // Markup general + servicios
  const [markupGeneral, setMarkupGeneral] = useState("20");
  const [filas, setFilas] = useState<Fila[]>([]);

  // El modo TA solo aplica al aéreo (igual que en el servidor).
  const efModo = (f: Fila): "mk" | "ta" => (f.tipo === "aereo" && f.modo === "ta" ? "ta" : "mk");
  const totalServicios = useMemo(() => filas.reduce((s, f) => s + valor({ ...f, modo: efModo(f) }), 0), [filas]);
  const fmt = (n: number) => formatMoneda(n, moneda);

  const nNinos = Math.max(Number(numNinos) || 0, 0);
  const valorNino = Math.max(Number(tarifaNino) || 0, 0);
  const totalNinos = nNinos * valorNino;
  const recobroN = Math.max(Number(recobro) || 0, 0);
  const totalCotizacion = totalServicios + totalNinos + recobroN;

  // Comparativa: lo común (aéreo, traslados, asistencia, otros) se cuenta UNA vez en cada hotel.
  // NUNCA se suma un hotel con otro: cada opción tiene su propio total.
  const comunes = filas.filter((f) => f.tipo !== "hotel").reduce((s, f) => s + valor({ ...f, modo: efModo(f) }), 0);
  const opcionesUsadas = OPCIONES_REF.filter((r) => filas.some((f) => f.tipo === "hotel" && f.opcionRef === r));
  const hotelSinOpcion = filas.some((f) => f.tipo === "hotel" && !f.opcionRef);
  const totalOpcion = (r: OpcionRef) =>
    comunes + filas.filter((f) => f.tipo === "hotel" && f.opcionRef === r).reduce((s, f) => s + valor({ ...f, modo: efModo(f) }), 0);

  const esB2B = tipoAsesor !== "interno";
  const recobroAliadoN = esB2B ? Math.min(Math.max(Number(recobroAliado) || 0, 0), recobroN) : 0;
  const recobroEmpresaN = recobroN - recobroAliadoN;

  // Cliente final = 100% empresa. Al pasar a B2B, sugiere el % de la config.
  useEffect(() => {
    if (!esB2B) { setRecobroAliado("0"); return; }
    setRecobroAliado((prev) => (Number(prev) > 0 ? prev : String(Math.round(recobroN * pctAliadoB2B))));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tipoAsesor]);

  // El botón solo existe en la cotización dinámica SIMPLE de canal interno; la action vuelve a exigir rol y tenant.
  const puedeBuscarCliente = !comparativa && tipoAsesor === "interno";

  async function buscarCliente() {
    const seq = ++busquedaSeq.current;
    const agenciaAntes = leerTenantCookie();
    setConfirmando(null);
    setBusqueda({ fase: "buscando" });
    let r: ResultadoBuscarCliente;
    try {
      r = await buscarClienteDocumento({ tipoDoc: cli.tipoDoc, numeroDoc: cli.numeroDoc });
    } catch {
      r = { ok: false, codigo: "consulta", error: MSG_BUSQUEDA_FALLIDA };
    }
    if (seq !== busquedaSeq.current) return; // tardía: cambió el documento, el canal, el modo o se desmontó
    if (leerTenantCookie() !== agenciaAntes) { invalidarBusqueda(); return; } // cambió la agencia activa
    setBusqueda(r.ok ? { fase: "listo", resultado: r } : { fase: "error", mensaje: r.error });
  }

  function aplicarDato(campo: CampoClienteCotizacion, valor: string) {
    setCli((c) => ({ ...c, [CAMPO_FORM[campo]]: valor }));
    setConfirmando(null);
  }
  /** Con el campo vacío se aplica directo (el clic ES el consentimiento); con texto distinto pide confirmar. */
  function usarDato(campo: CampoClienteCotizacion, valor: string) {
    const actual = cli[CAMPO_FORM[campo]];
    if (actual === valor) return;
    if (actual.trim() === "") aplicarDato(campo, valor);
    else setConfirmando({ campo, valor });
  }

  function agregar(tipo: string) {
    setFilas((f) => [...f, { _id: _seq++, tipo, plataforma: "", nombre: "", proveedor: "", costoNeto: 0, modo: "mk", pctMarkup: Number(markupGeneral) || 0, ta: 0 }]);
  }
  function set(id: number, k: keyof ServicioManual, v: string | number) {
    setFilas((f) => f.map((x) => (x._id === id ? { ...x, [k]: v } : x)));
  }
  function quitar(id: number) {
    setFilas((f) => f.filter((x) => x._id !== id));
  }

  function guardar() {
    setErr("");
    if (!`${cli.nombres}${cli.apellidos}`.trim()) { setErr("El nombre del cliente es obligatorio."); return; }
    if (!filas.length) { setErr("Agrega al menos un servicio."); return; }
    if (comparativa) {
      if (hotelSinOpcion) { setErr("Asigna cada hotel a una opción (A, B o C)."); return; }
      if (opcionesUsadas.length < 2) { setErr("Una comparativa necesita al menos dos hoteles en opciones distintas."); return; }
      if (tipoAsesor !== "interno" && aliadoId == null) { setErr("Elige el aliado del catálogo (no se admite texto libre en una comparativa)."); return; }
      start(async () => {
        const r = await crearComparativaManual({
          cliente: cli, destino, fechaIda, fechaRegreso, pax: Number(pax) || 0, moneda,
          ninos: nNinos, tarifaNino: valorNino, recobro: recobroN, recobroAliado: recobroAliadoN, tipoAsesor,
          asesorInterno: tipoAsesor === "interno" ? asesorInterno : "",
          agenciaNombre: tipoAsesor === "agencia" ? aliadoNombre : "",
          freelanceNombre: tipoAsesor === "freelance" ? aliadoNombre : "",
          aliadoId: tipoAsesor === "interno" ? null : aliadoId,
          plazo, vigenciaHasta: vigencia, observaciones, incluye, noIncluye,
          servicios: filas.map(({ tipo, plataforma, nombre, proveedor, costoNeto, modo, pctMarkup, ta, opcionRef }) => ({
            tipo, plataforma, nombre, proveedor, costoNeto: Number(costoNeto) || 0, modo, pctMarkup: Number(pctMarkup) || 0, ta: Number(ta) || 0,
            opcionRef: tipo === "hotel" ? (opcionRef ?? null) : null,
          })),
        });
        if (r.ok) router.push(`/dashboard/cotizaciones/${r.id}`);
        else setErr(r.error);
      });
      return;
    }
    start(async () => {
      const r = await crearCotizacionManual({
        cliente: cli, destino, fechaIda, fechaRegreso, pax: Number(pax) || 0, moneda,
        ninos: nNinos, tarifaNino: valorNino,
        recobro: recobroN, recobroAliado: recobroAliadoN,
        tipoAsesor,
        asesorInterno: tipoAsesor === "interno" ? asesorInterno : "",
        agenciaNombre: tipoAsesor === "agencia" ? aliadoNombre : "",
        freelanceNombre: tipoAsesor === "freelance" ? aliadoNombre : "",
        plazo, vigenciaHasta: vigencia, observaciones, incluye, noIncluye,
        servicios: filas.map(({ tipo, plataforma, nombre, proveedor, costoNeto, modo, pctMarkup, ta }) => ({ tipo, plataforma, nombre, proveedor, costoNeto: Number(costoNeto) || 0, modo, pctMarkup: Number(pctMarkup) || 0, ta: Number(ta) || 0 })),
      });
      if (r.ok) router.push(`/dashboard/cotizaciones/${r.id}`);
      else setErr(r.error);
    });
  }

  const aliadosFiltrados0 = aliados.filter((a) => tipoAsesor === "agencia" ? (a.tipo ?? "").toLowerCase().includes("agencia") : tipoAsesor === "freelance" ? (a.tipo ?? "").toLowerCase().includes("free") : true);
  const aliadosFiltrados = aliadosFiltrados0;
  // El aliado de una comparativa sale del catálogo por id; el texto libre no cuenta.
  const aliadoId = aliadosFiltrados.find((a) => a.nombre === aliadoNombre)?.id ?? null;

  return (
    <div className="space-y-6">
      {/* Cliente */}
      <section className="rounded-xl border border-gray-200 bg-white p-5">
        <h2 className="mb-3 text-sm font-semibold text-gray-700">Cliente</h2>
        <div className="grid grid-cols-2 gap-3 md:grid-cols-3">
          <div><label className={lbl}>Nombres</label><Input value={cli.nombres} onChange={(e) => setCli({ ...cli, nombres: e.target.value })} /></div>
          <div><label className={lbl}>Apellidos</label><Input value={cli.apellidos} onChange={(e) => setCli({ ...cli, apellidos: e.target.value })} /></div>
          <div>
            <label className={lbl}>Tipo doc</label>
            <select value={cli.tipoDoc} onChange={(e) => { invalidarBusqueda(); setCli({ ...cli, tipoDoc: e.target.value }); }} className="w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm">
              {["CC", "CE", "PAS", "NIT", "TI"].map((t) => <option key={t}>{t}</option>)}
            </select>
          </div>
          <div>
            <label className={lbl}>N° documento</label>
            <Input value={cli.numeroDoc} onChange={(e) => { invalidarBusqueda(); setCli({ ...cli, numeroDoc: e.target.value }); }} />
            {puedeBuscarCliente && (
              <button type="button" onClick={buscarCliente} disabled={busqueda.fase === "buscando" || cli.numeroDoc.trim() === ""}
                className="mt-1.5 inline-flex items-center gap-1.5 rounded-md border border-gray-300 px-2 py-1 text-[11px] font-medium text-gray-600 hover:border-[color:var(--brand-primary)] hover:text-[color:var(--brand-primary)] disabled:cursor-not-allowed disabled:opacity-50">
                <Search size={12} /> {busqueda.fase === "buscando" ? "Buscando…" : "Buscar cliente"}
              </button>
            )}
          </div>
          <div><label className={lbl}>Fecha de nacimiento</label><DateInput aria-label="Fecha de nacimiento" type="date" value={cli.nacimiento} onValueChange={(dateValue) => setCli({ ...cli, nacimiento: dateValue })} /></div>
          <div><label className={lbl}>Teléfono</label><Input value={cli.telefono} onChange={(e) => setCli({ ...cli, telefono: e.target.value })} /></div>
          <div><label className={lbl}>Email</label><Input value={cli.email} onChange={(e) => setCli({ ...cli, email: e.target.value })} /></div>
        </div>
        {puedeBuscarCliente && busqueda.fase === "error" && (
          <p role="alert" className="mt-3 text-xs text-red-600">{busqueda.mensaje}</p>
        )}
        {puedeBuscarCliente && busqueda.fase === "listo" && (
          <div className="mt-3" aria-live="polite">
            <PanelClienteEncontrado resultado={busqueda.resultado} cli={cli} confirmando={confirmando}
              onUsar={usarDato}
              onConfirmar={() => { if (confirmando) aplicarDato(confirmando.campo, confirmando.valor); }}
              onCancelar={() => setConfirmando(null)} />
          </div>
        )}
        <p className="mt-2 text-xs text-gray-400">Para generar el contrato se exige nombre, tipo y número de documento y fecha de nacimiento del titular.</p>
      </section>

      {/* Datos del viaje */}
      <section className="rounded-xl border border-gray-200 bg-white p-5">
        <h2 className="mb-3 text-sm font-semibold text-gray-700">Datos del viaje</h2>
        <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
          <div className="col-span-2 md:col-span-2"><label className={lbl}>Destino</label><Input value={destino} onChange={(e) => setDestino(e.target.value)} placeholder="Ej. San Andrés" /></div>
          <div><label className={lbl}>Fecha ida</label><DateInput aria-label="Fecha ida" type="date" value={fechaIda} min={hoy} onValueChange={(dateValue) => { const v = dateValue; setFechaIda(v); if (v && vigencia > v) setVigencia(v); }} /></div>
          <div><label className={lbl}>Fecha regreso</label><DateInput aria-label="Fecha regreso" type="date" value={fechaRegreso} min={fechaIda || hoy} onValueChange={(dateValue) => setFechaRegreso(dateValue)} /></div>
          <div><label className={lbl}>Adultos</label><Input type="number" min={1} value={pax} onChange={(e) => setPax(e.target.value)} /></div>
          <div><label className={lbl}>Niños</label><Input type="number" min={0} value={numNinos} onChange={(e) => setNumNinos(e.target.value)} /></div>
          {Number(numNinos) > 0 && (
            <div><label className={lbl}>Tarifa por niño</label><Input type="number" min={0} value={tarifaNino} onChange={(e) => setTarifaNino(e.target.value)} /></div>
          )}
          <div>
            <label className={lbl}>Moneda</label>
            <select value={moneda} onChange={(e) => setMoneda(e.target.value)} className="w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm">
              {["COP", "USD"].map((m) => <option key={m}>{m}</option>)}
            </select>
          </div>
          <div><label className={lbl}>Plazo de pago</label><Input value={plazo} onChange={(e) => setPlazo(e.target.value)} placeholder="Inmediato / 7 días…" /></div>
          <div><label className={lbl}>Vigencia hasta</label><DateInput aria-label="Vigencia hasta" type="date" value={vigencia} min={hoy} max={fechaIda || undefined} onValueChange={(dateValue) => setVigencia(dateValue)} /></div>
        </div>

        {/* Canal */}
        <div className="mt-4 grid grid-cols-1 gap-3 md:grid-cols-2">
          <div>
            <label className={lbl}>Tipo de venta</label>
            <div className="flex gap-1">
              {(["interno", "agencia", "freelance"] as const).map((t) => (
                <button key={t} type="button" onClick={() => { invalidarBusqueda(); setTipoAsesor(t); }}
                  className="flex-1 rounded-lg border px-3 py-2 text-xs font-medium capitalize transition-colors"
                  style={tipoAsesor === t ? { borderColor: "var(--brand-primary)", color: "var(--brand-primary)", backgroundColor: "rgba(29,124,154,0.08)" } : { borderColor: "#e5e7eb", color: "#6b7280" }}>
                  {t}
                </button>
              ))}
            </div>
          </div>
          {tipoAsesor === "interno" ? (
            <div>
              <label className={lbl}>Asesor</label>
              <select value={asesorInterno} onChange={(e) => setAsesorInterno(e.target.value)} className="w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm">
                <option value="">Selecciona</option>
                {asesores.map((a) => <option key={a.email} value={a.nombre ?? a.email}>{a.nombre ?? a.email}</option>)}
              </select>
            </div>
          ) : (
            <div>
              <label className={lbl}>{tipoAsesor === "agencia" ? "Agencia" : "Freelance"}</label>
              <input list="aliados-list" value={aliadoNombre} onChange={(e) => setAliadoNombre(e.target.value)} className="w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm" placeholder="Nombre" />
              <datalist id="aliados-list">{aliadosFiltrados.map((a) => <option key={a.id} value={a.nombre} />)}</datalist>
            </div>
          )}
        </div>
      </section>

      {/* Servicios */}
      <section className="rounded-xl border border-gray-200 bg-white p-5">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-sm font-semibold text-gray-700">Servicios</h2>
          <button type="button" onClick={() => { invalidarBusqueda(); setComparativa((v) => !v); }} aria-pressed={comparativa}
            className="inline-flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-xs font-medium transition-colors"
            style={comparativa ? { borderColor: "var(--brand-primary)", color: "var(--brand-primary)", backgroundColor: "rgba(29,124,154,0.08)" } : { borderColor: "#e5e7eb", color: "#6b7280" }}>
            <GitCompareArrows size={14} /> Cotización comparativa
          </button>
          <label className="flex items-center gap-2 text-xs text-gray-500">
            Markup general
            <Input type="number" min={0} className="h-8 w-20" value={markupGeneral} onChange={(e) => setMarkupGeneral(e.target.value)} />%
          </label>
        </div>
        {comparativa && (
          <p className="mb-3 rounded-lg bg-sky-50 px-3 py-2 text-xs text-sky-800">
            Compara hasta {MAX_OPCIONES} hoteles del mismo viaje y moneda. El aéreo (uno o varios tramos), los traslados y los demás
            servicios son <b>comunes</b> y se cuentan una sola vez en el total de cada hotel. Asigna cada hotel a una opción (A, B o C).
            El cliente elige <b>un</b> hotel: los hoteles no se suman entre sí.
          </p>
        )}
        <div className="mb-3 flex flex-wrap gap-1.5">
          {TIPOS.map((t) => (
            <button key={t.value} type="button" onClick={() => agregar(t.value)}
              className="inline-flex items-center gap-1.5 rounded-lg border border-gray-300 px-3 py-1.5 text-xs font-medium text-gray-600 hover:border-[color:var(--brand-primary)] hover:text-[color:var(--brand-primary)]">
              <t.icon size={14} /> {t.label}
            </button>
          ))}
        </div>

        {filas.length === 0 ? (
          <p className="rounded-lg bg-gray-50 px-3 py-6 text-center text-sm text-gray-400">Agrega servicios con los botones de arriba.</p>
        ) : (
          <div className="space-y-3">
            {filas.map((f) => {
              const esAereo = f.tipo === "aereo";
              const v = valor({ ...f, modo: efModo(f) });
              const modoTa = esAereo && f.modo === "ta";
              return (
                <div key={f._id} className="rounded-lg border border-gray-200 p-3">
                  <div className="mb-2 flex items-center justify-between gap-2">
                    <select value={f.tipo} onChange={(e) => set(f._id, "tipo", e.target.value)} className="rounded-md border border-gray-300 bg-white px-2 py-1 text-xs font-semibold">
                      {TIPOS.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
                    </select>
                    {esAereo && (
                      <div className="flex overflow-hidden rounded-md border border-gray-300 text-[11px] font-medium">
                        {(["mk", "ta"] as const).map((m) => (
                          <button key={m} type="button" onClick={() => set(f._id, "modo", m)}
                            className="px-2.5 py-1 transition-colors"
                            style={f.modo === m ? { backgroundColor: "var(--brand-primary)", color: "white" } : { color: "#6b7280" }}>
                            {m === "mk" ? "Markup" : "TA (fijo)"}
                          </button>
                        ))}
                      </div>
                    )}
                    {comparativa && (f.tipo === "hotel" ? (
                      <select aria-label="Opción de la comparativa" value={f.opcionRef ?? ""}
                        onChange={(e) => setFilas((fs) => fs.map((x) => (x._id === f._id ? { ...x, opcionRef: (e.target.value || null) as OpcionRef | null } : x)))}
                        className="rounded-md border px-2 py-1 text-xs font-semibold" style={f.opcionRef ? { borderColor: "var(--brand-primary)" } : { borderColor: "#f59e0b" }}>
                        <option value="">Opción…</option>
                        {OPCIONES_REF.map((r) => <option key={r} value={r}>Opción {r}</option>)}
                      </select>
                    ) : (
                      <span className="rounded-full bg-gray-100 px-2 py-0.5 text-[11px] font-medium text-gray-500">Común a todas las opciones</span>
                    ))}
                    <button type="button" onClick={() => quitar(f._id)} className="ml-auto text-gray-400 hover:text-red-500"><Trash2 size={15} /></button>
                  </div>
                  <div className="grid grid-cols-2 gap-2 md:grid-cols-3">
                    <div><label className={lbl}>Plataforma</label><Input value={f.plataforma} onChange={(e) => set(f._id, "plataforma", e.target.value)} placeholder="Despegar, JetSMART…" /></div>
                    <div><label className={lbl}>Nombre del servicio</label><Input value={f.nombre} onChange={(e) => set(f._id, "nombre", e.target.value)} /></div>
                    <div><label className={lbl}>Proveedor</label><Input value={f.proveedor} onChange={(e) => set(f._id, "proveedor", e.target.value)} /></div>
                    <div><label className={lbl}>Costo neto</label><Input type="number" min={0} value={f.costoNeto || ""} onChange={(e) => set(f._id, "costoNeto", Number(e.target.value))} /></div>
                    {modoTa ? (
                      <div><label className={lbl}>TA (valor fijo)</label><Input type="number" min={0} value={f.ta || ""} onChange={(e) => set(f._id, "ta", Number(e.target.value))} /></div>
                    ) : (
                      <div><label className={lbl}>Markup %</label><Input type="number" min={0} value={f.pctMarkup} onChange={(e) => set(f._id, "pctMarkup", Number(e.target.value))} /></div>
                    )}
                    <div>
                      <label className={lbl}>Valor</label>
                      <div className="rounded-lg border border-gray-200 bg-gray-50 px-3 py-2 text-sm font-semibold tabular-nums" style={{ color: "var(--brand-primary)" }}>{fmt(v)}</div>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}

        <div className="mt-4 flex items-center justify-between border-t border-gray-100 pt-3">
          <span className="text-sm font-medium text-gray-600">Subtotal servicios</span>
          <span className="text-lg font-semibold tabular-nums text-gray-700">{fmt(totalServicios)}</span>
        </div>
      </section>

      {/* Recobro (oculto al cliente) */}
      <section className="rounded-xl border border-gray-200 bg-white p-5">
        <div className="mb-1 flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-sm font-semibold text-gray-700">Recobro</h2>
          <span className="rounded-full bg-amber-50 px-2 py-0.5 text-[11px] font-medium text-amber-700">No se muestra al cliente</span>
        </div>
        <p className="mb-3 text-xs text-gray-400">Mayor valor que entra al total pero no corresponde a un servicio. Va oculto dentro de la tarifa.</p>
        <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
          <div><label className={lbl}>Valor del recobro</label><Input type="number" min={0} value={recobro} onChange={(e) => setRecobro(e.target.value)} /></div>
          {esB2B ? (
            <>
              <div>
                <div className="mb-1 flex items-center justify-between">
                  <label className={lbl}>Para el aliado (free/agencia)</label>
                  <button type="button" onClick={() => setRecobroAliado(String(Math.round(recobroN * pctAliadoB2B)))}
                    className="text-[11px] font-medium text-[#1D7C9A] hover:underline">Sugerir {Math.round(pctAliadoB2B * 100)}%</button>
                </div>
                <Input type="number" min={0} max={recobroN} value={recobroAliado} onChange={(e) => setRecobroAliado(e.target.value)} />
              </div>
              <div>
                <label className={lbl}>Para la empresa</label>
                <div className="rounded-lg border border-gray-200 bg-gray-50 px-3 py-2 text-sm font-semibold tabular-nums text-gray-700">{fmt(recobroEmpresaN)}</div>
              </div>
            </>
          ) : (
            <div className="md:col-span-2 flex items-end">
              <p className="text-xs text-gray-500">Cliente final → recobro <b>100% para la empresa</b>.</p>
            </div>
          )}
        </div>
      </section>

      {/* Total por opción (comparativa): sin total global */}
      {comparativa && (
        <section className="rounded-xl border p-5" style={{ borderColor: "var(--brand-primary)", backgroundColor: "rgba(29,124,154,0.04)" }}>
          <h2 className="mb-2 text-sm font-semibold text-gray-700">Total por opción</h2>
          {opcionesUsadas.length === 0 ? (
            <p className="text-xs text-gray-400">Asigna al menos dos hoteles a una opción para ver el total de cada una.</p>
          ) : (
            <div className="space-y-2">
              {opcionesUsadas.map((r) => {
                const nombreHotel = filas.find((f) => f.tipo === "hotel" && f.opcionRef === r)?.nombre || `Hotel ${r}`;
                const total = totalOpcion(r) + totalNinos + recobroN;
                return (
                  <div key={r} className="flex items-center justify-between rounded-lg bg-white px-3 py-2 text-sm">
                    <span className="font-medium text-gray-700">Opción {r} · {nombreHotel}</span>
                    <span className="text-lg font-bold tabular-nums" style={{ color: "var(--brand-primary)" }}>{fmt(total)}</span>
                  </div>
                );
              })}
              <p className="text-[11px] text-gray-400">Cada total incluye los servicios comunes una sola vez{nNinos > 0 ? ", los niños" : ""}{recobroN > 0 ? " y el recobro (oculto)" : ""}. No hay un total global: se elige un hotel.</p>
            </div>
          )}
        </section>
      )}

      {/* Total cotización */}
      {!comparativa && (
      <section className="rounded-xl border p-5" style={{ borderColor: "var(--brand-primary)", backgroundColor: "rgba(29,124,154,0.04)" }}>
        <div className="space-y-1 text-sm text-gray-600">
          <div className="flex items-center justify-between"><span>Servicios (adultos)</span><span className="tabular-nums">{fmt(totalServicios)}</span></div>
          {nNinos > 0 && <div className="flex items-center justify-between"><span>Niños ({nNinos} × {fmt(valorNino)})</span><span className="tabular-nums">{fmt(totalNinos)}</span></div>}
          {recobroN > 0 && <div className="flex items-center justify-between text-gray-400"><span>Recobro (oculto)</span><span className="tabular-nums">{fmt(recobroN)}</span></div>}
        </div>
        <div className="mt-3 flex items-center justify-between border-t border-gray-200 pt-3">
          <span className="text-sm font-semibold text-gray-700">Total cotización</span>
          <span className="text-2xl font-bold tabular-nums" style={{ color: "var(--brand-primary)" }}>{fmt(totalCotizacion)}</span>
        </div>
      </section>
      )}

      {/* Incluye / No incluye */}
      <section className="rounded-xl border border-gray-200 bg-white p-5">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-sm font-semibold text-gray-700">Incluye / No incluye</h2>
          <p className="text-xs text-gray-400">Aparece en la cotización para que el cliente sepa qué cubre. Editable.</p>
        </div>
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          <div>
            <div className="mb-1 flex items-center justify-between">
              <label className={lbl}>Incluye</label>
              <button type="button" onClick={() => setIncluye(sugerirIncluye(filas.map((f) => ({ tipo: f.tipo, nombre: f.nombre }))))}
                className="text-[11px] font-medium text-[#1D7C9A] hover:underline">Generar desde servicios</button>
            </div>
            <textarea value={incluye} onChange={(e) => setIncluye(e.target.value)} rows={5} placeholder="Una línea por ítem…" className="w-full rounded-lg border border-gray-300 p-2 text-sm" />
          </div>
          <div>
            <div className="mb-1 flex items-center justify-between">
              <label className={lbl}>No incluye</label>
              <button type="button" onClick={() => setNoIncluye(NO_INCLUYE_DEFAULT)}
                className="text-[11px] font-medium text-[#1D7C9A] hover:underline">Usar texto sugerido</button>
            </div>
            <textarea value={noIncluye} onChange={(e) => setNoIncluye(e.target.value)} rows={5} placeholder="Una línea por ítem…" className="w-full rounded-lg border border-gray-300 p-2 text-sm" />
          </div>
        </div>
      </section>

      <div>
        <label className={lbl}>Observaciones</label>
        <textarea value={observaciones} onChange={(e) => setObservaciones(e.target.value)} rows={2} className="w-full rounded-lg border border-gray-300 p-2 text-sm" />
      </div>

      {err && <p className="text-sm text-red-600">{err}</p>}
      <div className="flex items-center gap-3">
        <Button onClick={guardar} disabled={pending} style={{ backgroundColor: "var(--brand-primary)" }}>
          {pending ? "Guardando…" : comparativa ? "Generar comparativa" : "Generar cotización"}
        </Button>
        <span className="text-xs text-gray-400">{comparativa ? "Se guarda como comparativa: no se cobra ni se convierte hasta elegir una opción." : "Se guarda como cotización (estado abierta)."}</span>
      </div>
    </div>
  );
}
