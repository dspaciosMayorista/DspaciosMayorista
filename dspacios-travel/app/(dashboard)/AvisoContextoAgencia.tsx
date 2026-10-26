import { Info, TriangleAlert } from "lucide-react";

// Aviso del superadmin sobre la agencia vinculada a SU SESIÓN (#5 D8/D9, migración
// 237). La base es la autoridad para escribir catálogos globales: solo Mayorista.
//  - "sin_vinculo": la sesión no tiene agencia vinculada (abierta antes de la 237
//    o contexto invalidado); las escrituras de catálogos quedan denegadas hasta
//    cerrar sesión y volver a ingresar. NO se reinicializa sola.
//  - "minorista": está operando en Minorista; los catálogos globales son de solo lectura.
export function AvisoContextoAgencia({ estado }: { estado: "sin_vinculo" | "minorista" | "ajustada" | "no_verificada" }) {
  const sinVinculo = estado === "sin_vinculo";
  const Icono = sinVinculo || estado === "ajustada" || estado === "no_verificada" ? TriangleAlert : Info;
  return (
    <div
      role="status"
      className="flex items-start gap-2 border-b px-4 py-2 text-xs md:px-6"
      style={{
        backgroundColor: sinVinculo || estado === "no_verificada" ? "rgba(245,158,11,0.12)" : "rgba(38,187,217,0.10)",
        borderColor: sinVinculo || estado === "no_verificada" ? "rgba(245,158,11,0.4)" : "rgba(38,187,217,0.3)",
        color: "var(--foreground)",
      }}
    >
      <Icono className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
      <p>
        {estado === "no_verificada"
          ? "No se pudo verificar la agencia de tu sesión (error al consultarla). La agencia que ves es solo una pista y las operaciones que dependen de ella se rechazan hasta que se verifique: recarga la página; si persiste, cierra sesión y vuelve a ingresar."
          : estado === "ajustada"
          ? "Un cambio de agencia no se completó. Se muestra la agencia que tu sesión tiene autorizada; si no es la que querías, vuelve a elegirla en el selector."
          : sinVinculo
          ? "Tu sesión no tiene una agencia vinculada, así que no puedes editar catálogos globales. Cierra sesión y vuelve a ingresar para habilitarlo."
          : "Estás operando en Minorista: los catálogos globales (destinos, hoteles, proveedores, aliados, asesores, parámetros…) se pueden consultar y usar, pero solo se editan desde Mayorista."}
      </p>
    </div>
  );
}
