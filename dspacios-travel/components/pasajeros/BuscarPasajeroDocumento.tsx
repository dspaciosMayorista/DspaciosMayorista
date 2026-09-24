"use client";

// ─────────────────────────────────────────────────────────────────────────
// Botón "Buscar en historial" para una fila de pasajero: busca por
// tipo+número de documento EXACTOS (RPC buscar_pasajero_por_documento,
// migración 187) y deja elegir explícitamente una coincidencia para
// prellenar SOLO fecha de nacimiento/nacionalidad (y nombres/apellidos
// SOLO cuando la fila encontrada ya los trae estructurados — nunca
// partiendo `nombreHistorico` por heurística).
//
// Cada resultado queda ATADO al tipo+documento con el que se buscó
// (`buscadoTipoId`/`buscadoIdentificacion`, capturados en el momento del
// clic). Si cualquiera de los dos cambia después — el usuario sigue
// editando la fila, o dispara una búsqueda nueva antes de que la anterior
// vuelva — los resultados pendientes/mostrados se invalidan: nunca se deja
// aplicar una coincidencia que corresponde a un documento distinto del que
// hay escrito ahora en la fila. Un `token` de generación descarta además
// cualquier respuesta tardía de una búsqueda vieja que llegue después de
// una más nueva (o después de que el documento ya cambió).
//
// A propósito NUNCA prellena id/responsable_id/es_infante/silla/precio:
// esos son atributos del CONTRATO de origen, no de la persona (el
// formulario que usa este botón ya recalcula es_infante contra la fecha
// del contrato nuevo).
// ─────────────────────────────────────────────────────────────────────────
import { useEffect, useRef, useState } from "react";
import { Search, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { buscarPasajeroPorDocumento, type PasajeroEncontrado } from "@/lib/reservar/buscarPasajero";

export type PasajeroDatosAplicables = {
  fechaNacimiento: string | null;
  nacionalidad: string | null;
  nombres: string | null;
  apellidos: string | null;
};

export function BuscarPasajeroDocumento({
  tipoId,
  identificacion,
  onAplicar,
}: {
  tipoId: string;
  identificacion: string;
  onAplicar: (datos: PasajeroDatosAplicables, nombreHistorico: string) => void;
}) {
  const [abierto, setAbierto] = useState(false);
  const [resultados, setResultados] = useState<PasajeroEncontrado[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  // Documento con el que se disparó la búsqueda EN CURSO o cuyos resultados
  // se están mostrando — nunca el valor actual de los props si ya cambió.
  const [buscado, setBuscado] = useState<{ tipo: string; doc: string } | null>(null);
  // Descarta respuestas tardías de una búsqueda anterior a la vigente.
  const tokenRef = useRef(0);

  const tipoNorm = tipoId.trim() || "CC";
  const docNorm = identificacion.trim();
  const puedeBuscar = docNorm.length > 0;
  // El documento/tipo actual de la fila difiere de lo que se buscó → lo que
  // hay en pantalla (o en vuelo) ya no corresponde a esta fila.
  const desactualizado = buscado != null && (buscado.tipo !== tipoNorm || buscado.doc !== docNorm);

  // Si el usuario sigue editando tipo/documento (con o sin un panel abierto,
  // con o sin una búsqueda en vuelo), se invalida de inmediato — nunca queda
  // una coincidencia vieja clickeable, ni un `pending` colgado, sobre un
  // documento que ya no es el mostrado en la fila.
  //
  // ⚠️ El `tokenRef.current++` de aquí es imprescindible y NO es redundante
  // con el que ya hace `buscar()`: si el documento cambia mientras una
  // búsqueda sigue en vuelo y el usuario NUNCA dispara una búsqueda nueva
  // (se queda quieto, o solo sigue editando), `buscar()` no vuelve a
  // ejecutarse — nada más bumpea el token — así que sin esta línea la
  // respuesta tardía de la búsqueda vieja seguiría pasando el chequeo
  // `tokenRef.current !== miToken` (ambos seguirían apuntando al mismo
  // token) y terminaría escribiendo `resultados`/`pending` en el estado, aun
  // con el panel ya cerrado — un remanente invisible pero real. Bumpear el
  // token AQUÍ, en el efecto que reacciona al cambio de documento, hace que
  // CUALQUIER respuesta en vuelo en ese instante quede descartada sin
  // importar si después se dispara o no una búsqueda nueva.
  useEffect(() => {
    if (desactualizado) {
      tokenRef.current++;
      setAbierto(false);
      setResultados(null);
      setError(null);
      setPending(false);
      setBuscado(null);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tipoNorm, docNorm]);

  function buscar() {
    if (!puedeBuscar) return;
    const miToken = ++tokenRef.current;
    const criterio = { tipo: tipoNorm, doc: docNorm };
    setError(null);
    setResultados(null);
    setBuscado(criterio);
    setAbierto(true);
    setPending(true);
    buscarPasajeroPorDocumento(criterio.tipo, criterio.doc).then((r) => {
      // Una búsqueda más nueva (o un cambio de documento) ya invalidó esta
      // respuesta — se descarta en silencio, nunca se muestra fuera de orden.
      if (tokenRef.current !== miToken) return;
      setPending(false);
      if (!r.ok) {
        setError(r.error);
        return;
      }
      setResultados(r.resultados);
    });
  }

  function aplicar(r: PasajeroEncontrado) {
    // Último candado: si por cualquier razón el documento cambió entre que
    // se pintó este resultado y el clic (evento en cola, doble clic rápido),
    // no se aplica — se obliga a buscar de nuevo sobre el documento actual.
    if (desactualizado || buscado?.tipo !== tipoNorm || buscado?.doc !== docNorm) return;
    onAplicar(
      {
        fechaNacimiento: r.fechaNacimiento,
        nacionalidad: r.nacionalidad,
        nombres: r.nombres,
        apellidos: r.apellidos,
      },
      r.nombre
    );
    setAbierto(false);
  }

  return (
    <div className="relative inline-block">
      <Button
        type="button"
        variant="outline"
        size="icon-sm"
        disabled={!puedeBuscar}
        title="Buscar este documento en contratos anteriores"
        onClick={buscar}
      >
        <Search />
      </Button>

      {abierto && !desactualizado && (
        <div className="absolute z-30 mt-1 w-80 rounded-lg border border-gray-200 bg-white p-2 shadow-lg">
          <div className="mb-1 flex items-center justify-between">
            <span className="text-xs font-medium text-gray-600">Coincidencias en historial</span>
            <button type="button" onClick={() => setAbierto(false)} className="text-gray-400 hover:text-gray-600">
              <X className="size-3.5" />
            </button>
          </div>

          {pending && <p className="px-1 py-2 text-xs text-gray-500">Buscando…</p>}
          {!pending && error && <p className="px-1 py-2 text-xs text-red-600">{error}</p>}
          {!pending && !error && resultados && resultados.length === 0 && (
            <p className="px-1 py-2 text-xs text-gray-500">Sin coincidencias con ese documento.</p>
          )}
          {!pending && !error && resultados && resultados.length > 1 && (
            <p className="px-1 pb-1 text-[11px] text-amber-700">
              Este documento tiene datos distintos en más de un contrato — revisa cuál usar.
            </p>
          )}

          {!pending && resultados && resultados.length > 0 && (
            <ul className="max-h-64 space-y-1 overflow-auto">
              {resultados.map((r, i) => (
                <li key={i}>
                  <button type="button" className="w-full rounded-md border border-gray-100 px-2 py-1.5 text-left text-xs hover:border-gray-300 hover:bg-gray-50" onClick={() => aplicar(r)}>
                    <div className="font-medium text-gray-800">
                      {r.nombres || r.apellidos ? `${r.nombres ?? ""} ${r.apellidos ?? ""}`.trim() : r.nombre}
                    </div>
                    {(r.nombres || r.apellidos) && r.nombre !== `${r.nombres ?? ""} ${r.apellidos ?? ""}`.trim() && (
                      <div className="text-gray-400">Nombre en el contrato: {r.nombre}</div>
                    )}
                    <div className="text-gray-500">
                      {r.fechaNacimiento ? `Nace ${r.fechaNacimiento}` : "Sin fecha de nacimiento"}
                      {r.nacionalidad ? ` · ${r.nacionalidad}` : ""}
                    </div>
                    <div className="text-gray-400">
                      Visto en {r.vecesVisto} contrato{r.vecesVisto === 1 ? "" : "s"}
                      {r.ultimoContrato ? ` · último ${r.ultimoContrato}` : ""}
                    </div>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
