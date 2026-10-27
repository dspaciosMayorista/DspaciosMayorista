"use client";

// #88 / PR #409 — Catálogo de un programa terrestre por hotel y vigencia.
//   · Cada hotel guardado es una TARJETA COMPACTA (nombre, zona, habitación, ocupación, resumen de vigencias).
//   · «Editar», «Clonar» y «Agregar hotel» abren un DIÁLOGO con el formulario; guardar o cancelar lo cierra y devuelve el foco.
//     Los errores del servidor se muestran dentro del diálogo y el borrador se conserva.
//   · «Clonar» crea un BORRADOR (identidad nueva, nombre único) y abre el diálogo; no se guarda hasta confirmar.
//   · La vista previa de solo lectura usa el catálogo en pantalla y el motor de la reserva.
import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Copy, Pencil, Plus, TriangleAlert } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { guardarHoteles, leerCatalogoHoteles } from "../actions";
import type { ProgramaPrecioCabecera } from "@/lib/programas/precioReserva57";
import type { DiaItinerario } from "@/lib/programas/estanciaHotel88";
import type { CatalogoHoteles88 } from "@/lib/programas/estanciaHotelDatos88";
import { HotelFormulario } from "./HotelFormulario";
import { VistaPreviaEstancia } from "./VistaPreviaEstancia";
import {
  aPayload, clonarHotel, conflictosDe, copiarHotel, desdeCatalogo, hotelNuevo, nombreRepetido, ocupacionTexto, resumenVigencias,
  type HotelState,
} from "./hotelEstado";

type Edicion = { indice: number | null; borrador: HotelState; origen: "existente" | "nuevo" | "clon"; foco: string };

