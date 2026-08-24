import { describe, expect, it } from "vitest";
import { recipientId } from "./uazapi-client";

describe("destinatário uazapi", () => {
  it("remove apenas o sufixo do contato telefônico tradicional", () => {
    expect(recipientId("5511999999999@s.whatsapp.net")).toBe("5511999999999");
  });

  it("preserva os JIDs que a API exige completos", () => {
    expect(recipientId("120363000000000000@g.us")).toBe("120363000000000000@g.us");
    expect(recipientId("192837465738291@lid")).toBe("192837465738291@lid");
    expect(recipientId("canal@newsletter")).toBe("canal@newsletter");
  });
});
