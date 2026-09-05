#!/usr/bin/env python3
"""
Gera o ícone e a splash do aplicativo a partir da marca que já existe no site.

Por que um script e não dois PNGs commitados sem história: o símbolo é RECORTADO
do logotipo em 2172x724 (`public/brand/agenda-de-unha-white.png`), e não ampliado
do ícone de 512 do PWA. Ampliar 512 para 1024 — que é o que a App Store exige —
entrega borda mole num ícone que fica a vida inteira na tela de início de alguém.
Recortando da fonte, o traço tem 619px de altura real e sobra resolução.

Uso:  python3 scripts/gerar-arte.py
Depois:  npx @capacitor/assets generate

Saída: assets/icon.png (1024) e assets/splash.png (2732), mais a variante escura.
"""

from pathlib import Path

from PIL import Image

RAIZ = Path(__file__).resolve().parents[2]
LOGO = RAIZ / "public" / "brand" / "agenda-de-unha-white.png"
SAIDA = Path(__file__).resolve().parents[1] / "assets"

# O gradiente medido no ícone do PWA, canto a canto. Manter os dois idênticos
# importa: quem instalou pelo navegador e depois instala o aplicativo tem que
# ver o MESMO ícone, senão parecem dois produtos.
INICIO = (134, 67, 204)
FIM = (98, 42, 159)

# A splash do modo escuro é a MESMA ameixa, rebaixada.
#
# Não é enfeite: a splash ocupa a tela inteira por três segundos, e quem abre a
# agenda às onze da noite, no escuro, leva 2732 pixels de roxo aceso na cara. Os
# valores são os mesmos tons multiplicados por 0,45 — a marca continua
# reconhecível, o brilho não.
INICIO_ESCURO = (60, 30, 92)
FIM_ESCURO = (44, 19, 72)

# Recorte do símbolo dentro do logotipo. A marquinha em x>=735 é o traço da
# assinatura "gestão inteligente para manicures", não faz parte do símbolo.
JANELA = (281, 25, 733, 644)


def simbolo() -> Image.Image:
    marca = Image.open(LOGO).convert("RGBA").crop(JANELA)
    return marca.crop(marca.split()[3].getbbox())


def fundo(lado: int, inicio=INICIO, fim=FIM) -> Image.Image:
    """Gradiente diagonal. Desenhado em miniatura e ampliado: um degradê é liso
    por definição, e 64x64 interpolado dá o mesmo resultado que 2732 pixel a
    pixel, em um centésimo do tempo."""
    n = 64
    base = Image.new("RGB", (n, n))
    px = base.load()
    for y in range(n):
        for x in range(n):
            t = (x + y) / (2 * (n - 1))
            px[x, y] = tuple(round(inicio[i] + (fim[i] - inicio[i]) * t) for i in range(3))
    return base.resize((lado, lado), Image.LANCZOS).convert("RGBA")


def compor(lado: int, altura_relativa: float, inicio=INICIO, fim=FIM) -> Image.Image:
    arte = fundo(lado, inicio, fim)
    marca = simbolo()
    alvo = round(lado * altura_relativa)
    largura = round(marca.width * alvo / marca.height)
    marca = marca.resize((largura, alvo), Image.LANCZOS)
    arte.alpha_composite(marca, ((lado - largura) // 2, (lado - alvo) // 2))
    return arte


def main() -> None:
    SAIDA.mkdir(parents=True, exist_ok=True)
    # 48% é a proporção medida no ícone de 512 do PWA. Também é o que mantém o
    # traço dentro da zona segura de 66/108 do ícone adaptativo do Android, que
    # é o recorte mais agressivo dos dois sistemas.
    compor(1024, 0.48).convert("RGB").save(SAIDA / "icon.png")
    # A splash é recortada ao centro em telas de proporções muito diferentes:
    # o símbolo fica pequeno de propósito, para sobreviver ao corte.
    compor(2732, 0.14).convert("RGB").save(SAIDA / "splash.png")
    compor(2732, 0.14, INICIO_ESCURO, FIM_ESCURO).convert("RGB").save(SAIDA / "splash-dark.png")
    for nome in ("icon.png", "splash.png"):
        print(nome, Image.open(SAIDA / nome).size)


if __name__ == "__main__":
    main()
