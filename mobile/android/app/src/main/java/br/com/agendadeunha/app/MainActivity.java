package br.com.agendadeunha.app;

import android.graphics.Color;
import android.os.Bundle;
import android.view.View;
import android.view.ViewGroup;
import android.widget.FrameLayout;
import androidx.activity.OnBackPressedCallback;
import androidx.core.graphics.Insets;
import androidx.core.view.ViewCompat;
import androidx.core.view.WindowInsetsCompat;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {

    /**
     * A mesma ameixa que o `manifest.ts` do site declara como `theme_color`.
     *
     * Não é uma cor escolhida aqui: é a cor que o produto já diz que a barra de
     * status dele tem quando instalado pelo navegador. O aplicativo nativo
     * repete a decisão em vez de tomar outra.
     */
    private static final int COR_DA_BARRA = Color.parseColor("#8744CD");

    /**
     * O canvas do produto (`--color-surface` do globals.css).
     *
     * Fica embaixo da webview, na faixa da barra de gestos. Precisa ser a cor
     * da PÁGINA e não a da marca: uma tarja ameixa embaixo de uma tela clara
     * não lê como decisão, lê como sobra de renderização.
     */
    private static final int COR_DA_PAGINA = Color.parseColor("#F8F6FB");

    @Override
    public void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        recuarDasBarrasDoSistema();
        tratarOBotaoVoltar();
    }

    /**
     * Empurra a página para baixo da barra de status e para cima da barra de
     * gestos.
     *
     * Por que isto existe, já que o plugin StatusBar tem `overlaysWebView`:
     * porque no Android 15 ele não funciona mais. Aplicativos que miram a API
     * 35 são obrigatoriamente de borda a borda, e o sistema IGNORA
     * `setStatusBarColor` e as flags `SYSTEM_UI_FLAG_LAYOUT_*` — que é
     * exatamente o que aquele plugin usa por dentro. Medido no emulador com
     * Android 15: o degradê do cabeçalho do site começava no pixel 0 e o
     * relógio do sistema ficava escrito por cima do logotipo.
     *
     * Só as barras do sistema entram na conta. O teclado (`ime()`) fica de
     * fora de propósito: quem cuida dele é o plugin Keyboard, com
     * `resize: "native"`, e somar os dois recuos deixaria o campo de texto
     * pulando duas vezes ao abrir o teclado no inbox.
     *
     * Com a página recuada, `env(safe-area-inset-*)` passa a valer zero dentro
     * da webview — então o `pb-[env(safe-area-inset-bottom)]` que a navegação
     * de baixo do site já usa não soma em cima deste recuo. Não há margem
     * dobrada.
     */
    private void recuarDasBarrasDoSistema() {
        FrameLayout conteudo = findViewById(android.R.id.content);
        View camadaDoCapacitor = conteudo.getChildAt(0);
        camadaDoCapacitor.setBackgroundColor(COR_DA_PAGINA);

        // A faixa da barra de status, pintada à parte e por cima.
        //
        // São duas cores diferentes nas duas pontas da tela, e um fundo só não
        // dá conta: em cima o cabeçalho ameixa do site precisa continuar até o
        // topo, embaixo a faixa tem que sumir dentro da página clara. Esta
        // View existe só para a ponta de cima; a de baixo é o fundo da camada
        // do Capacitor.
        View faixaDoTopo = new View(this);
        faixaDoTopo.setBackgroundColor(COR_DA_BARRA);
        conteudo.addView(faixaDoTopo, new FrameLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, 0));

        ViewCompat.setOnApplyWindowInsetsListener(
            camadaDoCapacitor,
            (view, janela) -> {
                Insets barras = janela.getInsets(WindowInsetsCompat.Type.systemBars());
                view.setPadding(barras.left, barras.top, barras.right, barras.bottom);
                ViewGroup.LayoutParams medidas = faixaDoTopo.getLayoutParams();
                medidas.height = barras.top;
                faixaDoTopo.setLayoutParams(medidas);
                return janela;
            }
        );
    }

    /**
     * O botão voltar do Android, que sem isto fica morto na primeira tela.
     *
     * O plugin App do Capacitor registra um tratador que CONSOME o gesto e,
     * quando não há histórico para trás, não faz nada — lido no código dele:
     * `if (!hasListeners(...)) { if (canGoBack()) goBack(); }`, sem ramo para o
     * caso contrário. Na prática, em /hoje, que é onde o aplicativo abre,
     * apertar voltar não produz reação nenhuma. Botão do sistema que não
     * responde é o tipo de coisa que faz a pessoa achar que travou.
     *
     * Este tratador é registrado DEPOIS do plugin, e o despachante do Android
     * entrega o gesto ao último tratador ativo — então este vence. Faz o que o
     * do plugin faz, mais o que falta: sem histórico, fecha o aplicativo.
     *
     * Quando a página quiser interceptar o voltar (fechar uma gaveta antes de
     * sair da tela), este é o único ponto que precisa mudar.
     */
    private void tratarOBotaoVoltar() {
        getOnBackPressedDispatcher()
            .addCallback(
                this,
                new OnBackPressedCallback(true) {
                    @Override
                    public void handleOnBackPressed() {
                        if (getBridge() != null && getBridge().getWebView().canGoBack()) {
                            getBridge().getWebView().goBack();
                        } else {
                            finish();
                        }
                    }
                }
            );
    }
}
