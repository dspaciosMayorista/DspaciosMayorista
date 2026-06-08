import { CartProvider } from "@/lib/cart/CartContext";

// El carrito del tarifario dinámico vive aquí para compartirse entre la vitrina
// (/tarifario) y el checkout (/tarifario/checkout), persistido en localStorage.
export default function TarifarioLayout({ children }: { children: React.ReactNode }) {
  return <CartProvider>{children}</CartProvider>;
}
