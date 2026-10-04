"use client";

import { DateInput } from "@/components/ui/DateInput";
import { useMemo, useState, useTransition } from "react";
import { editarPasajeroSilla, borrarPasajeroSilla, moverPasajeroSilla, guardarInfanteVuelo, type PasajeroSillaInput, type ContratoVistoSilla } from "../actions";
import { esInfantePorEdad, sillaTieneDatosDePasajero } from "@/lib/vuelos/infanteVuelo";
import { calcularEdad } from "@/lib/utils";
import { nuevaOperacionId, type ModoMover } from "@/lib/vuelos/operaciones";
import { validarRetencion } from "@/lib/vuelos/retencion";
import { AlertTriangle, ArrowRightLeft, Check, Info, UserRound } from "lucide-react";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";

type Pasajero = PasajeroSillaInput;
/**
 * Record destino ya filtrado por la página a los COMPATIBLES (mismo destino,
 * mismo proveedor, vuelo no salido). La base vuelve a validarlo todo.
 */
type RecordOpt = {
  id: number; record: string; fecha_ida: string | null; libres: number; tarifaDistinta: boolean;
  /** Misma fecha de ida y de regreso que este record (D3-c). */
  mismasFechas: boolean;
};
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
  libre,
  contratoOrganico,
  contratoVisto,
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
  /**
   * OBLIGATORIA. Silla libre de verdad (`esSillaLibre`, lib/vuelos/sillaLibre.ts):
   * sin pasajero ni contrato. En ella "Mover" no se ofrece (no hay a quién
   * mover; para cupos libres está "Trasladar cupos"). La protección real está
   * en la base: `mover_pasajero` (migración 194) rechaza una silla libre
   * aunque se llame la acción directamente.
   */
  libre: boolean;
  /**
   * OBLIGATORIA. La silla tiene numero_contrato (venta del sistema). D3-c:
   * solo puede ir a un record con las mismas fechas de ida y regreso, y el
   * vuelo del contrato se actualiza con el movimiento. Con contrato_manual
   * (false) no aplica. La base lo vuelve a validar.
   */
  contratoOrganico: boolean;
  /**
   * OBLIGATORIA. El contrato (orgánico y manual) que esta pantalla muestra en
   * la silla. Se manda al editar: si la silla cambió de contrato entretanto
   * (una reserva la tomó), la base rechaza la edición en vez de escribirla
   * sobre otro contrato (migración 201).
   */
  contratoVisto: ContratoVistoSilla;
}) {
  const [modo, setModo] = useState<null | "editar" | "mover">(null);
  const [form, setForm] = useState<Pasajero>(inicial);
  const sinContrato = contratoVisto.numero_contrato === null && contratoVisto.contrato_manual === null;
  const [destino, setDestino] = useState<number | "">("");
  // Modo de recepción en el destino: SIN valor por defecto (decisión explícita).
  const [modoMover, setModoMover] = useState<ModoMover | null>(null);
  const [aceptaTarifa, setAceptaTarifa] = useState(false);
  const [tarifaDetectada, setTarifaDetectada] = useState(false);
  const [motivo, setMotivo] = useState("");
  // Mismo id en cada reintento del mismo formulario: si la primera llamada sí
  // se aplicó y solo se perdió la respuesta, la base no la aplica dos veces.
  const [operacionId, setOperacionId] = useState("");
  const [movido, setMovido] = useState<null | { movidas: number; repetida: boolean; contrato: string | null; avisoRecord: boolean; avisoTarifa: boolean; tramos: number }>(null);
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
    // Sin contrato, la silla queda vacía o RETENIDA: pasajero y fecha de plazo
    // (migración 201). Nunca se guarda una silla "aparentemente disponible"
    // con datos; la base lo vuelve a validar.
    if (sinContrato) {
      const motivo = validarRetencion(form, inicial.plazo || null);
      if (motivo) { setErr(motivo); return; }
    }
    start(async () => {
      const r = await editarPasajeroSilla(sillaId, bloqueoId, form, contratoVisto);
      if (r.ok) setModo(null);
      else setErr(r.error);
    });
  }
  const destinoSel = otros.find((o) => o.id === destino) ?? null;
  const pideTarifa = !!destinoSel?.tarifaDistinta || tarifaDetectada;

  function abrirMover() {
    setErr(""); setDestino(""); setModoMover(null); setAceptaTarifa(false); setTarifaDetectada(false);
    setMotivo(""); setMovido(null); setOperacionId(nuevaOperacionId()); setModo("mover");
  }
  function mover() {
    if (destino === "" || !modoMover) return;
    if (pideTarifa && !aceptaTarifa) { setErr("Confirma que entiendes que la tarifa del record destino es distinta."); return; }
    setErr("");
    start(async () => {
      const r = await moverPasajeroSilla(sillaId, bloqueoId, Number(destino), {
        modo: modoMover, aceptaTarifaDistinta: aceptaTarifa, motivo, operacionId,
      });
      if (r.ok) {
        setMovido({ movidas: r.movidas, repetida: r.repetida, contrato: r.contrato, avisoRecord: r.avisoRecordContrato, avisoTarifa: r.avisoTarifaDistinta, tramos: r.tramosActualizados });
      } else {
        if (r.requiereConfirmarTarifa) setTarifaDetectada(true);
        setErr(r.error);
      }
    });
  }
  return (
    <>
      <div className="flex items-center gap-2 text-xs">
        <button type="button" onClick={() => { setForm(inicial); setModo("editar"); }} className="text-[#1D7C9A] hover:underline">Editar</button>
        {!libre && (
          <button type="button" onClick={abrirMover} className="text-[#1D7C9A] hover:underline">Mover</button>
        )}
        <ConfirmDialog
          title="¿Borrar el pasajero y liberar la silla?"
          description="La silla queda disponible y pierde la referencia del contrato, también la manual. El contrato en sí no se modifica."
          confirmLabel="Borrar pasajero"
          destructive
          onConfirm={() => borrarPasajeroSilla(sillaId, bloqueoId, contratoVisto.updated_at)}
          trigger={<button type="button" disabled={pending} className="text-red-500 hover:underline disabled:opacity-50">Borrar</button>}
        />
      </div>

      {modo && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={() => setModo(null)}>
          <div className="w-full max-w-lg rounded-2xl bg-white p-5 shadow-xl" onClick={(e) => e.stopPropagation()}>
            {modo === "editar" ? (
              <>
                <h3 className="mb-3 text-sm font-semibold text-gray-800">Editar pasajero</h3>
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
                    <DateInput aria-label="Fecha de nacimiento" type="date" className={inp} value={form.nacimiento} onValueChange={(dateValue) => set("nacimiento", dateValue)} />
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
                      <label className="text-xs text-gray-500">{sinContrato ? "Plazo (obligatorio sin contrato)" : "Plazo"}
                        <DateInput aria-label="Plazo de pago" type="date" className={inp} value={form.plazo} onValueChange={(dateValue) => set("plazo", dateValue)} />
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
                <h3 className="mb-1 flex items-center gap-1.5 text-sm font-semibold text-gray-800">
                  <ArrowRightLeft className="h-4 w-4" style={{ color: "var(--brand-primary)" }} /> Mover pasajero a otro record
                </h3>
                {movido ? (
                  <div role="status" className="mt-2 space-y-2">
                    <p className="flex items-start gap-1.5 text-sm text-gray-700">
                      <Check className="mt-0.5 h-4 w-4 shrink-0" style={{ color: "var(--brand-success)" }} />
                      {movido.repetida
                        ? "Esta operación ya se había aplicado; no se repitió."
                        : `Listo: ${movido.movidas} silla(s) movida(s)${movido.contrato ? ` del contrato ${movido.contrato}` : ""}.`}
                    </p>
                    {movido.tramos > 0 && (
                      <p className="flex items-start gap-1.5 text-xs text-gray-600">
                        <Info className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                        Se actualizó el vuelo del contrato ({movido.tramos} tramo(s)): PNR, número de vuelo y horas del nuevo record.
                      </p>
                    )}
                    {movido.avisoRecord && (
                      <p className="flex items-start gap-1.5 rounded-lg border border-amber-200 bg-amber-50 p-2 text-xs text-amber-800">
                        <Info className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                        Contrato manual: el vuelo de la venta a la que se refiere todavía muestra el PNR del record anterior. No se cambia solo; actualízalo en ese contrato si corresponde.
                      </p>
                    )}
                    {movido.avisoTarifa && (
                      <p className="flex items-start gap-1.5 rounded-lg border border-amber-200 bg-amber-50 p-2 text-xs text-amber-800">
                        <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                        La tarifa neta del record destino es distinta. El costo del contrato y las cuentas por pagar NO se recalcularon.
                      </p>
                    )}
                    <div className="flex justify-end">
                      <button type="button" onClick={() => setModo(null)} className="rounded-lg px-4 py-1.5 text-sm font-semibold text-white" style={{ backgroundColor: "var(--brand-primary)" }}>Cerrar</button>
                    </div>
                  </div>
                ) : (
                  <>
                    <p className="mb-3 text-xs text-gray-500">
                      Si el pasajero tiene contrato, todas las sillas de ese contrato en este record se mueven juntas. Solo se
                      listan records del mismo destino y proveedor que todavía no han salido.
                    </p>
                    {contratoOrganico && (
                      <p className="mb-3 flex items-start gap-1.5 rounded-lg border border-gray-200 bg-gray-50 p-2 text-xs text-gray-600">
                        <Info className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                        Contrato del sistema: solo a un record con las mismas fechas de ida y regreso. El vuelo del contrato (PNR, número de vuelo y horas) se actualiza en el mismo movimiento. Para cambiar de fecha, anula y vuelve a reservar.
                      </p>
                    )}
                    <label className="text-xs text-gray-500">Record destino
                      <select
                        value={destino}
                        onChange={(e) => { setDestino(e.target.value === "" ? "" : Number(e.target.value)); setAceptaTarifa(false); setTarifaDetectada(false); setErr(""); }}
                        className={inp}
                      >
                        <option value="">Elige el record destino…</option>
                        {otros.map((o) => (
                          <option key={o.id} value={o.id} disabled={contratoOrganico && !o.mismasFechas}>
                            {o.record}{o.fecha_ida ? ` · ${o.fecha_ida}` : ""} · {o.libres} libre(s){o.tarifaDistinta ? " · otra tarifa" : ""}
                            {contratoOrganico && !o.mismasFechas ? " · otras fechas (no permitido para este contrato)" : ""}
                          </option>
                        ))}
                      </select>
                    </label>
                    {otros.length === 0 && (
                      <p className="mt-1 text-xs text-gray-500">No hay records compatibles (mismo destino y proveedor, sin salir).</p>
                    )}

                    <fieldset className="mt-3">
                      <legend className="mb-1 text-xs font-semibold text-gray-700">¿Cómo lo recibe el record destino?</legend>
                      <label className={`mb-2 flex cursor-pointer gap-2 rounded-lg border p-2 text-xs ${modoMover === "solo_datos" ? "border-[var(--brand-accent)] bg-gray-50" : "border-gray-200"}`}>
                        <input type="radio" name={`modo-mover-${sillaId}`} value="solo_datos" checked={modoMover === "solo_datos"} onChange={() => { setModoMover("solo_datos"); setErr(""); }} className="mt-0.5" />
                        <span>
                          <span className="flex items-center gap-1 font-semibold text-gray-800"><UserRound className="h-3.5 w-3.5" /> Solo sus datos</span>
                          <span className="text-gray-500">
                            Ocupa un cupo libre que ya existe en el destino y esta silla queda libre. Los cupos de los dos records no cambian.
                            {destinoSel ? ` Libres en ${destinoSel.record}: ${destinoSel.libres}.` : ""} Si no hay cupo libre, no se mueve.
                          </span>
                        </span>
                      </label>
                      <label className={`flex cursor-pointer gap-2 rounded-lg border p-2 text-xs ${modoMover === "con_cupo" ? "border-[var(--brand-accent)] bg-gray-50" : "border-gray-200"}`}>
                        <input type="radio" name={`modo-mover-${sillaId}`} value="con_cupo" checked={modoMover === "con_cupo"} onChange={() => { setModoMover("con_cupo"); setErr(""); }} className="mt-0.5" />
                        <span>
                          <span className="flex items-center gap-1 font-semibold text-gray-800"><ArrowRightLeft className="h-3.5 w-3.5" /> Con su cupo</span>
                          <span className="text-gray-500">
                            La silla se traslada al destino: este record pierde un cupo y el destino gana uno. El total no cambia.
                          </span>
                        </span>
                      </label>
                    </fieldset>

                    {pideTarifa && (
                      <label className="mt-3 flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 p-2 text-xs text-amber-800">
                        <input type="checkbox" checked={aceptaTarifa} onChange={(e) => setAceptaTarifa(e.target.checked)} className="mt-0.5" />
                        <span className="flex items-start gap-1">
                          <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                          La tarifa neta del record destino es distinta. Entiendo que el costo del contrato y las cuentas por pagar no se recalculan.
                        </span>
                      </label>
                    )}

                    <label className="mt-3 block text-xs text-gray-500">Motivo (opcional)
                      <input className={inp} value={motivo} onChange={(e) => setMotivo(e.target.value)} />
                    </label>

                    {err && <p role="alert" className="mt-2 text-xs text-red-600">{err}</p>}
                    <div className="mt-4 flex justify-end gap-2">
                      <button type="button" onClick={() => setModo(null)} className="rounded-lg px-3 py-1.5 text-sm text-gray-500 hover:bg-gray-100">Cancelar</button>
                      <button
                        type="button"
                        onClick={mover}
                        disabled={pending || destino === "" || !modoMover || (pideTarifa && !aceptaTarifa)}
                        className="rounded-lg px-4 py-1.5 text-sm font-semibold text-white disabled:opacity-50"
                        style={{ backgroundColor: "var(--brand-primary)" }}
                      >
                        {pending ? "Moviendo…" : "Mover pasajero"}
                      </button>
                    </div>
                  </>
                )}
              </>
            )}
          </div>
        </div>
      )}
    </>
  );
}
