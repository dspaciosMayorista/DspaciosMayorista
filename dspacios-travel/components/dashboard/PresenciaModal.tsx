"use client";

import { useEffect, useState } from "react";
import { Search, ChevronLeft, ChevronRight } from "lucide-react";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { cargarPaginaActividad, type PaginaActividad } from "@/app/(dashboard)/dashboard/actividad-actions";
import { esAliado, etiquetaNivel, fechaHoraBogota, haceTexto, nivelPresencia, INTERVALO_PING_MIN, UMBRAL_RECIENTE_MIN, type FilaActividad, type NivelPresencia } from "@/lib/actividad/actividadReciente";
import { TAM_PAGINA_ACTIVIDAD, MAX_BUSQUEDA_ACTIVIDAD, totalPaginas, type GrupoActividad } from "@/lib/actividad/consulta";

// B3-01 — Presencia reciente en un MODAL con dos pestañas (personal interno / aliados B2B). Se carga SOLO al abrir y al cambiar de pestaña, página o búsqueda: una petición por acción, sin sondeo ni temporizadores.
// La búsqueda se aplica con Enter o el botón (no por tecla). Una observación reciente NO prueba una conexión continua; el pie lo dice.
const TONO: Record<NivelPresencia, { fondo: string; color: string }> = {
  reciente: { fondo: "var(--dash-highlight)", color: "var(--dash-primary)" },
  hoy: { fondo: "var(--dash-muted-surface)", color: "var(--dash-primary)" },
  antes: { fondo: "var(--dash-muted-surface)", color: "var(--dash-ink-muted)" },
  ninguna: { fondo: "transparent", color: "var(--dash-ink-muted)" },
};
const ROL_ALIADO: Record<string, string> = { agencia: "Agencia", freelance: "Freelance" };
const muted = { color: "var(--dash-ink-muted)" } as const;

