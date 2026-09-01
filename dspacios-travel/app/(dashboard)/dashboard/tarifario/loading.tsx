export default function CargandoTarifarioInterno() {
  return (
    <div className="mx-auto max-w-[1700px] p-4 md:p-6">
      <div className="mb-4 h-10 w-64 animate-pulse rounded-lg bg-gray-100" />
      <div className="space-y-3">
        {Array.from({ length: 8 }).map((_, i) => (
          <div key={i} className="h-14 animate-pulse rounded-lg bg-gray-100" />
        ))}
      </div>
    </div>
  );
}
