"use client";

import { useRef, useState, useTransition } from "react";
import { Loader2, X } from "lucide-react";
import { ComboDestino } from "@/components/ComboDestino";
import { resumirUsoDestino, type ResumenUsoDestino } from "@/lib/producto/usoDestino";
import { eliminarDestino, usoDestino } from "./actions";

type DestOpt = { id: number; nombre: string };

// Estado de la revisión de contenido asociado (solo INFORMATIVA: qué se
// muestra al usuario). Nunca decide el flujo — el combo obligatorio sigue
// dependiendo de `hoteles`, igual que antes, y la base de datos tiene la
// última palabra al borrar.
type Uso =
  | { estado: "cargando" }
  | { estado: "error" }
  | { estado: "listo"; resumen: ResumenUsoDestino; alcanceCompleto: boolean };

export function EliminarDestinoBtn({
  id,
  nombre,
  hoteles = 0,
  destinos = [],
}: {
  id: number;
  nombre: string;
  hoteles?: number;
  destinos?: DestOpt[];
}) {
  const [open, setOpen] = useState(false);
  const [target, setTarget] = useState<number | "">("");
  const [err, setErr] = useState("");
  const [uso, setUso] = useState<Uso>({ estado: "cargando" });
  const [pending, start] = useTransition();
  // Cada apertura invalida la revisión anterior: una respuesta tardía de una
  // apertura previa nunca pisa la actual.
  const revision = useRef(0);

  const otros = destinos.filter((d) => d.id !== id);

  function abrir() {
    setOpen(true);
    setErr("");
    setTarget("");
    setUso({ estado: "cargando" });
    const mia = ++revision.current;
    usoDestino(id).then(
      (r) => { if (revision.current === mia) setUso({ estado: "listo", resumen: resumirUsoDestino(r.conteos), alcanceCompleto: r.alcanceCompleto }); },
      () => { if (revision.current === mia) setUso({ estado: "error" }); }
    );
  }

  function eliminar() {
    setErr("");
    // Con hoteles, exige elegir a dónde moverlos.
    if (hoteles > 0 && target === "") {
      setErr(`Tiene ${hoteles} hotel(es): elige a qué destino moverlos.`);
      return;
    }
    start(async () => {
      const r = await eliminarDestino(id, target === "" ? undefined : Number(target));
      if (r.ok) setOpen(false);
      else setErr(r.error);
    });
  }

  const resumen = uso.estado === "listo" ? uso.resumen : null;
  // Solo roles que leen TODAS las filas (los que pueden borrar destinos) —
  // para cualquier otro, un 0 puede ser RLS y no ausencia.
  const alcanceCompleto = uso.estado === "listo" && uso.alcanceCompleto;
  const nadaVisible = !!resumen && resumen.total === 0 && resumen.sinVerificar.length === 0;
  const verificadoSinUso = nadaVisible && alcanceCompleto;

  return (
    <>
      <button
        onClick={(e) => { e.preventDefault(); abrir(); }}
        className="flex h-6 w-6 items-center justify-center rounded text-gray-400 transition-colors hover:bg-red-50 hover:text-red-500"
        title="Eliminar destino"
        aria-label="Eliminar destino"
      >
        <X className="h-4 w-4" aria-hidden />
      </button>

      {open && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={(e) => { e.preventDefault(); if (!pending) setOpen(false); }}>
          <div className="w-full max-w-sm rounded-xl bg-white p-5 shadow-xl" onClick={(e) => e.stopPropagation()}>
            <h3 className="text-base font-semibold text-gray-900">Eliminar destino</h3>
            <p className="mt-1 text-sm text-gray-600">
              Vas a eliminar <b>{nombre?.toUpperCase()}</b>.
            </p>

            <div className="mt-3" data-uso-destino={uso.estado}>
              {uso.estado === "cargando" && (
                <p className="flex items-center gap-1.5 text-xs text-gray-500">
                  <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />
                  Revisando qué contenido usa este destino…
                </p>
              )}
              {uso.estado === "error" && (
                <p className="text-xs text-gray-500">
                  No se pudo revisar el contenido asociado: no es posible confirmar si el destino está en uso.
                </p>
              )}
              {resumen && resumen.items.length > 0 && (
                <>
                  <p className="text-xs font-medium text-gray-700">Contenido que apunta a este destino:</p>
                  <ul className="mt-1 list-disc space-y-0.5 pl-5 text-xs text-gray-600">
                    {resumen.items.map((it) => <li key={it.tabla}>{it.texto}</li>)}
                  </ul>
                </>
              )}
              {resumen && resumen.items.length > 0 && !alcanceCompleto && (
                <p className="mt-1 text-xs text-gray-500">Solo se muestra lo que tu rol puede ver; puede haber más.</p>
              )}
              {resumen && resumen.sinVerificar.length > 0 && (
                <p className="mt-1 text-xs text-gray-500">No se pudo verificar: {resumen.sinVerificar.join(", ")}.</p>
              )}
            </div>

            {hoteles > 0 ? (
              <div className="mt-3">
                <p className="mb-1 text-xs text-amber-700">
                  Tiene <b>{hoteles}</b> hotel(es): no se puede eliminar sin mover su contenido. Todo lo que apunta a este destino pasará al destino que elijas; las tarifas y temporadas de cada hotel siguen con su hotel:
                </p>
                <ComboDestino
                  destinos={otros}
                  value={target}
                  onChange={setTarget}
                  placeholder="Busca el destino de llegada…"
                />
                <p className="mt-1 text-xs text-gray-500">Los contratos, ventas y cotizaciones ya creados no se modifican.</p>
              </div>
            ) : verificadoSinUso ? (
              <p className="mt-2 text-xs text-gray-500">No tiene contenido asociado; se eliminará directamente.</p>
            ) : resumen && resumen.total > 0 ? (
              <p className="mt-2 text-xs text-amber-700">
                No tiene hoteles, pero el contenido de arriba lo usa: mientras exista, la base de datos rechazará la eliminación. Este cuadro solo ofrece mover el contenido a otro destino cuando el destino tiene hoteles.
              </p>
            ) : nadaVisible ? (
              <p className="mt-2 text-xs text-gray-500">
                No se encontró contenido asociado entre lo que tu rol puede ver; con tu rol no es posible confirmar que no haya más.
              </p>
            ) : null}

            {err && <p className="mt-3 text-sm text-red-600">{err}</p>}

            <div className="mt-5 flex justify-end gap-2">
              <button onClick={() => setOpen(false)} disabled={pending} className="rounded-lg border border-gray-300 px-3 py-1.5 text-sm text-gray-600">Cancelar</button>
              <button onClick={eliminar} disabled={pending} className="rounded-lg bg-red-500 px-3 py-1.5 text-sm font-medium text-white disabled:opacity-60">
                {pending ? "Eliminando…" : hoteles > 0 ? "Mover y eliminar" : "Eliminar"}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
