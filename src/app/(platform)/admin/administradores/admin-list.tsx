"use client";

import { FUSO_DA_PLATAFORMA, formatTz } from "@/lib/tz";
import { Plus, ShieldOff } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { toast } from "sonner";
import { Avatar } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Field, Input } from "@/components/ui/input";
import { grantAction, revokeAction } from "./actions";

type Admin = {
  userId: number;
  name: string;
  email: string;
  grantedAtISO: string;
  grantedByName: string | null;
  clinics: string[];
};

export function AdminList({
  admins,
  currentUserId,
}: {
  admins: Admin[];
  currentUserId: number;
}) {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [erro, setErro] = useState<string | null>(null);
  const [confirmando, setConfirmando] = useState<number | null>(null);
  const [pending, startTransition] = useTransition();

  const ultimo = admins.length <= 1;

  function conceder() {
    setErro(null);
    startTransition(async () => {
      const resultado = await grantAction({ email });
      if (resultado.ok) {
        toast.success(resultado.message);
        setEmail("");
        router.refresh();
      } else {
        setErro(resultado.error);
      }
    });
  }

  function revogar(userId: number) {
    startTransition(async () => {
      const resultado = await revokeAction({ userId });
      if (resultado.ok) {
        toast.success(resultado.message);
        setConfirmando(null);
        router.refresh();
      } else {
        toast.error(resultado.error);
        setConfirmando(null);
      }
    });
  }

  return (
    <>
      <section>
        <h2 className="text-section">Dar acesso a alguém</h2>
        <Card className="mt-3 px-5 py-4">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
            <div className="flex-1">
              <Field
                label="E-mail da pessoa"
                htmlFor="email-admin"
                error={erro ?? undefined}
                hint="A pessoa precisa já ter conta no sistema. Este campo não cria usuário."
              >
                <Input
                  id="email-admin"
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="pessoa@empresa.com.br"
                  aria-invalid={erro ? true : undefined}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && email.trim()) conceder();
                  }}
                />
              </Field>
            </div>
            <Button
              variant="primary"
              size="md"
              loading={pending && confirmando === null}
              disabled={!email.trim()}
              onClick={conceder}
            >
              <Plus />
              Dar acesso
            </Button>
          </div>
        </Card>
      </section>

      <section>
        <h2 className="text-section">Com acesso hoje</h2>
        <Card className="mt-3">
          <ul className="divide-y divide-line">
            {admins.map((admin) => {
              const souEu = admin.userId === currentUserId;
              const emConfirmacao = confirmando === admin.userId;

              return (
                <li key={admin.userId} className="flex flex-wrap items-center gap-3 px-5 py-3.5">
                  <Avatar name={admin.name} size="md" />

                  <div className="min-w-0 flex-1">
                    <p className="flex flex-wrap items-center gap-1.5">
                      <span className="truncate text-label text-ink">{admin.name}</span>
                      {souEu ? <Badge tone="accent">Você</Badge> : null}
                    </p>
                    <p className="truncate text-caption text-ink-secondary">{admin.email}</p>
                    <p className="mt-0.5 text-meta text-ink-tertiary">
                      Desde{" "}
                      {formatTz(new Date(admin.grantedAtISO), FUSO_DA_PLATAFORMA, "d 'de' MMM 'de' yyyy")}
                      {admin.grantedByName ? ` · concedido por ${admin.grantedByName}` : ""}
                      {admin.clinics.length > 0 ? ` · também em ${admin.clinics.join(", ")}` : ""}
                    </p>
                  </div>

                  {/* Nem o próprio acesso nem o último podem ser removidos: os
                      dois casos deixariam alguém (ou todos) trancado do lado de
                      fora, sem caminho de volta pela interface. */}
                  {souEu ? (
                    <span className="text-caption text-ink-tertiary">
                      Outra pessoa precisa remover o seu
                    </span>
                  ) : ultimo ? (
                    <span className="text-caption text-ink-tertiary">Último acesso</span>
                  ) : emConfirmacao ? (
                    <span className="flex items-center gap-2">
                      <span className="text-caption text-danger">
                        Remover o acesso de {admin.name.split(" ")[0]}?
                      </span>
                      <Button
                        variant="danger"
                        size="sm"
                        loading={pending}
                        onClick={() => revogar(admin.userId)}
                      >
                        Remover
                      </Button>
                      <Button variant="ghost" size="sm" onClick={() => setConfirmando(null)}>
                        Cancelar
                      </Button>
                    </span>
                  ) : (
                    <Button variant="ghost" size="sm" onClick={() => setConfirmando(admin.userId)}>
                      <ShieldOff />
                      Remover acesso
                    </Button>
                  )}
                </li>
              );
            })}
          </ul>
        </Card>
      </section>
    </>
  );
}
