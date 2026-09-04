"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { formatCOP, formatFechaLarga } from "@/lib/utils";
import {
  crearTemporada, actualizarTemporada, eliminarTemporada, copiarTemporadasDesdeHotel,
  crearTarifa, actualizarTarifa, eliminarTarifa,
} from "../actions";
import { pctInicialParaFormulario, restriccionImplicitaHotel } from "@/lib/cotizacion/condicionPagoCatalogo";
import { etiquetasRestriccion } from "@/lib/cotizacion/etiquetasCondicion";

type RangoFechas = { fecha_inicio: string; fecha_fin: string };
type Temporada = {
  id: number; nombre: string; fecha_inicio: string | null; fecha_fin: string | null;
  prioridad?: number; compra_inicio?: string | null; compra_fin?: string | null;
  tipo?: string | null; descuento_valor?: number | null; min_noches?: number;
  rangos?: unknown; blackouts?: unknown; regimen_restringido?: string | null;
  condicion_pago_tipo?: string | null; condicion_pago_pct_inicial?: number | null; condicion_pago_dias_saldo?: number | null;
};

const CONDICIONES_PAGO_HOTEL: { value: string; label: string }[] = [
  { value: "sin_condicion", label: "Sin condición especial" },
  { value: "pago_total", label: "Requiere pago total" },
  { value: "anticipo_saldo", label: "Anticipo y saldo" },
];

// jsonb → lista de rangos válidos.
function asRangos(v: unknown): RangoFechas[] {
  if (!Array.isArray(v)) return [];
  return v.filter((r): r is RangoFechas =>
    !!r && typeof r === "object" &&
    typeof (r as { fecha_inicio?: unknown }).fecha_inicio === "string" &&
    typeof (r as { fecha_fin?: unknown }).fecha_fin === "string");
}

const TIPOS_TEMP: { value: string; label: string }[] = [
  { value: "tarifa", label: "Temporada / tarifa de reemplazo" },
  { value: "descuento_pct", label: "Promo: descuento %" },
  { value: "descuento_monto", label: "Promo: descuento $ por pax" },
  { value: "promo_noche_gratis", label: "Promo: N noches, 1 gratis" },
];
const TIPO_BADGE: Record<string, string> = {
  tarifa: "tarifa", descuento_pct: "promo %", descuento_monto: "promo $", promo_noche_gratis: "noche gratis",
};
type Tarifa = {
  id: number; tipo_habitacion: string | null; alimentacion: string | null; temporada: string | null;
  neto_sencilla: number | null; neto_doble: number | null; neto_triple: number | null;
  neto_multiple: number | null; neto_nino: number | null; neto_nino2: number | null;
  neto_infante: number | null; nota_infante: string | null;
};

const lbl = "mb-1 block text-xs font-medium text-gray-600";
const sel = "rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm";

// Hoy en formato yyyy-mm-dd (zona del navegador). Una vigencia está VENCIDA si su
// "compra hasta" ya pasó: deja de alimentar el tarifario pero NO se borra; pasa
// al histórico del hotel para consultar y comparar contratos viejos.
const hoyLocal = () => new Date().toLocaleDateString("en-CA");
const esVencida = (t: Temporada, hoy: string): boolean => !!t.compra_fin && t.compra_fin < hoy;

export function HotelDetalleClient({
  hotelId, categorias, regimenes, temporadas, tarifas, otrosHoteles, adultsOnly = false,
}: { hotelId: number; categorias: string[]; regimenes: string[]; temporadas: Temporada[]; tarifas: Tarifa[]; otrosHoteles: { id: number; nombre: string }[]; adultsOnly?: boolean }) {
  const hoy = hoyLocal();
  const vencidasNombres = new Set(temporadas.filter((t) => esVencida(t, hoy)).map((t) => t.nombre));
  return (
    <div className="space-y-8">
      <TemporadasBox hotelId={hotelId} temporadas={temporadas} otrosHoteles={otrosHoteles} hoy={hoy} regimenes={regimenes} />
      <TarifasBox hotelId={hotelId} categorias={categorias} regimenes={regimenes} temporadas={temporadas} tarifas={tarifas} vencidasNombres={vencidasNombres} adultsOnly={adultsOnly} />
    </div>
  );
}

