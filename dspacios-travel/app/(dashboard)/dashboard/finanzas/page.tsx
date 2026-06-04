import { redirect } from "next/navigation";

// La relación de utilidades vive ahora en el módulo Rentabilidad.
export default function FinanzasPage() {
  redirect("/dashboard/rentabilidad");
}
