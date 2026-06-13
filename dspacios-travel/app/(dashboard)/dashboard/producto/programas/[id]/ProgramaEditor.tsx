"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { CabeceraForm } from "../CabeceraForm";
import type { Database } from "@/types/database";
import {
  guardarCabecera,
  guardarCiudades,
  guardarDias,
  guardarMatriz,
  guardarInclusiones,
  guardarTours,
  guardarBlackouts,
  setPublicado,
  eliminarPrograma,
  importarDesdeTexto,
  guardarSalidas,
  type CabeceraInput,
  type CategoriaInput,
  type SalidaInput,
} from "../actions";
import { parsearPrograma } from "@/lib/programasImport";
import { pvpPrograma, type PvpOpciones } from "@/lib/programas";
import { formatMoneda } from "@/lib/utils";

type ProgramaRow = Database["public"]["Tables"]["programas"]["Row"];
type Ciudad = { id: number; nombre: string; codigo_iata: string | null; noches: number };
type Dia = { dia: number; titulo: string | null; desayuno: boolean; almuerzo: boolean; cena: boolean; descripcion: string | null };
type Categoria = { id: number; nombre: string | null; orden: number };
type HotelRow = { categoria_id: number; ciudad: string; hotel: string | null; orden: number };
type PrecioRow = { categoria_id: number; acomodacion: string; neto: number | null; bajo_solicitud: boolean };
type SalidaRow = {
  etiqueta: string | null; fecha_desde: string | null; fecha_hasta: string | null; noches: number | null; columna: string | null;
  neto_sencilla: number | null; neto_doble: number | null; neto_triple: number | null; neto_multiple: number | null; neto_nino: number | null; bajo_solicitud: boolean;
};
type Inclusion = { ciudad: string | null; tipo: string; texto: string };
type Tour = { ciudad: string | null; nombre: string; precio: number | null; min_pax: number; dias_operacion: string | null; descripcion: string | null };
type Blackout = { fecha_inicio: string | null; fecha_fin: string | null; motivo: string | null; ciudad: string | null };

const ACOMS = ["sencilla", "doble", "triple", "cuadruple", "nino"];
const ACOM_LABEL: Record<string, string> = { sencilla: "Sencilla", doble: "Doble", triple: "Triple", cuadruple: "Cuádruple", nino: "Niño" };

const lbl = "mb-1 block text-xs font-medium text-gray-600";
const sel = "w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm";

const TABS = [
  { key: "general", label: "General" },
  { key: "importar", label: "Importar ✨" },
  { key: "ruta", label: "Ruta" },
  { key: "itinerario", label: "Itinerario" },
  { key: "matriz", label: "Hoteles y precios" },
  { key: "inclusiones", label: "Incluye / No incluye" },
  { key: "tours", label: "Tours opcionales" },
  { key: "blackouts", label: "Blackouts" },
] as const;

