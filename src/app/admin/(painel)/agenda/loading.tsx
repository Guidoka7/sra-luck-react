import { Skeleton } from "@/components/ui/Skeleton";

export default function CarregandoAgenda() {
  return (
    <div className="space-y-6">
      <Skeleton className="h-8 w-48" />
      <Skeleton className="h-96 w-full" />
    </div>
  );
}
