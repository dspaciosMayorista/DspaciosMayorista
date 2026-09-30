"use client";

import { useMemo, useRef, useState, type ReactNode } from "react";
import Link from "next/link";
import { ChevronRight, Loader2 } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Dialog, DialogClose, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { EliminarDestinoBtn } from "../../tarifario/EliminarDestinoBtn";
import { etiquetaConteo } from "@/lib/producto/usoDestino";
import type { ReceptivoDeDestino } from "@/lib/producto/receptivos";
import { listarReceptivosDestino, type ResultadoReceptivosDestino } from "./actions";

type HotelMini = { id: number; nombre: string };
type Dest = { id: number; nombre: string; codigo_iata: string | null; pais: string | null; hoteles: HotelMini[] | null };

// `receptivosPorDestino`: conteo de receptivos por id de destino (ver
// page.tsx). `null` = no se pudo contar — se omite la insignia en vez de
// afirmar un "0 receptivos" que no se verificó.
export function DestinosLista({
  destinos,
  receptivosPorDestino = null,
}: {
  destinos: Dest[];
  receptivosPorDestino?: Record<number, number> | null;
}) {
  const [query, setQuery] = useState("");

  const q = query.trim().toLowerCase();
  const filtrados = q
    ? destinos.filter((d) => d.nombre.toLowerCase().includes(q) || (d.pais ?? "").toLowerCase().includes(q))
    : destinos;

  // Agrupar por país (los sin país van al final, en "Otros").
  const grupos = new Map<string, Dest[]>();
  for (const d of filtrados) {
    const key = d.pais?.trim() || "Otros";
    if (!grupos.has(key)) grupos.set(key, []);
    grupos.get(key)!.push(d);
  }
  const paises = [...grupos.keys()].sort((a, b) => {
    if (a === "Otros") return 1;
    if (b === "Otros") return -1;
    return a.localeCompare(b, "es");
  });

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <Input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Buscar por nombre o país…" className="max-w-xs" />
        <span className="text-xs text-gray-400">
          {filtrados.length} {filtrados.length === 1 ? "destino" : "destinos"}{q ? ` · filtrado de ${destinos.length}` : ""}
        </span>
      </div>

      {filtrados.length === 0 ? (
        <p className="rounded-xl border border-gray-200 bg-white px-4 py-8 text-center text-sm text-gray-400">Sin resultados para “{query}”.</p>
      ) : (
        <div className="space-y-8">
          {paises.map((pais) => (
            <section key={pais}>
              <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-gray-500">
                {pais} <span className="font-normal text-gray-400">({grupos.get(pais)!.length})</span>
              </h2>
              {/* `items-start`: cada tarjeta ocupa solo su contenido (compacto),
                  nunca se estira a la altura de una vecina. Los hoteles y
                  receptivos ya no se listan dentro de la tarjeta: se abren en
                  un diálogo desde su insignia. */}
              <div className="grid grid-cols-1 items-start gap-4 sm:grid-cols-2 lg:grid-cols-3">
                {grupos.get(pais)!.map((d) => {
                  const hoteles = d.hoteles ?? [];
                  const receptivos = receptivosPorDestino?.[d.id];
                  return (
                  <div key={d.id} data-destino-tarjeta={d.id} className="group relative rounded-xl border border-gray-200 bg-white p-5">
                    {/* Fila 1: el nombre usa TODO el ancho (antes compartía la
                        fila con las insignias y un nombre largo se partía a
                        mitad de palabra). Fila 2: insignias, que hacen wrap. */}
                    <div className="flex items-start justify-between gap-2">
                      <h3 className="min-w-0 break-words font-semibold text-gray-900">
                        {d.nombre?.toUpperCase()}
                        {d.codigo_iata && <span className="font-normal text-gray-400"> ({d.codigo_iata})</span>}
                      </h3>
                      <EliminarDestinoBtn
                        id={d.id}
                        nombre={d.nombre}
                        hoteles={hoteles.length}
                        destinos={destinos.map((x) => ({ id: x.id, nombre: x.nombre }))}
                      />
                    </div>
                    <div className="mt-3 flex flex-wrap items-center gap-2">
                      <HotelesInsignia destino={d.nombre} hoteles={hoteles} />
                      {typeof receptivos === "number" && (
                        <ReceptivosInsignia destinoId={d.id} destino={d.nombre} conteo={receptivos} />
                      )}
                    </div>
                  </div>
                  );
                })}
              </div>
            </section>
          ))}
        </div>
      )}
    </div>
  );
}

