"use client";

import { useMemo, useState, useTransition } from "react";
import { editarPasajeroSilla, borrarPasajeroSilla, moverPasajeroSilla, guardarInfanteVuelo, type PasajeroSillaInput } from "../actions";
import { esInfantePorEdad, sillaTieneDatosDePasajero } from "@/lib/vuelos/infanteVuelo";
import { calcularEdad } from "@/lib/utils";

type Pasajero = PasajeroSillaInput;
type RecordOpt = { id: number; record: string; fecha_ida: string | null };
type CandidatoResponsable = { sillaId: number; nombre: string };

const inp = "w-full rounded border border-gray-300 px-2 py-1 text-sm";

export function PasajeroAcciones({
  sillaId,
  bloqueoId,
  inicial,
  otros,
  bloqueada,
  fechaIdaBloqueo,
  candidatosResponsable,
}: {
  sillaId: number;
  bloqueoId: number;
  inicial: Pasajero;
  otros: RecordOpt[];
  bloqueada: boolean; // solo 'cambio' (silla que salió a otro record): la gestiona el sistema
  /** `bloqueos_vuelo.fecha_ida` REAL de este vuelo — para detectar en vivo si la fecha de nacimiento tecleada corresponde a un infante (mismo criterio que guardar_infante_vuelo, migración 168). */
  fechaIdaBloqueo: string | null;
  /** Otros pasajeros del MISMO vuelo con documento propio (candidatos a "adulto responsable" si este resulta ser un infante). El server (guardar_infante_vuelo) revalida todo — esta lista solo alimenta el <select>. */
  candidatosResponsable: CandidatoResponsable[];
}) {
  const [modo, setModo] = useState<null | "editar" | "mover">(null);
  const [form, setForm] = useState<Pasajero>(inicial);
  const [destino, setDestino] = useState<number | "">("");
  const [responsableId, setResponsableId] = useState<number | "">("");
  const [pending, start] = useTransition();
  const [err, setErr] = useState("");

  const set = (k: keyof Pasajero, val: string) => setForm((f) => ({ ...f, [k]: val }));

  // Silla VACÍA al abrir el modal (sin ningún dato de pasajero ya
  // registrado) — se decide sobre `inicial` (el estado ORIGINAL de la
  // silla), nunca sobre `form` (que cambia mientras se escribe): si la silla
  // YA tenía CUALQUIER dato propio (nombre, apellido, documento o
  // nacimiento — una fila puede llegar con datos PARCIALES, ej. solo
  // documento sin nombre todavía), esto es una EDICIÓN, no un alta, y la
  // conversión automática a infante no aplica aquí (ver más abajo) — evita
  // el caso reportado donde corregir la fecha de un pasajero existente a
  // <2 años creaba un infante NUEVO y dejaba al pasajero original duplicado
  // ocupando la silla.
  const sillaVacia = !sillaTieneDatosDePasajero(inicial);

  // Detección EN VIVO de infante — misma fuente de verdad que el RPC
  // guardar_infante_vuelo (lib/vuelos/infanteVuelo.ts), contra la fecha REAL
  // del vuelo (nunca la del contrato). El servidor sigue siendo la
  // autoridad: esto solo adelanta el cambio de flujo en el formulario.
  const esInfante = useMemo(
    () => (form.nacimiento ? esInfantePorEdad(form.nacimiento, fechaIdaBloqueo) : false),
    [form.nacimiento, fechaIdaBloqueo]
  );
  const edadInfante = useMemo(
    () => (form.nacimiento ? calcularEdad(form.nacimiento, fechaIdaBloqueo) : null),
    [form.nacimiento, fechaIdaBloqueo]
  );
  // Alcance mínimo pedido: la conversión automática a INF solo opera en el
  // ALTA sobre una silla vacía. Si la silla ya tenía un pasajero y la fecha
  // corregida clasifica como infante, se BLOQUEA el guardado — nunca se
  // inserta el infante ni se toca la silla (ninguna conversión destructiva
  // ni multioperación en este PR).
  const bloqueadaPorSillaOcupada = esInfante && !sillaVacia;

  if (bloqueada) return <span className="text-[10px] text-gray-400">—</span>;

  function guardar() {
    setErr("");
    // Si la fecha de nacimiento clasifica como infante (< 2 años a la fecha
    // REAL del vuelo) Y la silla estaba VACÍA al abrir el modal (alta, no
    // edición de un pasajero existente), este pasajero NO ocupa silla —
    // nunca se escribe en ESTA silla (queda disponible/sin tocar). En vez de
    // eso, se crea como infante subordinado al adulto responsable elegido,
    // vía el mismo RPC estrecho que usa el trigger directo "Infante"
    // (migración 168).
    if (esInfante) {
      if (bloqueadaPorSillaOcupada) {
        setErr("Esta silla ya tiene un pasajero registrado: no se puede convertir a infante editándola aquí. Borra o mueve primero al pasajero actual, o corrige la fecha de nacimiento.");
        return;
      }
      if (responsableId === "") { setErr("Elige el adulto responsable del infante."); return; }
      start(async () => {
        const r = await guardarInfanteVuelo(bloqueoId, Number(responsableId), null, {
          nombreCompleto: `${form.pasajero_nombres} ${form.pasajero_apellidos}`.trim(),
          tipoDoc: form.tipo_doc,
          numeroDoc: form.numero_doc,
          fechaNacimiento: form.nacimiento,
        });
        if (r.ok) { setModo(null); setResponsableId(""); }
        else setErr(r.error);
      });
      return;
    }
    start(async () => {
      const r = await editarPasajeroSilla(sillaId, bloqueoId, form);
      if (r.ok) setModo(null);
      else setErr(r.error);
    });
  }
  function mover() {
    if (destino === "") return;
    setErr("");
    start(async () => {
      const r = await moverPasajeroSilla(sillaId, bloqueoId, Number(destino));
      if (r.ok) { setModo(null); setDestino(""); }
      else setErr(r.error);
    });
  }
  function borrar() {
    if (!confirm("¿Borrar el pasajero y liberar la silla? Esta acción la deja 'disponible' y no toca el contrato.")) return;
    setErr("");
    start(async () => {
      const r = await borrarPasajeroSilla(sillaId, bloqueoId);
      if (!r.ok) setErr(r.error);
    });
  }

  return (
    <>
      <div className="flex items-center gap-2 text-xs">
        <button type="button" onClick={() => { setForm(inicial); setModo("editar"); }} className="text-[#1D7C9A] hover:underline">Editar</button>
        <button type="button" onClick={() => setModo("mover")} className="text-[#1D7C9A] hover:underline">Mover</button>
        <button type="button" onClick={borrar} disabled={pending} className="text-red-500 hover:underline disabled:opacity-50">Borrar</button>
      </div>

      {modo && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={() => setModo(null)}>
          <div className="w-full max-w-lg rounded-2xl bg-white p-5 shadow-xl" onClick={(e) => e.stopPropagation()}>
            {modo === "editar" ? (
              <>
                <h3 className="mb-3 text-sm font-semibold text-gray-800">Editar pasajero · silla #{sillaId}</h3>
                <div className="grid grid-cols-2 gap-3">
                  <label className="text-xs text-gray-500">Nombres
                    <input className={inp} value={form.pasajero_nombres} onChange={(e) => set("pasajero_nombres", e.target.value)} />
                  </label>
                  <label className="text-xs text-gray-500">Apellidos
                    <input className={inp} value={form.pasajero_apellidos} onChange={(e) => set("pasajero_apellidos", e.target.value)} />
                  </label>
                  <label className="text-xs text-gray-500">Tipo doc
                    <input className={inp} value={form.tipo_doc} onChange={(e) => set("tipo_doc", e.target.value)} />
                  </label>
                  <label className="text-xs text-gray-500">Número doc
                    <input className={inp} value={form.numero_doc} onChange={(e) => set("numero_doc", e.target.value)} />
                  </label>
                  <label className="text-xs text-gray-500">Nacimiento
                    <input type="date" className={inp} value={form.nacimiento} onChange={(e) => set("nacimiento", e.target.value)} />
                  </label>
                  {!esInfante && (
                    <>
                      <label className="text-xs text-gray-500">Asesor
                        <input className={inp} value={form.asesor} onChange={(e) => set("asesor", e.target.value)} />
                      </label>
                      <label className="text-xs text-gray-500">Hotel
                        <input className={inp} value={form.hotel} onChange={(e) => set("hotel", e.target.value)} />
                      </label>
                      <label className="text-xs text-gray-500">Acomodación
                        <input className={inp} value={form.acomodacion} onChange={(e) => set("acomodacion", e.target.value)} />
                      </label>
                      <label className="text-xs text-gray-500">Plazo
                        <input type="date" className={inp} value={form.plazo} onChange={(e) => set("plazo", e.target.value)} />
                      </label>
                    </>
                  )}
                </div>

                {esInfante && sillaVacia && (
                  <div className="mt-3 rounded-lg border border-amber-200 bg-amber-50 p-3">
                    <p className="text-xs text-amber-800">
                      Con {edadInfante ?? "?"} años a la fecha del vuelo, este pasajero es <b>infante</b>: no ocupa silla
                      (esta silla queda sin usar) — se guarda a cargo de un adulto responsable.
                    </p>
                    <label className="mt-2 block text-xs text-gray-500">Adulto responsable
                      <select
                        className={inp}
                        value={responsableId}
                        onChange={(e) => setResponsableId(e.target.value === "" ? "" : Number(e.target.value))}
                      >
                        <option value="">Elige el adulto responsable…</option>
                        {candidatosResponsable.map((c) => (
                          <option key={c.sillaId} value={c.sillaId}>{c.nombre}</option>
                        ))}
                      </select>
                    </label>
                  </div>
                )}

                {bloqueadaPorSillaOcupada && (
                  <div className="mt-3 rounded-lg border border-red-200 bg-red-50 p-3">
                    <p className="text-xs text-red-800">
                      Con {edadInfante ?? "?"} años a la fecha del vuelo, este pasajero sería <b>infante</b> — pero esta
                      silla ya tiene un pasajero registrado. No se puede convertir aquí: borra o mueve primero al
                      pasajero actual, o corrige la fecha de nacimiento.
                    </p>
                  </div>
                )}

                {err && <p className="mt-2 text-xs text-red-600">{err}</p>}
                <div className="mt-4 flex justify-end gap-2">
                  <button type="button" onClick={() => setModo(null)} className="rounded-lg px-3 py-1.5 text-sm text-gray-500 hover:bg-gray-100">Cancelar</button>
                  <button type="button" onClick={guardar} disabled={pending || bloqueadaPorSillaOcupada} className="rounded-lg px-4 py-1.5 text-sm font-semibold text-white disabled:opacity-50" style={{ backgroundColor: "var(--brand-primary)" }}>{pending ? "Guardando…" : "Guardar"}</button>
                </div>
              </>
            ) : (
              <>
                <h3 className="mb-1 text-sm font-semibold text-gray-800">Mover pasajero a otro record</h3>
                <p className="mb-3 text-xs text-gray-500">Se copia con su contrato y estado al record elegido; la silla actual queda <b>disponible</b> y se registra el cambio.</p>
                <select value={destino} onChange={(e) => setDestino(e.target.value === "" ? "" : Number(e.target.value))} className={inp}>
                  <option value="">Elige el record destino…</option>
                  {otros.map((o) => <option key={o.id} value={o.id}>{o.record}{o.fecha_ida ? ` · ${o.fecha_ida}` : ""}</option>)}
                </select>
                {err && <p className="mt-2 text-xs text-red-600">{err}</p>}
                <div className="mt-4 flex justify-end gap-2">
                  <button type="button" onClick={() => setModo(null)} className="rounded-lg px-3 py-1.5 text-sm text-gray-500 hover:bg-gray-100">Cancelar</button>
                  <button type="button" onClick={mover} disabled={pending || destino === ""} className="rounded-lg px-4 py-1.5 text-sm font-semibold text-white disabled:opacity-50" style={{ backgroundColor: "var(--brand-primary)" }}>{pending ? "Moviendo…" : "Mover pasajero"}</button>
                </div>
              </>
            )}
          </div>
        </div>
      )}
    </>
  );
}
