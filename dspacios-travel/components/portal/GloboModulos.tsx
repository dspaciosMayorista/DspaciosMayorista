import Image from "next/image";
import Link from "next/link";
import { ClipboardList, FileText, ReceiptText, Wallet } from "lucide-react";
import s from "./vidrio.module.css";

const ICONO = { size: 26, strokeWidth: 2.1, "aria-hidden": true } as const;

/** Isotipo de la marca (pieza central) y los cuatro módulos en las esquinas. */
export function GloboModulos() {
  const modulos = [
    { href: "/portal/b2b/cotizaciones", etiqueta: "Cotizaciones", pos: s.mTL, tono: s.mNaranja, icono: <ClipboardList {...ICONO} /> },
    { href: "/portal/b2b/ventas", etiqueta: "Mis ventas", pos: s.mTR, tono: s.mAzul, icono: <ReceiptText {...ICONO} /> },
    { href: "/portal/b2b/cartera", etiqueta: "Cartera", pos: s.mBL, tono: s.mVerde, icono: <Wallet {...ICONO} /> },
    { href: "/portal/b2b/documentos", etiqueta: "Documentos", pos: s.mBR, tono: s.mMorado, icono: <FileText {...ICONO} /> },
  ];
  return (
    <nav aria-label="Módulos principales" className={s.globo}>
      {/* Pieza central: el isotipo oficial (public/marca/isotipo-white.png: figura blanca, fondo transparente), sin recuadro. El resplandor es solo un
          degradado suave detrás —no una pieza con borde— para que el blanco se lea sobre el fondo claro del portal. */}
      <span aria-hidden="true" className={s.globoHalo} />
      <Image src="/marca/isotipo-white.png" alt="" width={384} height={384} priority aria-hidden="true" className={s.globoIso} />

      {modulos.map((m) => (
        <Link key={m.href} href={m.href} className={`${s.modulo} ${m.pos} ${m.tono}`}>
          <span aria-hidden="true" className={s.moduloIcono}>{m.icono}</span>
          {m.etiqueta}
        </Link>
      ))}
    </nav>
  );
}
