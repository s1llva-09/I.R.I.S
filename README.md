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

### Fotos e celular

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

### Verificação

```bash
npm run teste:presenca
npm run teste:interface
npm run teste:servidor
npm run teste:melhorias
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
