"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { convertirCotizacionManualAContrato } from "../manual-actions";

export function ConvertirManualBtn({ id }: { id: number }) {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleClick() {
    setLoading(true);
    setError(null);
    const res = await convertirCotizacionManualAContrato(id);
    if (res.ok) {
      router.push(`/dashboard/contratos/${encodeURIComponent(res.numero)}`);
    } else {
      setError(res.error);
      setLoading(false);
    }
  }

  return (
    <div className="flex flex-col items-end gap-1">
      <Button onClick={handleClick} disabled={loading} style={{ backgroundColor: "var(--brand-primary)" }}>
        {loading ? "Generando contrato…" : "Generar contrato →"}
      </Button>
      {error && <p className="text-xs text-red-500">{error}</p>}
    </div>
  );
}
