"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Check, Pencil, Plus, Trash2, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { claveDestinoFijo, validarNombreDestinoFijo, DESTINO_FIJO_MAX, NOMBRE_DESTINO_PROVISIONAL } from "@/lib/programas/destinoFijo";
import { crearDestinoFijo, crearDestinoProvisional, eliminarDestinoFijo, renombrarDestinoFijo } from "../listas-actions";

export type ItemDestinoFijo = { id: number; nombre: string; programas: number; es_provisional?: boolean };

export function ListaDestinoProgramas({ items, puedeEditar }: { items: ItemDestinoFijo[]; puedeEditar: boolean }) {
  const router = useRouter();
  const [nuevo, setNuevo] = useState("");
  const [editando, setEditando] = useState<{ id: number; nombre: string } | null>(null);
  const [confirmando, setConfirmando] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  // Aviso previo de duplicado (la autoridad es el índice único de la base).
  const existe = (nombre: string, exceptoId?: number) =>
    items.some((i) => i.id !== exceptoId && claveDestinoFijo(i.nombre) === claveDestinoFijo(nombre));

  function ejecutar(fn: () => Promise<{ ok: boolean; error?: string }>, alExito?: () => void) {
    setError(null);
    startTransition(async () => {
      const r = await fn();
      if (!r.ok) {
        setError(r.error ?? "No se pudo completar la acción.");
        return;
      }
      alExito?.();
      router.refresh();
    });
  }

  function agregar(e: React.FormEvent) {
    e.preventDefault();
    const v = validarNombreDestinoFijo(nuevo);
    if (!v.ok) return setError(v.error);
    if (existe(v.nombre)) return setError("Ese destino ya está en la lista.");
    ejecutar(() => crearDestinoFijo(v.nombre), () => setNuevo(""));
  }

  const hayProvisional = items.some((i) => i.es_provisional === true);

  function guardarEdicion() {
    if (!editando) return;
    const v = validarNombreDestinoFijo(editando.nombre);
    if (!v.ok) return setError(v.error);
    if (existe(v.nombre, editando.id)) return setError("Ese destino ya está en la lista.");
    ejecutar(() => renombrarDestinoFijo(editando.id, v.nombre), () => setEditando(null));
  }

  return (
    <section aria-labelledby="titulo-lista-destino-programas">
      <h2 id="titulo-lista-destino-programas" className="text-lg font-semibold text-gray-900">Lista destino programas</h2>
      <p className="mt-1 mb-4 text-sm text-gray-500">
        Destinos comerciales con los que se muestran los programas en el tarifario y su filtro. No es el catálogo de
        ciudades ni la ruta del circuito: cada programa se asigna a UN destino de esta lista (en la pestaña General del programa).
        Mientras un programa no tenga destino, no se ve en el tarifario.
      </p>

      {puedeEditar ? (
        <form onSubmit={agregar} className="mb-4 flex flex-wrap items-end gap-2">
          <div>
            <label htmlFor="nuevo-destino-fijo" className="mb-1 block text-xs font-medium text-gray-600">Nuevo destino</label>
            <Input
              id="nuevo-destino-fijo"
              value={nuevo}
              maxLength={DESTINO_FIJO_MAX}
              onChange={(e) => setNuevo(e.target.value)}
              placeholder="Ej. Brasil, Caribe, Europa"
              className="w-64"
            />
          </div>
          <Button type="submit" disabled={pending} style={{ backgroundColor: "var(--brand-primary)" }}>
            <Plus size={14} className="mr-1" /> Agregar
          </Button>
        </form>
      ) : (
        <p className="mb-4 text-sm text-gray-500">Solo lectura: tu rol no administra esta lista.</p>
      )}

      {puedeEditar && !hayProvisional && (
        <div className="mb-4 rounded-lg border border-gray-200 bg-gray-50 px-4 py-3 text-sm text-gray-600">
          <p>
            <b>Despliegue:</b> si necesitas que los programas existentes sigan visibles mientras creas los destinos reales,
            crea el destino provisional «{NOMBRE_DESTINO_PROVISIONAL}», asígnalos allí y luego reasígnalos uno por uno.
          </p>
          <Button
            type="button"
            size="sm"
            variant="secondary"
            className="mt-2"
            disabled={pending}
            onClick={() => ejecutar(() => crearDestinoProvisional())}
          >
            Crear destino provisional «{NOMBRE_DESTINO_PROVISIONAL}»
          </Button>
        </div>
      )}

      {error && (
        <p role="alert" className="mb-3 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>
      )}

      {items.length === 0 ? (
        <div className="rounded-2xl border-2 border-dashed border-gray-200 py-12 text-center text-gray-400">
          <p>La lista está vacía</p>
          <p className="mt-1 text-sm">Agrega los destinos comerciales para poder asignarlos a los programas.</p>
        </div>
      ) : (
        <ul className="divide-y divide-gray-100 rounded-xl border border-gray-200 bg-white">
          {items.map((it) => (
            <li key={it.id} className="flex flex-wrap items-center justify-between gap-2 px-4 py-3">
              {editando?.id === it.id ? (
                <div className="flex flex-wrap items-center gap-2">
                  <Input
                    aria-label={`Nombre del destino ${it.nombre}`}
                    value={editando.nombre}
                    maxLength={DESTINO_FIJO_MAX}
                    onChange={(e) => setEditando({ id: it.id, nombre: e.target.value })}
                    onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); guardarEdicion(); } if (e.key === "Escape") setEditando(null); }}
                    className="w-64"
                    autoFocus
                  />
                  <Button type="button" size="sm" onClick={guardarEdicion} disabled={pending} aria-label="Guardar nombre">
                    <Check size={14} />
                  </Button>
                  <Button type="button" size="sm" variant="secondary" onClick={() => setEditando(null)} aria-label="Cancelar edición">
                    <X size={14} />
                  </Button>
                </div>
              ) : (
                <div>
                  <span className="font-medium text-gray-800">{it.nombre}</span>
                  {it.es_provisional === true && (
                    <span className="ml-2 rounded-full bg-sky-100 px-2 py-0.5 text-xs font-medium text-sky-800">
                      Provisional: sus programas son visibles pero falta su destino real
                    </span>
                  )}
                  <span className="ml-3 text-xs text-gray-500">
                    {it.programas === 0 ? "Sin programas asignados" : `${it.programas} ${it.programas === 1 ? "programa" : "programas"}`}
                  </span>
                </div>
              )}

              {puedeEditar && editando?.id !== it.id && (
                <div className="flex items-center gap-1">
                  {confirmando === it.id ? (
                    <>
                      <span className="mr-1 text-xs text-gray-600">¿Eliminar “{it.nombre}”?</span>
                      <Button
                        type="button"
                        size="sm"
                        variant="destructive"
                        disabled={pending}
                        onClick={() => ejecutar(() => eliminarDestinoFijo(it.id), () => setConfirmando(null))}
                      >
                        Eliminar
                      </Button>
                      <Button type="button" size="sm" variant="secondary" onClick={() => setConfirmando(null)}>Cancelar</Button>
                    </>
                  ) : (
                    <>
                      <Button
                        type="button"
                        size="sm"
                        variant="secondary"
                        aria-label={`Renombrar ${it.nombre}`}
                        onClick={() => { setError(null); setEditando({ id: it.id, nombre: it.nombre }); }}
                      >
                        <Pencil size={14} />
                      </Button>
                      <Button
                        type="button"
                        size="sm"
                        variant="secondary"
                        aria-label={`Eliminar ${it.nombre}`}
                        onClick={() => { setError(null); setConfirmando(it.id); }}
                      >
                        <Trash2 size={14} />
                      </Button>
                    </>
                  )}
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
