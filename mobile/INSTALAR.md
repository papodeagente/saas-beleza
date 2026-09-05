# O aplicativo no telefone

O que existe aqui é o **Agenda de Unha empacotado como aplicativo nativo**: ícone
na tela de início, tela cheia sem barra de navegador, splash com a marca, botão
voltar do Android funcionando e uma tela própria para quando falta internet. Por
dentro, ele carrega `https://agendadeunha.com.br/hoje` — o mesmo produto que já
está no ar, sem uma segunda versão do código para manter em dia.

Isso é uma escolha, e vale saber o preço dela. Está em [O que falta antes das
lojas](#o-que-falta-antes-das-lojas).

---

## Android — instalar hoje

O arquivo é `agenda-de-unha.apk` (o mesmo `app-debug.apk` que sai do build). Ele
instala em qualquer Android 6 ou mais novo, sem Play Store e sem conta de
desenvolvedor.

**Pelo cabo (mais rápido):**

```bash
adb install -r agenda-de-unha.apk
```

**Sem cabo:** mande o arquivo para você mesma pelo WhatsApp, Drive ou e-mail,
abra no telefone e toque em instalar. O Android vai pedir para liberar
"instalar apps desconhecidos" para o aplicativo de onde veio o arquivo — é uma
única confirmação, em Ajustes.

> O Google Play Protect pode mostrar um aviso de "app não reconhecido" na
> primeira instalação. É esperado: o arquivo não passou pela loja. Toque em
> "Instalar assim mesmo".

### O que já foi verificado

Num emulador com **Android 15**, que é onde as regras mais novas apertam:

| | |
|---|---|
| Instala e abre | sim, 5,3 MB |
| Splash | ameixa da marca, com variante escura; não é mais o clarão branco do sistema |
| Barra de status | faixa ameixa com ícones brancos, sem escrever por cima do logotipo |
| Barra de gestos | faixa na cor da página, sem tarja roxa embaixo |
| Carrega o site | sim, cai em /entrar por não haver sessão |
| Botão voltar na primeira tela | fecha o aplicativo |
| Sem internet, primeira abertura | tela "Sem conexão" embutida |
| Sem internet, depois de já ter aberto | tela de offline do próprio site, pelo service worker |
| Tentar de novo com a rede de volta | entra |
| Tentar de novo ainda sem rede | diz "Ainda sem internet" |

O que **não** foi verificado por precisar de uma conta de verdade: entrar,
navegar logada, o teclado no inbox e os links de WhatsApp saindo para fora do
aplicativo.

### O que dá para testar

Entrar, agenda de hoje, inbox, catálogo, financeiro — tudo, porque é o produto
inteiro. O que vale olhar com atenção, que é o que muda em relação ao navegador:

- a splash e o tempo até a primeira tela aparecer;
- o botão **voltar** do Android em cada tela, inclusive na primeira (deve fechar
  o aplicativo, não ficar parado);
- o teclado subindo por cima dos campos de texto, principalmente no inbox;
- ligar o modo avião e abrir o aplicativo: deve aparecer a tela "Sem conexão"
  com a marca, e não a tela de erro do navegador;
- tocar num link de WhatsApp ou num telefone: deve **sair** para o aplicativo
  certo, não abrir dentro;
- fechar e reabrir: a sessão precisa continuar aberta.

---

## iOS — o que é preciso, e o que eu não consegui fazer

**Não existe um arquivo de iOS pronto nesta entrega, e não é descuido.** A Apple
não permite instalar um aplicativo num iPhone sem que ele esteja assinado por um
certificado da sua conta Apple. Não há como gerar esse arquivo sem as suas
credenciais — nem eu, nem ninguém que não seja você.

O que **está** pronto é o projeto Xcode completo, em `mobile/ios`, com ícones,
splash, identificador e dependências resolvidas. O caminho a partir daí:

1. Instale o **Xcode** pela App Store (é grande, uns 15 GB).
2. `cd mobile && npm install && npx cap sync ios`
3. `npx cap open ios` — abre o projeto no Xcode. Ele resolve os pacotes Swift
   sozinho na primeira abertura; não é preciso CocoaPods.
4. Em **Signing & Capabilities**, escolha seu time. Com um Apple ID comum já
   aparece um time pessoal.
5. Conecte o iPhone pelo cabo, escolha-o na barra de cima e aperte ▶.

Com **Apple ID comum e sem pagar nada**, o aplicativo instala no seu iPhone e
funciona por **7 dias** — depois para de abrir e precisa ser reinstalado pelo
Xcode. Serve para testar, não para distribuir.

Com o **Apple Developer Program** (99 dólares por ano), o mesmo projeto vira um
build de TestFlight: até 10.000 pessoas testam pelo convite, sem cabo e sem
prazo de 7 dias. É o caminho para colocar o aplicativo na mão de manicures de
verdade antes da loja.

---

## Recompilar sem instalar nada na sua máquina

Em **Actions → Aplicativo iOS e Android → Run workflow**, no GitHub. O APK sai
como artefato para baixar, e o projeto iOS é compilado (sem assinatura) só para
provar que não quebrou.

Se quiser compilar o Android na sua máquina, precisa de JDK 21 e do SDK do
Android; depois é `cd mobile && npm install && npx cap sync android && cd android
&& ./gradlew assembleDebug`.

---

## Mudar para onde o aplicativo aponta

Tudo vive em `capacitor.config.ts`. Para testar contra outro ambiente, troque
`server.url` e rode `npx cap sync`. **A configuração vai para dentro do binário**
— trocar o endereço exige gerar um APK novo, não basta mudar no servidor.

O ícone e a splash saem da marca do site, por script:

```bash
python3 scripts/gerar-arte.py && npx @capacitor/assets generate
```

Ele recorta o símbolo do logotipo em 2172×724 em vez de ampliar o ícone de 512
do PWA, para que o ícone de 1024 que a App Store exige tenha traço nítido.

---

## O que falta antes das lojas

**A Apple recusa aplicativo que é só um site dentro de uma casca** (diretriz 4.2,
"minimum functionality"). Não é uma regra que se contorna com capricho de
interface: ela pede que o aplicativo faça algo que o navegador não faz. O Google
é mais tolerante, mas a pergunta "por que baixar isto em vez de abrir o site" é
a mesma.

As três coisas que resolvem isso e que, por acaso, são exatamente o que uma dona
de salão quer de um aplicativo:

1. **Notificação de agendamento novo.** É a razão de existir do aplicativo: hoje
   ela só descobre um agendamento abrindo o site. Precisa de um projeto Firebase
   (Android), de uma chave APNs da conta Apple (iOS), do registro do token no
   nosso servidor e de um gancho no `booking-service` para disparar. É a maior
   das três e a que mais vale.
2. **Câmera para a foto do trabalho**, direto na ficha da cliente, sem passar
   pela galeria.
3. **Agenda do telefone**: o atendimento confirmado aparecendo no calendário
   nativo. Hoje isso existe como arquivo `.ics` na página pública de reserva.

Nenhuma das três é grande sozinha. As três exigem que o Capacitor passe a viver
**dentro do site** também — hoje ele só existe do lado nativo — para que a
página consiga chamar a câmera e registrar o token de notificação.

## Uma coisa que eu achava resolvida e não estava

A navegação de baixo do site usa `pb-[env(safe-area-inset-bottom)]` para não
ficar embaixo da barra de gestos. **Dentro do aplicativo isso vale zero.**
Medido: numa página de teste com `viewport-fit=cover`, a WebView do Android 15
devolveu `top=0 bottom=0 left=0 right=0` nas quatro bordas. O `env()` do CSS não
enxerga as barras do sistema ali — e sem `viewport-fit=cover`, que o site não
declara, também não enxerga no Safari.

Quem segura a barra de gestos hoje é o recuo feito à mão no `MainActivity`, e no
iOS será o `contentInset: "always"` da configuração. Vale saber porque é o tipo
de proteção que parece existir no código e não existe na tela.

O resto disso o site já tinha de verdade e não precisou ser refeito: campos de
texto com 16px para o Safari não dar zoom ao focar, alvos de toque de 44px e
telas pensadas para uma mão.
