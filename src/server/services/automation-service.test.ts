import { describe, expect, it } from "vitest";
import { automationScheduledFor, renderAutomationTemplate } from "./automation-service";

describe("automações", () => {
  it("agenda confirmação de criação para o mesmo instante", () => {
    const event = new Date("2026-08-23T18:35:12.000Z");
    expect(automationScheduledFor(event, "appointment_created", 0, "00:00", "America/Sao_Paulo")).toEqual(event);
  });
  const event = new Date("2026-09-10T18:00:00.000Z"); // 15h em São Paulo

  it("calcula lembrete antes no fuso da clínica", () => {
    expect(
      automationScheduledFor(event, "before_appointment", 2, "09:30", "America/Sao_Paulo").toISOString(),
    ).toBe("2026-09-08T12:30:00.000Z");
  });

  it("calcula reativação depois da data base", () => {
    expect(
      automationScheduledFor(event, "after_appointment", 21, "10:00", "America/Sao_Paulo").toISOString(),
    ).toBe("2026-10-01T13:00:00.000Z");
  });

  it("calcula mensagem antes do aniversário no fuso da clínica", () => {
    expect(
      automationScheduledFor(event, "birthday_before", 3, "09:00", "America/Sao_Paulo").toISOString(),
    ).toBe("2026-09-07T12:00:00.000Z");
  });

  it("calcula mensagem no dia do aniversário", () => {
    expect(
      automationScheduledFor(event, "birthday_day", 0, "08:15", "America/Sao_Paulo").toISOString(),
    ).toBe("2026-09-10T11:15:00.000Z");
  });

  it("personaliza mensagem e link de reagendamento", () => {
    const message = renderAutomationTemplate(
      "Oi, {nome}! Seu {servico} é às {hora}. {link_agendamento}",
      {
        sourceType: "appointment",
        sourceId: 1,
        customerId: 2,
        customerName: "Maria Silva",
        consentMarketing: true,
        eventAt: event,
        serviceName: "Manicure",
      },
      "America/Sao_Paulo",
      "https://lumina.test/agendar/salao",
    );
    expect(message).toBe("Oi, Maria! Seu Manicure é às 15:00. https://lumina.test/agendar/salao");
  });
});