export function ProgramaEditor(props: {
  programa: ProgramaRow;
  proveedores: { id: number; nombre: string }[];
  ciudades: Ciudad[];
  dias: Dia[];
  categorias: Categoria[];
  hoteles: HotelRow[];
  precios: PrecioRow[];
  salidas: SalidaRow[];
  inclusiones: Inclusion[];
  tours: Tour[];
  blackouts: Blackout[];
}) {
  const { programa } = props;
  const [tab, setTab] = useState<(typeof TABS)[number]["key"]>("general");
  const router = useRouter();
  const modoSalidaTabs = programa.modo_precio === "salida";
  const tabs = TABS.map((t) =>
    t.key === "matriz" ? { ...t, label: modoSalidaTabs ? "Salidas y precios" : "Hoteles y precios" } : t
  );
  const [pubPending, startPub] = useTransition();

  const initialCab: Partial<CabeceraInput> = {
    nombre: programa.nombre,
    proveedorId: programa.proveedor_id,
    subtitulo: programa.subtitulo ?? "",
    dias: programa.dias,
    noches: programa.noches,
    moneda: programa.moneda,
    salidas: programa.salidas ?? "",
    vigenciaDesde: programa.vigencia_desde ?? "",
    vigenciaHasta: programa.vigencia_hasta ?? "",
    minPax: programa.min_pax,
    maxPax: programa.max_pax,
    pctMk: programa.pct_mk,
    pctFeeTarjeta: programa.pct_fee_tarjeta,
    ninoEdadMax: programa.nino_edad_max,
    ninoValorServicios: programa.nino_valor_servicios,
    textoCondiciones: programa.texto_condiciones ?? "",
    textoCancelacion: programa.texto_cancelacion ?? "",
    textoPagos: programa.texto_pagos ?? "",
    notas: programa.notas ?? "",
    desdePrecio: programa.desde_precio,
    incluyeAereo: programa.incluye_aereo,
    portadaUrl: programa.portada_url ?? "",
    asistenciaMedicaDia: programa.asistencia_medica_dia,
    modoPrecio: programa.modo_precio,
    videoUrl: programa.video_url ?? "",
  };

  return (
    <div className="mt-2">
      {/* Cabecera */}
      <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold text-gray-900">{programa.nombre}</h1>
          <p className="text-sm text-gray-500">
            {programa.subtitulo ?? "—"} · {programa.moneda}
            {programa.dias ? ` · ${programa.dias}d/${programa.noches ?? ""}n` : ""}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <span
            className="rounded-full px-2 py-0.5 text-xs"
            style={
              programa.publicado
                ? { backgroundColor: "rgba(102,181,150,0.18)", color: "var(--brand-success)" }
                : { backgroundColor: "#f3f4f6", color: "#6b7280" }
            }
          >
            {programa.publicado ? "Publicado" : "Borrador"}
          </span>
          <Button
            disabled={pubPending}
            onClick={() => startPub(async () => void (await setPublicado(programa.id, !programa.publicado)))}
            style={{ backgroundColor: programa.publicado ? "#6b7280" : "var(--brand-success)" }}
          >
            {programa.publicado ? "Despublicar" : "Publicar"}
          </Button>
        </div>
      </div>

      {/* Tabs */}
      <div className="mb-5 flex flex-wrap gap-1 border-b border-gray-200">
        {tabs.map((t) => (
          <button
            key={t.key}
            type="button"
            onClick={() => setTab(t.key)}
            className="rounded-t-lg px-3 py-2 text-sm"
            style={
              tab === t.key
                ? { color: "var(--brand-primary)", borderBottom: "2px solid var(--brand-primary)", fontWeight: 600 }
                : { color: "#6b7280" }
            }
          >
            {t.label}
          </button>
        ))}
      </div>

      {tab === "general" && (
        <CabeceraForm
          initial={initialCab}
          proveedores={props.proveedores}
          onSubmit={(input) => guardarCabecera(programa.id, input)}
          submitLabel="Guardar cabecera"
        />
      )}
      {tab === "importar" && <ImportarEditor programaId={programa.id} onDone={() => router.refresh()} />}
      {tab === "ruta" && <RutaEditor programaId={programa.id} ciudades={props.ciudades} />}
      {tab === "itinerario" && <ItinerarioEditor programaId={programa.id} dias={props.dias} totalDias={programa.dias} />}
      {tab === "matriz" &&
        (modoSalidaTabs ? (
          <SalidasEditor
            programaId={programa.id}
            salidas={props.salidas}
            moneda={programa.moneda}
            pvpOpt={{
              pctMk: programa.pct_mk,
              asistenciaDia: programa.asistencia_medica_dia,
              dias: programa.dias,
              pctFee: programa.pct_fee_tarjeta,
            }}
          />
        ) : (
          <MatrizEditor
            programaId={programa.id}
            ciudades={props.ciudades}
            categorias={props.categorias}
            hoteles={props.hoteles}
            precios={props.precios}
            moneda={programa.moneda}
            pvpOpt={{
              pctMk: programa.pct_mk,
              asistenciaDia: programa.asistencia_medica_dia,
              dias: programa.dias,
              pctFee: programa.pct_fee_tarjeta,
            }}
          />
        ))}
      {tab === "inclusiones" && <InclusionesEditor programaId={programa.id} ciudades={props.ciudades} inclusiones={props.inclusiones} />}
      {tab === "tours" && <ToursEditor programaId={programa.id} ciudades={props.ciudades} tours={props.tours} />}
      {tab === "blackouts" && <BlackoutsEditor programaId={programa.id} blackouts={props.blackouts} />}

      {/* Eliminar */}
      <div className="mt-10 border-t border-gray-100 pt-5">
        <button
          type="button"
          onClick={() => {
            if (confirm("¿Eliminar este programa y todo su contenido? Esta acción no se puede deshacer.")) {
              eliminarPrograma(programa.id).then((r) => {
                if (r.ok) router.push("/dashboard/producto/programas");
                else alert(r.error);
              });
            }
          }}
          className="text-sm font-medium text-red-500 hover:underline"
        >
          Eliminar programa
        </button>
      </div>
    </div>
  );
}

// ── Botón de guardado de sección ──────────────────────────────────────────────
function SaveBar({ onSave, disabled }: { onSave: () => Promise<{ ok: boolean; error?: string }>; disabled?: boolean }) {
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [ok, setOk] = useState(false);
  return (
    <div className="mt-4 flex items-center gap-3">
      <Button
        disabled={pending || disabled}
        onClick={() =>
          start(async () => {
            setError(null);
            setOk(false);
            const r = await onSave();
            if (r.ok) setOk(true);
            else setError(r.error ?? "Error al guardar");
          })
        }
        style={{ backgroundColor: "var(--brand-primary)" }}
      >
        {pending ? "Guardando…" : "Guardar"}
      </Button>
      {ok && <span className="text-sm text-green-600">Guardado ✓</span>}
      {error && <span className="text-sm text-red-600">{error}</span>}
    </div>
  );
}

