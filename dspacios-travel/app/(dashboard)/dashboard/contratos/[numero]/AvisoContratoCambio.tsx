"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { TriangleAlert } from "lucide-react";
import { Button } from "@/components/ui/button";
import { contratoSigueVigente } from "./vigencia-actions";

const CADA_MS = 60_000;
const ESPERA_S = 8;

/**
 * Avisa —y redirige al panel— cuando el contrato que esta pantalla muestra fue eliminado o reemplazado por otro con el mismo número.
 * Es solo cortesía: la protección real de las escrituras es la identidad que la base verifica (migración 284), con o sin este aviso.
 */
export function AvisoContratoCambio({ numero, uid }: { numero: string; uid: string | null }) {
  const router = useRouter();
  const [cambio, setCambio] = useState(false);
  const [seg, setSeg] = useState(ESPERA_S);

  useEffect(() => {
    if (!uid || cambio) return;
    let vivo = true;
    const revisar = async () => {
      if (document.visibilityState !== "visible") return;
      const r = await contratoSigueVigente(numero, uid);
      if (vivo && r === false) setCambio(true);
    };
    const t = setInterval(revisar, CADA_MS);
    window.addEventListener("focus", revisar);
    document.addEventListener("visibilitychange", revisar);
    return () => { vivo = false; clearInterval(t); window.removeEventListener("focus", revisar); document.removeEventListener("visibilitychange", revisar); };
  }, [numero, uid, cambio]);

  useEffect(() => {
    if (!cambio) return;
    if (seg <= 0) { router.replace("/dashboard"); return; }
    const t = setTimeout(() => setSeg((s) => s - 1), 1000);
    return () => clearTimeout(t);
  }, [cambio, seg, router]);

  if (!cambio) return null;
  return (
    <div role="alertdialog" aria-live="assertive" className="fixed inset-x-4 top-4 z-50 mx-auto max-w-xl rounded-lg border border-red-300 bg-red-50 p-4 shadow-lg">
      <div className="flex items-start gap-3">
        <TriangleAlert className="mt-0.5 h-5 w-5 shrink-0 text-red-700" aria-hidden />
        <div className="flex-1 text-sm text-red-900">
          <p className="font-semibold">Este contrato ya no está disponible</p>
          <p className="mt-1">El contrato {numero} fue eliminado o reemplazado por otro. Lo que veías en esta pantalla es de la versión anterior y no se guardará ningún cambio. Te llevamos al panel en {seg} s.</p>
          <Button type="button" size="sm" className="mt-3" onClick={() => router.replace("/dashboard")}>Ir al panel ahora</Button>
        </div>
      </div>
    </div>
  );
}
