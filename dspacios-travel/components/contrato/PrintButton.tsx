"use client";

import { Button } from "@/components/ui/button";

export function PrintButton() {
  return (
    <Button onClick={() => window.print()} style={{ backgroundColor: "var(--brand-primary)" }}>
      Imprimir / Guardar PDF
    </Button>
  );
}