function AddBtn({ onClick, children }: { onClick: () => void; children: React.ReactNode }) {
  return (
    <button type="button" onClick={onClick} className="text-sm font-medium text-[#1D7C9A] hover:underline">
      {children}
    </button>
  );
}

function DelBtn({ onClick }: { onClick: () => void }) {
  return (
    <button type="button" onClick={onClick} className="text-gray-400 hover:text-red-500" aria-label="Quitar">
      ✕
    </button>
  );
}

// ── Ruta (ciudades) ───────────────────────────────────────────────────────────
function RutaEditor({ programaId, ciudades }: { programaId: number; ciudades: Ciudad[] }) {
  const [rows, setRows] = useState(
    ciudades.map((c) => ({ nombre: c.nombre, codigoIata: c.codigo_iata ?? "", noches: c.noches as number | null }))
  );
  const upd = (i: number, k: string, v: unknown) => setRows((p) => p.map((r, j) => (j === i ? { ...r, [k]: v } : r)));
  return (
    <div>
      <p className="mb-3 text-sm text-gray-500">Ciudades del circuito, en orden. Las noches suman el total del programa.</p>
      <div className="space-y-2">
        {rows.map((r, i) => (
          <div key={i} className="flex flex-wrap items-center gap-2">
            <span className="w-5 text-xs text-gray-400">{i + 1}</span>
            <Input value={r.nombre} onChange={(e) => upd(i, "nombre", e.target.value)} placeholder="Ciudad" className="w-56" />
            <Input value={r.codigoIata} onChange={(e) => upd(i, "codigoIata", e.target.value)} placeholder="IATA" className="w-24" />
            <Input type="number" value={r.noches ?? ""} onChange={(e) => upd(i, "noches", e.target.value === "" ? null : Number(e.target.value))} placeholder="Noches" className="w-28" />
            <DelBtn onClick={() => setRows((p) => p.filter((_, j) => j !== i))} />
          </div>
        ))}
      </div>
      <div className="mt-3">
        <AddBtn onClick={() => setRows((p) => [...p, { nombre: "", codigoIata: "", noches: null }])}>+ Agregar ciudad</AddBtn>
      </div>
      <SaveBar onSave={() => guardarCiudades(programaId, rows)} />
    </div>
  );
}

// ── Itinerario (días) ──────────────────────────────────────────────────────────
function ItinerarioEditor({ programaId, dias, totalDias }: { programaId: number; dias: Dia[]; totalDias: number | null }) {
  const [rows, setRows] = useState(
    dias.map((d) => ({ dia: d.dia, titulo: d.titulo ?? "", desayuno: d.desayuno, almuerzo: d.almuerzo, cena: d.cena, descripcion: d.descripcion ?? "" }))
  );
  const upd = (i: number, k: string, v: unknown) => setRows((p) => p.map((r, j) => (j === i ? { ...r, [k]: v } : r)));
  const generar = () => {
    const n = totalDias ?? 0;
    if (!n) return;
    setRows(Array.from({ length: n }, (_, i) => ({ dia: i + 1, titulo: "", desayuno: false, almuerzo: false, cena: false, descripcion: "" })));
  };
  return (
    <div>
      <div className="mb-3 flex items-center justify-between">
        <p className="text-sm text-gray-500">Itinerario día por día. Marca las comidas incluidas.</p>
        {totalDias ? <AddBtn onClick={generar}>Generar {totalDias} días en blanco</AddBtn> : null}
      </div>
      <div className="space-y-3">
        {rows.map((r, i) => (
          <div key={i} className="rounded-lg border border-gray-200 bg-white p-3">
            <div className="mb-2 flex flex-wrap items-center gap-2">
              <span className="text-xs text-gray-400">Día</span>
              <Input type="number" value={r.dia} onChange={(e) => upd(i, "dia", Number(e.target.value))} className="w-20" />
              <Input value={r.titulo} onChange={(e) => upd(i, "titulo", e.target.value)} placeholder="Título (ej. RIO DE JANEIRO)" className="w-72" />
              <label className="flex items-center gap-1 text-xs text-gray-600"><input type="checkbox" checked={r.desayuno} onChange={(e) => upd(i, "desayuno", e.target.checked)} /> Des</label>
              <label className="flex items-center gap-1 text-xs text-gray-600"><input type="checkbox" checked={r.almuerzo} onChange={(e) => upd(i, "almuerzo", e.target.checked)} /> Alm</label>
              <label className="flex items-center gap-1 text-xs text-gray-600"><input type="checkbox" checked={r.cena} onChange={(e) => upd(i, "cena", e.target.checked)} /> Cena</label>
              <DelBtn onClick={() => setRows((p) => p.filter((_, j) => j !== i))} />
            </div>
            <textarea value={r.descripcion} onChange={(e) => upd(i, "descripcion", e.target.value)} rows={3} className={sel} placeholder="Descripción del día…" />
          </div>
        ))}
      </div>
      <div className="mt-3">
        <AddBtn onClick={() => setRows((p) => [...p, { dia: p.length + 1, titulo: "", desayuno: false, almuerzo: false, cena: false, descripcion: "" }])}>+ Agregar día</AddBtn>
      </div>
      <SaveBar onSave={() => guardarDias(programaId, rows)} />
    </div>
  );
}

