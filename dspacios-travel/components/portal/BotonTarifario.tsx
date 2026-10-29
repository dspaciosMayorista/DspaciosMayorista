import Link from "next/link";
import { Compass } from "lucide-react";
import s from "./vidrio.module.css";

/** Acción principal del encabezado en las páginas interiores (el inicio dibuja la suya). */
export function BotonTarifario() {
  return (
    <Link href="/tarifario" className={s.cta}>
      <Compass aria-hidden size={18} /> Explora el tarifario y cotiza
    </Link>
  );
}
