"use client";

import { CalendarPlus, Pencil, Printer } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { CustomerForm, type CustomerFormOptions, type CustomerFormValues } from "../customer-form";
import { DeleteCustomerButton } from "../delete-customer-button";

export function CustomerActions({
  customer,
  options,
  canDelete,
}: {
  customer: CustomerFormValues & { id: number };
  options: CustomerFormOptions;
  canDelete: boolean;
}) {
  const [editing, setEditing] = useState(false);

  return (
    <>
      <div className="flex items-center gap-2" data-print="hide">
        <Button
          variant="ghost"
          size="md"
          onClick={() => window.print()}
          aria-label="Imprimir ficha do cliente"
        >
          <Printer />
          <span className="hidden sm:inline">Imprimir</span>
        </Button>
        {canDelete ? (
          <DeleteCustomerButton
            customer={{ id: customer.id, name: customer.name }}
            variant="button"
            redirectTo="/clientes"
          />
        ) : null}
        <Button variant="secondary" size="md" onClick={() => setEditing(true)}>
          <Pencil />
          Editar
        </Button>
        <Button variant="primary" size="md" asChild>
          <Link href="/agenda">
            <CalendarPlus />
            Agendar
          </Link>
        </Button>
      </div>

      {editing ? (
        <CustomerForm initial={customer} options={options} onClose={() => setEditing(false)} />
      ) : null}
    </>
  );
}