// ── Matriz: categorías × (hoteles por ciudad + precios) ────────────────────────
type CatState = { nombre: string; hoteles: Record<string, string>; precios: Record<string, { neto: string; bs: boolean }> };

function MatrizEditor({
  programaId,
  ciudades,
  categorias,
  hoteles,
  precios,
  moneda,
  pvpOpt,
}: {
  programaId: number;
  ciudades: Ciudad[];
  categorias: Categoria[];
  hoteles: HotelRow[];
  precios: PrecioRow[];
  moneda: string;
  pvpOpt: PvpOpciones;
}) {
  const ciudadNames = ciudades.map((c) => c.nombre);
  const initialCats: CatState[] = categorias.map((cat) => {
    const hot: Record<string, string> = {};
    for (const h of hoteles.filter((x) => x.categoria_id === cat.id)) hot[h.ciudad] = h.hotel ?? "";
    const pre: Record<string, { neto: string; bs: boolean }> = {};
    for (const p of precios.filter((x) => x.categoria_id === cat.id)) pre[p.acomodacion] = { neto: p.neto != null ? String(p.neto) : "", bs: p.bajo_solicitud };
    return { nombre: cat.nombre ?? "", hoteles: hot, precios: pre };
  });
  const [cats, setCats] = useState<CatState[]>(initialCats);

  const updCat = (i: number, patch: Partial<CatState>) => setCats((p) => p.map((c, j) => (j === i ? { ...c, ...patch } : c)));
  const updHotel = (i: number, ciudad: string, v: string) => updCat(i, { hoteles: { ...cats[i].hoteles, [ciudad]: v } });
  const updPrecio = (i: number, acom: string, field: "neto" | "bs", v: string | boolean) =>
    updCat(i, { precios: { ...cats[i].precios, [acom]: { ...(cats[i].precios[acom] ?? { neto: "", bs: false }), [field]: v } } });

  const addCat = () => setCats((p) => [...p, { nombre: "", hoteles: {}, precios: {} }]);

  const payload: CategoriaInput[] = cats.map((c) => ({
    nombre: c.nombre,
    hoteles: ciudadNames.map((ciudad) => ({ ciudad, hotel: c.hoteles[ciudad] ?? "" })),
    precios: ACOMS.map((acom) => ({
      acomodacion: acom,
      neto: c.precios[acom]?.neto ? Number(c.precios[acom].neto) : null,
      bajoSolicitud: !!c.precios[acom]?.bs,
    })),
  }));

  if (!ciudadNames.length) {
    return <p className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">Define primero la <b>Ruta</b> (ciudades). Las columnas de hoteles salen de ahí.</p>;
  }

  return (
    <div>
      <p className="mb-1 text-sm text-gray-500">
        Cada categoría define qué hotel se usa en cada ciudad y su precio <b>neto</b> por acomodación (en {moneda}).
      </p>
      <p className="mb-3 text-xs text-gray-400">
        Precio de venta (PVP) = neto + markup {Math.round((pvpOpt.pctMk ?? 0) * 100)}%
        {pvpOpt.asistenciaDia ? ` + asistencia ${formatMoneda(pvpOpt.asistenciaDia, moneda)}/día × ${pvpOpt.dias ?? 0} días` : ""}
        {pvpOpt.pctFee ? ` + fee bancario ${Math.round((pvpOpt.pctFee ?? 0) * 100)}%` : ""}. Ajusta esos valores en la pestaña General.
      </p>
      <div className="space-y-6">
        {cats.map((c, i) => (
          <div key={i} className="rounded-xl border border-gray-200 bg-white p-4">
            <div className="mb-3 flex items-center gap-2">
              <Input value={c.nombre} onChange={(e) => updCat(i, { nombre: e.target.value })} placeholder={`Categoría ${i + 1} (opcional)`} className="w-64" />
              <DelBtn onClick={() => setCats((p) => p.filter((_, j) => j !== i))} />
            </div>

            <div className="mb-3">
              <div className={lbl}>Hotel por ciudad</div>
              <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                {ciudadNames.map((ciudad) => (
                  <div key={ciudad} className="flex items-center gap-2">
                    <span className="w-32 shrink-0 text-xs text-gray-500">{ciudad}</span>
                    <Input value={c.hoteles[ciudad] ?? ""} onChange={(e) => updHotel(i, ciudad, e.target.value)} placeholder="Hotel" className="flex-1" />
                  </div>
                ))}
              </div>
            </div>

            <div>
              <div className={lbl}>Precio neto por acomodación ({moneda})</div>
              <div className="flex flex-wrap gap-3">
                {ACOMS.map((acom) => (
                  <div key={acom} className="w-32">
                    <div className="mb-1 text-xs text-gray-500">{ACOM_LABEL[acom]}</div>
                    <Input
                      type="number"
                      value={c.precios[acom]?.neto ?? ""}
                      onChange={(e) => updPrecio(i, acom, "neto", e.target.value)}
                      placeholder="0"
                      disabled={!!c.precios[acom]?.bs}
                    />
                    {!c.precios[acom]?.bs && Number(c.precios[acom]?.neto) > 0 && (
                      <div className="mt-1 text-xs font-medium" style={{ color: "var(--brand-primary)" }}>
                        PVP {formatMoneda(pvpPrograma(Number(c.precios[acom].neto), pvpOpt), moneda)}
                      </div>
                    )}
                    <label className="mt-1 flex items-center gap-1 text-xs text-gray-500">
                      <input type="checkbox" checked={!!c.precios[acom]?.bs} onChange={(e) => updPrecio(i, acom, "bs", e.target.checked)} /> bajo solicitud
                    </label>
                  </div>
                ))}
              </div>
            </div>
          </div>
        ))}
      </div>
      <div className="mt-3">
        <AddBtn onClick={addCat}>+ Agregar categoría</AddBtn>
      </div>
      <SaveBar onSave={() => guardarMatriz(programaId, payload)} />
    </div>
  );
}