const CLASE_INSIGNIA = "inline-flex items-center gap-0.5 rounded-full bg-gray-50 px-2 py-1 text-xs text-gray-500";
const CLASE_INSIGNIA_BOTON =
  "inline-flex items-center gap-0.5 rounded-full border border-gray-200 bg-white px-2 py-1 text-xs text-gray-600 transition-colors hover:border-[var(--brand-accent)] hover:text-[var(--brand-primary)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--brand-accent)]";

// Con 0 elementos la insignia es solo informativa: no hay lista que abrir.
function InsigniaFija({ texto }: { texto: string }) {
  return <span data-insignia className={CLASE_INSIGNIA}>{texto}</span>;
}

function HotelesInsignia({ destino, hoteles }: { destino: string; hoteles: HotelMini[] }) {
  const texto = etiquetaConteo(hoteles.length, "hotel", "hoteles");
  const ordenados = useMemo(() => [...hoteles].sort((a, b) => a.nombre.localeCompare(b.nombre, "es")), [hoteles]);
  if (hoteles.length === 0) return <InsigniaFija texto={texto} />;
  return (
    <Dialog>
      <DialogTrigger
        render={<button type="button" data-insignia className={CLASE_INSIGNIA_BOTON} aria-label={`Ver ${texto} de ${destino.toUpperCase()}`} />}
      >
        {texto}
        <ChevronRight className="h-3 w-3" aria-hidden />
      </DialogTrigger>
      <DialogContent className="sm:max-w-md" showCloseButton={false}>
        <DialogHeader>
          <DialogTitle>Hoteles en {destino.toUpperCase()}</DialogTitle>
          <DialogDescription>{texto}</DialogDescription>
        </DialogHeader>
        <ListaBuscable
          items={ordenados}
          etiquetaBusqueda={`Buscar hotel en ${destino.toUpperCase()}`}
          placeholder="Buscar hotel por nombre…"
          render={(h) => (
            <Link href={`/dashboard/producto/hoteles/${h.id}`} className="block break-words rounded px-2 py-1.5 text-sm text-[var(--brand-primary)] hover:bg-gray-50 hover:underline">
              {h.nombre}
            </Link>
          )}
        />
        <DialogFooter>
          <DialogClose render={<Button variant="outline" />}>Cerrar</DialogClose>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// Estado de la lista de receptivos: se pide SOLO al abrir el diálogo (nunca
// para todas las tarjetas de entrada). "sin_permiso"/"error" nunca se pintan
// como una lista vacía: una lista vacía solo aparece si el servidor la
// confirmó (`ok` con 0 filas).
type EstadoLista = { estado: "cargando" } | ResultadoReceptivosDestino;

function ReceptivosInsignia({ destinoId, destino, conteo }: { destinoId: number; destino: string; conteo: number }) {
  const texto = etiquetaConteo(conteo, "receptivo", "receptivos");
  const [lista, setLista] = useState<EstadoLista>({ estado: "cargando" });
  // Cada apertura/reintento invalida la carga anterior: una respuesta tardía
  // nunca pisa la vigente.
  const revision = useRef(0);

  function cargar() {
    setLista({ estado: "cargando" });
    const mia = ++revision.current;
    listarReceptivosDestino(destinoId).then(
      (r) => { if (revision.current === mia) setLista(r); },
      () => { if (revision.current === mia) setLista({ estado: "error" }); }
    );
  }

  if (conteo === 0) return <InsigniaFija texto={texto} />;
  return (
    <Dialog onOpenChange={(abierto) => { if (abierto) cargar(); else revision.current++; }}>
      <DialogTrigger
        render={<button type="button" data-insignia className={CLASE_INSIGNIA_BOTON} aria-label={`Ver ${texto} de ${destino.toUpperCase()}`} />}
      >
        {texto}
        <ChevronRight className="h-3 w-3" aria-hidden />
      </DialogTrigger>
      <DialogContent className="sm:max-w-md" showCloseButton={false}>
        <DialogHeader>
          <DialogTitle>Receptivos en {destino.toUpperCase()}</DialogTitle>
          <DialogDescription>Tours y traslados asignados a este destino.</DialogDescription>
        </DialogHeader>
        <div data-receptivos-estado={lista.estado} aria-live="polite">
          {lista.estado === "cargando" && (
            <p className="flex items-center gap-1.5 text-sm text-gray-500">
              <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
              Cargando receptivos…
            </p>
          )}
          {lista.estado === "sin_permiso" && (
            <p className="text-sm text-gray-500">Tu rol no tiene acceso a la lista de receptivos.</p>
          )}
          {lista.estado === "error" && (
            <div className="space-y-2">
              <p className="text-sm text-red-600">No se pudo cargar la lista de receptivos.</p>
              <Button variant="outline" size="sm" onClick={cargar}>Reintentar</Button>
            </div>
          )}
          {lista.estado === "ok" && (
            <>
              {lista.receptivos.length !== conteo && (
                <p className="mb-2 text-xs text-amber-700">
                  La lista trae {etiquetaConteo(lista.receptivos.length, "receptivo", "receptivos")}; el conteo de la tarjeta decía {conteo}. Los datos cambiaron desde que se cargó la página.
                </p>
              )}
              <ListaBuscable<ReceptivoDeDestino>
                items={lista.receptivos}
                etiquetaBusqueda={`Buscar receptivo en ${destino.toUpperCase()}`}
                placeholder="Buscar receptivo por nombre…"
                vacio="Este destino no tiene receptivos."
                // Sin enlace: no existe una página de detalle por servicio
                // (Producto → Servicios es solo el listado).
                render={(r) => <span className="block break-words px-2 py-1.5 text-sm text-gray-700">{r.nombre}</span>}
              />
            </>
          )}
        </div>
        <DialogFooter>
          <DialogClose render={<Button variant="outline" />}>Cerrar</DialogClose>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// Minúsculas y sin tildes: "monteria" encuentra "MONTERÍA".
const normalizar = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();

function ListaBuscable<T extends { id: number; nombre: string }>({
  items, etiquetaBusqueda, placeholder, render, vacio = "Sin elementos.",
}: {
  items: T[];
  etiquetaBusqueda: string;
  placeholder: string;
  render: (item: T) => ReactNode;
  vacio?: string;
}) {
  const [busqueda, setBusqueda] = useState("");
  const b = normalizar(busqueda.trim());
  const visibles = b ? items.filter((it) => normalizar(it.nombre).includes(b)) : items;
  if (items.length === 0) return <p data-lista-vacia className="text-sm text-gray-500">{vacio}</p>;
  return (
    <div className="space-y-2">
      <Input
        type="search"
        value={busqueda}
        onChange={(e) => setBusqueda(e.target.value)}
        placeholder={placeholder}
        aria-label={etiquetaBusqueda}
      />
      {/* El total ya está en la descripción del diálogo; aquí solo al filtrar. */}
      {b && (
        <p className="text-xs text-gray-400" data-lista-resumen>
          {visibles.length} de {items.length}
        </p>
      )}
      {visibles.length === 0 ? (
        <p className="text-sm text-gray-500">Sin resultados para “{busqueda.trim()}”.</p>
      ) : (
        <ul data-lista className="max-h-[50vh] divide-y divide-gray-100 overflow-y-auto overscroll-contain rounded-lg border border-gray-100">
          {visibles.map((it) => <li key={it.id}>{render(it)}</li>)}
        </ul>
      )}
    </div>
  );
}
