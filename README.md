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

### Verificação

```bash
npm run teste:presenca
npm run teste:interface
```

O primeiro comando verifica perda/recuperação de sinal e o ciclo de vida do sensor
com APIs simuladas. O segundo compila o app e usa uma janela Electron invisível
com uma ponte simulada para verificar navegação, layout, erros de gravação,
aprovações, foto de teste e modelos locais. Capturas e relatório ficam em
`out/ui-checks/`. Esses testes não acionam APIs externas nem comandos reais do PC.
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