// ── Salidas y precios (modo por fecha) ─────────────────────────────────────────
type SalidaState = {
  etiqueta: string; fechaDesde: string; fechaHasta: string; noches: string; columna: string;
  netoSencilla: string; netoDoble: string; netoTriple: string; netoMultiple: string; netoNino: string; bs: boolean;
};

function SalidasEditor({
  programaId,
  salidas,
  moneda,
  pvpOpt,
}: {
  programaId: number;
  salidas: SalidaRow[];
  moneda: string;
  pvpOpt: PvpOpciones;
}) {
  const toState = (s: SalidaRow): SalidaState => ({
    etiqueta: s.etiqueta ?? "",
    fechaDesde: s.fecha_desde ?? "",
    fechaHasta: s.fecha_hasta ?? "",
    noches: s.noches != null ? String(s.noches) : "",
    columna: s.columna ?? "",
    netoSencilla: s.neto_sencilla != null ? String(s.neto_sencilla) : "",
    netoDoble: s.neto_doble != null ? String(s.neto_doble) : "",
    netoTriple: s.neto_triple != null ? String(s.neto_triple) : "",
    netoMultiple: s.neto_multiple != null ? String(s.neto_multiple) : "",
    netoNino: s.neto_nino != null ? String(s.neto_nino) : "",
    bs: s.bajo_solicitud,
  });
  const [rows, setRows] = useState<SalidaState[]>(salidas.map(toState));
  const upd = (i: number, k: keyof SalidaState, v: unknown) => setRows((p) => p.map((r, j) => (j === i ? { ...r, [k]: v } : r)));
  const nOrNull = (v: string) => (v === "" ? null : Number(v));

  // PVP en vivo: usa las noches de la salida para la asistencia médica.
  const pvpDe = (r: SalidaState, neto: string) => {
    if (r.bs || !(Number(neto) > 0)) return null;
    const dias = r.noches !== "" ? Number(r.noches) : pvpOpt.dias;
    return pvpPrograma(Number(neto), { ...pvpOpt, dias });
  };

  const payload: SalidaInput[] = rows.map((r) => ({
    etiqueta: r.etiqueta,
    fechaDesde: r.fechaDesde,
    fechaHasta: r.fechaHasta,
    noches: nOrNull(r.noches),
    columna: r.columna,
    netoSencilla: nOrNull(r.netoSencilla),
    netoDoble: nOrNull(r.netoDoble),
    netoTriple: nOrNull(r.netoTriple),
    netoMultiple: nOrNull(r.netoMultiple),
    netoNino: nOrNull(r.netoNino),
    bajoSolicitud: r.bs,
  }));

  const COLS: [keyof SalidaState, string][] = [
    ["netoSencilla", "Sencilla"],
    ["netoDoble", "Doble"],
    ["netoTriple", "Triple"],
    ["netoMultiple", "Múltiple"],
    ["netoNino", "Niño"],
  ];

  return (
    <div>
      <p className="mb-1 text-sm text-gray-500">
        Una fila por <b>salida</b> (rango de fecha). Las <b>noches</b> pueden variar por salida. El precio es el <b>neto</b> por acomodación (en {moneda}); el PVP se calcula igual que en categorías.
      </p>
      <p className="mb-3 text-xs text-gray-400">
        Usa <b>Columna</b> si el proveedor da varias columnas de precio por fecha (ej. distintos hoteles: Zuruma / Siami / Waira) → crea una fila por columna con la misma etiqueta de fecha.
      </p>
      <div className="space-y-3">
        {rows.map((r, i) => (
          <div key={i} className="rounded-lg border border-gray-200 bg-white p-3">
            <div className="mb-2 flex flex-wrap items-center gap-2">
              <Input value={r.etiqueta} onChange={(e) => upd(i, "etiqueta", e.target.value)} placeholder="Etiqueta (ej. MAY 29 AL 01 JUN)" className="w-56" />
              <Input type="date" value={r.fechaDesde} onChange={(e) => upd(i, "fechaDesde", e.target.value)} className="w-40" title="Fecha desde" />
              <span className="text-gray-300">→</span>
              <Input type="date" value={r.fechaHasta} onChange={(e) => upd(i, "fechaHasta", e.target.value)} className="w-40" title="Fecha hasta" />
              <Input type="number" value={r.noches} onChange={(e) => upd(i, "noches", e.target.value)} placeholder="Noches" className="w-24" />
              <Input value={r.columna} onChange={(e) => upd(i, "columna", e.target.value)} placeholder="Columna/hotel (opcional)" className="w-48" />
              <DelBtn onClick={() => setRows((p) => p.filter((_, j) => j !== i))} />
            </div>
            <div className="flex flex-wrap gap-3">
              {COLS.map(([k, label]) => (
                <div key={k} className="w-32">
                  <div className="mb-1 text-xs text-gray-500">{label}</div>
                  <Input type="number" value={r[k] as string} onChange={(e) => upd(i, k, e.target.value)} placeholder="neto" disabled={r.bs} />
                  {pvpDe(r, r[k] as string) != null && (
                    <div className="mt-1 text-xs font-medium" style={{ color: "var(--brand-primary)" }}>
                      PVP {formatMoneda(pvpDe(r, r[k] as string)!, moneda)}
                    </div>
                  )}
                </div>
              ))}
              <label className="mt-5 flex items-center gap-1 text-xs text-gray-500">
                <input type="checkbox" checked={r.bs} onChange={(e) => upd(i, "bs", e.target.checked)} /> a solicitud
              </label>
            </div>
          </div>
        ))}
      </div>
      <div className="mt-3">
        <AddBtn
          onClick={() =>
            setRows((p) => [
              ...p,
              { etiqueta: "", fechaDesde: "", fechaHasta: "", noches: "", columna: "", netoSencilla: "", netoDoble: "", netoTriple: "", netoMultiple: "", netoNino: "", bs: false },
            ])
          }
        >
          + Agregar salida
        </AddBtn>
      </div>
      <SaveBar onSave={() => guardarSalidas(programaId, payload)} />
    </div>
  );
}

