"use client";

// Formulario de alta/edición de UN infante (sin silla) directamente desde el
// detalle de un vuelo — migración 168 (`guardar_infante_vuelo`, RPC
// estrecho). Se usa tanto en `vuelos/[id]` (bajo la silla del responsable)
// como en `vuelos/pasajeros` (buscador global) — ver
// docs/tecnico/ para el diseño completo.
//
// El server relee TODO (fecha_ida, contrato, responsable): este formulario
// solo adelanta mensajes (clasificación INF/CHD en vivo, forma de los
// datos) para no hacer esperar al asesor un viaje de red por un error obvio.
import { useMemo, useState, useTransition } from "react";
import { Baby } from "lucide-react";
import { calcularEdad } from "@/lib/utils";
import { esInfantePorEdad, validarInfanteVueloInput, type InfanteVueloInput } from "@/lib/vuelos/infanteVuelo";
import { guardarInfanteVuelo } from "@/app/(dashboard)/dashboard/vuelos/actions";

const inp = "w-full rounded border border-gray-300 px-2 py-1 text-sm";

export function InfanteVueloForm({
  bloqueoId,
  sillaResponsableId,
  fechaIdaBloqueo,
  modo,
  inicial,
  trigger,
}: {
  bloqueoId: number;
  /** Silla REAL del adulto responsable en este bloqueo — nunca un numero_contrato/responsable_id sueltos (el server los resuelve desde aquí). */
  sillaResponsableId: number;
  /** `bloqueos_vuelo.fecha_ida` de ESTE vuelo — fecha de referencia para la clasificación INF/CHD en vivo (la misma que usará el server). */
  fechaIdaBloqueo: string | null;
  modo: "crear" | "editar";
  /** Solo en modo editar: datos actuales del infante. */
  inicial?: { id: number; nombreCompleto: string; tipoDoc: string; numeroDoc: string; fechaNacimiento: string };
  /** Contenido del botón/enlace que abre el formulario — por defecto uno genérico según el modo. */
  trigger?: React.ReactNode;
}) {
  const vacio: InfanteVueloInput = { nombreCompleto: "", tipoDoc: "RC", numeroDoc: "", fechaNacimiento: "" };
  const [abierto, setAbierto] = useState(false);
  const [form, setForm] = useState<InfanteVueloInput>(
    modo === "editar" && inicial
      ? { nombreCompleto: inicial.nombreCompleto, tipoDoc: inicial.tipoDoc, numeroDoc: inicial.numeroDoc, fechaNacimiento: inicial.fechaNacimiento }
      : vacio
  );
  const [pending, start] = useTransition();
  const [err, setErr] = useState("");

  const set = (k: keyof InfanteVueloInput, val: string) => setForm((f) => ({ ...f, [k]: val }));

  const abrir = () => {
    setForm(
      modo === "editar" && inicial
        ? { nombreCompleto: inicial.nombreCompleto, tipoDoc: inicial.tipoDoc, numeroDoc: inicial.numeroDoc, fechaNacimiento: inicial.fechaNacimiento }
        : vacio
    );
    setErr("");
    setAbierto(true);
  };

  // Clasificación en vivo — MISMA fuente de verdad que el server
  // (lib/reservar/pasajeros.ts::esInfantePorEdad), contra la fecha_ida real
  // de este bloqueo (nunca la fecha del contrato).
  const aviso = useMemo(() => {
    if (!form.fechaNacimiento) return null;
    const edad = calcularEdad(form.fechaNacimiento, fechaIdaBloqueo);
    const esInf = esInfantePorEdad(form.fechaNacimiento, fechaIdaBloqueo);
    if (!esInf) {
      return `Con ${edad ?? "?"} años a la fecha del vuelo, este pasajero ya NO califica como infante: debe registrarse con silla (CHD/ADT), no desde aquí.`;
    }
    return null;
  }, [form.fechaNacimiento, fechaIdaBloqueo]);

  function guardar() {
    const v = validarInfanteVueloInput(form);
    if (!v.ok) { setErr(v.error); return; }
    if (aviso) { setErr(aviso); return; }
    setErr("");
    start(async () => {
      const r = await guardarInfanteVuelo(bloqueoId, sillaResponsableId, modo === "editar" && inicial ? inicial.id : null, form);
      if (r.ok) setAbierto(false);
      else setErr(r.error);
    });
  }

  return (
    <>
      <button type="button" onClick={abrir} className="inline-flex items-center gap-1 text-[#1D7C9A] hover:underline">
        {trigger ?? (
          <>
            <Baby className="h-3.5 w-3.5" aria-hidden="true" />
            {modo === "crear" ? "Infante" : "Editar"}
          </>
        )}
      </button>

      {abierto && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={() => setAbierto(false)}>
          <div className="w-full max-w-lg rounded-2xl bg-white p-5 shadow-xl" onClick={(e) => e.stopPropagation()}>
            <h3 className="mb-1 text-sm font-semibold text-gray-800">
              {modo === "crear" ? "Agregar infante" : "Editar infante"}
            </h3>
            <p className="mb-3 text-xs text-gray-500">No ocupa silla ni cupo del vuelo — queda a cargo del adulto responsable de esta fila.</p>
            <div className="grid grid-cols-2 gap-3">
              <label className="col-span-2 text-xs text-gray-500">Nombre completo
                <input className={inp} value={form.nombreCompleto} onChange={(e) => set("nombreCompleto", e.target.value)} />
              </label>
              <label className="text-xs text-gray-500">Tipo doc
                <select className={inp} value={form.tipoDoc} onChange={(e) => set("tipoDoc", e.target.value)}>
                  <option value="RC">RC — Registro civil</option>
                  <option value="TI">TI — Tarjeta de identidad</option>
                  <option value="CC">CC — Cédula</option>
                  <option value="PAS">PAS — Pasaporte</option>
                </select>
              </label>
              <label className="text-xs text-gray-500">Número doc
                <input className={inp} value={form.numeroDoc} onChange={(e) => set("numeroDoc", e.target.value)} />
              </label>
              <label className="col-span-2 text-xs text-gray-500">Fecha de nacimiento
                <input type="date" className={inp} value={form.fechaNacimiento} onChange={(e) => set("fechaNacimiento", e.target.value)} />
              </label>
            </div>
            {aviso && <p className="mt-2 text-xs text-amber-700">{aviso}</p>}
            {err && <p className="mt-2 text-xs text-red-600">{err}</p>}
            <div className="mt-4 flex justify-end gap-2">
              <button type="button" onClick={() => setAbierto(false)} className="rounded-lg px-3 py-1.5 text-sm text-gray-500 hover:bg-gray-100">Cancelar</button>
              <button type="button" onClick={guardar} disabled={pending} className="rounded-lg px-4 py-1.5 text-sm font-semibold text-white disabled:opacity-50" style={{ backgroundColor: "var(--brand-primary)" }}>
                {pending ? "Guardando…" : "Guardar"}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
