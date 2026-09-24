import { describe, expect, it } from "vitest";
import {
  decisaoDoEvento,
  meioDePagamento,
  valorDaReserva,
} from "./booking-payment-service";

describe("valor da reserva", () => {
  it("arredonda o sinal para cima", () => {
    // 50% de R$ 79,90 = R$ 39,95. Centavo quebrado em cobrança é confusão na
    // conciliação, então sobe para o centavo seguinte.
    expect(valorDaReserva(7990, 50)).toBe(3995);
    expect(valorDaReserva(7991, 50)).toBe(3996);
  });

  it("respeita o piso de R$ 5,00 do Asaas", () => {
    // Sem o piso, o link nem seria criado: o Asaas recusa cobrança menor, e a
    // cliente veria erro depois de escolher o horário.
    expect(valorDaReserva(1000, 30)).toBe(500);
    expect(valorDaReserva(600, 10)).toBe(500);
  });

  it("nunca cobra mais que o serviço", () => {
    // O piso não pode passar por cima do preço: serviço de R$ 3,00 cobra R$ 3,00.
    expect(valorDaReserva(300, 100)).toBe(300);
    expect(valorDaReserva(300, 50)).toBe(300);
  });

  it("cobra o valor cheio em 100%", () => {
    expect(valorDaReserva(12000, 100)).toBe(12000);
  });
});

describe("eventos do Asaas", () => {
  it("confirma no pagamento confirmado e no recebido", () => {
    // São o MESMO pagamento chegando duas vezes; as duas formas confirmam, e a
    // idempotência de confirmarPagamento é que evita lançamento dobrado.
    expect(decisaoDoEvento("PAYMENT_CONFIRMED")).toBe("confirmar");
    expect(decisaoDoEvento("PAYMENT_RECEIVED")).toBe("confirmar");
  });

  it("estorna em devolução e contestação", () => {
    expect(decisaoDoEvento("PAYMENT_REFUNDED")).toBe("estornar");
    expect(decisaoDoEvento("PAYMENT_CHARGEBACK_REQUESTED")).toBe("estornar");
    expect(decisaoDoEvento("PAYMENT_CHARGEBACK_DISPUTE")).toBe("estornar");
  });

  it("não derruba reserva por vencimento do Asaas", () => {
    // O vencimento do boleto é muito mais longo que o nosso prazo de reserva.
    // Tratar OVERDUE como queda cancelaria horário que ainda podia ser pago.
    expect(decisaoDoEvento("PAYMENT_OVERDUE")).toBe("ignorar");
  });

  it("ignora evento desconhecido em vez de agir por engano", () => {
    expect(decisaoDoEvento("PAYMENT_CREATED")).toBe("ignorar");
    expect(decisaoDoEvento("")).toBe("ignorar");
  });
});

describe("meio de pagamento", () => {
  it("traduz o billingType do Asaas para o caixa da clínica", () => {
    expect(meioDePagamento("PIX")).toBe("pix");
    expect(meioDePagamento("CREDIT_CARD")).toBe("cartao_credito");
    expect(meioDePagamento("DEBIT_CARD")).toBe("cartao_debito");
    expect(meioDePagamento("BOLETO")).toBe("outro");
    expect(meioDePagamento(null)).toBe("outro");
  });
});
