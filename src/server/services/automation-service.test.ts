import { describe, expect, it } from "vitest";
import { automationScheduledFor, renderAutomationTemplate } from "./automation-service";

describe("automações", () => {
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
