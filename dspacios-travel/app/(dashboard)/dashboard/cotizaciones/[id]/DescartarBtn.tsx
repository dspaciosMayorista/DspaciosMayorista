"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { descartarCotizacion } from "../../reservar/actions";

export function DescartarBtn({ id }: { id: number }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [confirmar, setConfirmar] = useState(false);

  function descartar() {
    start(async () => {
      const r = await descartarCotizacion(id);
      if (r.ok) router.refresh();
    });
  }

  if (!confirmar) return <Button variant="outline" disabled={pending} onClick={() => setConfirmar(true)}>Descartar</Button>;
  return (
    <div className="flex items-center gap-2 text-sm">
      <span className="text-gray-500">¿Seguro?</span>
      <Button onClick={descartar} disabled={pending} variant="outline" className="text-red-600">Sí, descartar</Button>
      <button type="button" className="text-xs text-gray-400 hover:text-gray-600" onClick={() => setConfirmar(false)}>Cancelar</button>
    </div>
  );
}
