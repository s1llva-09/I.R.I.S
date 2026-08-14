import { spawn, type ChildProcess } from 'child_process'

/**
 * Voz pelo SAPI do Windows.
 *
 * Por que não o speechSynthesis do navegador: no Electron ele existe mas
 * volta ZERO vozes — o speak() é um no-op silencioso. O Chrome tem a ponte
 * pro SAPI, o Electron não.
 *
 * Por que um processo PERSISTENTE e não um spawn por frase:
 *   - spawn custa ~285ms, e a fala é streaming (frase a frase)
 *   - processos separados falam AO MESMO TEMPO, um por cima do outro
 * Com um processo só, o $s.Speak bloqueia lá dentro e a fila sai de graça,
 * na ordem certa, sem nenhum código de fila aqui.
 */

let ps: ChildProcess | null = null

// '-Command -' faz o PowerShell ler comandos do stdin até fechar.
// Prefere a voz pt-BR que NÃO seja "Desktop". As Desktop são as SAPI5 de
// ~2010 e soam robóticas; as OneCore (Maria/Daniel modernas) soam bem melhor.
// O System.Speech só enxerga as OneCore depois da cópia de registro — sem
// ela este filtro não acha nada e o fallback pega a Desktop do mesmo jeito.
const PREPARO = `Add-Type -AssemblyName System.Speech
$s = New-Object System.Speech.Synthesis.SpeechSynthesizer
$br = $s.GetInstalledVoices() | Where-Object { $_.VoiceInfo.Culture.Name -eq 'pt-BR' }
$pt = $br | Where-Object { $_.VoiceInfo.Name -notlike '*Desktop*' } | Select-Object -First 1
if (-not $pt) { $pt = $br | Select-Object -First 1 }
if ($pt) { $s.SelectVoice($pt.VoiceInfo.Name) }
$s.Rate = 1
`

function processo(): ChildProcess {
  if (ps) return ps
  ps = spawn('powershell', ['-NoProfile', '-Command', '-'])
  ps.stdin?.write(PREPARO)
  // Morreu (kill nosso ou crash): zera pra próxima fala subir outro.
  ps.on('exit', () => (ps = null))
  return ps
}

/**
 * O texto vai em base64 de propósito. Ele vem do modelo, então pode ter
 * aspas, apóstrofo, quebra de linha, `@ — qualquer escape manual vira
 * injeção mais cedo ou mais tarde. Base64 é só [A-Za-z0-9+/=]: não existe
 * caractere capaz de escapar da string.
 */
export function falar(texto: string): void {
  if (!texto.trim()) return
  const b64 = Buffer.from(texto, 'utf8').toString('base64')
  processo().stdin?.write(
    `$s.Speak([Text.Encoding]::UTF8.GetString([Convert]::FromBase64String('${b64}')))\n`
  )
}

/**
 * Sobe o processo antes de precisar dele. Chamado no whenReady: o spawn
 * (~285ms) acontece enquanto o app abre, não na primeira frase.
 */
export function aquecerVoz(): void {
  processo()
}

/**
 * Não dá pra esvaziar a fila do SAPI de fora do processo — o Speak já está
 * bloqueado lá dentro. Matar é o único corte.
 *
 * E já sobe o substituto na sequência: o parar() dispara quando você manda
 * uma mensagem nova, ou seja, logo antes de vários segundos de LLM pensando.
 * O spawn cabe inteiro nesse buraco e a próxima fala sai instantânea.
 */
export function pararFala(): void {
  ps?.kill()
  ps = null
  processo()
}
