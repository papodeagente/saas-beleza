"use client";

import { Trash2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent } from "@/components/ui/sheet";
import { deleteCustomerAction } from "./actions";

/**
 * Excluir cliente, em duas etapas.
 *
 * Um único componente para os dois lugares onde ele aparece: o ícone na linha
 * da lista (`icon`) e o botão na ficha do cliente (`button`, que volta para a
 * lista ao terminar — a ficha que acabou de ser apagada não existe mais).
 *
 * A frase da confirmação já diz o que NÃO acontece, antes de perguntar: as
 * conversas ficam, e quem tem atendimento ou pagamento não é excluído. Quem
 * confirma não é pego de surpresa pela recusa nem acha que apagou o WhatsApp.
 */
export function DeleteCustomerButton({
  customer,
  variant = "icon",
  redirectTo,
}: {
  customer: { id: number; name: string };
  variant?: "icon" | "button";
  redirectTo?: string;
}) {
  const [open, setOpen] = useState(false);

  return (
    <>
      {variant === "icon" ? (
        <Button
          variant="ghost"
          size="sm"
          className="shrink-0 px-2 text-ink-tertiary hover:text-danger"
          aria-label={`Excluir ${customer.name}`}
          onClick={() => setOpen(true)}
        >
          <Trash2 className="size-3.5" />
        </Button>
      ) : (
        <Button variant="ghost" size="md" className="hover:text-danger" onClick={() => setOpen(true)}>
          <Trash2 />
          <span className="hidden sm:inline">Excluir</span>
          <span className="sr-only sm:hidden">Excluir cliente</span>
        </Button>
      )}
      {open ? <DeleteCustomerSheet customer={customer} redirectTo={redirectTo} close={() => setOpen(false)} /> : null}
    </>
  );
}

function DeleteCustomerSheet({
  customer,
  redirectTo,
  close,
}: {
  customer: { id: number; name: string };
  redirectTo?: string;
  close: () => void;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [confirmando, setConfirmando] = useState(false);

  const excluir = () =>
    startTransition(async () => {
      const resultado = await deleteCustomerAction(customer.id);
      if (resultado.ok) {
        toast.success(`${customer.name} foi excluído`);
        if (redirectTo) router.push(redirectTo);
        else router.refresh();
        close();
      } else {
        toast.error(resultado.error);
        close();
      }
    });

  return (
    <Sheet open onOpenChange={(v) => !v && close()}>
      <SheetContent title="Excluir cliente" description={customer.name}>
        <div className="space-y-3 px-5 py-4">
          <p className="text-body text-ink-secondary">
            A ficha, as etiquetas e as anotações do agente sobre {customer.name} somem de vez. As conversas de WhatsApp
            continuam no Atendimento.
          </p>
          <p className="text-body text-ink-secondary">
            Se {customer.name} já tiver <strong className="text-ink">atendimento ou pagamento</strong> registrado, o
            cadastro é mantido, para não apagar o histórico da agenda e do financeiro.
          </p>
          {confirmando ? (
            <div className="flex flex-wrap items-center gap-2">
              <Button variant="danger" size="md" loading={pending} onClick={excluir}>
                Confirmar
              </Button>
              <Button variant="ghost" size="md" onClick={() => setConfirmando(false)}>
                Voltar
              </Button>
            </div>
          ) : (
            <Button variant="danger" size="md" onClick={() => setConfirmando(true)}>
              Excluir cliente
            </Button>
          )}
        </div>
      </SheetContent>
    </Sheet>
  );
}
