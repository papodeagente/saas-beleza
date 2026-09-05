"use client";

import { useActionState, useState } from "react";
import { Button } from "@/components/ui/button";
import { Field, Input, Textarea } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { createAutomationAction } from "./actions";

const PRESETS = {
  appointment_created: {
    name: "Confirmação imediata do agendamento",
    days: 0,
    message:
      "Oi, {nome}! Seu agendamento de {servico} foi realizado com sucesso ✨ Dia {data}, às {hora}, com {profissional}. Esperamos você!",
  },
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
  birthday_before: {
    name: "Carinho antes do aniversário",
    days: 3,
    message:
      "Oi, {nome}! Seu aniversário está chegando 🎉 Que tal reservar um momento especial para você? Escolha seu horário: {link_agendamento}",
  },
  birthday_day: {
    name: "Mensagem no dia do aniversário",
    days: 0,
    message:
      "Feliz aniversário, {nome}! 🎉 Desejamos um novo ciclo lindo e cheio de motivos para celebrar. Será um prazer cuidar de você 💜",
  },
} as const;

type Trigger = keyof typeof PRESETS;

export function AutomationForm() {
  const [trigger, setTrigger] = useState<Trigger>("appointment_created");
  const [state, formAction, pending] = useActionState(createAutomationAction, { ok: false, message: "" });
  const preset = PRESETS[trigger];
  // A chave recria os campos quando o gatilho muda, aplicando o modelo sugerido.
  return (
    <form action={formAction} className="space-y-4">
      <Field label="Quando enviar" htmlFor="trigger">
        <Select id="trigger" name="trigger" value={trigger} onChange={(event) => setTrigger(event.target.value as Trigger)}>
          <option value="appointment_created">Assim que o agendamento for criado</option>
          <option value="before_appointment">X dias antes do agendamento</option>
          <option value="appointment_day">No dia do agendamento</option>
          <option value="after_appointment">X dias depois do atendimento</option>
          <option value="after_purchase">X dias depois da última compra confirmada</option>
          <option value="birthday_before">X dias antes do aniversário</option>
          <option value="birthday_day">No dia do aniversário</option>
        </Select>
      </Field>

      <div key={trigger} className={trigger === "appointment_created" ? "grid gap-4" : "grid gap-4 sm:grid-cols-[1fr_120px_130px]"}>
        <Field label="Nome da automação" htmlFor="name">
          <Input id="name" name="name" defaultValue={preset.name} required maxLength={80} />
        </Field>
        {trigger === "appointment_created" ? (
          <>
            <input type="hidden" name="daysOffset" value="0" />
            <input type="hidden" name="sendTime" value="00:00" />
          </>
        ) : (
          <>
            <Field
              label={
                trigger === "appointment_day" || trigger === "birthday_day"
                  ? "No mesmo dia"
                  : trigger === "before_appointment" || trigger === "birthday_before"
                    ? "Quantos dias antes"
                    : "Após quantos dias"
              }
              htmlFor="daysOffset"
            >
              <Input id="daysOffset" name="daysOffset" type="number" min={0} max={365} defaultValue={preset.days} disabled={trigger === "appointment_day" || trigger === "birthday_day"} required />
              {trigger === "appointment_day" || trigger === "birthday_day" ? <input type="hidden" name="daysOffset" value="0" /> : null}
            </Field>
            <Field label="Horário" htmlFor="sendTime">
              <Input id="sendTime" name="sendTime" type="time" defaultValue="09:00" required />
            </Field>
          </>
        )}
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
      {state.message ? (
        <p role="status" className={state.ok ? "text-caption text-positive" : "text-caption text-danger"}>
          {state.message}
        </p>
      ) : null}
      <div className="flex justify-end">
        <Button variant="primary" type="submit" loading={pending}>Criar automação</Button>
      </div>
    </form>
  );
}
