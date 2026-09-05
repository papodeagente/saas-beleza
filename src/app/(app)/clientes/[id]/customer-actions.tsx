"use client";

import { CalendarPlus, Pencil, Printer } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { CustomerForm, type CustomerFormOptions, type CustomerFormValues } from "../customer-form";

export function CustomerActions({
  customer,
  options,
}: {
  customer: CustomerFormValues & { id: number };
  options: CustomerFormOptions;
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
