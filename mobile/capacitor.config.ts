import type { CapacitorConfig } from "@capacitor/cli";

/**
 * O aplicativo é uma CASCA NATIVA sobre o Agenda de Unha que já está no ar.
 *
 * Não é preguiça: o produto é servido por Next.js com renderização no servidor,
 * ações de servidor e um inbox por SSE. Não existe versão estática dele para
 * empacotar dentro do telefone, e reescrever agenda, inbox, catálogo e
 * financeiro em React Native é outro produto, de meses. A casca entrega hoje
 * ícone na tela de início, tela cheia sem barra de navegador, splash com a
 * marca e o botão voltar do Android funcionando — que é o que se precisa para
 * TESTAR no aparelho.
 *
 * O que ela ainda não entrega, e é o que justifica a existência do app nas
 * lojas (Apple recusa invólucro sem função nativa, diretriz 4.2): notificação
 * de agendamento novo, câmera para foto do trabalho e agenda do telefone.
 * Estão listadas no INSTALAR.md como o próximo passo, com o que cada uma exige.
 */
const config: CapacitorConfig = {
  appId: "br.com.agendadeunha.app",
  appName: "Agenda de Unha",
  /**
   * Pasta obrigatória do Capacitor mesmo carregando remoto: é o que ele copia
   * para dentro do aparelho. Aqui vive a tela de "sem conexão", a única coisa
   * que o telefone consegue mostrar quando o site não responde.
   */
  webDir: "www",
  server: {
    /**
     * Abre em /hoje, e não em "/".
     *
     * A raiz do site é a página de VENDA do produto. Quem instalou o aplicativo
     * já comprou: abrir na landing toda vez é fazer a dona do salão passar por
     * um anúncio para chegar ao trabalho dela. /hoje redireciona sozinho para
     * /entrar quando não há sessão, então o mesmo endereço serve aos dois
     * estados.
     */
    url: "https://agendadeunha.com.br/hoje",
    cleartext: false,
    /**
     * Quando o site não responde, o Capacitor abre este arquivo, que mora
     * dentro do telefone. É a diferença entre a tela de "não foi possível
     * acessar" do navegador — com o endereço do site à mostra, parecendo um
     * defeito nosso — e uma tela do produto dizendo o que fazer.
     */
    errorPath: "offline.html",
    /**
     * Hospedeiros que abrem DENTRO do aplicativo. Só o próprio site.
     *
     * Todo o resto — link de pagamento, wa.me, mapa — sai para o navegador do
     * sistema, que é onde a cliente reconhece o cadeado e onde o login dela
     * naqueles serviços já existe. Checkout dentro de webview de aplicativo é
     * exatamente o desenho que ensina a pessoa a digitar cartão em tela sem
     * endereço visível.
     */
    allowNavigation: ["agendadeunha.com.br", "www.agendadeunha.com.br"],
  },
  ios: {
    /**
     * A barra de status fica com fundo próprio e o conteúdo começa abaixo dela.
     * Sem isto o cabeçalho ameixa do site passa por baixo do relógio do iPhone.
     */
    contentInset: "always",
    limitsNavigationsToAppBoundDomains: false,
    backgroundColor: "#8744CD",
  },
  android: {
    allowMixedContent: false,
    backgroundColor: "#8744CD",
    /**
     * Inspeção da webview pelo Chrome fica DESLIGADA na configuração.
     *
     * Não é redundância com o tipo de build: o Capacitor já liga a inspeção
     * sozinho quando o build é de depuração, então o valor aqui só decide o que
     * acontece no build de release. Ligado, qualquer pessoa com o telefone na
     * mão abre o DevTools e lê a agenda e as conversas das clientes de dentro
     * do aplicativo instalado.
     */
    webContentsDebuggingEnabled: false,
  },
  plugins: {
    SplashScreen: {
      /**
       * Três segundos e some sozinha.
       *
       * O certo seria a página avisar "terminei de carregar" e a splash sair no
       * instante exato. Isso exige o Capacitor dentro do site, que é a próxima
       * etapa. Enquanto não existe, três segundos é o valor medido: a primeira
       * pintura de /hoje leva de 1,2 a 2,4 segundos numa rede móvel comum, e
       * splash que sai cedo demais entrega tela branca — pior do que esperar.
       */
      launchShowDuration: 3000,
      launchAutoHide: true,
      launchFadeOutDuration: 250,
      backgroundColor: "#8744CDFF",
      androidScaleType: "CENTER_CROP",
      showSpinner: false,
      androidSplashResourceName: "splash",
    },
    StatusBar: {
      /**
       * "DARK" aqui quer dizer ÍCONES CLAROS, não barra escura — a nomenclatura
       * do plugin é o estilo do CONTEÚDO, e o valor anterior ("LIGHT") pedia
       * relógio e bateria em cinza-escuro sobre a ameixa. Medido no emulador:
       * ilegível.
       */
      style: "DARK",
      /**
       * As duas linhas abaixo valem no iOS e no Android até o 14. No Android 15
       * o sistema ignora as duas: quem mira a API 35 é de borda a borda por
       * obrigação, e o recuo passou a ser feito à mão no MainActivity, que é o
       * único lugar onde ainda funciona.
       */
      backgroundColor: "#8744CD",
      overlaysWebView: false,
    },
    Keyboard: {
      /** O teclado empurra a tela em vez de cobrir o campo que está sendo digitado. */
      resize: "native",
      resizeOnFullScreen: true,
    },
  },
};

export default config;