function TemporadasBox({ hotelId, temporadas, otrosHoteles, hoy, regimenes }: { hotelId: number; temporadas: Temporada[]; otrosHoteles: { id: number; nombre: string }[]; hoy: string; regimenes: string[] }) {
  const [editId, setEditId] = useState<number | null>(null);
  const [nombre, setNombre] = useState("");
  const [ini, setIni] = useState("");
  const [fin, setFin] = useState("");
  const [prioridad, setPrioridad] = useState("1");
  const [minNoches, setMinNoches] = useState("1");
  const [compraIni, setCompraIni] = useState("");
  const [compraFin, setCompraFin] = useState("");
  const [tipo, setTipo] = useState("tarifa");
  const [descuento, setDescuento] = useState("");
  const [regimenRestringido, setRegimenRestringido] = useState("");
  const [rangosExtra, setRangosExtra] = useState<RangoFechas[]>([]);
  const [blackouts, setBlackouts] = useState<RangoFechas[]>([]);
  const [condicionPagoTipo, setCondicionPagoTipo] = useState("sin_condicion");
  const [condicionPagoPct, setCondicionPagoPct] = useState("");
  const [condicionPagoDias, setCondicionPagoDias] = useState("");
  const [pending, start] = useTransition();
  const [err, setErr] = useState("");
  const [aviso, setAviso] = useState("");

  const esPromo = tipo !== "tarifa";
  const esDescuento = tipo === "descuento_pct" || tipo === "descuento_monto";
  const esNocheGratis = tipo === "promo_noche_gratis";
  const esAnticipoSaldo = condicionPagoTipo === "anticipo_saldo";
  const editando = editId != null;

  function reset() {
    setEditId(null); setNombre(""); setIni(""); setFin(""); setPrioridad("1"); setMinNoches("1");
    setCompraIni(""); setCompraFin(""); setTipo("tarifa"); setDescuento(""); setRegimenRestringido("");
    setRangosExtra([]); setBlackouts([]); setCondicionPagoTipo("sin_condicion"); setCondicionPagoPct(""); setCondicionPagoDias("");
    setErr("");
  }

  function editar(t: Temporada) {
    setEditId(t.id);
    setNombre(t.nombre);
    const rangos = asRangos(t.rangos);
    // El primer rango es el principal (Viaje desde/hasta); el resto son adicionales.
    setIni(rangos[0]?.fecha_inicio ?? t.fecha_inicio ?? "");
    setFin(rangos[0]?.fecha_fin ?? t.fecha_fin ?? "");
    setRangosExtra(rangos.slice(1));
    setBlackouts(asRangos(t.blackouts));
    setPrioridad(String(t.prioridad ?? 1));
    setMinNoches(String(t.min_noches ?? 1));
    setCompraIni(t.compra_inicio ?? "");
    setCompraFin(t.compra_fin ?? "");
    setTipo(t.tipo ?? "tarifa");
    setDescuento(t.descuento_valor != null ? String(t.descuento_valor) : "");
    setRegimenRestringido(t.regimen_restringido ?? "");
    // Inicializar SIEMPRE con lo guardado — nunca con el default "sin_condicion".
    setCondicionPagoTipo(t.condicion_pago_tipo ?? "sin_condicion");
    setCondicionPagoPct(pctInicialParaFormulario(t.condicion_pago_pct_inicial));
    setCondicionPagoDias(t.condicion_pago_dias_saldo != null ? String(t.condicion_pago_dias_saldo) : "");
    setErr("");
    if (typeof window !== "undefined") window.scrollTo({ top: 0, behavior: "smooth" });
  }

  function guardar() {
    if (!nombre.trim()) { setErr("Ponle un nombre."); return; }
    setErr(""); setAviso("");
    const payload = {
      hotelId, nombre, inicio: ini, fin,
      prioridad: Number(prioridad) || 1,
      minNoches: Math.max(1, Number(minNoches) || 1),
      compraInicio: compraIni, compraFin: compraFin,
      tipo, descuentoValor: esDescuento ? Number(descuento) || 0 : null,
      regimenRestringido: regimenRestringido || null,
      rangos: rangosExtra, blackouts,
      condicionPagoTipo,
      condicionPagoPctInicial: condicionPagoPct === "" ? null : Number(condicionPagoPct),
      condicionPagoDiasSaldo: condicionPagoDias === "" ? null : Number(condicionPagoDias),
    };
    start(async () => {
      const r = editId == null ? await crearTemporada(payload) : await actualizarTemporada(editId, payload);
      if (!r.ok) { setErr(r.error); return; }
      if (r.aviso) setAviso(r.aviso);
      reset();
    });
  }

  const activas = temporadas.filter((t) => !esVencida(t, hoy));
  const vencidas = temporadas.filter((t) => esVencida(t, hoy));

  const filaTemp = (t: Temporada, historico = false) => {
    const tp = t.tipo ?? "tarifa";
    const promo = tp !== "tarifa";
    return (
      <li key={t.id} className="flex flex-wrap items-center justify-between gap-2 py-2 text-sm">
        <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
          <b>{t.nombre}</b>
          <span className={`rounded-full px-2 py-0.5 text-[10px] ${promo ? "bg-[var(--brand-highlight)]/25 text-gray-700" : "bg-gray-100 text-gray-500"}`}>{TIPO_BADGE[tp] ?? tp}</span>
          <span className="text-[11px] text-gray-400">P{t.prioridad ?? 1}</span>
          {(tp === "descuento_pct" || tp === "descuento_monto") && t.descuento_valor != null && (
            <span className="text-[11px] font-medium text-[var(--brand-success)]">
              {tp === "descuento_pct" ? `−${t.descuento_valor}%` : `−${formatCOP(t.descuento_valor)}/pax`}
            </span>
          )}
          {tp === "promo_noche_gratis" && (
            <span className="text-[11px] font-medium text-[var(--brand-success)]">1 noche gratis (mín. {t.min_noches ?? 1}N)</span>
          )}
          {t.regimen_restringido && (
            <span className="rounded-full bg-gray-100 px-2 py-0.5 text-[10px] text-gray-500">solo {t.regimen_restringido}</span>
          )}
          {t.condicion_pago_tipo === "pago_total" && (
            <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-medium text-amber-700">Pago total</span>
          )}
          {t.condicion_pago_tipo === "anticipo_saldo" && (
            <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-medium text-amber-700">
              Anticipo {Math.round((t.condicion_pago_pct_inicial ?? 0) * 100)}% · saldo {t.condicion_pago_dias_saldo ?? 0}d antes
            </span>
          )}
          {etiquetasRestriccion(restriccionImplicitaHotel(t.condicion_pago_tipo ?? "sin_condicion")).map((e) => (
            <span key={e} className="rounded-full bg-red-50 px-2 py-0.5 text-[10px] font-medium text-red-600">{e}</span>
          ))}
          <span className="text-gray-400">· {formatFechaLarga(t.fecha_inicio)} → {formatFechaLarga(t.fecha_fin)}</span>
          {asRangos(t.rangos).length > 1 && (
            <span className="text-[11px] text-gray-400">· +{asRangos(t.rangos).length - 1} rango(s)</span>
          )}
          {asRangos(t.blackouts).length > 0 && (
            <span className="text-[11px] font-medium text-amber-600">· {asRangos(t.blackouts).length} black-out</span>
          )}
          {(t.compra_inicio || t.compra_fin) && (
            <span className={`text-[11px] ${historico ? "font-medium text-gray-500" : "text-gray-400"}`}>· compra {t.compra_inicio ?? "…"} → {t.compra_fin ?? "…"}{historico ? " (vencida)" : ""}</span>
          )}
        </span>
        <span className="flex items-center gap-3">
          <button type="button" onClick={() => editar(t)} className="text-xs text-[var(--brand-accent)] hover:underline">Editar</button>
          <DelBtn onDel={() => eliminarTemporada(t.id, hotelId)} />
        </span>
      </li>
    );
  };

  return (
    <section>
      <h2 className="mb-1 text-sm font-semibold text-gray-700">Temporadas y promociones</h2>
      <p className="mb-3 text-xs text-gray-500">
        Las fechas <b>pueden cruzarse</b>: gana la de mayor <b>prioridad</b>. La <b>vigencia de compra</b> define
        cuándo está disponible para vender (si hoy está fuera, no aplica). Una promo descuenta la tarifa base de esas fechas.
        Usa <b>rangos adicionales</b> para una misma vigencia con varias fechas (ej. puentes) y <b>black-outs</b> para excluir fechas.
        El <b>régimen</b> deja la vigencia (o promo) restringida a uno solo, aunque el hotel tenga varios (vacío = todos).
      </p>
      {!editando && <CopiarDeHotel hotelId={hotelId} otrosHoteles={otrosHoteles} />}
      <div className="rounded-xl border border-gray-200 bg-white p-4">
        {editando && <p className="mb-2 text-xs font-medium text-[var(--brand-accent)]">Editando: {nombre || "temporada"}</p>}
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <div className="col-span-2 sm:col-span-1"><label className={lbl}>Nombre</label><Input placeholder="ALTA, BAJA, PROMO JULIO…" value={nombre} onChange={(e) => setNombre(e.target.value)} /></div>
          <div><label className={lbl}>Viaje desde</label><Input type="date" value={ini} onChange={(e) => setIni(e.target.value)} /></div>
          <div><label className={lbl}>Viaje hasta</label><Input type="date" value={fin} onChange={(e) => setFin(e.target.value)} /></div>
          <div><label className={lbl}>Prioridad</label><Input type="number" min={1} value={prioridad} onChange={(e) => setPrioridad(e.target.value)} /></div>
          <div>
            <label className={lbl}>{esNocheGratis ? "Noches mín. para la promo" : "Mín. noches"}</label>
            <Input type="number" min={1} value={minNoches} onChange={(e) => setMinNoches(e.target.value)} />
          </div>
          <div><label className={lbl}>Compra desde</label><Input type="date" value={compraIni} onChange={(e) => setCompraIni(e.target.value)} /></div>
          <div><label className={lbl}>Compra hasta</label><Input type="date" value={compraFin} onChange={(e) => setCompraFin(e.target.value)} /></div>
          <div className="col-span-2 sm:col-span-1">
            <label className={lbl}>Tipo</label>
            <select value={tipo} onChange={(e) => setTipo(e.target.value)} className={`${sel} w-full`}>
              {TIPOS_TEMP.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
            </select>
          </div>
          {esDescuento && (
            <div>
              <label className={lbl}>{tipo === "descuento_pct" ? "Descuento %" : "Descuento $/pax"}</label>
              <Input type="number" min={0} value={descuento} onChange={(e) => setDescuento(e.target.value)} placeholder={tipo === "descuento_pct" ? "20" : "50000"} />
            </div>
          )}
          <div>
            <label className={lbl}>Régimen <span className="font-normal text-gray-400">(vacío = todos)</span></label>
            <select value={regimenRestringido} onChange={(e) => setRegimenRestringido(e.target.value)} className={`${sel} w-full`}>
              <option value="">Todos los régimen</option>
              {regimenes.map((r) => <option key={r} value={r}>{r}</option>)}
            </select>
          </div>
          <div className="col-span-2 sm:col-span-1">
            <label className={lbl}>Condición de pago</label>
            <select value={condicionPagoTipo} onChange={(e) => setCondicionPagoTipo(e.target.value)} className={`${sel} w-full`}>
              {CONDICIONES_PAGO_HOTEL.map((c) => <option key={c.value} value={c.value}>{c.label}</option>)}
            </select>
          </div>
          {esAnticipoSaldo && (
            <>
              <div>
                <label className={lbl}>Anticipo inicial (%)</label>
                <Input type="number" min={1} max={99} value={condicionPagoPct} onChange={(e) => setCondicionPagoPct(e.target.value)} placeholder="50" />
              </div>
              <div>
                <label className={lbl}>Días antes del viaje para el saldo</label>
                <Input type="number" min={0} value={condicionPagoDias} onChange={(e) => setCondicionPagoDias(e.target.value)} placeholder="30" />
              </div>
            </>
          )}
        </div>
        {condicionPagoTipo !== "sin_condicion" && (
          <p className="mt-2 rounded-lg bg-red-50 px-3 py-2 text-xs text-red-700">
            Esta vigencia queda automáticamente <b>No reembolsable</b> y <b>No endosable</b> (toda condición distinta de
            &quot;Sin condición especial&quot; lo es, sin selector aparte).
          </p>
        )}
        {esNocheGratis && (
          <p className="mt-2 rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-700">
            Se regala SIEMPRE exactamente 1 noche (nunca escala con más noches): una estadía de {Math.max(1, Number(minNoches) || 1)}
            {" "}o más noches paga el equivalente a 1 noche menos del total (se descuenta 1/N del total, sin importar si son{" "}
            {Math.max(1, Number(minNoches) || 1)}, {Math.max(1, Number(minNoches) || 1) + 1} o más noches).
          </p>
        )}

        <div className="mt-3 grid grid-cols-1 gap-4 sm:grid-cols-2">
          <ListaRangos titulo="Rangos adicionales (misma vigencia)" items={rangosExtra} onChange={setRangosExtra} />
          <ListaRangos titulo="Black-outs (fechas a excluir)" items={blackouts} onChange={setBlackouts} />
        </div>

        <div className="mt-3 flex items-center gap-3">
          <Button onClick={guardar} disabled={pending} style={{ backgroundColor: "var(--brand-primary)" }}>{pending ? "…" : editando ? "Guardar cambios" : esPromo ? "Agregar promoción" : "Agregar temporada"}</Button>
          {editando && <Button variant="outline" onClick={reset} disabled={pending}>Cancelar</Button>}
          {err && <span className="text-sm text-red-600">{err}</span>}
        </div>
        {aviso && <p className="mt-2 rounded-lg bg-[var(--brand-accent)]/10 px-3 py-2 text-xs text-[var(--brand-primary)]">{aviso}</p>}

        <ul className="mt-3 divide-y divide-gray-100">
          {activas.map((t) => filaTemp(t))}
          {!activas.length && <li className="py-2 text-sm text-gray-400">Sin vigencias activas.</li>}
        </ul>
      </div>

      {vencidas.length > 0 && (
        <details className="mt-3 rounded-xl border border-gray-200 bg-gray-50/60">
          <summary className="cursor-pointer select-none px-4 py-2 text-sm font-medium text-gray-600">
            Histórico de vigencias vencidas <span className="text-gray-400">({vencidas.length})</span>
          </summary>
          <p className="px-4 pb-1 text-xs text-gray-500">
            Vigencias cuya <b>compra hasta</b> ya pasó. No alimentan el tarifario; se conservan para consultar y comparar contratos viejos.
          </p>
          <ul className="divide-y divide-gray-100 px-4 pb-3 opacity-80">{vencidas.map((t) => filaTemp(t, true))}</ul>
        </details>
      )}
    </section>
  );
}

// Copia las vigencias de otro hotel al actual (cadenas con misma config).
function CopiarDeHotel({ hotelId, otrosHoteles }: { hotelId: number; otrosHoteles: { id: number; nombre: string }[] }) {
  const router = useRouter();
  const [origen, setOrigen] = useState<number | "">("");
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState("");

  if (!otrosHoteles.length) return null;

  function copiar() {
    if (origen === "") { setMsg("Elige un hotel."); return; }
    if (!confirm("¿Copiar todas las vigencias de ese hotel a este? Se agregan como copias independientes (no borra las actuales).")) return;
    setMsg("");
    start(async () => {
      const r = await copiarTemporadasDesdeHotel(hotelId, Number(origen));
      if (r.ok) { setMsg(`✓ ${r.copiadas} copiada(s)`); setOrigen(""); router.refresh(); }
      else setMsg(r.error);
    });
  }

  return (
    <div className="mb-3 flex flex-wrap items-center gap-2 rounded-xl border border-dashed border-gray-200 bg-gray-50 p-3">
      <span className="text-xs font-medium text-gray-600">Traer vigencias de otro hotel:</span>
      <select value={origen} onChange={(e) => setOrigen(Number(e.target.value) || "")} className={`${sel} max-w-xs`}>
        <option value="">— Elegir hotel origen —</option>
        {otrosHoteles.map((h) => <option key={h.id} value={h.id}>{h.nombre}</option>)}
      </select>
      <Button variant="outline" onClick={copiar} disabled={pending}>{pending ? "Copiando…" : "Traer"}</Button>
      {msg && <span className={msg.startsWith("✓") ? "text-sm text-green-600" : "text-sm text-red-600"}>{msg}</span>}
    </div>
  );
}

// Editor de una lista de rangos de fechas (para rangos adicionales y black-outs).
function ListaRangos({ titulo, items, onChange }: { titulo: string; items: RangoFechas[]; onChange: (v: RangoFechas[]) => void }) {
  const set = (i: number, k: keyof RangoFechas, v: string) =>
    onChange(items.map((r, idx) => (idx === i ? { ...r, [k]: v } : r)));
  return (
    <div className="rounded-lg border border-gray-100 p-3">
      <p className={lbl}>{titulo}</p>
      <div className="space-y-2">
        {items.map((r, i) => (
          <div key={i} className="flex items-end gap-2">
            <div className="flex-1"><label className="block text-[10px] text-gray-400">Desde</label><Input type="date" value={r.fecha_inicio} onChange={(e) => set(i, "fecha_inicio", e.target.value)} /></div>
            <div className="flex-1"><label className="block text-[10px] text-gray-400">Hasta</label><Input type="date" value={r.fecha_fin} onChange={(e) => set(i, "fecha_fin", e.target.value)} /></div>
            <button type="button" onClick={() => onChange(items.filter((_, idx) => idx !== i))} className="pb-2 text-xs text-gray-400 hover:text-red-500">Quitar</button>
          </div>
        ))}
        {!items.length && <p className="text-[11px] text-gray-400">Ninguno.</p>}
      </div>
      <button type="button" onClick={() => onChange([...items, { fecha_inicio: "", fecha_fin: "" }])} className="mt-2 text-xs font-medium text-[var(--brand-accent)]">+ Agregar</button>
    </div>
  );
}

function TarifasBox({ hotelId, categorias, regimenes, temporadas, tarifas, vencidasNombres, adultsOnly }: {
  hotelId: number; categorias: string[]; regimenes: string[]; temporadas: Temporada[]; tarifas: Tarifa[]; vencidasNombres: Set<string>; adultsOnly: boolean;
}) {
  const [tipo, setTipo] = useState("");
  const [alim, setAlim] = useState("");
  const [temp, setTemp] = useState("");
  const [p, setP] = useState({ sencilla: "", doble: "", triple: "", multiple: "", nino: "", nino2: "", infante: "" });
  const [notaInfante, setNotaInfante] = useState("");
  const [editId, setEditId] = useState<number | null>(null);
  const [pending, start] = useTransition();
  const [err, setErr] = useState("");
  // Niño 1/Niño 2/Infante quedan colapsados por defecto (no es Adults Only, pero
  // la mayoría de tarifas no llevan niño) -- se expanden al pedirlo, o solos si la
  // tarifa que se está editando ya trae algo cargado.
  const [mostrarNinos, setMostrarNinos] = useState(false);
  const nombresTemporada = Array.from(new Set(temporadas.map((t) => t.nombre)));
  const num = (s: string) => (s === "" ? null : Number(s));
  const str = (n: number | null) => (n == null ? "" : String(n));

  // Temporadas de tipo "promo" (descuento_pct/descuento_monto): el valor cargado
  // en la fila es la tarifa de referencia; el descuento de esa temporada se le
  // aplica encima para mostrar el valor final (mismo % que ya aplica el motor
  // en vivo al liquidar, ver lib/calc/paquetes.ts `netoNoche`).
  const cfgTemporada = (nombre: string | null) => temporadas.find((tm) => tm.nombre === nombre);
  const conDescuento = (base: number | null, cfg?: Temporada): number | null => {
    if (base == null || !cfg?.tipo || cfg.tipo === "tarifa") return null;
    const val = Number(cfg.descuento_valor) || 0;
    if (cfg.tipo === "descuento_pct") return Math.round(base * (1 - val / 100));
    if (cfg.tipo === "descuento_monto") return Math.max(0, Math.round(base - val));
    return null; // promo_noche_gratis no es un % por acomodación
  };

  function resetForm() {
    setTipo(""); setAlim(""); setTemp("");
    setP({ sencilla: "", doble: "", triple: "", multiple: "", nino: "", nino2: "", infante: "" });
    setNotaInfante("");
    setEditId(null);
    setMostrarNinos(false);
  }

  function startEdit(t: Tarifa) {
    setErr("");
    setEditId(t.id);
    setTipo(t.tipo_habitacion ?? "");
    setAlim(t.alimentacion ?? "");
    setTemp(t.temporada ?? "");
    setP({
      sencilla: str(t.neto_sencilla), doble: str(t.neto_doble), triple: str(t.neto_triple),
      multiple: str(t.neto_multiple), nino: str(t.neto_nino), nino2: str(t.neto_nino2),
      infante: str(t.neto_infante),
    });
    setNotaInfante(t.nota_infante ?? "");
    setMostrarNinos(t.neto_nino != null || t.neto_nino2 != null || t.neto_infante != null || !!t.nota_infante);
  }

  function add() {
    if (!tipo || !alim || !temp) { setErr("Elige categoría, régimen y temporada."); return; }
    setErr("");
    const input = {
      tipoHabitacion: tipo, alimentacion: alim, temporada: temp,
      netoSencilla: num(p.sencilla), netoDoble: num(p.doble), netoTriple: num(p.triple),
      netoMultiple: num(p.multiple),
      // Hotel Adults Only: nunca guarda tarifa de niño/niño2/infante, sin importar
      // el estado residual del formulario (los campos ni siquiera se muestran).
      netoNino: adultsOnly ? null : num(p.nino),
      netoNino2: adultsOnly ? null : num(p.nino2),
      netoInfante: adultsOnly ? null : num(p.infante),
      notaInfante: adultsOnly ? null : (notaInfante.trim() || null),
    };
    start(async () => {
      const r = editId
        ? await actualizarTarifa(editId, hotelId, input)
        : await crearTarifa({ hotelId, ...input });
      if (r.ok) resetForm();
      else setErr(r.error);
    });
  }

  const faltaConfig = categorias.length === 0 || regimenes.length === 0 || temporadas.length === 0;

  const esHistorica = (t: Tarifa) => !!t.temporada && vencidasNombres.has(t.temporada);
  const activas = tarifas.filter((t) => !esHistorica(t));
  const historicas = tarifas.filter((t) => esHistorica(t));

  const celda = (base: number | null, cfg?: Temporada) => {
    const desc = conDescuento(base, cfg);
    return (
      <>
        {base ? formatCOP(base) : "—"}
        {desc != null && <div className="text-[10px] font-normal text-[var(--brand-accent)]">({formatCOP(desc)})</div>}
      </>
    );
  };

  const filaTarifa = (t: Tarifa) => {
    const cfg = cfgTemporada(t.temporada);
    const descInfante = conDescuento(t.neto_infante, cfg);
    return (
    <tr key={t.id} className="border-t border-gray-50">
      <td className="px-3 py-2 text-gray-700">{t.tipo_habitacion ?? "—"}</td>
      <td className="px-3 py-2 text-gray-500">{t.alimentacion ?? "—"}</td>
      <td className="px-3 py-2 text-gray-500">{t.temporada ?? "—"}</td>
      <td className="px-3 py-2 text-right tabular-nums">{celda(t.neto_sencilla, cfg)}</td>
      <td className="px-3 py-2 text-right tabular-nums">{celda(t.neto_doble, cfg)}</td>
      <td className="px-3 py-2 text-right tabular-nums">{celda(t.neto_triple, cfg)}</td>
      <td className="px-3 py-2 text-right tabular-nums">{celda(t.neto_multiple, cfg)}</td>
      {!adultsOnly && (
        <>
          <td className="px-3 py-2 text-right tabular-nums">{celda(t.neto_nino, cfg)}</td>
          <td className="px-3 py-2 text-right tabular-nums">{celda(t.neto_nino2, cfg)}</td>
          <td className="px-3 py-2 text-right tabular-nums" title={t.nota_infante ?? undefined}>
            {t.neto_infante != null ? formatCOP(t.neto_infante) : "—"}
            {descInfante != null && <div className="text-[10px] font-normal text-[var(--brand-accent)]">({formatCOP(descInfante)})</div>}
            {t.nota_infante && <span className="ml-1 text-amber-500" title={t.nota_infante}>*</span>}
          </td>
        </>
      )}
      <td className="px-3 py-2 text-right">
        <div className="flex items-center justify-end gap-3">
          <button type="button" onClick={() => startEdit(t)} className="text-xs text-[var(--brand-accent)] hover:underline">Editar</button>
          <DelBtn onDel={() => eliminarTarifa(t.id, hotelId)} />
        </div>
      </td>
    </tr>
    );
  };

  const tablaTarifas = (rows: Tarifa[]) => (
    <div className="overflow-x-auto rounded-xl border border-gray-200 bg-white">
      <table className="w-full min-w-[760px] text-sm">
        <thead><tr className="bg-gray-50 text-left text-xs uppercase text-gray-400">
          <th className="px-3 py-2">Categoría</th><th className="px-3 py-2">Régimen</th><th className="px-3 py-2">Temporada</th>
          <th className="px-3 py-2 text-right">Sencilla</th><th className="px-3 py-2 text-right">Doble</th>
          <th className="px-3 py-2 text-right">Triple</th><th className="px-3 py-2 text-right">Múltiple</th>
          {!adultsOnly && (
            <>
              <th className="px-3 py-2 text-right">Niño 1</th><th className="px-3 py-2 text-right">Niño 2</th>
              <th className="px-3 py-2 text-right">Infante</th>
            </>
          )}
          <th className="px-3 py-2"></th>
        </tr></thead>
        <tbody>{rows.map((t) => filaTarifa(t))}</tbody>
      </table>
    </div>
  );

  return (
    <section>
      <h2 className="mb-3 text-sm font-semibold text-gray-700">Tarifa neta (lo que pagas al proveedor)</h2>
      {faltaConfig && (
        <p className="mb-3 rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-700">
          Para cargar tarifas necesitas: al menos una categoría y un régimen aplicados al hotel, y una temporada creada arriba.
        </p>
      )}
      <div className="rounded-xl border border-gray-200 bg-white p-4">
        <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
          <div>
            <label className={lbl}>Categoría de habitación</label>
            <select value={tipo} onChange={(e) => setTipo(e.target.value)} className={`${sel} w-full`}>
              <option value="">Selecciona</option>
              {categorias.map((c) => <option key={c} value={c}>{c}</option>)}
            </select>
          </div>
          <div>
            <label className={lbl}>Régimen</label>
            <select value={alim} onChange={(e) => setAlim(e.target.value)} className={`${sel} w-full`}>
              <option value="">Selecciona</option>
              {regimenes.map((r) => <option key={r} value={r}>{r}</option>)}
            </select>
          </div>
          <div>
            <label className={lbl}>Temporada</label>
            <select value={temp} onChange={(e) => setTemp(e.target.value)} className={`${sel} w-full`}>
              <option value="">Selecciona</option>
              {nombresTemporada.map((t) => <option key={t} value={t}>{t}</option>)}
            </select>
          </div>
        </div>
        <div className={`mt-3 grid grid-cols-2 gap-3 ${adultsOnly ? "sm:grid-cols-4" : mostrarNinos ? "sm:grid-cols-7" : "sm:grid-cols-4"}`}>
          {(
            [["sencilla","Sencilla"],["doble","Doble"],["triple","Triple"],["multiple","Múltiple"],
              ...(adultsOnly || !mostrarNinos ? [] : [["nino","Niño 1"],["nino2","Niño 2"],["infante","Infante"]]),
            ] as [keyof typeof p, string][]
          ).map(([k, label]) => (
            <div key={k}>
              <label className={lbl}>{label}</label>
              <Input type="number" min={0} value={p[k]} onChange={(e) => setP({ ...p, [k]: e.target.value })} placeholder="—" />
            </div>
          ))}
        </div>
        {!adultsOnly && !mostrarNinos && (
          <button type="button" onClick={() => setMostrarNinos(true)} className="mt-3 text-xs font-medium text-[var(--brand-accent)]">
            + Agregar tarifa de niño/infante (opcional)
          </button>
        )}
        {!adultsOnly && mostrarNinos && (
          <div className="mt-3">
            <div className="mb-1 flex items-center justify-between">
              <label className={lbl}>Nota de infante <span className="font-normal text-gray-400">(ej. &quot;Comparte cama con los padres&quot;, &quot;Solo paga seguro hotelero&quot;)</span></label>
              <button
                type="button"
                onClick={() => { setP({ ...p, nino: "", nino2: "", infante: "" }); setNotaInfante(""); setMostrarNinos(false); }}
                className="text-xs text-gray-400 hover:text-red-500"
              >
                Quitar tarifa de niño/infante
              </button>
            </div>
            <Input value={notaInfante} onChange={(e) => setNotaInfante(e.target.value)} placeholder="Nota especial para esta tarifa de infante (opcional)" />
          </div>
        )}
        <div className="mt-3 flex items-center gap-3">
          <Button onClick={add} disabled={pending} style={{ backgroundColor: "var(--brand-primary)" }}>
            {pending ? "…" : editId ? "Guardar cambios" : "Agregar tarifa"}
          </Button>
          {editId && (
            <Button variant="outline" onClick={resetForm} disabled={pending}>Cancelar</Button>
          )}
          {err && <span className="text-sm text-red-600">{err}</span>}
          {!editId && adultsOnly && (
            <span className="text-xs text-gray-400">Este hotel es Adults Only: no se piden tarifas de niño/infante.</span>
          )}
          {!editId && !adultsOnly && mostrarNinos && (
            <span className="text-xs text-gray-400">Niño 1/Niño 2/Infante pueden ir en $0 (gratis) o con su valor por noche. Déjalos vacíos si no aplican a esta tarifa.</span>
          )}
        </div>
      </div>

      {activas.length > 0 && <div className="mt-4">{tablaTarifas(activas)}</div>}

      {historicas.length > 0 && (
        <details className="mt-4 rounded-xl border border-gray-200 bg-gray-50/60">
          <summary className="cursor-pointer select-none px-4 py-2 text-sm font-medium text-gray-600">
            Histórico de tarifas vencidas <span className="text-gray-400">({historicas.length})</span>
          </summary>
          <p className="px-4 pb-2 text-xs text-gray-500">
            Tarifas de vigencias ya vencidas. No se publican; quedan para auditar contratos viejos con la tarifa que aplicó.
          </p>
          <div className="px-3 pb-3 opacity-80">{tablaTarifas(historicas)}</div>
        </details>
      )}
    </section>
  );
}

function DelBtn({ onDel }: { onDel: () => void | Promise<unknown> }) {
  const [pending, start] = useTransition();
  return (
    <button type="button" disabled={pending}
      onClick={() => { if (confirm("¿Eliminar?")) start(() => { void onDel(); }); }}
      className="text-xs text-gray-400 hover:text-red-500">Eliminar</button>
  );
}
