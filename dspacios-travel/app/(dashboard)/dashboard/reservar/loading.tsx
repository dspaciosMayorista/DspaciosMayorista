export default function CargandoReservar() {
  return (
    <div className="mx-auto max-w-6xl p-4 md:p-8">
      <div className="mb-6 h-16 animate-pulse rounded-lg bg-gray-100" />
      <div className="space-y-3">
        {Array.from({ length: 8 }).map((_, i) => (
          <div key={i} className="h-14 animate-pulse rounded-lg bg-gray-100" />
        ))}
      </div>
    </div>
  );
}
