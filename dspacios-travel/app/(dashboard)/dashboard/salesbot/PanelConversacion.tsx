"use client";

// Conversación guiada de SalesBot (#56, MVP). La conversación vive SOLO en la
// memoria de esta página: no se guarda en base de datos, URL, localStorage ni
// logs. Cada turno va a la acción de servidor `conversar`, que revalida la
// sesión y no confía en el estado que le manda este componente.
import { useEffect, useRef, useState, useTransition } from "react";
import Link from "next/link";
import { AlertTriangle, Bot, ExternalLink, RotateCcw, Send, User } from "lucide-react";
import { conversar } from "./actions";
import type { EntradaConversacion, EstadoConversacion, MensajeBot, RespuestaConversacion } from "@/lib/salesbot/conversacion/contrato";

type Linea = { id: number; autor: "bot"; mensaje: MensajeBot } | { id: number; autor: "usuario"; texto: string };

const MAX_TEXTO = 300;

export function PanelConversacion({ inicial }: { inicial: RespuestaConversacion }) {
  const [estado, setEstado] = useState<EstadoConversacion>(inicial.estado);
  const [lineas, setLineas] = useState<Linea[]>(() => inicial.mensajes.map((m, i) => ({ id: i, autor: "bot" as const, mensaje: m })));
  const [texto, setTexto] = useState("");
  const [pendiente, iniciar] = useTransition();
  const sig = useRef(inicial.mensajes.length);
  const entrada = useRef<HTMLInputElement>(null);
  const fin = useRef<HTMLDivElement>(null);

  useEffect(() => {
    fin.current?.scrollIntoView({ block: "end" });
  }, [lineas]);

  const ultimaBot = [...lineas].reverse().find((l) => l.autor === "bot")?.id;

  function enviar(e: EntradaConversacion, eco: string | null) {
    if (pendiente) return;
    if (eco) setLineas((ls) => [...ls, { id: sig.current++, autor: "usuario", texto: eco }]);
    iniciar(async () => {
      let r: RespuestaConversacion;
      try {
        r = await conversar(estado, e);
      } catch {
        r = { ok: false, estado, mensajes: [{ texto: "No fue posible conectar. Intenta de nuevo.", aviso: true }] };
      }
      setEstado(r.estado);
      setLineas((ls) => [...ls, ...r.mensajes.map((m) => ({ id: sig.current++, autor: "bot" as const, mensaje: m }))]);
      entrada.current?.focus();
    });
  }

  function alEnviar(ev: React.FormEvent) {
    ev.preventDefault();
    const t = texto.trim();
    if (!t) return;
    setTexto("");
    enviar({ tipo: "texto", texto: t.slice(0, MAX_TEXTO) }, t.slice(0, MAX_TEXTO));
  }

  return (
    <section className="flex flex-col rounded-lg border bg-white" aria-label="Conversación con SalesBot">
      <div className="flex items-center justify-between gap-2 border-b px-3 py-2">
        <p className="text-xs text-gray-500">La conversación no se guarda: se borra al cerrar o recargar la página. Los precios son orientativos y vencen a los 15 minutos.</p>
        <button
          type="button"
          onClick={() => enviar({ tipo: "opcion", valor: "reiniciar" }, "Empezar de nuevo")}
          disabled={pendiente}
          className="flex shrink-0 items-center gap-1 rounded-md border px-2 py-1 text-xs text-gray-700 hover:bg-gray-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--brand-accent)] disabled:opacity-50"
        >
          <RotateCcw size={14} aria-hidden /> Empezar de nuevo
        </button>
      </div>

      <div role="log" aria-live="polite" aria-relevant="additions" aria-busy={pendiente} className="flex max-h-[60vh] min-h-[16rem] flex-col gap-3 overflow-y-auto p-3 sm:max-h-[65vh]">
        {lineas.map((l) =>
          l.autor === "usuario" ? (
            <div key={l.id} className="flex justify-end">
              <p className="flex max-w-[85%] items-start gap-2 rounded-lg px-3 py-2 text-sm text-white sm:max-w-[70%]" style={{ background: "var(--brand-primary)" }}>
                <span className="sr-only">Tú:</span>
                <span className="whitespace-pre-wrap break-words">{l.texto}</span>
                <User size={14} className="mt-0.5 shrink-0" aria-hidden />
              </p>
            </div>
          ) : (
            <div key={l.id} className="flex justify-start">
              <div className={`max-w-[95%] space-y-2 rounded-lg border px-3 py-2 text-sm sm:max-w-[80%] ${l.mensaje.aviso ? "border-amber-200 bg-amber-50 text-amber-900" : "bg-gray-50 text-gray-800"}`}>
                <p className="flex items-start gap-2">
                  {l.mensaje.aviso ? <AlertTriangle size={14} className="mt-0.5 shrink-0" aria-hidden /> : <Bot size={14} className="mt-0.5 shrink-0" aria-hidden />}
                  <span className="sr-only">SalesBot:</span>
                  <span className="whitespace-pre-wrap break-words">{l.mensaje.texto}</span>
                </p>
                {l.mensaje.lineas && l.mensaje.lineas.length > 0 && (
                  <ul className="space-y-1 pl-6 text-gray-700">
                    {l.mensaje.lineas.map((x, i) => (
                      <li key={i} className="list-disc break-words">
                        {x}
                      </li>
                    ))}
                  </ul>
                )}
                {l.mensaje.enlace && (
                  <Link href={l.mensaje.enlace.href} target="_blank" className="inline-flex items-center gap-1 pl-6 font-medium" style={{ color: "var(--brand-accent)" }}>
                    {l.mensaje.enlace.etiqueta} <ExternalLink size={12} aria-hidden />
                  </Link>
                )}
                {l.id === ultimaBot && l.mensaje.opciones && l.mensaje.opciones.length > 0 && (
                  <div role="group" aria-label="Opciones" className="flex flex-wrap gap-2 pl-6">
                    {l.mensaje.opciones.map((o) => (
                      <button
                        key={o.valor}
                        type="button"
                        disabled={pendiente}
                        onClick={() => enviar({ tipo: "opcion", valor: o.valor }, o.etiqueta)}
                        className="min-h-9 rounded-full border bg-white px-3 py-1 text-left text-xs font-medium text-gray-800 hover:bg-gray-100 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--brand-accent)] disabled:opacity-50"
                      >
                        {o.etiqueta}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            </div>
          )
        )}
        {pendiente && (
          <p className="text-xs text-gray-500" role="status">
            Consultando…
          </p>
        )}
        <div ref={fin} />
      </div>

      <form onSubmit={alEnviar} className="flex gap-2 border-t p-3">
        <label htmlFor="salesbot-entrada" className="sr-only">
          Escribe tu mensaje para SalesBot
        </label>
        <input
          id="salesbot-entrada"
          ref={entrada}
          type="text"
          value={texto}
          onChange={(ev) => setTexto(ev.target.value)}
          maxLength={MAX_TEXTO}
          autoComplete="off"
          placeholder="Escribe aquí (por ejemplo: bloqueo a San Andrés)"
          className="min-w-0 flex-1 rounded-md border px-3 py-2 text-sm focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-[var(--brand-accent)]"
        />
        <button
          type="submit"
          disabled={pendiente || !texto.trim()}
          aria-label="Enviar mensaje"
          className="flex items-center gap-2 rounded-md px-4 py-2 text-sm font-semibold text-white focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--brand-accent)] disabled:opacity-50"
          style={{ background: "var(--brand-primary)" }}
        >
          <Send size={16} aria-hidden /> <span className="hidden sm:inline">Enviar</span>
        </button>
      </form>
    </section>
  );
}
