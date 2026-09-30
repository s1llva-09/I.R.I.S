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
navegador exige um contexto seguro (HTTPS); para vídeo no uso local, escolha uma
das opções de webcam acima. Se o celular não abrir a página do QR, confira a
rede Wi-Fi e a permissão do aplicativo no Firewall do Windows para redes privadas.

### Verificação

```bash
npm run teste:presenca
npm run teste:interface
npm run teste:servidor
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
