"use client";

// ─────────────────────────────────────────────────────────────────────────
// "Tarifas por unidad" (fase 2 Bernalo) — editor de `hotel_tarifas_unidad`
// dentro del detalle de hotel. Complementa —no reemplaza— la "Tarifa neta"
// de arriba (`tarifa_hotel`, cobro por persona con columnas fijas): esta
// sección es para tarifas cobradas por pareja/habitación/apartamento (o
// persona con reglas de menores de varios tramos), que ese modelo no puede
// expresar. Ver `lib/calc/unidadAlojamiento.ts` y `lib/calc/
// tarifaAlojamientoPersistida.ts`.
//
// Todo lo que este formulario junta se manda TAL CUAL a las Server Actions
// (`tarifasUnidadActions.ts`), que construyen el `TarifaAlojamiento` con
// `lib/calc/tarifaAlojamientoEditor.ts` y lo validan con el motor — este
// componente no decide si una combinación es válida, solo la recopila y
// muestra el error que el servidor devuelva.
//
// Sin fechas: la vigencia (temporada) se elige de las temporadas YA creadas
// del hotel (`hotel_temporadas` es el calendario autoritativo) — este editor
// no tiene ningún campo de fecha; `hotel_tarifas_unidad` ni siquiera tiene
// columnas de fecha propias (migración 173).
// ─────────────────────────────────────────────────────────────────────────

