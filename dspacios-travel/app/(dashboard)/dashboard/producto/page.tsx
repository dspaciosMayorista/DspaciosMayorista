export const dynamic = "force-dynamic";

export default function ProductoPage() {
  return (
    <div className="mx-auto max-w-4xl p-4 md:p-8">
      <h1 className="text-2xl font-semibold text-gray-900">Producto</h1>
      <p className="mt-1 text-sm text-gray-500">
        Módulo para montar el producto: hoteles, temporadas y tarifas.
      </p>

      <div className="mt-8 rounded-2xl border-2 border-dashed border-gray-200 p-10 text-center text-gray-400">
        <p className="text-lg">Módulo en construcción</p>
        <p className="mt-1 text-sm">
          Lo estamos armando a la medida según tu flujo de trabajo.
        </p>
      </div>
    </div>
  );
}
