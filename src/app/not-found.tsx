import Link from "next/link";
import { Button } from "@/components/ui/button";

export default function NotFound() {
  return (
    <div className="flex min-h-dvh items-center justify-center px-6">
      <div className="max-w-[40ch] text-center">
        <h1 className="font-display text-[22px] leading-8 text-ink">Não encontramos esta página</h1>
        <p className="mt-2 text-body text-ink-secondary">
          O endereço pode ter mudado, ou o registro que você procura foi removido.
        </p>
        <div className="mt-6">
          <Button variant="primary" size="md" asChild>
            <Link href="/hoje">Voltar para Hoje</Link>
          </Button>
        </div>
      </div>
    </div>
  );
}
