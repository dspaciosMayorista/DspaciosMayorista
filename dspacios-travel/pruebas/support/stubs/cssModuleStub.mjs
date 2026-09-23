// Stub de imports "*.css" (módulos CSS) para pruebas de interacción React
// (ver pruebas/support/reactLoader.mjs) — CSS no es un módulo ESM válido
// para Node. Los componentes reales solo leen `styles.<clase>` como texto
// para el atributo `className`; un Proxy que devuelve el nombre de la
// propiedad alcanza para que la interacción real (fuera de estilos/
// animaciones, que no se ejecutan en jsdom) se pruebe sin cambios. Se agregó
// junto con `components/LoadingScreen.tsx` (el primer componente de
// producción que estas pruebas de interacción montan con un import de CSS
// module — `BuscadorBooking`/`BuscadorReceptivos`/`SidebarNav` ninguno lo
// tenía antes).
const handler = { get: (_target, prop) => String(prop) };
const cssModuleProxy = new Proxy({}, handler);
export default cssModuleProxy;
