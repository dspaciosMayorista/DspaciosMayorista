"use client";

import { useRef, useState, useTransition } from "react";
import type { DatosExcedente } from "@/lib/finanzas/excedenteAbono";

// Registro de un abono desde un formulario (ficha del contrato y Cartera comparten esto):
//  · Los datos se CONGELAN al pulsar «Registrar» (`EnvioAbono`). Si el servidor pide confirmar un pago adicional, el
//    diálogo y el reintento confirmado usan ESE mismo envío — aunque el formulario haya cambiado mientras llegaba la
//    respuesta —, así lo confirmado es exactamente el abono que se le mostró a quien confirma.
//  · Cada envío lleva su clave de operación; una doble pulsación no sale mientras hay uno en curso y, si saliera, la
//    base devuelve el mismo abono. Tras registrar, el formulario solo se limpia si NO cambió desde el envío.
export type EnvioAbono = { valor: number; forma: string; ref: string; trm?: number; fecha: string; operacion: string };
export type CamposAbono = { valor: string; forma: string; ref: string; trm: string; fecha: string };
type Respuesta = { ok: boolean; error?: string; confirmacion?: DatosExcedente };

export function useRegistroAbono({ campos, esUSD, registrar, reiniciar }: {
  campos: CamposAbono;
  esUSD: boolean;
  registrar: (envio: EnvioAbono, confirmar: boolean) => Promise<Respuesta>;
  reiniciar: () => void;
}) {
  const vivo = useRef(campos);
  vivo.current = campos; // lo último que muestra el formulario (las respuestas demoradas lo comparan con su envío)
  const enVuelo = useRef(false);
  const operacion = useRef(crypto.randomUUID());
  const [error, setError] = useState<string | null>(null);
  const [pendiente, setPendiente] = useState<{ datos: DatosExcedente; envio: EnvioAbono } | null>(null);
  const [pending, start] = useTransition();

  const sinCambios = (e: EnvioAbono) => {
    const c = vivo.current;
    return Number(c.valor) === e.valor && c.forma === e.forma && c.ref === e.ref && c.fecha === e.fecha && (!esUSD || Number(c.trm) === e.trm);
  };
  function registrado(e: EnvioAbono) {
    operacion.current = crypto.randomUUID(); // la operación quedó consumida: lo que se escriba ahora es otro abono
    if (sinCambios(e)) reiniciar();
  }

  function enviar() {
    setError(null);
    const v = Number(campos.valor);
    if (!v || v <= 0) { setError("Ingresa un valor mayor a 0."); return; }
    if (esUSD && !(Number(campos.trm) > 0)) { setError("Indica la TRM del día (contrato en USD)."); return; }
    if (enVuelo.current) return;
    enVuelo.current = true;
    const envio: EnvioAbono = { valor: v, forma: campos.forma, ref: campos.ref, trm: esUSD ? Number(campos.trm) : undefined, fecha: campos.fecha, operacion: operacion.current };
    start(async () => {
      try {
        const r = await registrar(envio, false);
        if (r.confirmacion) { setPendiente({ datos: r.confirmacion, envio }); return; } // nada se escribió: se pide confirmar ESTE envío
        if (!r.ok) { setError(r.error ?? "No se pudo registrar el abono."); return; }
        registrado(envio);
      } catch {
        setError("No se pudo registrar el abono.");
      } finally {
        enVuelo.current = false;
      }
    });
  }

  async function confirmar(): Promise<{ ok: boolean; error?: string }> {
    if (!pendiente) return { ok: false, error: "No hay un abono pendiente de confirmar." };
    if (enVuelo.current) return { ok: false, error: "El registro ya está en curso." };
    enVuelo.current = true;
    try {
      const r = await registrar(pendiente.envio, true); // el envío congelado, no lo que haya ahora en el formulario
      if (!r.ok) return { ok: false, error: r.error ?? "No se pudo registrar el abono." };
      setPendiente(null);
      registrado(pendiente.envio);
      return { ok: true };
    } catch {
      return { ok: false, error: "No se pudo registrar el abono." };
    } finally {
      enVuelo.current = false;
    }
  }

  return { error, pending, enviar, excedente: pendiente?.datos ?? null, cancelar: () => setPendiente(null), confirmar };
}
