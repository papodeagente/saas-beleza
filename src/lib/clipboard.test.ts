import { afterEach, describe, expect, it, vi } from "vitest";
import { copyToClipboard } from "./clipboard";

/**
 * O deploy é servido por HTTP puro, onde `navigator.clipboard` não existe. O
 * botão de copiar falhava calado justamente ali, então o caminho de reserva é
 * o que precisa estar coberto.
 */

function fakeDocument() {
  const element = {
    value: "",
    style: {} as Record<string, string>,
    setAttribute: vi.fn(),
    select: vi.fn(),
    setSelectionRange: vi.fn(),
  };
  const document = {
    createElement: vi.fn(() => element),
    body: { appendChild: vi.fn(), removeChild: vi.fn() },
    getSelection: vi.fn(() => null),
    execCommand: vi.fn(() => true),
  };
  return { document, element };
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("copyToClipboard", () => {
  it("usa o caminho antigo quando o navegador não expõe a área de transferência", async () => {
    const { document, element } = fakeDocument();
    vi.stubGlobal("navigator", {});
    vi.stubGlobal("window", { isSecureContext: false });
    vi.stubGlobal("document", document);

    const copied = await copyToClipboard("https://exemplo.test/webhook/abc");

    expect(copied).toBe(true);
    expect(element.value).toBe("https://exemplo.test/webhook/abc");
    expect(document.execCommand).toHaveBeenCalledWith("copy");
    // O campo temporário não pode ficar na página depois da cópia.
    expect(document.body.removeChild).toHaveBeenCalled();
  });

  it("prefere a área de transferência moderna quando ela existe", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    const { document } = fakeDocument();
    vi.stubGlobal("navigator", { clipboard: { writeText } });
    vi.stubGlobal("window", { isSecureContext: true });
    vi.stubGlobal("document", document);

    expect(await copyToClipboard("texto")).toBe(true);
    expect(writeText).toHaveBeenCalledWith("texto");
    expect(document.execCommand).not.toHaveBeenCalled();
  });

  it("cai para o caminho antigo quando a área de transferência moderna recusa", async () => {
    const writeText = vi.fn().mockRejectedValue(new Error("NotAllowedError"));
    const { document } = fakeDocument();
    vi.stubGlobal("navigator", { clipboard: { writeText } });
    vi.stubGlobal("window", { isSecureContext: true });
    vi.stubGlobal("document", document);

    expect(await copyToClipboard("texto")).toBe(true);
    expect(document.execCommand).toHaveBeenCalledWith("copy");
  });

  it("avisa quando nem o caminho antigo funciona, para a tela poder oferecer a cópia manual", async () => {
    const { document } = fakeDocument();
    document.execCommand = vi.fn(() => false);
    vi.stubGlobal("navigator", {});
    vi.stubGlobal("window", { isSecureContext: false });
    vi.stubGlobal("document", document);

    expect(await copyToClipboard("texto")).toBe(false);
  });

  it("não tenta copiar texto vazio", async () => {
    const { document } = fakeDocument();
    vi.stubGlobal("document", document);
    expect(await copyToClipboard("")).toBe(false);
    expect(document.createElement).not.toHaveBeenCalled();
  });
});