// ── Incluye / No incluye ────────────────────────────────────────────────────────
function InclusionesEditor({ programaId, ciudades, inclusiones }: { programaId: number; ciudades: Ciudad[]; inclusiones: Inclusion[] }) {
  const [rows, setRows] = useState(
    inclusiones.map((x) => ({ ciudad: x.ciudad ?? "", tipo: x.tipo, texto: x.texto }))
  );
  const upd = (i: number, k: string, v: unknown) => setRows((p) => p.map((r, j) => (j === i ? { ...r, [k]: v } : r)));
  return (
    <div>
      <p className="mb-3 text-sm text-gray-500">Líneas de “incluye” y “no incluye”. Deja la ciudad en “General” si aplica a todo el programa.</p>
      <div className="space-y-2">
        {rows.map((r, i) => (
          <div key={i} className="flex flex-wrap items-center gap-2">
            <select value={r.tipo} onChange={(e) => upd(i, "tipo", e.target.value)} className="w-36 rounded-lg border border-gray-300 bg-white px-2 py-2 text-sm">
              <option value="incluye">Incluye</option>
              <option value="no_incluye">No incluye</option>
            </select>
            <select value={r.ciudad} onChange={(e) => upd(i, "ciudad", e.target.value)} className="w-44 rounded-lg border border-gray-300 bg-white px-2 py-2 text-sm">
              <option value="">General</option>
              {ciudades.map((c) => <option key={c.id} value={c.nombre}>{c.nombre}</option>)}
            </select>
            <Input value={r.texto} onChange={(e) => upd(i, "texto", e.target.value)} placeholder="Texto" className="min-w-[16rem] flex-1" />
            <DelBtn onClick={() => setRows((p) => p.filter((_, j) => j !== i))} />
          </div>
        ))}
      </div>
      <div className="mt-3 flex gap-4">
        <AddBtn onClick={() => setRows((p) => [...p, { ciudad: "", tipo: "incluye", texto: "" }])}>+ Incluye</AddBtn>
        <AddBtn onClick={() => setRows((p) => [...p, { ciudad: "", tipo: "no_incluye", texto: "" }])}>+ No incluye</AddBtn>
      </div>
      <SaveBar onSave={() => guardarInclusiones(programaId, rows)} />
    </div>
  );
}

