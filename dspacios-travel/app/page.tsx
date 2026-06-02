import { redirect } from "next/navigation";

// La raíz redirige al tarifario público.
// El middleware redirige /dashboard si no hay sesión → /auth/login
export default function Home() {
  redirect("/tarifario");
}
