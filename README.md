# IZZE

An Electron application with React and TypeScript

## Central de segurança

A navegação lateral abre Segurança, Assistente, Modo porta e Configurações.
Em **Segurança**, use **Ativar câmera** para iniciar o sensor. **Gerenciar fontes**
permite selecionar webcam, câmera de rede, celular ou uma foto de teste. O painel
mostra imagem, rostos detectados, tempo real de análise, cadastros e histórico.
Fotos de teste são identificadas como simulação; imagem sem sinal não permanece
marcada como transmissão ao vivo. Os modelos faciais são carregados localmente,
com GPU quando disponível e CPU como alternativa.

### Painel de várias câmeras

Em **Segurança → Suas câmeras → Adicionar câmera**, informe um nome, um ambiente
(Sala, Quarto, Garagem…) e escolha a fonte:

- **Rede:** endereço do vídeo MJPEG HTTP. RTSP/HLS precisam de conversor.
- **Celular:** salve e clique em **Conectar celular** no cartão; cada aparelho
  recebe um QR HTTPS independente. O certificado local é o mesmo para todos.
- **Webcam / USB / Camo:** escolha o dispositivo na lista. Uma webcam pode ser
  cadastrada uma vez; o sistema operacional pode limitar seu uso simultâneo com
  o visor de reconhecimento individual.

O mosaico comporta até 12 cadastros, com filtro por ambiente, uma a três colunas,
ampliação, edição, remoção e pausa individual ou de todas. Nomes e ambientes
ficam salvos. Alterar apenas o nome mantém a conexão; mudar a fonte exige
reconectar. Os celulares usam pares de portas TCP entre 8800 e 8823 na rede local.

As imagens são simultâneas, sem gravação de vídeo. Ao sair da tela, as conexões
do mosaico são encerradas; ao voltar, clique em Conectar. **Ativar privacidade**
também encerra todas as fontes. O mosaico não executa reconhecimento facial em
todas as câmeras: a análise e o cadastro abaixo continuam na fonte do visor
individual. Não confunda a contagem desse sensor com a do mosaico.

### Foto e conexão individual

- **Foto no computador:** clique em **Adicionar foto** acima do visor ou arraste
  uma imagem para ele. São aceitos JPG, PNG, WebP, BMP, GIF e AVIF até 25 MB.
  Converta HEIC/HEIF para JPG ou PNG antes de escolher o arquivo no PC.
- **Foto pelo iPhone ou Android:** abra **Usar celular → Gerar QR para enviar
  foto**, mantenha o telefone e o computador na mesma rede e abra o QR no
  navegador. Escolha **Tirar foto** ou **Escolher da galeria**. A página reduz e
  converte a imagem antes do envio; aguarde a confirmação. A foto permanece no
  visor para análise e cadastro. Gere outro QR após reiniciar o aplicativo.