export function PresenciaModal({ personalTotal, aliadosTotal, cargar = cargarPaginaActividad }: { personalTotal: number; aliadosTotal: number; cargar?: typeof cargarPaginaActividad }) {
  const [abierto, setAbierto] = useState(false);
  const [grupo, setGrupo] = useState<GrupoActividad>("interno");
  const [texto, setTexto] = useState("");        // lo que se escribe
  const [busqueda, setBusqueda] = useState("");  // lo que se aplicó (dispara la petición)
  const [pagina, setPagina] = useState(0);
  const [res, setRes] = useState<PaginaActividad | null>(null);
  const [cargando, setCargando] = useState(false);
  const [ahora, setAhora] = useState(() => new Date());

  useEffect(() => {
    if (!abierto) return;
    let vigente = true;   // una respuesta atrasada de una consulta anterior no pisa a la actual
    setCargando(true);
    cargar({ grupo, busqueda, pagina }).then((r) => {
      if (!vigente) return;
      if (r.ok && r.filas.length === 0 && pagina > 0) { setPagina(0); return; }   // página fuera de rango (cambió el total): vuelve a la primera
      setRes(r); setAhora(new Date()); setCargando(false);
    }, () => { if (vigente) { setRes({ ok: false }); setCargando(false); } });
    return () => { vigente = false; };
  }, [abierto, grupo, busqueda, pagina, cargar]);

  const total = res?.ok ? res.total : 0;
  const paginas = totalPaginas(total);
  const filas = res?.ok ? res.filas : [];
  const cambiarGrupo = (g: GrupoActividad) => { if (g !== grupo) { setGrupo(g); setPagina(0); setRes(null); } };
  const aplicar = () => { const q = texto.trim(); if (q !== busqueda) { setBusqueda(q); setPagina(0); } };

  return (
    <Dialog open={abierto} onOpenChange={setAbierto}>
      <DialogTrigger render={<button type="button" className="inline-flex min-h-8 items-center gap-1 rounded-md border px-2.5 py-1 text-xs font-medium" style={{ borderColor: "var(--dash-border)", color: "var(--dash-primary)" }} data-testid="presencia-abrir" />}>
        Ver presencia
      </DialogTrigger>
      <DialogContent className="max-h-[88vh] overflow-y-auto sm:max-w-2xl" data-testid="presencia-modal">
        <DialogHeader>
          <DialogTitle>Presencia reciente</DialogTitle>
          <DialogDescription>Última actividad observada del equipo y de los aliados, en hora de Bogotá. No es una conexión en vivo.</DialogDescription>
        </DialogHeader>
        <div role="tablist" aria-label="Grupo de presencia" className="flex gap-1 border-b" style={{ borderColor: "var(--dash-border)" }}>
          {([["interno", "Personal interno", personalTotal], ["aliado", "Aliados B2B", aliadosTotal]] as const).map(([g, etiqueta, n]) => (
            <button key={g} type="button" role="tab" aria-selected={grupo === g} data-testid={`presencia-tab-${g}`} onClick={() => cambiarGrupo(g)}
              className="-mb-px min-h-9 border-b-2 px-3 py-1.5 text-sm font-medium" style={grupo === g ? { borderColor: "var(--dash-primary)", color: "var(--dash-primary)" } : { borderColor: "transparent", ...muted }}>
              {etiqueta} ({n})
            </button>
          ))}
        </div>
        <form className="flex gap-2" role="search" onSubmit={(e) => { e.preventDefault(); aplicar(); }}>
          <input type="search" value={texto} onChange={(e) => setTexto(e.target.value)} maxLength={MAX_BUSQUEDA_ACTIVIDAD} placeholder={grupo === "aliado" ? "Buscar por nombre, correo o aliado" : "Buscar por nombre o correo"} aria-label="Buscar en la presencia" data-testid="presencia-buscar"
            className="min-h-9 min-w-0 flex-1 rounded-md border px-2.5 text-sm" style={{ borderColor: "var(--dash-border)" }} />
          <button type="submit" className="inline-flex min-h-9 items-center gap-1 rounded-md border px-3 text-sm font-medium" style={{ borderColor: "var(--dash-border)", color: "var(--dash-primary)" }}><Search size={14} aria-hidden="true" /> Buscar</button>
        </form>
        <div aria-live="polite" data-testid="presencia-lista">
          {res && !res.ok ? (
            <p role="status" className="text-sm" style={muted} data-testid="actividad-error">No se pudo leer la presencia. Cierra y vuelve a abrir esta ventana; el resto del tablero no se ve afectado.</p>
          ) : cargando && !res ? (
            <p className="text-sm" style={muted}>Cargando…</p>
          ) : filas.length === 0 ? (
            <p className="text-sm" style={muted} data-testid="presencia-vacio">{busqueda ? "Ninguna persona coincide con la búsqueda." : "No hay personas activas en este grupo."}</p>
          ) : (
            <ul className="divide-y" style={{ borderColor: "var(--dash-border)", opacity: cargando ? 0.6 : 1 }}>
              {filas.map((f) => <FilaPresencia key={f.usuario_id} f={f} ahora={ahora} />)}
            </ul>
          )}
        </div>
        {total > 0 && (
          <nav className="flex flex-wrap items-center justify-between gap-2 text-xs" style={muted} aria-label="Paginación de presencia">
            <span data-testid="presencia-rango">{pagina * TAM_PAGINA_ACTIVIDAD + 1}–{pagina * TAM_PAGINA_ACTIVIDAD + filas.length} de {total}</span>
            <span className="flex items-center gap-1">
              <button type="button" disabled={pagina === 0 || cargando} onClick={() => setPagina(pagina - 1)} className="inline-flex min-h-8 items-center gap-0.5 rounded-md border px-2 disabled:opacity-40" style={{ borderColor: "var(--dash-border)" }} data-testid="presencia-anterior"><ChevronLeft size={14} aria-hidden="true" /> Anterior</button>
              <span>Página {pagina + 1} de {paginas}</span>
              <button type="button" disabled={pagina + 1 >= paginas || cargando} onClick={() => setPagina(pagina + 1)} className="inline-flex min-h-8 items-center gap-0.5 rounded-md border px-2 disabled:opacity-40" style={{ borderColor: "var(--dash-border)" }} data-testid="presencia-siguiente">Siguiente <ChevronRight size={14} aria-hidden="true" /></button>
            </span>
          </nav>
        )}
        <p className="text-[11px] leading-snug" style={muted}>
          «Actividad observada» es el último instante en que el navegador de la persona avisó, con la pestaña visible y uso real (cargar una pantalla, un clic o una tecla), como máximo una vez cada {INTERVALO_PING_MIN} min.
          Se considera reciente lo observado en los últimos {UMBRAL_RECIENTE_MIN} min. Es evidencia de uso reciente, no una conexión continua: quien cierra la pestaña sigue «reciente» hasta que pase la ventana, y quien no usa la aplicación no deja observación.
          Se consulta al abrir esta ventana y al cambiar de pestaña, página o búsqueda.
        </p>
      </DialogContent>
    </Dialog>
  );
}

function FilaPresencia({ f, ahora }: { f: FilaActividad; ahora: Date }) {
  const nivel = nivelPresencia(ahora, f.visto_en);
  return (
    <li className="flex flex-wrap items-start justify-between gap-x-4 gap-y-1 py-2.5" style={{ borderColor: "var(--dash-border)" }} data-testid="actividad-fila" data-nivel={nivel} data-rol={f.rol}>
      <div className="min-w-0 flex-1 basis-44">
        <p className="break-words text-sm font-semibold" style={{ color: "var(--dash-ink)" }}>{f.nombre || f.email || "Sin nombre"}</p>
        <p className="break-words text-xs capitalize" style={muted}>{esAliado(f.rol) ? `${ROL_ALIADO[f.rol]}${f.aliado ? ` · ${f.aliado}` : ""}` : f.rol}{f.tenant ? ` · ${f.tenant}` : ""}</p>
      </div>
      <div className="min-w-0 basis-52 text-xs" style={muted}>
        <span className="inline-block rounded-md px-2 py-0.5 text-[11px] font-semibold" style={{ backgroundColor: TONO[nivel].fondo, color: TONO[nivel].color }}>{etiquetaNivel(nivel)}</span>
        {f.visto_en && <p className="mt-1">Última observación: {haceTexto(ahora, f.visto_en)} ({fechaHoraBogota(f.visto_en)})</p>}
        <p className="mt-0.5">Último ingreso: {f.ultimo_ingreso ? `${haceTexto(ahora, f.ultimo_ingreso)} (${fechaHoraBogota(f.ultimo_ingreso)})` : "sin registro"}</p>
        {f.ultima_actividad && <p className="mt-0.5">Último cambio guardado: {haceTexto(ahora, f.ultima_actividad)}</p>}
      </div>
    </li>
  );
}