// ── Tours opcionales ────────────────────────────────────────────────────────────
function ToursEditor({ programaId, ciudades, tours }: { programaId: number; ciudades: Ciudad[]; tours: Tour[] }) {
  const [rows, setRows] = useState(
    tours.map((t) => ({
      ciudad: t.ciudad ?? "",
      nombre: t.nombre,
      precio: t.precio as number | null,
      minPax: t.min_pax as number | null,
      diasOperacion: t.dias_operacion ?? "",
      descripcion: t.descripcion ?? "",
    }))
  );
  const upd = (i: number, k: string, v: unknown) => setRows((p) => p.map((r, j) => (j === i ? { ...r, [k]: v } : r)));
  return (
    <div>
      <p className="mb-3 text-sm text-gray-500">Tours opcionales (por pax). Se muestran en el tarifario como add-on.</p>
      <div className="space-y-3">
        {rows.map((r, i) => (
          <div key={i} className="rounded-lg border border-gray-200 bg-white p-3">
            <div className="mb-2 flex flex-wrap items-center gap-2">
              <select value={r.ciudad} onChange={(e) => upd(i, "ciudad", e.target.value)} className="w-44 rounded-lg border border-gray-300 bg-white px-2 py-2 text-sm">
                <option value="">— Ciudad —</option>
                {ciudades.map((c) => <option key={c.id} value={c.nombre}>{c.nombre}</option>)}
              </select>
              <Input value={r.nombre} onChange={(e) => upd(i, "nombre", e.target.value)} placeholder="Nombre del tour" className="min-w-[14rem] flex-1" />
              <Input type="number" value={r.precio ?? ""} onChange={(e) => upd(i, "precio", e.target.value === "" ? null : Number(e.target.value))} placeholder="Precio" className="w-28" />
              <Input type="number" value={r.minPax ?? ""} onChange={(e) => upd(i, "minPax", e.target.value === "" ? null : Number(e.target.value))} placeholder="Mín pax" className="w-24" />
              <DelBtn onClick={() => setRows((p) => p.filter((_, j) => j !== i))} />
            </div>
            <div className="flex flex-wrap gap-2">
              <Input value={r.diasOperacion} onChange={(e) => upd(i, "diasOperacion", e.target.value)} placeholder="Días de operación" className="w-56" />
              <Input value={r.descripcion} onChange={(e) => upd(i, "descripcion", e.target.value)} placeholder="Descripción" className="min-w-[14rem] flex-1" />
            </div>
          </div>
        ))}
      </div>
      <div className="mt-3">
        <AddBtn onClick={() => setRows((p) => [...p, { ciudad: "", nombre: "", precio: null, minPax: 2, diasOperacion: "", descripcion: "" }])}>+ Agregar tour</AddBtn>
      </div>
      <SaveBar onSave={() => guardarTours(programaId, rows)} />
    </div>
  );
}