export function HotelesVigenciaEditor({
  programaId, programa, proveedores, catalogo, dias,
}: {
  programaId: number;
  programa: ProgramaPrecioCabecera;
  proveedores: { id: number; nombre: string }[];
  catalogo: CatalogoHoteles88;
  /** Itinerario guardado, para la vista previa. */
  dias?: DiaItinerario[];
}) {
  const router = useRouter();
  const [hoteles, setHoteles] = useState<HotelState[]>(() => desdeCatalogo(catalogo));
  const [edicion, setEdicion] = useState<Edicion | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [quitando, setQuitando] = useState(false);
  const [pending, start] = useTransition();
  // Tras un guardado cuyos ids no se pudieron confirmar el catálogo se recarga de la base: mientras tanto (o si la recarga falla) no se permite otro guardado.
  const [recarga, setRecarga] = useState<"no" | "cargando" | "fallo">("no");
  const bloqueado = recarga !== "no";
  const raiz = useRef<HTMLDivElement>(null);

  const devolverFoco = (id: string) => requestAnimationFrame(() => raiz.current?.querySelector<HTMLElement>(`[data-foco="${id}"]`)?.focus());

  function abrir(e: Edicion) {
    if (bloqueado) return;
    setError(null);
    setQuitando(false);
    setEdicion(e);
  }
  function cerrar() {
    const foco = edicion?.foco;
    setEdicion(null);
    setError(null);
    setQuitando(false);
    if (foco) devolverFoco(foco);
  }

  const editar = (i: number) => abrir({ indice: i, borrador: copiarHotel(hoteles[i]), origen: "existente", foco: `editar-${i}` });
  const clonar = (i: number) => abrir({ indice: null, borrador: clonarHotel(hoteles[i], hoteles.map((h) => h.nombre)), origen: "clon", foco: `clonar-${i}` });
  const nuevo = () => abrir({ indice: null, borrador: hotelNuevo(), origen: "nuevo", foco: "agregar-hotel" });

  const otrosNombres = (e: Edicion) => hoteles.filter((_, i) => i !== e.indice).map((h) => h.nombre);

  function persistir(lista: HotelState[], alExito: () => void) {
    setError(null);
    start(async () => {
      const r = await guardarHoteles(programaId, lista.map(aPayload));
      if (!r.ok) { setError(r.error); return; }
      alExito();
      router.refresh();
      const ids = r.ids;
      if (ids) {
        // Los hoteles recién creados toman su id real: si siguieran sin id, el próximo guardado los reenviaría como NUEVOS y chocarían con ellos mismos.
        setHoteles(lista.map((h, i) => ({ ...h, id: ids[i] ?? h.id })));
        return;
      }
      // Se guardó, pero no se pudieron confirmar los ids. router.refresh() no reinicializa este estado: se lee el catálogo guardado y se reemplaza la lista; hasta entonces
      // los hoteles nuevos siguen sin id, así que no se permite otro guardado (y nunca se pide repetir uno que ya ocurrió).
      setHoteles(lista);
      setRecarga("cargando");
      const c = await leerCatalogoHoteles(programaId);
      if (c.ok) { setHoteles(desdeCatalogo(c.catalogo)); setRecarga("no"); } else setRecarga("fallo");
    });
  }

  function guardarEdicion() {
    if (!edicion) return;
    const lista = edicion.indice == null ? [...hoteles, edicion.borrador] : hoteles.map((h, i) => (i === edicion.indice ? edicion.borrador : h));
    persistir(lista, cerrar);
  }

  function quitarHotel() {
    if (!edicion || edicion.indice == null) return;
    persistir(hoteles.filter((_, i) => i !== edicion.indice), () => {
      setEdicion(null);
      setQuitando(false);
      devolverFoco("agregar-hotel");
    });
  }

  const conflictos = edicion ? conflictosDe(edicion.borrador) : [];
  const repetido = edicion ? nombreRepetido(edicion.borrador.nombre, otrosNombres(edicion)) : false;
  const sinNombre = edicion ? !edicion.borrador.nombre.trim() : false;
  const puedeGuardar = !!edicion && !pending && conflictos.length === 0 && !repetido && !sinNombre;
  const titulo = !edicion ? "" : edicion.origen === "existente" ? `Editar ${hoteles[edicion.indice!]?.nombre || "hotel"}` : edicion.origen === "clon" ? "Clonar hotel (borrador sin guardar)" : "Agregar hotel";

  return (
    <div ref={raiz} className="space-y-6">
      <p className="rounded-lg border border-gray-100 bg-gray-50 p-3 text-xs text-gray-600">
        Cada hotel tiene su <strong>precio base</strong> (neto por persona para toda la estancia incluida, por vigencia de la fecha de <em>entrada</em> y
        servicios privados o regulares) y su <strong>tarifa de noche adicional</strong>, ligada a una de esas vigencias (cada noche usa la tarifa de su propia fecha).
        Elige siempre si el proveedor cobra la noche por persona o por habitación. Por habitación, los menores ocupantes van incluidos (solo pagan su asistencia);
        por persona, cada menor exige su tarifa. El PVP se calcula con las reglas vigentes del programa ({programa.moneda}).
      </p>

      {recarga === "cargando" && (
        <p role="status" data-testid="recargando-hoteles" className="rounded-lg border border-sky-200 bg-sky-50 p-3 text-xs text-sky-800">Los cambios se guardaron. Actualizando la lista de hoteles…</p>
      )}
      {recarga === "fallo" && (
        <div role="alert" data-testid="recarga-fallida-hoteles" className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-amber-200 bg-amber-50 p-3 text-xs text-amber-900">
          <span>Los cambios se guardaron, pero no se pudo actualizar la lista de hoteles. Recarga la página para seguir editando.</span>
          <Button type="button" size="sm" variant="outline" onClick={() => window.location.reload()}>Recargar página</Button>
        </div>
      )}
      <ul className="grid grid-cols-1 gap-3 md:grid-cols-2" aria-label="Hoteles del programa">
        {hoteles.map((h, i) => {
          const r = resumenVigencias(h);
          const conflicto = conflictosDe(h).length > 0;
          return (
            <li key={h.id ?? `n-${i}`} className="flex flex-col justify-between gap-3 rounded-xl border border-gray-200 bg-white p-4" aria-label={`Hotel ${h.nombre || i + 1}`}>
              <div className="min-w-0">
                <div className="flex items-start justify-between gap-2">
                  <h3 className="truncate font-semibold text-gray-900">{h.nombre || "Hotel sin nombre"}</h3>
                  {conflicto && (
                    <span className="inline-flex shrink-0 items-center gap-1 rounded-full bg-amber-50 px-2 py-0.5 text-[11px] font-medium text-amber-800">
                      <TriangleAlert size={12} aria-hidden="true" /> Revisar
                    </span>
                  )}
                </div>
                <p className="truncate text-xs text-gray-500">{[h.zona, h.tipoHabitacion].filter(Boolean).join(" · ") || "Sin zona ni tipo de habitación"}</p>
                <p className="mt-1 text-xs text-gray-500">{ocupacionTexto(h)}</p>
                <p className="mt-1 text-xs text-gray-600">{r.base}</p>
                <p className="text-xs text-gray-600">{r.noches}</p>
              </div>
              <div className="flex gap-2">
                <Button type="button" variant="outline" size="sm" disabled={bloqueado} data-foco={`editar-${i}`} onClick={() => editar(i)} aria-label={`Editar ${h.nombre || `hotel ${i + 1}`}`}>
                  <Pencil size={14} aria-hidden="true" /> Editar
                </Button>
                <Button type="button" variant="outline" size="sm" disabled={bloqueado} data-foco={`clonar-${i}`} onClick={() => clonar(i)} aria-label={`Clonar ${h.nombre || `hotel ${i + 1}`}`}>
                  <Copy size={14} aria-hidden="true" /> Clonar
                </Button>
              </div>
            </li>
          );
        })}
      </ul>
      {!hoteles.length && <p className="text-sm text-gray-500">Este programa aún no tiene hoteles.</p>}

      <Button type="button" variant="outline" disabled={bloqueado} data-foco="agregar-hotel" onClick={nuevo}>
        <Plus size={14} aria-hidden="true" /> Agregar hotel
      </Button>

      <VistaPreviaEstancia programaId={programaId} hoteles={hoteles} dias={dias} moneda={programa.moneda} />

      <Dialog open={!!edicion} onOpenChange={(o) => { if (!o && !pending) cerrar(); }} disablePointerDismissal>
        <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-4xl" aria-label={titulo}>
          {edicion && (
            <>
              <DialogHeader>
                <DialogTitle>{titulo}</DialogTitle>
                <DialogDescription>
                  {edicion.origen === "clon"
                    ? "Copia con identidad nueva: el original no cambia. No se guarda hasta que confirmes."
                    : "Los cambios se guardan al confirmar; si cancelas, no se modifica nada."}
                </DialogDescription>
              </DialogHeader>

              <HotelFormulario
                h={edicion.borrador}
                onChange={(b) => setEdicion((p) => (p ? { ...p, borrador: b } : p))}
                programa={programa}
                proveedores={proveedores}
                nombreRepetido={repetido}
              />

                <VistaPreviaEstancia
                  programaId={programaId}
                  hoteles={edicion.indice == null ? [...hoteles, edicion.borrador] : hoteles.map((h, i) => (i === edicion.indice ? edicion.borrador : h))}
                  hotelInicial={edicion.indice ?? hoteles.length}
                  dias={dias}
                  moneda={programa.moneda}
                />


              {error && <p role="alert" className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">{error}</p>}

              <DialogFooter className="sticky -bottom-4 z-10 flex-row flex-wrap items-center justify-between bg-gray-50">
                {edicion.origen === "existente" ? (
                  quitando ? (
                    <span className="flex items-center gap-2 text-sm">
                      ¿Quitar este hotel?
                      <Button type="button" variant="destructive" size="sm" disabled={pending} onClick={quitarHotel}>Sí, quitar</Button>
                      <Button type="button" variant="ghost" size="sm" onClick={() => setQuitando(false)}>No</Button>
                    </span>
                  ) : (
                    <Button type="button" variant="ghost" size="sm" className="text-red-600" onClick={() => setQuitando(true)} aria-label={`Quitar el hotel ${edicion.borrador.nombre || ""}`}>
                      Quitar hotel
                    </Button>
                  )
                ) : <span />}
                <span className="ml-auto flex gap-2">
                  <Button type="button" variant="outline" disabled={pending} onClick={cerrar}>Cancelar</Button>
                  <Button type="button" disabled={!puedeGuardar} onClick={guardarEdicion} style={{ backgroundColor: "var(--brand-primary)" }}>
                    {pending ? "Guardando…" : edicion.origen === "clon" ? "Crear copia" : "Guardar"}
                  </Button>
                </span>
              </DialogFooter>
            </>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