import { useRef, useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type {
  CategoriaTarifaria,
  PeriodicidadCobro,
  TarifaAlojamiento,
  UnidadCobro,
} from "@/lib/calc/unidadAlojamiento";
import type { EntradaFormularioTarifaUnidad, EstadoTarifaUnidad } from "@/lib/calc/tarifaAlojamientoEditor";
import {
  actualizarTarifaUnidadBorrador,
  crearTarifaUnidadBorrador,
  duplicarTarifaUnidadVersion,
  eliminarTarifaUnidadBorrador,
  inactivarTarifaUnidad,
  publicarTarifaUnidad,
} from "./tarifasUnidadActions";

export type FilaTarifaUnidadUI = {
  id: number;
  estado: EstadoTarifaUnidad;
  tarifa: TarifaAlojamiento;
};

const lbl = "mb-1 block text-xs font-medium text-gray-600";
const sel = "rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm";
const UNIDADES: { value: UnidadCobro; label: string; ayuda: string }[] = [
  { value: "persona", label: "Persona", ayuda: "Valor por 1 adulto, por noche." },
  { value: "pareja", label: "Pareja", ayuda: "Valor de LA PAREJA completa (2 adultos), por noche." },
  { value: "habitacion", label: "Habitación", ayuda: "Valor de LA HABITACIÓN completa, por noche." },
  { value: "apartamento", label: "Apartamento", ayuda: "Valor del APARTAMENTO completo, por noche." },
];
const CATEGORIAS_TARIFARIAS: { value: CategoriaTarifaria; label: string }[] = [
  { value: "infante", label: "Infante" },
  { value: "nino", label: "Niño" },
  { value: "adulto", label: "Adulto (menor que paga tarifa de adulto)" },
];
const PERIODICIDADES: { value: PeriodicidadCobro; label: string }[] = [
  { value: "por_noche", label: "Por noche" },
  { value: "por_estadia", label: "Una sola vez por estadía" },
];
const ESTADO_BADGE: Record<EstadoTarifaUnidad, string> = {
  borrador: "bg-gray-100 text-gray-600",
  publicada: "bg-[var(--brand-success)]/20 text-[var(--brand-primary)]",
  inactiva: "bg-red-50 text-red-500",
};
const ESTADO_LABEL: Record<EstadoTarifaUnidad, string> = {
  borrador: "Borrador",
  publicada: "Publicada",
  inactiva: "Inactiva",
};

const fmt = (n: number) => new Intl.NumberFormat("es-CO").format(n);

type FormState = {
  versionTarifario: string;
  temporada: string;
  categoria: string;
  alimentacion: string;
  unidadCobro: UnidadCobro;
  valorBase: string;
  nino: string;
  infante: string;
  periodicidadInfante: PeriodicidadCobro | "";
  minPax: string;
  maxPax: string;
  paxIncluidos: string;
  adultoAdicional: string;
  personaSola: string;
  menorAdicionalNino: string;
  menorAdicionalInfante: string;
  reglasEdad: { categoria: CategoriaTarifaria; edadMinAnios: string; edadMaxAnios: string }[];
  fuenteDocumento: string;
  fuentePagina: string;
};

const FORM_VACIO: FormState = {
  versionTarifario: "",
  temporada: "",
  categoria: "",
  alimentacion: "",
  unidadCobro: "persona",
  valorBase: "",
  nino: "",
  infante: "",
  periodicidadInfante: "",
  minPax: "1",
  maxPax: "",
  paxIncluidos: "0",
  adultoAdicional: "",
  personaSola: "",
  menorAdicionalNino: "",
  menorAdicionalInfante: "",
  reglasEdad: [],
  fuenteDocumento: "",
  fuentePagina: "",
};

function aFormState(t: TarifaAlojamiento): FormState {
  const clave = (s: TarifaAlojamiento["suplementos"][number]) =>
    s.tipo === "menor_adicional" ? `menor_adicional:${s.categoriaMenor}` : s.tipo;
  const supMap = new Map(t.suplementos.map((s) => [clave(s), s.valor]));
  const sup = (k: string) => (supMap.has(k) ? String(supMap.get(k)) : "");
  return {
    versionTarifario: t.versionTarifario,
    temporada: t.temporada ?? "",
    categoria: t.categoria ?? "",
    alimentacion: t.alimentacion ?? "",
    unidadCobro: t.unidadCobro,
    valorBase: String(t.valores.adulto),
    nino: t.valores.nino != null ? String(t.valores.nino) : "",
    infante: t.valores.infante != null ? String(t.valores.infante) : "",
    periodicidadInfante: t.valores.periodicidadInfante ?? "",
    minPax: String(t.capacidad.minPax),
    maxPax: t.capacidad.maxPax != null ? String(t.capacidad.maxPax) : "",
    paxIncluidos: String(t.capacidad.paxIncluidos),
    adultoAdicional: sup("adulto_adicional"),
    personaSola: sup("persona_sola"),
    menorAdicionalNino: sup("menor_adicional:nino"),
    menorAdicionalInfante: sup("menor_adicional:infante"),
    reglasEdad: t.reglaMenores.reglas.map((r) => ({
      categoria: r.categoria,
      edadMinAnios: String(r.edadMinAnios),
      edadMaxAnios: String(r.edadMaxAnios),
    })),
    fuenteDocumento: t.fuente?.documento ?? "",
    fuentePagina: t.fuente?.pagina != null ? String(t.fuente.pagina) : "",
  };
}

// Un campo NUMÉRICO OBLIGATORIO vacío nunca se convierte en un valor
// comercial válido (0, 1…) — `Number("")` da `0` en JS, así que un `|| 0`/
// `|| 1` disfrazaría "no lo llené" de "vale cero"/"vale uno". Se traduce a
// `NaN` en su lugar: el motor (`esEnteroSeguro`/`Number.isSafeInteger`) ya
// rechaza `NaN` con `configuracion_invalida`, así que el campo vacío llega
// a la validación real y se rechaza ahí — nunca se persiste en silencio.
const numRequerido = (s: string): number => (s.trim() === "" ? NaN : Number(s));

function aEntradaFormulario(f: FormState): EntradaFormularioTarifaUnidad {
  const esPersona = f.unidadCobro === "persona";
  return {
    versionTarifario: f.versionTarifario,
    temporada: f.temporada || null,
    categoria: f.categoria || null,
    alimentacion: f.alimentacion || null,
    unidadCobro: f.unidadCobro,
    valorBase: numRequerido(f.valorBase),
    nino: esPersona && f.nino !== "" ? Number(f.nino) : null,
    infante: esPersona && f.infante !== "" ? Number(f.infante) : null,
    periodicidadInfante: esPersona && f.periodicidadInfante ? f.periodicidadInfante : null,
    capacidad: {
      minPax: numRequerido(f.minPax),
      maxPax: f.maxPax === "" ? null : Number(f.maxPax),
      // Invariantes ESTRUCTURALES (no comerciales, ver `lib/calc/
      // tarifaAlojamientoEditor.ts`): persona=0/pareja=2 se fuerzan ahí sin
      // importar lo que se envíe — aquí solo se traduce lo capturado
      // (para habitación/apartamento, un campo obligatorio real).
      paxIncluidos: numRequerido(f.paxIncluidos),
    },
    suplementos: {
      adultoAdicional: f.adultoAdicional === "" ? null : Number(f.adultoAdicional),
      personaSola: f.unidadCobro === "pareja" && f.personaSola !== "" ? Number(f.personaSola) : null,
      menorAdicionalNino: f.menorAdicionalNino === "" ? null : Number(f.menorAdicionalNino),
      menorAdicionalInfante: f.menorAdicionalInfante === "" ? null : Number(f.menorAdicionalInfante),
    },
    reglasEdad: f.reglasEdad.map((r) => ({
      categoria: r.categoria,
      edadMinAnios: numRequerido(r.edadMinAnios),
      edadMaxAnios: numRequerido(r.edadMaxAnios),
    })),
    fuenteDocumento: f.fuenteDocumento || null,
    fuentePagina: f.fuentePagina === "" ? null : Number(f.fuentePagina),
  };
}

export function TarifasUnidadEditor({
  hotelId,
  temporadas,
  categorias,
  regimenes,
  filas,
  incoherentes = 0,
}: {
  hotelId: number;
  temporadas: string[];
  categorias: string[];
  regimenes: string[];
  filas: FilaTarifaUnidadUI[];
  incoherentes?: number;
}) {
  const [editId, setEditId] = useState<number | null>(null);
  const [form, setForm] = useState<FormState>(FORM_VACIO);
  const [pending, start] = useTransition();
  const [err, setErr] = useState("");
  const [msg, setMsg] = useState("");
  // La sección vive AL FINAL del detalle de hotel (debajo de temporadas,
  // tarifa neta, etc.) — desplazar la página al tope alejaba al usuario del
  // formulario que acababa de abrir. `scrollIntoView` sobre el propio
  // contenedor del formulario lo trae a la vista sin asumir en qué posición
  // de la página está montado.
  const formRef = useRef<HTMLDivElement>(null);

  const editando = editId != null;
  const esPersona = form.unidadCobro === "persona";
  const esPareja = form.unidadCobro === "pareja";
  const admiteSuplementos = form.unidadCobro !== "persona";

  function reset() {
    setEditId(null);
    setForm(FORM_VACIO);
    setErr("");
  }

  function editar(f: FilaTarifaUnidadUI) {
    setEditId(f.id);
    setForm(aFormState(f.tarifa));
    setErr("");
    setMsg("");
    formRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  function guardar() {
    if (!form.versionTarifario.trim()) { setErr("La versión del tarifario es obligatoria."); return; }
    if (!form.valorBase.trim()) { setErr("El valor base es obligatorio."); return; }
    setErr(""); setMsg("");
    const input = aEntradaFormulario(form);
    start(async () => {
      const r = editId == null
        ? await crearTarifaUnidadBorrador(hotelId, input)
        : await actualizarTarifaUnidadBorrador(editId, hotelId, input);
      if (!r.ok) { setErr(r.error); return; }
      setMsg(editId == null ? "Borrador creado." : "Borrador actualizado.");
      reset();
    });
  }

  function publicar(id: number) {
    if (!confirm("¿Publicar esta tarifa? Una vez publicada, su contenido ya no se puede editar (solo duplicar como nueva versión o inactivar).")) return;
    setErr(""); setMsg("");
    start(async () => {
      const r = await publicarTarifaUnidad(id, hotelId);
      if (!r.ok) setErr(r.error); else setMsg("Tarifa publicada.");
    });
  }

  function inactivar(id: number) {
    if (!confirm("¿Inactivar esta tarifa?")) return;
    setErr(""); setMsg("");
    start(async () => {
      const r = await inactivarTarifaUnidad(id, hotelId);
      if (!r.ok) setErr(r.error); else setMsg("Tarifa inactivada.");
    });
  }

  function duplicar(f: FilaTarifaUnidadUI) {
    const sugerida = `${f.tarifa.versionTarifario}-v2`;
    const nueva = window.prompt("Nueva versión para la copia (debe ser distinta de la actual):", sugerida);
    if (!nueva) return;
    setErr(""); setMsg("");
    start(async () => {
      const r = await duplicarTarifaUnidadVersion(f.id, hotelId, nueva);
      if (!r.ok) { setErr(r.error); return; }
      setMsg("Se creó un borrador con la nueva versión. Edítalo para ajustar los valores.");
    });
  }

  function eliminar(id: number) {
    if (!confirm("¿Eliminar este borrador? Esta acción no se puede deshacer.")) return;
    setErr(""); setMsg("");
    start(async () => {
      const r = await eliminarTarifaUnidadBorrador(id, hotelId);
      if (!r.ok) setErr(r.error);
    });
  }

  const setReglas = (v: FormState["reglasEdad"]) => setForm({ ...form, reglasEdad: v });

  const filasOrdenadas = [...filas].sort((a, b) => {
    if (a.tarifa.id !== b.tarifa.id) return a.tarifa.id.localeCompare(b.tarifa.id);
    return a.tarifa.versionTarifario.localeCompare(b.tarifa.versionTarifario);
  });

  return (
    <section className="mt-8">
      <h2 className="mb-1 text-sm font-semibold text-gray-700">Tarifas por unidad (Bernalo)</h2>
      <p className="mb-3 text-xs text-gray-500">
        Para tarifas cobradas por <b>pareja</b>, <b>habitación</b> o <b>apartamento</b> (o por persona con reglas de
        menores de varios tramos) — la tabla &quot;Tarifa neta&quot; de arriba solo cubre el cobro por persona con
        columnas fijas. La <b>temporada</b> se elige de las ya creadas arriba; esta sección nunca captura fechas.
        Una tarifa nace en <b>borrador</b>, se <b>publica</b> cuando está lista (ya no se puede editar su contenido) y
        solo puede pasar a <b>inactiva</b>. Para corregir una publicada, <b>duplícala como nueva versión</b>.
      </p>

      {incoherentes > 0 && (
        <p className="mb-3 rounded-lg bg-red-50 px-3 py-2 text-xs text-red-700">
          {incoherentes} fila(s) de esta tabla no pasaron la validación al leerlas y no se muestran. Revisa la base o
          contacta a quien las cargó.
        </p>
      )}

      <div ref={formRef} className="rounded-xl border border-gray-200 bg-white p-4">
        {editando && <p className="mb-2 text-xs font-medium text-[var(--brand-accent)]">Editando borrador — versión &quot;{form.versionTarifario || "…"}&quot;</p>}

        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <div>
            <label className={lbl}>Versión del tarifario</label>
            <Input placeholder="bernalo-2026" value={form.versionTarifario} onChange={(e) => setForm({ ...form, versionTarifario: e.target.value })} />
          </div>
          <div>
            <label className={lbl}>Temporada <span className="font-normal text-gray-400">(opcional)</span></label>
            <select value={form.temporada} onChange={(e) => setForm({ ...form, temporada: e.target.value })} className={`${sel} w-full`}>
              <option value="">Sin temporada</option>
              {temporadas.map((t) => <option key={t} value={t}>{t}</option>)}
            </select>
          </div>
          <div>
            <label className={lbl}>Categoría <span className="font-normal text-gray-400">(opcional)</span></label>
            <select value={form.categoria} onChange={(e) => setForm({ ...form, categoria: e.target.value })} className={`${sel} w-full`}>
              <option value="">Sin categoría</option>
              {categorias.map((c) => <option key={c} value={c}>{c}</option>)}
            </select>
          </div>
          <div>
            <label className={lbl}>Alimentación <span className="font-normal text-gray-400">(opcional)</span></label>
            <select value={form.alimentacion} onChange={(e) => setForm({ ...form, alimentacion: e.target.value })} className={`${sel} w-full`}>
              <option value="">Sin régimen</option>
              {regimenes.map((r) => <option key={r} value={r}>{r}</option>)}
            </select>
          </div>

          <div>
            <label className={lbl}>Unidad de cobro</label>
            <select
              value={form.unidadCobro}
              onChange={(e) => {
                const unidadCobro = e.target.value as UnidadCobro;
                setForm({
                  ...form,
                  unidadCobro,
                  paxIncluidos: unidadCobro === "persona" ? "0" : unidadCobro === "pareja" ? "2" : form.paxIncluidos,
                  nino: unidadCobro === "persona" ? form.nino : "",
                  infante: unidadCobro === "persona" ? form.infante : "",
                  periodicidadInfante: unidadCobro === "persona" ? form.periodicidadInfante : "",
                  personaSola: unidadCobro === "pareja" ? form.personaSola : "",
                });
              }}
              className={`${sel} w-full`}
            >
              {UNIDADES.map((u) => <option key={u.value} value={u.value}>{u.label}</option>)}
            </select>
          </div>
          <div>
            <label className={lbl}>Valor base</label>
            <Input type="number" min={0} value={form.valorBase} onChange={(e) => setForm({ ...form, valorBase: e.target.value })} placeholder="0" />
          </div>
        </div>
        <p className="mt-1 text-[11px] text-gray-400">{UNIDADES.find((u) => u.value === form.unidadCobro)?.ayuda}</p>

        {esPersona && (
          <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-4">
            <div>
              <label className={lbl}>Niño <span className="font-normal text-gray-400">(opcional)</span></label>
              <Input type="number" min={0} value={form.nino} onChange={(e) => setForm({ ...form, nino: e.target.value })} placeholder="—" />
            </div>
            <div>
              <label className={lbl}>Infante <span className="font-normal text-gray-400">(opcional)</span></label>
              <Input type="number" min={0} value={form.infante} onChange={(e) => setForm({ ...form, infante: e.target.value })} placeholder="—" />
            </div>
            <div>
              <label className={lbl}>Periodicidad del infante {form.infante !== "" && <span className="text-red-500">*</span>}</label>
              <select
                value={form.periodicidadInfante}
                onChange={(e) => setForm({ ...form, periodicidadInfante: e.target.value as PeriodicidadCobro | "" })}
                className={`${sel} w-full`}
                disabled={form.infante === ""}
              >
                <option value="">{form.infante === "" ? "Sin infante configurado" : "Elige…"}</option>
                {PERIODICIDADES.map((p) => <option key={p.value} value={p.value}>{p.label}</option>)}
              </select>
            </div>
          </div>
        )}

        <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-4">
          <div>
            <label className={lbl}>Capacidad mínima (pax)</label>
            <Input type="number" min={1} value={form.minPax} onChange={(e) => setForm({ ...form, minPax: e.target.value })} />
          </div>
          <div>
            <label className={lbl}>Capacidad máxima <span className="font-normal text-gray-400">(vacío = sin límite)</span></label>
            <Input type="number" min={1} value={form.maxPax} onChange={(e) => setForm({ ...form, maxPax: e.target.value })} placeholder="—" />
          </div>
          <div>
            <label className={lbl}>Pax incluidos en el valor base</label>
            {form.unidadCobro === "persona" || form.unidadCobro === "pareja" ? (
              <Input value={form.unidadCobro === "persona" ? "0 (no aplica)" : "2 (fijo)"} disabled />
            ) : (
              <Input type="number" min={0} value={form.paxIncluidos} onChange={(e) => setForm({ ...form, paxIncluidos: e.target.value })} />
            )}
          </div>
        </div>

        {admiteSuplementos && (
          <div className="mt-3 rounded-lg border border-gray-100 p-3">
            <p className={lbl}>Suplementos compatibles con &quot;{UNIDADES.find((u) => u.value === form.unidadCobro)?.label}&quot;</p>
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              <div>
                <label className="mb-1 block text-[11px] text-gray-500">Adulto adicional</label>
                <Input type="number" min={0} value={form.adultoAdicional} onChange={(e) => setForm({ ...form, adultoAdicional: e.target.value })} placeholder="—" />
              </div>
              {esPareja && (
                <div>
                  <label className="mb-1 block text-[11px] text-gray-500">Persona sola</label>
                  <Input type="number" min={0} value={form.personaSola} onChange={(e) => setForm({ ...form, personaSola: e.target.value })} placeholder="—" />
                </div>
              )}
              <div>
                <label className="mb-1 block text-[11px] text-gray-500">Menor adicional (niño)</label>
                <Input type="number" min={0} value={form.menorAdicionalNino} onChange={(e) => setForm({ ...form, menorAdicionalNino: e.target.value })} placeholder="—" />
              </div>
              <div>
                <label className="mb-1 block text-[11px] text-gray-500">Menor adicional (infante)</label>
                <Input type="number" min={0} value={form.menorAdicionalInfante} onChange={(e) => setForm({ ...form, menorAdicionalInfante: e.target.value })} placeholder="—" />
              </div>
            </div>
          </div>
        )}

        <div className="mt-3 rounded-lg border border-gray-100 p-3">
          <p className={lbl}>Reglas de edad (clasifica cada menor por tramo — sin una regla que cubra su edad, la reserva se bloquea)</p>
          <div className="space-y-2">
            {form.reglasEdad.map((r, i) => (
              <div key={i} className="flex items-end gap-2">
                <div>
                  <label className="block text-[10px] text-gray-400">Categoría</label>
                  <select
                    value={r.categoria}
                    onChange={(e) => setReglas(form.reglasEdad.map((x, idx) => (idx === i ? { ...x, categoria: e.target.value as CategoriaTarifaria } : x)))}
                    className={sel}
                  >
                    {CATEGORIAS_TARIFARIAS.map((c) => <option key={c.value} value={c.value}>{c.label}</option>)}
                  </select>
                </div>
                <div className="flex-1">
                  <label className="block text-[10px] text-gray-400">Edad mín. (años)</label>
                  <Input type="number" min={0} value={r.edadMinAnios} onChange={(e) => setReglas(form.reglasEdad.map((x, idx) => (idx === i ? { ...x, edadMinAnios: e.target.value } : x)))} />
                </div>
                <div className="flex-1">
                  <label className="block text-[10px] text-gray-400">Edad máx. (años)</label>
                  <Input type="number" min={0} value={r.edadMaxAnios} onChange={(e) => setReglas(form.reglasEdad.map((x, idx) => (idx === i ? { ...x, edadMaxAnios: e.target.value } : x)))} />
                </div>
                <button type="button" onClick={() => setReglas(form.reglasEdad.filter((_, idx) => idx !== i))} className="pb-2 text-xs text-gray-400 hover:text-red-500">Quitar</button>
              </div>
            ))}
            {!form.reglasEdad.length && <p className="text-[11px] text-gray-400">Sin reglas de menores (ej. hoteles de pareja sin política de menores).</p>}
          </div>
          <button
            type="button"
            onClick={() => setReglas([...form.reglasEdad, { categoria: "nino", edadMinAnios: "", edadMaxAnios: "" }])}
            className="mt-2 text-xs font-medium text-[var(--brand-accent)]"
          >
            + Agregar regla
          </button>
        </div>

        <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-4">
          <div className="col-span-2">
            <label className={lbl}>Documento fuente <span className="font-normal text-gray-400">(opcional)</span></label>
            <Input value={form.fuenteDocumento} onChange={(e) => setForm({ ...form, fuenteDocumento: e.target.value })} placeholder="Tarifario Bernalo 2026.pdf" />
          </div>
          <div>
            <label className={lbl}>Página <span className="font-normal text-gray-400">(opcional)</span></label>
            <Input type="number" min={1} value={form.fuentePagina} onChange={(e) => setForm({ ...form, fuentePagina: e.target.value })} placeholder="—" disabled={!form.fuenteDocumento.trim()} />
          </div>
        </div>

        <div className="mt-3 flex items-center gap-3">
          <Button onClick={guardar} disabled={pending} style={{ backgroundColor: "var(--brand-primary)" }}>
            {pending ? "…" : editando ? "Guardar borrador" : "Crear borrador"}
          </Button>
          {editando && <Button variant="outline" onClick={reset} disabled={pending}>Cancelar</Button>}
          {err && <span className="text-sm text-red-600">{err}</span>}
        </div>
        {msg && <p className="mt-2 rounded-lg bg-[var(--brand-accent)]/10 px-3 py-2 text-xs text-[var(--brand-primary)]">{msg}</p>}
      </div>

      <div className="mt-4 overflow-x-auto rounded-xl border border-gray-200 bg-white">
        <table className="w-full min-w-[900px] text-sm">
          <thead>
            <tr className="bg-gray-50 text-left text-xs uppercase text-gray-400">
              <th className="px-3 py-2">Estado</th>
              <th className="px-3 py-2">Tarifa</th>
              <th className="px-3 py-2">Versión</th>
              <th className="px-3 py-2">Unidad</th>
              <th className="px-3 py-2">Clasificación</th>
              <th className="px-3 py-2 text-right">Valor base</th>
              <th className="px-3 py-2"></th>
            </tr>
          </thead>
          <tbody>
            {filasOrdenadas.map((f) => (
              <tr key={f.id} className="border-t border-gray-50">
                <td className="px-3 py-2">
                  <span className={`rounded-full px-2 py-0.5 text-[10px] font-medium ${ESTADO_BADGE[f.estado]}`}>{ESTADO_LABEL[f.estado]}</span>
                </td>
                <td className="px-3 py-2 font-mono text-[11px] text-gray-400">{f.tarifa.id}</td>
                <td className="px-3 py-2 text-gray-700">{f.tarifa.versionTarifario}</td>
                <td className="px-3 py-2 text-gray-500">{UNIDADES.find((u) => u.value === f.tarifa.unidadCobro)?.label ?? f.tarifa.unidadCobro}</td>
                <td className="px-3 py-2 text-gray-500">
                  {[f.tarifa.temporada, f.tarifa.categoria, f.tarifa.alimentacion].filter(Boolean).join(" · ") || "—"}
                </td>
                <td className="px-3 py-2 text-right tabular-nums">{fmt(f.tarifa.valores.adulto)}</td>
                <td className="px-3 py-2 text-right">
                  <div className="flex items-center justify-end gap-3">
                    {f.estado === "borrador" && (
                      <>
                        <button type="button" onClick={() => editar(f)} className="text-xs text-[var(--brand-accent)] hover:underline">Editar</button>
                        <button type="button" onClick={() => publicar(f.id)} className="text-xs text-[var(--brand-success)] hover:underline" disabled={pending}>Publicar</button>
                      </>
                    )}
                    {f.estado === "publicada" && (
                      <button type="button" onClick={() => inactivar(f.id)} className="text-xs text-amber-600 hover:underline" disabled={pending}>Inactivar</button>
                    )}
                    <button type="button" onClick={() => duplicar(f)} className="text-xs text-gray-500 hover:underline" disabled={pending}>Duplicar versión</button>
                    {f.estado === "borrador" && (
                      <button type="button" onClick={() => eliminar(f.id)} className="text-xs text-gray-400 hover:text-red-500" disabled={pending}>Eliminar</button>
                    )}
                  </div>
                </td>
              </tr>
            ))}
            {!filasOrdenadas.length && (
              <tr><td colSpan={7} className="px-3 py-4 text-center text-sm text-gray-400">Sin tarifas por unidad todavía.</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </section>
  );
}
