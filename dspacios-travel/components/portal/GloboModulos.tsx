import Link from "next/link";
import { ClipboardList, FileText, ReceiptText, Wallet } from "lucide-react";
import s from "./vidrio.module.css";

const PUNTOS = [[140, 140], [150, 150], [160, 145], [148, 162], [158, 172], [165, 190], [160, 205], [168, 218], [205, 135], [215, 142], [225, 150], [232, 165], [220, 175], [228, 195], [240, 210]];
const ICONO = { size: 26, strokeWidth: 2.1, "aria-hidden": true } as const;

/** Globo con órbitas (pieza central) y los cuatro módulos en las esquinas, como la referencia. */
export function GloboModulos() {
  const modulos = [
    { href: "/portal/b2b/cotizaciones", etiqueta: "Cotizaciones", pos: s.mTL, tono: s.mNaranja, icono: <ClipboardList {...ICONO} /> },
    { href: "/portal/b2b/ventas", etiqueta: "Mis ventas", pos: s.mTR, tono: s.mAzul, icono: <ReceiptText {...ICONO} /> },
    { href: "/portal/b2b/cartera", etiqueta: "Cartera", pos: s.mBL, tono: s.mVerde, icono: <Wallet {...ICONO} /> },
    { href: "/portal/b2b/documentos", etiqueta: "Documentos", pos: s.mBR, tono: s.mMorado, icono: <FileText {...ICONO} /> },
  ];
  return (
    <nav aria-label="Módulos principales" className={s.globo}>
      <svg viewBox="0 0 360 360" width="100%" height="100%" aria-hidden="true" className={s.globoSvg}>
        <defs>
          <radialGradient id="g-globe" cx="38%" cy="32%" r="75%">
            <stop offset="0%" stopColor="#7FE6F0" /><stop offset="45%" stopColor="#1E9BC2" /><stop offset="100%" stopColor="#0B3C63" />
          </radialGradient>
          <radialGradient id="g-halo" cx="50%" cy="50%" r="50%">
            <stop offset="60%" stopColor="#7FE6F0" stopOpacity="0.45" /><stop offset="100%" stopColor="#7FE6F0" stopOpacity="0" />
          </radialGradient>
        </defs>
        <circle cx="180" cy="180" r="150" fill="url(#g-halo)" />
        <circle cx="180" cy="180" r="104" fill="url(#g-globe)" />
        <g fill="none" stroke="#BFF6FA" strokeOpacity="0.5" strokeWidth="1">
          <ellipse cx="180" cy="180" rx="104" ry="36" /><ellipse cx="180" cy="180" rx="104" ry="72" />
          <ellipse cx="180" cy="180" rx="36" ry="104" /><ellipse cx="180" cy="180" rx="72" ry="104" />
          <line x1="180" y1="76" x2="180" y2="284" /><line x1="76" y1="180" x2="284" y2="180" />
        </g>
        <g fill="#E8FDFF" fillOpacity="0.75">{PUNTOS.map(([x, y]) => <circle key={`${x}-${y}`} cx={x} cy={y} r="2.2" />)}</g>
        <g fill="none" stroke="#FFFFFF" strokeWidth="1.5" strokeOpacity="0.85">
          <ellipse cx="180" cy="180" rx="150" ry="52" transform="rotate(-18 180 180)" />
          <ellipse cx="180" cy="180" rx="138" ry="40" transform="rotate(24 180 180)" strokeDasharray="4 6" />
        </g>
        <circle cx="44" cy="214" r="5" fill="#FFB547" /><circle cx="318" cy="132" r="5" fill="#33D1A6" /><circle cx="296" cy="244" r="4" fill="#FFFFFF" />
        <path d="M158 166 Q 190 110 226 150" fill="none" stroke="#FFD27A" strokeWidth="2" strokeLinecap="round" />
        <circle cx="158" cy="166" r="4" fill="#FFD27A" /><circle cx="226" cy="150" r="4" fill="#FFD27A" />
      </svg>
      {modulos.map((m) => (
        <Link key={m.href} href={m.href} className={`${s.modulo} ${m.pos} ${m.tono}`}>
          <span aria-hidden="true" className={s.moduloIcono}>{m.icono}</span>
          {m.etiqueta}
        </Link>
      ))}
    </nav>
  );
}