// ── Importar desde el texto del proveedor ─────────────────────────────────────
function ImportarEditor({ programaId, onDone }: { programaId: number; onDone: () => void }) {
  const [texto, setTexto] = useState("");
  const [opts, setOpts] = useState({ itinerario: true, ruta: true, inclusiones: true, diasNoches: true });
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [ok, setOk] = useState(false);

  const preview = texto.trim() ? parsearPrograma(texto) : null;
  const optRow = (k: keyof typeof opts, label: string, count: number) => (
    <label className="flex items-center gap-2 text-sm text-gray-700">
      <input type="checkbox" checked={opts[k]} onChange={(e) => setOpts((p) => ({ ...p, [k]: e.target.checked }))} />
      {label} <span className="text-xs text-gray-400">({count})</span>
    </label>
  );

  return (
    <div>
      <div className="mb-3 rounded-lg border border-[var(--brand-accent)] bg-[rgba(38,187,217,0.06)] p-3 text-sm text-gray-600">
        Pega aquí el texto del programa <b>tal como lo envía el proveedor</b> (copiado del Word o PDF).
        El sistema reconoce solo el itinerario día por día, la ruta, los días/noches y el bloque de
        incluye / no incluye. Revisa la vista previa y luego importa — después puedes ajustar todo a mano.
      </div>
      <textarea
        value={texto}
        onChange={(e) => setTexto(e.target.value)}
        rows={12}
        className={sel}
        placeholder={"COLORES DE TURQUÍA 2026-27\n8 DÍAS / 7 NOCHES\nAnkara - Cappadocia – Estambul…\nITINERARIO\nDÍA 01 - ESTAMBUL Llegada en vuelo internacional…"}
      />

      {preview && (
        <div className="mt-4 rounded-xl border border-gray-200 bg-white p-4">
          <p className="mb-2 text-sm font-semibold text-gray-700">Vista previa de lo detectado</p>
          <p className="mb-3 text-xs text-gray-500">
            {preview.dias ?? "?"} días / {preview.noches ?? "?"} noches · {preview.ciudades.length} ciudades ·{" "}
            {preview.itinerario.length} días de itinerario · {preview.incluye.length} incluye / {preview.noIncluye.length} no incluye
          </p>
          <div className="mb-3 space-y-1.5">
            {optRow("diasNoches", "Días / noches", preview.dias ? 1 : 0)}
            {optRow("ruta", "Ruta (ciudades)", preview.ciudades.length)}
            {optRow("itinerario", "Itinerario día por día", preview.itinerario.length)}
            {optRow("inclusiones", "Incluye / No incluye", preview.incluye.length + preview.noIncluye.length)}
          </div>
          {preview.itinerario.length > 0 && (
            <details className="mb-2">
              <summary className="cursor-pointer text-xs font-medium text-[#1D7C9A]">Ver itinerario detectado</summary>
              <div className="mt-2 max-h-64 space-y-1 overflow-y-auto text-xs text-gray-600">
                {preview.itinerario.map((d) => (
                  <p key={d.dia}>
                    <b>Día {d.dia}{d.titulo ? `: ${d.titulo}` : ""}</b>
                    {(d.desayuno || d.almuerzo || d.cena) && (
                      <span className="text-gray-400">
                        {" "}({[d.desayuno && "Des", d.almuerzo && "Alm", d.cena && "Cena"].filter(Boolean).join(", ")})
                      </span>
                    )}
                    {d.descripcion ? ` — ${d.descripcion.slice(0, 120)}${d.descripcion.length > 120 ? "…" : ""}` : ""}
                  </p>
                ))}
              </div>
            </details>
          )}
        </div>
      )}

      <div className="mt-4 flex items-center gap-3">
        <Button
          disabled={pending || !preview}
          onClick={() =>
            start(async () => {
              setError(null);
              setOk(false);
              const r = await importarDesdeTexto(programaId, texto, opts);
              if (r.ok) {
                setOk(true);
                onDone();
              } else setError(r.error ?? "Error al importar");
            })
          }
          style={{ backgroundColor: "var(--brand-primary)" }}
        >
          {pending ? "Importando…" : "Importar lo seleccionado"}
        </Button>
        {ok && <span className="text-sm text-green-600">Importado ✓ — revisa las pestañas Itinerario / Ruta / Incluye.</span>}
        {error && <span className="text-sm text-red-600">{error}</span>}
      </div>
      <p className="mt-2 text-xs text-amber-700">
        Ojo: importar <b>reemplaza</b> el contenido de cada sección marcada (no agrega encima).
      </p>
    </div>
  );
}

// ── Blackouts ───────────────────────────────────────────────────────────────────
function BlackoutsEditor({ programaId, blackouts }: { programaId: number; blackouts: Blackout[] }) {
  const [rows, setRows] = useState(
    blackouts.map((b) => ({ fechaInicio: b.fecha_inicio ?? "", fechaFin: b.fecha_fin ?? "", motivo: b.motivo ?? "", ciudad: b.ciudad ?? "" }))
  );
  const upd = (i: number, k: string, v: unknown) => setRows((p) => p.map((r, j) => (j === i ? { ...r, [k]: v } : r)));
  return (
    <div>
      <p className="mb-3 text-sm text-gray-500">Fechas bloqueadas (no se puede viajar / cotizar).</p>
      <div className="space-y-2">
        {rows.map((r, i) => (
          <div key={i} className="flex flex-wrap items-center gap-2">
            <Input type="date" value={r.fechaInicio} onChange={(e) => upd(i, "fechaInicio", e.target.value)} className="w-44" />
            <span className="text-gray-400">→</span>
            <Input type="date" value={r.fechaFin} onChange={(e) => upd(i, "fechaFin", e.target.value)} className="w-44" />
            <Input value={r.motivo} onChange={(e) => upd(i, "motivo", e.target.value)} placeholder="Motivo" className="min-w-[12rem] flex-1" />
            <DelBtn onClick={() => setRows((p) => p.filter((_, j) => j !== i))} />
          </div>
        ))}
      </div>
      <div className="mt-3">
        <AddBtn onClick={() => setRows((p) => [...p, { fechaInicio: "", fechaFin: "", motivo: "", ciudad: "" }])}>+ Agregar blackout</AddBtn>
      </div>
      <SaveBar onSave={() => guardarBlackouts(programaId, rows)} />
    </div>
  );
}
