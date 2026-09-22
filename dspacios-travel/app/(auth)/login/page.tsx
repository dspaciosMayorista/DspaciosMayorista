import { LoginClient } from "./LoginClient";

// Server Component: decide en el servidor qué controles existen antes de
// mandar nada al cliente. `QUICK_LOGIN_ENABLED` es la única fuente de verdad
// de si el "Acceso de pruebas" debe siquiera poder aparecer — antes esto se
// dibujaba siempre en un componente cliente y solo el ENVÍO fallaba si el
// servidor lo tenía apagado, dejando visible un control que nunca iba a
// funcionar. `loginConCodigo` (./actions.ts) sigue siendo la única autoridad
// real (revalida `QUICK_LOGIN_ENABLED` otra vez del lado del servidor antes
// de aceptar un código) — esta bandera es solo para decidir si el formulario
// aparece, nunca reemplaza esa validación.
export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ inactivo?: string }>;
}) {
  const sp = await searchParams;
  return (
    <LoginClient
      quickLoginEnabled={process.env.QUICK_LOGIN_ENABLED === "1"}
      inactivoInicial={sp.inactivo === "1"}
    />
  );
}
