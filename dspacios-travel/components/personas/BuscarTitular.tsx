"use client";

// #40 E2 — Botón "Buscar en personas" junto al N° de documento de un cliente/titular (formularios internos).
// El número es lo único necesario; el tipo sale de la coincidencia. Varios tipos para el mismo número →
// se elige expresamente uno. Lo ya escrito nunca se pisa en silencio: los vacíos se llenan y los distintos
// se ofrecen con casilla (sin marcar = se conserva lo escrito). Cualquier respuesta cuyo número o contexto
// ya cambió se descarta (token de generación + invalidación al editar), igual que BuscarPasajeroDocumento.
import { useEffect, useRef, useState } from "react";
import { Search, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { buscarTitularPorNumero } from "@/lib/personas/buscarTitular";
import { nombreUnido, planAplicacion, type CampoTitularUI, type CandidatoTitular, type DatosTitular } from "@/lib/personas/titularBusqueda";
import type { TipoDocPersona } from "@/lib/personas/identidad";

export type PatchTitular = DatosTitular & { tipoDoc: TipoDocPersona };

const ETIQUETA: Record<CampoTitularUI, string> = { nombres: "Nombres", apellidos: "Apellidos", telefono: "Teléfono", email: "Email", nacimiento: "Nacimiento" };

export function BuscarTitular({ numero, contexto = "", actual, campos, nombreCompleto, onAplicar }: {
  numero: string;
  /** Cambia cuando cambia el contexto de la búsqueda (aliado, modalidad…): invalida lo pendiente. */
  contexto?: string;
  actual: DatosTitular;
  /** Campos que el formulario sí tiene (por defecto todos); el resto nunca se propone. */
  campos?: readonly CampoTitularUI[];
  /** El formulario tiene un solo campo de nombre completo (va en `nombres`). */
  nombreCompleto?: boolean;
  onAplicar: (patch: PatchTitular) => void;
}) {
  const [abierto, setAbierto] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [candidatos, setCandidatos] = useState<CandidatoTitular[] | null>(null);
  const [elegido, setElegido] = useState<CandidatoTitular | null>(null);
  const [pisar, setPisar] = useState<Partial<Record<CampoTitularUI, boolean>>>({});
  const [buscado, setBuscado] = useState<{ num: string; ctx: string } | null>(null);
  const token = useRef(0);

  const num = numero.trim();
  const desactualizado = buscado != null && (buscado.num !== num || buscado.ctx !== contexto);

  useEffect(() => {
    if (!desactualizado) return;
    token.current++;
    // Invalidación por cambio de entrada: reinicia el panel (no hay otra fuente que derive este estado).
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setAbierto(false); setCandidatos(null); setElegido(null); setError(null); setPending(false); setBuscado(null); setPisar({});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [num, contexto]);

  function buscar() {
    if (!num) return;
    const mio = ++token.current;
    setBuscado({ num, ctx: contexto }); setAbierto(true); setPending(true); setError(null); setCandidatos(null); setElegido(null); setPisar({});
    buscarTitularPorNumero(num).then((r) => {
      if (token.current !== mio) return;
      setPending(false);
      if (!r.ok) { setError(r.error); return; }
      setCandidatos(r.candidatos);
      if (r.candidatos.length === 1) setElegido(r.candidatos[0]);
    }).catch(() => { if (token.current === mio) { setPending(false); setError("No se pudo consultar el documento. Intenta de nuevo."); } });
  }

  const plan = elegido ? planAplicacion(actual, nombreCompleto ? nombreUnido(elegido.datos) : elegido.datos, campos) : null;

  function aplicar() {
    if (!elegido || !plan || desactualizado) return;
    const patch: PatchTitular = { tipoDoc: elegido.tipoDoc, ...plan.llenar };
    for (const c of plan.conflictos) if (pisar[c.campo]) patch[c.campo] = c.nuevo;
    onAplicar(patch);
    setAbierto(false);
  }

  return (
    <div className="relative inline-block">
      <Button type="button" variant="outline" size="icon-sm" disabled={!num} title="Buscar este documento en personas ya registradas" onClick={buscar}>
        <Search />
      </Button>
      {abierto && !desactualizado && (
        <div className="absolute right-0 z-30 mt-1 w-80 rounded-lg border border-gray-200 bg-white p-2 text-left shadow-lg">
          <div className="mb-1 flex items-center justify-between">
            <span className="text-xs font-medium text-gray-600">Personas con ese documento</span>
            <button type="button" onClick={() => setAbierto(false)} className="text-gray-400 hover:text-gray-600"><X className="size-3.5" /></button>
          </div>
          {pending && <p className="px-1 py-2 text-xs text-gray-500">Buscando…</p>}
          {!pending && error && <p className="px-1 py-2 text-xs text-red-600">{error}</p>}
          {!pending && !error && candidatos && candidatos.length === 0 && (
            <p className="px-1 py-2 text-xs text-gray-500">Sin coincidencias. Captura los datos a mano y elige el tipo de documento.</p>
          )}
          {!pending && candidatos && candidatos.length > 1 && !elegido && (
            <p className="px-1 pb-1 text-[11px] text-amber-700">Ese número existe con más de un tipo de documento: elige cuál es.</p>
          )}
          {!pending && candidatos && candidatos.length > 1 && !elegido && (
            <ul className="space-y-1">
              {candidatos.map((c) => (
                <li key={c.tipoDoc}>
                  <button type="button" onClick={() => setElegido(c)} className="w-full rounded-md border border-gray-100 px-2 py-1.5 text-left text-xs hover:border-gray-300 hover:bg-gray-50">
                    <div className="font-medium text-gray-800">{c.tipoDoc} {c.numero}</div>
                    <div className="text-gray-500">{`${c.datos.nombres ?? ""} ${c.datos.apellidos ?? ""}`.trim() || "Sin nombre registrado"}</div>
                  </button>
                </li>
              ))}
            </ul>
          )}
          {!pending && elegido && plan && (
            <div className="space-y-1 text-xs">
              <div className="font-medium text-gray-800">{elegido.tipoDoc} {elegido.numero}</div>
              {elegido.divergencia && <p className="text-[11px] text-amber-700">Hay datos distintos entre registros; se propone el más frecuente. Revísalo.</p>}
              {Object.entries(plan.llenar).map(([k, v]) => (
                <div key={k} className="text-gray-600"><span className="text-gray-400">{ETIQUETA[k as CampoTitularUI]}:</span> {v}</div>
              ))}
              {plan.conflictos.map((c) => (
                <label key={c.campo} className="flex items-start gap-1.5 rounded bg-amber-50 px-1.5 py-1 text-amber-800">
                  <input type="checkbox" className="mt-0.5" checked={!!pisar[c.campo]} onChange={(e) => setPisar({ ...pisar, [c.campo]: e.target.checked })} />
                  <span>{ETIQUETA[c.campo]}: reemplazar «{c.actual}» por «{c.nuevo}»</span>
                </label>
              ))}
              <Button type="button" size="sm" onClick={aplicar}>Aplicar datos</Button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
