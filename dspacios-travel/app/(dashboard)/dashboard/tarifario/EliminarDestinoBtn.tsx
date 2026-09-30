"use client";

import { useRef, useState, useTransition } from "react";
import { Loader2, X } from "lucide-react";
import { ComboDestino } from "@/components/ComboDestino";
import { modoEliminacion, resumirUsoDestino, type ModoEliminacion, type UsoDestino } from "@/lib/producto/usoDestino";
import { eliminarDestino, usoDestino } from "./actions";

type DestOpt = { id: number; nombre: string };

// Revisión del contenido asociado. Es la que DECIDE qué ofrece el modal
// (`modoEliminacion`), nunca la cantidad de hoteles: un destino con 0 hoteles
// y 5 receptivos también debe moverse a otro antes de eliminarse. La base de
// datos sigue teniendo la última palabra (FK 23503, RLS y la propia
// `fn_fusionar_destino`).
type Uso = { estado: "cargando" } | { estado: "error" } | { estado: "listo"; uso: UsoDestino };

export function EliminarDestinoBtn({
  id,
  nombre,
  destinos = [],
}: {
  id: number;
  nombre: string;
  destinos?: DestOpt[];
}) {
  const [open, setOpen] = useState(false);
  const [target, setTarget] = useState<number | "">("");
  const [err, setErr] = useState("");
  const [uso, setUso] = useState<Uso>({ estado: "cargando" });
  const [pending, start] = useTransition();
  // Cada revisión invalida la anterior: una respuesta tardía nunca pisa la vigente.
  const revision = useRef(0);

  const otros = destinos.filter((d) => d.id !== id);

  function verificar() {
    setUso({ estado: "cargando" });
    const mia = ++revision.current;
    usoDestino(id).then(
      (r) => { if (revision.current === mia) setUso({ estado: "listo", uso: r }); },
      () => { if (revision.current === mia) setUso({ estado: "error" }); }
    );
  }

  function abrir() {
    setOpen(true);
    setErr("");
    setTarget("");
    verificar();
  }

  // "cargando" mientras se revisa; un error de revisión es "no_verificado"
  // (nunca se presenta como vacío ni habilita el borrado directo).
  const modo: ModoEliminacion | "cargando" =
    uso.estado === "cargando" ? "cargando" : uso.estado === "error" ? "no_verificado" : modoEliminacion(uso.uso);
  const resumen = uso.estado === "listo" ? resumirUsoDestino(uso.uso.conteos) : null;
  const permiso = uso.estado === "listo" ? uso.uso.permiso : "desconocido";
  const requiereDestino = modo === "fusion" || modo === "no_verificado";
  const sePuedeReintentar = uso.estado === "error" || modo === "no_verificado";

  function eliminar() {
    setErr("");
    if (modo === "cargando" || modo === "sin_permiso") return;
    if (requiereDestino && target === "") {
      setErr(
        modo === "fusion"
          ? "Tiene contenido asociado: elige a qué destino moverlo."
          : "No se pudo confirmar si tiene contenido: elige a qué destino moverlo o reintenta la verificación."
      );
      return;
    }
    // Borrado directo SOLO si está verificado sin contenido; si no, fusión.
    const reasignarA = modo === "borrado_directo" ? undefined : Number(target);
    start(async () => {
      const r = await eliminarDestino(id, reasignarA);
      if (r.ok) setOpen(false);
      else {
        setErr(r.error);
        // Lo que el servidor rechazó puede deberse a datos que cambiaron:
        // se vuelve a verificar para que el modal muestre el estado real.
        verificar();
      }
    });
  }

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

            <div className="mt-3" data-uso-destino={uso.estado} data-modo-eliminacion={modo}>
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
              {resumen && resumen.items.length > 0 && permiso !== "si" && (
                <p className="mt-1 text-xs text-gray-500">Solo se muestra lo que tu rol puede ver; puede haber más.</p>
              )}
              {resumen && resumen.sinVerificar.length > 0 && (
                <p className="mt-1 text-xs text-gray-500">No se pudo verificar: {resumen.sinVerificar.join(", ")}.</p>
              )}
              {sePuedeReintentar && (
                <button type="button" onClick={verificar} disabled={pending} className="mt-1 text-xs text-[var(--brand-accent)] hover:underline disabled:opacity-60">
                  Reintentar verificación
                </button>
              )}
            </div>

            {modo === "sin_permiso" && (
              <p className="mt-2 text-xs text-gray-500">Tu rol no tiene permiso para eliminar destinos.</p>
            )}
            {modo === "borrado_directo" && (
              <p className="mt-2 text-xs text-gray-500">No tiene contenido asociado; se eliminará directamente.</p>
            )}
            {requiereDestino && (
              <div className="mt-3">
                <p className="mb-1 text-xs text-amber-700">
                  {modo === "fusion"
                    ? "Tiene contenido asociado: no se puede eliminar sin moverlo. Todo lo que apunta a este destino pasará al destino que elijas; las tarifas y temporadas de cada hotel siguen con su hotel:"
                    : "No se pudo confirmar si tiene contenido asociado, así que no se ofrece el borrado directo. Puedes mover lo que tenga al destino que elijas y eliminarlo:"}
                </p>
                <ComboDestino
                  destinos={otros}
                  value={target}
                  onChange={setTarget}
                  placeholder="Busca el destino de llegada…"
                />
                <p className="mt-1 text-xs text-gray-500">Los contratos, ventas y cotizaciones ya creados no se modifican.</p>
              </div>
            )}

            {err && <p className="mt-3 text-sm text-red-600">{err}</p>}

            <div className="mt-5 flex justify-end gap-2">
              <button onClick={() => setOpen(false)} disabled={pending} className="rounded-lg border border-gray-300 px-3 py-1.5 text-sm text-gray-600">
                {modo === "sin_permiso" ? "Cerrar" : "Cancelar"}
              </button>
              {modo !== "sin_permiso" && (
                <button onClick={eliminar} disabled={pending || modo === "cargando"} className="rounded-lg bg-red-500 px-3 py-1.5 text-sm font-medium text-white disabled:opacity-60">
                  {pending ? "Eliminando…" : requiereDestino ? "Mover y eliminar" : "Eliminar"}
                </button>
              )}
            </div>
          </div>
        </div>
      )}
    </>
  );
}
