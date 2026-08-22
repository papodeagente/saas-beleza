import { Skeleton } from "@/components/ui/skeleton";

/**
 * Silhueta genérica do módulo. Rotas com layout próprio (agenda, inbox)
 * declaram o seu; esta cobre as telas de cabeçalho + lista.
 */
export default function Loading() {
  return (
    <div>
      <div className="border-b border-line">
        <div className="flex min-h-[60px] w-full max-w-[1180px] items-center justify-between gap-3 px-5 py-3 md:px-8">
          <div className="space-y-1.5">
            <Skeleton className="h-5 w-40" />
            <Skeleton className="h-3 w-24" />
          </div>
          <Skeleton className="h-9 w-32" />
        </div>
      </div>
      <div className="w-full max-w-[1180px] px-5 py-6 md:px-8 md:py-8">
        <div className="grid grid-cols-2 gap-px overflow-hidden rounded-card border border-line bg-line sm:grid-cols-4">
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="space-y-2 bg-surface-raised px-4 py-3.5">
              <Skeleton className="h-3 w-20" />
              <Skeleton className="h-6 w-24" />
            </div>
          ))}
        </div>
        <div className="mt-8 space-y-2">
          <Skeleton className="h-3 w-32" />
          <div className="divide-y divide-line overflow-hidden rounded-card border border-line bg-surface-raised">
            {Array.from({ length: 8 }).map((_, i) => (
              <div key={i} className="flex items-center gap-3 px-4 py-3">
                <Skeleton className="size-8 rounded-full" />
                <div className="flex-1 space-y-1.5">
                  <Skeleton className="h-3.5 w-48" />
                  <Skeleton className="h-3 w-32" />
                </div>
                <Skeleton className="h-5 w-20" />
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