- **Vídeo ao vivo no iPhone ou Android:** instale Camo Camera no celular e Camo
  Studio no computador, conecte os dois e selecione a câmera Camo em
  **Gerenciar fontes**. Siga o [guia oficial do Camo](https://camo.com/support/camo/camo-getting-started)
  para cabo USB ou pareamento Wi-Fi.
- **Android no Windows 11:** também é possível vincular o telefone em
  **Configurações → Bluetooth e dispositivos → Dispositivos móveis** e habilitar
  **Usar como câmera conectada**. Depois selecione essa webcam no painel.
  Consulte os [requisitos da Microsoft](https://support.microsoft.com/en-gb/windows/apps/phonelink/use-your-mobile-device-s-camera).
- **Câmera pela rede:** use uma URL de transmissão MJPEG. O
  [DroidCam](https://droidcam.app/help/) oferece o endereço
  `http://IP_DO_CELULAR:4747/video` quando a transmissão está ativa. URLs de
  páginas, RTSP e HLS não são aceitas nesse campo.

### Câmera da porta com ESP32-CAM

O firmware não fica neste repositório: a Íris usa o exemplo oficial
**CameraWebServer**, que já entrega MJPEG em `http://IP:81/stream`.

1. **Hardware:** ESP32-CAM AI-Thinker (OV2640) e um gravador USB-serial 3,3 V
   (FTDI/CH340) ou a base ESP32-CAM-MB. Alimente com 5 V e pelo menos 1 A; fonte
   fraca causa reinício com `Brownout detector was triggered`.
2. **Arduino IDE:** instale o pacote de placas **esp32** (Espressif) e abra
   **Arquivo → Exemplos → ESP32 → Camera → CameraWebServer**.
3. Deixe só `#define CAMERA_MODEL_AI_THINKER` ativo (em `board_config.h` nas
   versões 3.x do pacote, no próprio `.ino` nas antigas) e preencha `ssid` e
   `password` da mesma rede do computador.
4. Placa **AI Thinker ESP32-CAM**. Com gravador avulso, ligue **IO0 ao GND**,
   pressione reset, grave, depois solte IO0 e pressione reset de novo.
5. No Monitor Serial (115200), anote o IP de `Camera Ready! Use 'http://IP'`.
   Prefira reservar esse IP no roteador para o endereço não mudar.
6. Na Íris, use **Buscar na rede** (procura a porta 81 e o caminho `/stream`
   na sub-rede local) ou cole `http://IP:81/stream` e clique em **Testar
   endereço**. Na Central de câmeras, cadastre como fonte **Rede**.

O CameraWebServer atende **um cliente de vídeo por vez**: feche a página do
ESP32-CAM no navegador antes de conectar pela Íris. Resolução e qualidade se
ajustam nessa página (`http://IP`); VGA ou SVGA bastam para o reconhecimento.

O QR local da Íris usa HTTP e envia **fotos individuais**. Vídeo ao vivo pelo
navegador também está disponível em **Celular ao vivo · HTTPS**, conforme abaixo.
Se o celular não abrir a página do QR, confira a
rede Wi-Fi e a permissão do aplicativo no Firewall do Windows para redes privadas.

### Monitoramento, cadastro e privacidade

- **Diagnóstico e privacidade:** conexão, idade do quadro, luminosidade média e
  avisos de enquadramento. A luminosidade é uma estimativa da imagem inteira.
- **Reconexão:** webcam tenta recuperar sinal a cada cinco segundos; MJPEG usa
  quatro segundos. O celular tenta novamente após falhas transitórias e encerra
  após três falhas consecutivas. Permissão negada exige ação do usuário.
- **Cadastro guiado:** confirme o consentimento e capture três ângulos leves.
  As três amostras são usadas na comparação. Fotos precisam ser diferentes;
  avisos de iluminação, enquadramento e pessoa divergente impedem a captura.
  Isso não comprova identidade nem presença física diante da câmera.
- **Histórico visual:** mudanças de presença, horário e miniaturas opcionais.
  Guarda até 200 eventos, exibe os últimos 50; imagens ficam desligadas por padrão.
- **Ativar privacidade:** encerra sensor e conexões, limpa a imagem atual e
  solicita ao navegador conectado que desligue a câmera. Se a rede estiver
  interrompida, o celular encerra após três falhas de envio. Há botões separados
  para remover miniaturas ou histórico de presença, com confirmação. As decisões
  de risco e os cadastros são mantidos. Remoção é lógica, sem garantia de
  apagamento forense de arquivos SQLite ou backups.

### Celular ao vivo sem aplicativo externo

1. Em Segurança → Gerenciar fontes, clique em **Celular ao vivo · HTTPS**.
2. No telefone, escaneie o primeiro QR e instale o certificado **Iris Camera
   Local**. Confira a impressão SHA-256 mostrada no computador antes de confiar.
   No iPhone, instale o perfil em Geral → VPN e Gerenciamento de Dispositivo;
   depois habilite confiança em Geral → Sobre → Certificados Confiáveis.
   [Instruções da Apple](https://support.apple.com/en-ca/102390).
   No Android, procure Segurança → Criptografia e credenciais → Instalar
   certificado → Certificado de CA (os nomes variam conforme o aparelho).
3. Escaneie o segundo QR no Safari/Chrome, permita a câmera e toque em
   **Ligar câmera ao vivo**. Mantenha a tela ligada e a página em primeiro plano.
4. Use **Parar transmissão** no celular ou **Ativar privacidade** no computador
   para encerrar. Um novo pareamento revoga o anterior.

A rede precisa permitir as portas TCP 8790 e 8791 entre os dispositivos. A CA é
local e sua chave privada fica cifrada pelo sistema operacional. Instale apenas
o certificado do seu computador; remova a confiança nas configurações do celular
quando deixar de usar o recurso. Não compartilhe o QR de transmissão. Os testes
usam Chromium com câmera simulada; Safari/iPhone e Android físicos exigem validação.

### Fora de casa: proteção por áreas

Em **Segurança → Fora de casa**, escolha uma câmera cadastrada no mosaico,
conecte a prévia e marque de 3 a 12 pontos sobre o chão que deseja proteger.
Dê um nome e clique em **Adicionar área**. É possível selecionar até cinco
áreas por câmera, ou usar a imagem inteira. Salve e ative **Fora de casa**.

- A análise usa um detector local de **pessoas** (YOLOS tiny), inclusive quando
  o rosto não está visível. No primeiro uso, o modelo é baixado do Hugging Face;
  depois fica no diretório de dados do aplicativo. Nenhum quadro é enviado a
  uma API de IA. O reconhecimento facial do visor individual é independente.
- O ponto entre os pés precisa permanecer na área durante o tempo configurado
  e aparecer em pelo menos duas imagens diferentes. O intervalo entre alertas
  vale por área. Isso reduz avisos de passagem rápida; não comprova invasão,
  identidade ou presença física diante da câmera.
- Câmeras protegidas continuam conectadas ao mudar de tela, minimizar ou fechar
  a janela para a bandeja. A captura de webcams também permanece ativa. Sair
  da Íris encerra o monitoramento. Ao recarregar a interface, fontes de rede
  permanecem conectadas e webcams precisam retomar a captura. Se a interface
  encerrar inesperadamente durante a proteção, a Íris tenta recarregá-la até
  três vezes por minuto. Falhas persistentes ficam nos avisos de sinal/análise.
- Uma câmera sem vídeo recente por 15 segundos gera um evento; a recuperação
  gera outro. Fotos avulsas não são tratadas como vídeo. O painel mostra a idade
  da análise, pessoas detectadas e falhas. Várias câmeras dividem um detector;
  se a análise atrasar, reduza o número de câmeras protegidas.
- A agenda pode atravessar a meia-noite e usa o horário do computador. Os dias
  selecionados correspondem ao início do período. **Desarmar proteção** e
  **Pausar todas** também desativam a agenda, evitando uma reativação inesperada.
- O histórico guarda até 500 eventos por 1 a 30 dias; o PC exibe os últimos 100
  e o celular, os últimos 50. Uma imagem de cada evento de pessoa é opcional,
  desligada por padrão. Desativar essa opção afeta novas imagens; use **Apagar
  histórico** para remover as anteriores. Não há gravação contínua de vídeo.

O computador precisa permanecer ligado, com a Íris em execução. O aplicativo
solicita ao sistema evitar suspensão automática enquanto protege, mas não impede
desligamento, suspensão manual ou fechamento da tampa. Se o próprio computador
ou sua internet cair, ele não consegue enviar um aviso de sua própria queda.
Iluminação, obstruções e enquadramento influenciam a detecção; teste as áreas no
ambiente real antes de depender dos alertas.

### A própria Íris no celular

Em **Fora de casa → Íris no celular**, escolha um endereço privado do PC e
clique em **Parear Íris no celular**. O painel móvel tem apenas o essencial:
estado da proteção, câmeras ao vivo, eventos e autorização de notificações.
As regras e configurações ficam no computador.

1. Instale e confie no certificado local pelo primeiro QR, conferindo a
   impressão exibida no PC. As instruções são as mesmas do celular como câmera.
2. Abra o segundo QR. No iPhone, Safari → Compartilhar → **Adicionar à Tela de
   Início**. No Android, Chrome → **Instalar aplicativo** ou **Adicionar à tela
   inicial**. Abra a Íris pelo ícone. Se pedir novo pareamento, copie o link
   privado no PC e cole no campo do aplicativo instalado.
3. Toque em **Ativar notificações** no celular. No PC, use **Enviar alerta de
   teste** e confira o histórico e a notificação recebida.
4. Para ver as câmeras e o histórico fora de casa, mantenha uma **VPN privada**
   conectando PC e celular e pareie usando o endereço dessa VPN. O QR da LAN
   funciona dentro da rede de casa; ele sozinho não fornece acesso por 4G/5G.

O painel é servido por HTTPS na porta TCP **8798**; a **8799** fornece apenas o
certificado público. O firewall e a VPN precisam permitir essas portas entre
seus dispositivos. O servidor escuta apenas no endereço privado escolhido.
A configuração de VPN, firewall e permissões no telefone depende do ambiente;
não é feita automaticamente pelo aplicativo.

Notificações usam Web Push do navegador e exigem internet no PC e no telefone.
No iPhone, é necessário iOS 16.4 ou posterior e abrir o aplicativo instalado
na tela inicial ([documentação do WebKit](https://webkit.org/blog/13878/web-push-for-web-apps-on-ios-and-ipados/)).
Depois de autorizadas, a página não precisa ficar aberta para receber avisos.
A notificação contém o nome da câmera e o texto; imagens são consultadas apenas
no painel autenticado. A fila tenta novamente após falhas transitórias, evita
duplicar envios já aceitos para outros celulares e expira alertas após uma hora.
**Aceito pelo serviço de notificações** não confirma que a pessoa recebeu ou leu.

O link de pareamento é privado. O token sai da barra de endereço depois do
pareamento, e a sessão usa cookie seguro inacessível ao JavaScript. **Revogar
todos os acessos** invalida as sessões e remove os celulares da lista de alertas.
**Remover notificações** desativa somente os avisos daquele aparelho; para
revogar o acesso às imagens, revogue todos os acessos e pareie novamente os
aparelhos autorizados. **Desconectar este navegador** encerra sua sessão e
solicita o cancelamento da inscrição de notificações no navegador.

O modo **Ativar privacidade** desarma a proteção, desliga a agenda, interrompe
as câmeras e cancela alertas ainda pendentes. Eventos anteriores continuam no
histórico até serem apagados ou vencerem a retenção. Avisos já enviados não
podem ser recolhidos. A remoção dos registros é lógica, sem garantia de
apagamento forense do SQLite ou de backups.

### Verificação

```bash
npm run teste:presenca
npm run teste:interface
npm run teste:servidor
npm run teste:melhorias
npm run teste:cameras
npm run teste:vigilancia
npm run teste:detector
```

O primeiro comando verifica perda/recuperação de sinal e o ciclo de vida do sensor
com APIs simuladas. O segundo compila o app e usa uma janela Electron invisível
com uma ponte simulada para verificar navegação, layout, erros de gravação,
aprovações, foto de teste e modelos locais. Capturas e relatório ficam em
`out/ui-checks/`. Esses testes não acionam APIs externas nem comandos reais do PC.
O terceiro verifica o servidor local e o envio de fotos pela página móvel em
Chromium, incluindo redução de imagens grandes, erros HTTP e falhas de conexão.
Uma câmera física, a qualidade do reconhecimento com pessoas reais e as conexões
de rede precisam ser validadas no ambiente de uso.

`teste:vigilancia` usa banco isolado e testa perímetros, horários, confirmação,
queda/recuperação, cancelamento e fila de alertas com transporte simulado. Também
abre o painel móvel em Chromium invisível, verificando HTTPS, autenticação,
layout, histórico e revogação. Nenhum push real é enviado. `teste:detector`
baixa o modelo e uma imagem pública do repositório Ultralytics, verifica pessoas
reais nessa imagem, ausência de pessoas em imagem vazia e tratamento de JPEG
inválido. Isso valida a integração, não mede a precisão em uma casa real.
Push, instalação e conexão por VPN precisam ser confirmados em iPhone/Android
físicos; não foram validados nesses aparelhos pelos testes automatizados.

## Recommended IDE Setup

- [VSCode](https://code.visualstudio.com/) + [ESLint](https://marketplace.visualstudio.com/items?itemName=dbaeumer.vscode-eslint) + [Prettier](https://marketplace.visualstudio.com/items?itemName=esbenp.prettier-vscode)

## Project Setup

### Install

```bash
$ npm install
```

### Development

```bash
$ npm run dev
```

### Build

```bash
# For windows
$ npm run build:win

# For macOS
$ npm run build:mac

# For Linux
$ npm run build:linux
```
