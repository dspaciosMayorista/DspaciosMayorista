"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";

export function ShareButtons({
  token,
  numero,
  cliente,
}: {
  token: string;
  numero: string;
  cliente: string;
}) {
  const [copiado, setCopiado] = useState(false);

  function url() {
    if (typeof window === "undefined") return "";
    return `${window.location.origin}/c/${token}`;
  }

  const mensaje = `Hola${cliente ? ` ${cliente}` : ""}, aquí puedes ver tu contrato ${numero} con D'spacios Travel: `;

  function whatsapp() {
    window.open(
      `https://wa.me/?text=${encodeURIComponent(mensaje + url())}`,
      "_blank"
    );
  }

  function correo() {
    const subject = `Contrato ${numero} — D'spacios Travel`;
    const body = `${mensaje}\n${url()}`;
    window.location.href = `mailto:?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
  }

  async function copiar() {
    try {
      await navigator.clipboard.writeText(url());
      setCopiado(true);
      setTimeout(() => setCopiado(false), 2000);
    } catch {
      // Si el navegador bloquea el portapapeles, mostramos el link para copiar a mano
      prompt("Copia el enlace del contrato:", url());
    }
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
      <Button
        type="button"
        onClick={whatsapp}
        style={{ backgroundColor: "var(--brand-success)" }}
      >
        Compartir por WhatsApp
      </Button>
      <Button type="button" variant="outline" onClick={correo}>
        Enviar por correo
      </Button>
      <Button type="button" variant="outline" onClick={copiar}>
        {copiado ? "¡Enlace copiado!" : "Copiar enlace"}
      </Button>
    </div>
  );
}
