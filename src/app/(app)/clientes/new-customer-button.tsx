"use client";

import { Plus } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { CustomerForm, type CustomerFormOptions } from "./customer-form";

export function NewCustomerButton({
  options,
  label = "Novo cliente",
}: {
  options: CustomerFormOptions;
  label?: string;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);

  return (
    <>
      <Button variant="primary" size="md" onClick={() => setOpen(true)}>
        <Plus />
        {label}
      </Button>
      {open ? (
        <CustomerForm
          options={options}
          onClose={() => setOpen(false)}
          onSaved={(id) => router.push(`/clientes/${id}`)}
        />
      ) : null}
    </>
  );
}
