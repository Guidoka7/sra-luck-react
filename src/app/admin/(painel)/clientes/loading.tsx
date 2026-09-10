import { Skeleton, SkeletonCards } from "@/components/ui/Skeleton";

export default function CarregandoClientes() {
  return (
    <div className="space-y-6">
      <Skeleton className="h-8 w-48" />
      <Skeleton className="h-16 w-full" />
      <SkeletonCards count={6} />
    </div>
  );
}
