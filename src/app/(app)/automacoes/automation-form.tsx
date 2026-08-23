"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Field, Input, Textarea } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { createAutomationAction } from "./actions";

const PRESETS = {
  before_appointment: {
    name: "Lembrete para evitar faltas",
    days: 1,
    message:
      "Oi, {nome}! Passando para lembrar do seu horário de {servico} amanhã, às {hora}, com {profissional}. Podemos confirmar sua presença?",
  },
  appointment_day: {
    name: "Lembrete no dia",
    days: 0,
    message:
      "Bom dia, {nome}! Hoje é dia do seu {servico} ✨ Seu horário é às {hora}, com {profissional}. Te esperamos!",
  },
  after_appointment: {
    name: "Convite para agendar novamente",
    days: 21,
    message:
      "Oi, {nome}! Já está chegando a hora de renovar seu {servico}. Quer garantir o melhor horário? Agende aqui: {link_agendamento}",
  },
  after_purchase: {
    name: "Reativação após a última compra",
    days: 30,
    message:
      "Oi, {nome}! Sentimos sua falta por aqui 💛 Que tal reservar seu próximo cuidado? Escolha o melhor horário: {link_agendamento}",
  },
} as const;

type Trigger = keyof typeof PRESETS;

export function AutomationForm() {
  const [trigger, setTrigger] = useState<Trigger>("before_appointment");
  const preset = PRESETS[trigger];
  // A chave recria os campos quando o gatilho muda, aplicando o modelo sugerido.
  return (
    <form action={createAutomationAction} className="space-y-4">
      <Field label="Quando enviar" htmlFor="trigger">
        <Select id="trigger" name="trigger" value={trigger} onChange={(event) => setTrigger(event.target.value as Trigger)}>
          <option value="before_appointment">X dias antes do agendamento</option>
          <option value="appointment_day">No dia do agendamento</option>
          <option value="after_appointment">X dias depois do atendimento</option>
          <option value="after_purchase">X dias depois da última compra confirmada</option>
        </Select>
      </Field>

      <div key={trigger} className="grid gap-4 sm:grid-cols-[1fr_120px_130px]">
        <Field label="Nome da automação" htmlFor="name">
          <Input id="name" name="name" defaultValue={preset.name} required maxLength={80} />
        </Field>
        <Field label={trigger === "appointment_day" ? "No mesmo dia" : "Após quantos dias"} htmlFor="daysOffset">
          <Input id="daysOffset" name="daysOffset" type="number" min={0} max={365} defaultValue={preset.days} disabled={trigger === "appointment_day"} required />
          {trigger === "appointment_day" ? <input type="hidden" name="daysOffset" value="0" /> : null}
        </Field>
        <Field label="Horário" htmlFor="sendTime">
          <Input id="sendTime" name="sendTime" type="time" defaultValue="09:00" required />
        </Field>
      </div>

      <div key={`${trigger}-message`}>
        <Field
          label="Mensagem no WhatsApp"
          htmlFor="messageTemplate"
          hint="Use: {nome}, {servico}, {profissional}, {data}, {hora} e {link_agendamento}."
        >
          <Textarea id="messageTemplate" name="messageTemplate" rows={4} defaultValue={preset.message} required maxLength={1500} />
        </Field>
      </div>
      <div className="flex justify-end">
        <Button type="submit">Criar automação</Button>
      </div>
    </form>
  );
}

