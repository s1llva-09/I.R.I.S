import { resolve } from 'path'
import { defineConfig } from 'electron-vite'
import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  main: {
    build: {
      // Duas entradas no main: o app e a bancada de testes. A bancada precisa
      // do MESMO build (import.meta.env resolvido, electron de verdade) —
      // rodar por fora com tsx quebra no `app.getPath` e no better-sqlite3.
      rollupOptions: {
        input: {
          index: resolve('src/main/index.ts'),
          rodar: resolve('testes/rodar.ts'),
          sonda: resolve('testes/sonda.ts'),
          // 'fila-teste' pelo mesmo motivo do 'teste-gatilhos': src/main/fila.ts
          // já disputa o nome 'fila' como chunk.
          'fila-teste': resolve('testes/fila.ts'),
          rede: resolve('testes/rede.ts'),
          'teste-servidor': resolve('testes/servidor.ts'),
          // 'teste-gatilhos' e não 'gatilhos': a entrada vira out/main/<nome>.js,
          // e src/main/gatilhos.ts já disputa esse nome como chunk compartilhado.
          'teste-gatilhos': resolve('testes/gatilhos.ts')
        }
      }
    }
  },
  preload: {},
  renderer: {
    resolve: {
      alias: {
        '@renderer': resolve('src/renderer/src')
      }
    },
    plugins: [react(), tailwindcss()]
  }
})
