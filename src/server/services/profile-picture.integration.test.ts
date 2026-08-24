import { generateAccountCode } from "@/lib/account-code";
import { eq, inArray, like } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { db, pool } from "@/db";
import * as s from "@/db/schema";
import { getPictureBytes, whichHavePictures } from "./profile-picture-service";

/**
 * A invariante que importa aqui: a foto de um contato é dado de UMA clínica.
 *
 * A rota que serve a imagem recebe o JID pela URL, e JID é público — está no
 * número de telefone. Se a leitura não filtrasse por organização, bastaria
 * conhecer o telefone de alguém para ver a foto de perfil que a concorrente
 * guardou. Por isso o teste tenta explicitamente ler atravessado.
 */

const SUFFIX = "vitest-foto";
const JID_A = "5511900000001@s.whatsapp.net";
const JID_B = "5511900000002@s.whatsapp.net";
/** JPEG mínimo válido, só para termos bytes reais em vez de texto qualquer. */
const PIXEL = Buffer.from(
  "/9j/4AAQSkZJRgABAQEAYABgAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0aHBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/2wBDAQkJCQwLDBgNDRgyIRwhMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjL/wAARCAABAAEDASIAAhEBAxEB/8QAHwAAAQUBAQEBAQEAAAAAAAAAAAECAwQFBgcICQoL/8QAtRAAAgEDAwIEAwUFBAQAAAF9AQIDAAQRBRIhMUEGE1FhByJxFDKBkaEII0KxwRVS0fAkM2JyggkKFhcYGRolJicoKSo0NTY3ODk6Q0RFRkdISUpTVFVWV1hZWmNkZWZnaGlqc3R1dnd4eXqDhIWGh4iJipKTlJWWl5iZmqKjpKWmp6ipqrKztLW2t7i5usLDxMXGx8jJytLT1NXW19jZ2uHi4+Tl5ufo6erx8vP09fb3+Pn6/8QAHwEAAwEBAQEBAQEBAQAAAAAAAAECAwQFBgcICQoL/8QAtREAAgECBAQDBAcFBAQAAQJ3AAECAxEEBSExBhJBUQdhcRMiMoEIFEKRobHBCSMzUvAVYnLRChYkNOEl8RcYGRomJygpKjU2Nzg5OkNERUZHSElKU1RVVldYWVpjZGVmZ2hpanN0dXZ3eHl6goOEhYaHiImKkpOUlZaXmJmaoqOkpaanqKmqsrO0tba3uLm6wsPExcbHyMnK0tPU1dbX2Nna4uPk5ebn6Onq8vP09fb3+Pn6/9oADAMBAAIRAxEAPwD3+iiigD//2Q==",
  "base64",
);

let orgA = 0;
let orgB = 0;

beforeAll(async () => {
  const [a] = await db
    .insert(s.organizations)
    .values({ publicId: generateAccountCode(), name: `Clínica A ${SUFFIX}`, slug: `a-${SUFFIX}` })
    .returning({ id: s.organizations.id });
  const [b] = await db
    .insert(s.organizations)
    .values({ publicId: generateAccountCode(), name: `Clínica B ${SUFFIX}`, slug: `b-${SUFFIX}` })
    .returning({ id: s.organizations.id });
  orgA = a.id;
  orgB = b.id;

  await db.insert(s.whatsappProfilePictures).values([
    { organizationId: orgA, jid: JID_A, mime: "image/jpeg", dataBase64: PIXEL.toString("base64") },
    // Mesmo JID, outra clínica: é o caso que prova o vazamento se ele existir.
    { organizationId: orgB, jid: JID_A, mime: "image/jpeg", dataBase64: PIXEL.toString("base64") },
    { organizationId: orgA, jid: JID_B, missing: true },
  ]);
});

afterAll(async () => {
  await db
    .delete(s.whatsappProfilePictures)
    .where(inArray(s.whatsappProfilePictures.organizationId, [orgA, orgB]));
  await db.delete(s.organizations).where(like(s.organizations.slug, `%-${SUFFIX}`));
  await pool.end();
});

describe("foto de perfil", () => {
  it("devolve os bytes da própria clínica", async () => {
    const foto = await getPictureBytes(orgA, JID_A);
    expect(foto).not.toBeNull();
    expect(foto?.mime).toBe("image/jpeg");
    // Bytes de verdade, não a string base64: é isso que a rota devolve.
    expect(Buffer.isBuffer(foto?.bytes)).toBe(true);
    expect(foto?.bytes.length).toBe(PIXEL.length);
  });

  it("não devolve foto de conta que não é a sua", async () => {
    // Uma organização que nunca guardou nada não pode alcançar o registro de
    // outra só por conhecer o JID.
    const intrusa = await getPictureBytes(orgA + orgB + 999_999, JID_A);
    expect(intrusa).toBeNull();
  });

  it("trata contato sem foto como ausência, não como erro", async () => {
    // `missing` existe para não perguntar de novo à uazapi a cada abertura do
    // inbox. Para quem lê, precisa ser indistinguível de não ter registro.
    expect(await getPictureBytes(orgA, JID_B)).toBeNull();
  });

  it("lista só os JIDs com foto de verdade, escopados pela conta", async () => {
    const comFoto = await whichHavePictures(orgA, [JID_A, JID_B, "999@s.whatsapp.net"]);
    expect([...comFoto]).toEqual([JID_A]);

    // A clínica B tem o mesmo JID guardado; A e B não se contaminam.
    const daB = await whichHavePictures(orgB, [JID_A, JID_B]);
    expect([...daB]).toEqual([JID_A]);
  });

  it("não vaza quando a lista de JIDs vem vazia", async () => {
    // Sem o guard, um `in ()` vazio no SQL viraria erro ou, pior, cláusula
    // ignorada — e a consulta devolveria a tabela inteira.
    expect((await whichHavePictures(orgA, [])).size).toBe(0);
  });
});
