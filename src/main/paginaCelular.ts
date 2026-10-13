export const workerCelular = `self.addEventListener('push',e=>{let d={title:'Íris',body:'Novo evento de segurança'};try{d=e.data.json()}catch{}e.waitUntil(self.registration.showNotification(d.title,{body:d.body,tag:d.id,icon:'/icone.png',data:{url:'/?evento='+encodeURIComponent(d.id||'')}}))});self.addEventListener('notificationclick',e=>{e.notification.close();e.waitUntil(clients.openWindow(e.notification.data.url))});self.addEventListener('fetch',e=>{if(e.request.mode==='navigate')e.respondWith(fetch(e.request).catch(()=>new Response('<html lang="pt-BR"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Íris · Sem conexão</title><body style="color-scheme:dark;background:#101216;color:#eef0f4;font:15px/1.6 system-ui;margin:0;padding:28px 20px"><main style="max-width:480px;margin:auto"><p style="color:#969da9">Íris</p><h1 style="font-size:26px;font-weight:600">Sem conexão</h1><p style="color:#bdc2cc">Confira a internet, a VPN e se o computador está ligado. Reabra quando a conexão voltar.</p></main></body></html>',{headers:{'Content-Type':'text/html; charset=utf-8'}})))})`

export const paginaCelular = `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="theme-color" content="#101216"><link rel="manifest" href="/manifest.webmanifest"><link rel="apple-touch-icon" href="/icone.png"><title>Íris · Segurança</title><style>
:root { color-scheme: dark; font: 15px/1.5 -apple-system, BlinkMacSystemFont, "Segoe UI", system-ui, sans-serif; background: #101216; color: #eef0f4; }
* { box-sizing: border-box; }
body { margin: 0 auto; padding: 28px 24px 40px; max-width: 1100px; }
h1 { margin: 4px 0 0; font-size: 28px; font-weight: 600; letter-spacing: -.025em; }
h2 { margin: 0 0 6px; font-size: 17px; font-weight: 600; }
p { margin: 10px 0; }
small, .muted { color: #969da9; }
header { display: flex; justify-content: space-between; gap: 16px; align-items: center; margin-bottom: 24px; }
header small { color: #bdc2cc; font-size: 13px; }
button { font: inherit; font-size: 14px; padding: 11px 14px; background: #242932; color: #eef0f4; border: 1px solid #39414f; border-radius: 8px; cursor: pointer; }
button:hover:not(:disabled) { background: #2d3440; }
button.primary { background: #466ed5; color: #fff; border-color: #466ed5; }
button.primary:hover:not(:disabled) { background: #527cdf; }
button:disabled { opacity: .5; cursor: not-allowed; }
button:focus-visible, input:focus-visible, summary:focus-visible, a:focus-visible { outline: 2px solid #8eaef6; outline-offset: 3px; }
.panel, article { border: 1px solid #2b3039; border-radius: 10px; padding: 20px; margin: 16px 0; background: #191c22; }
nav { display: flex; gap: 6px; margin: 24px 0 18px; padding-bottom: 12px; border-bottom: 1px solid #2b3039; }
nav button { border-color: transparent; background: transparent; }
nav button[aria-pressed=true] { background: #252e41; border-color: #354563; color: #eef0f4; }
main { display: grid; grid-template-columns: repeat(auto-fit,minmax(260px,1fr)); gap: 16px; }
main article { margin: 0; min-width: 0; }
main article p { font-size: 13px; color: #969da9; }
img { width: 100%; aspect-ratio: 4/3; object-fit: contain; background: #0d0f13; border-radius: 6px; margin-top: 8px; }
#status { font-size: 18px; font-weight: 600; }
#erro { color: #ed939d; white-space: pre-line; }
#erro:empty { display: none; }
.acoes { display: flex; gap: 8px; flex-wrap: wrap; margin: 18px 0; }
details { border-top: 1px solid #2b3039; padding-top: 14px; }
summary { cursor: pointer; font-size: 14px; color: #bdc2cc; }
details p { font-size: 13px; color: #969da9; }
.evento time { font-size: 12px; color: #969da9; }
.evento h2 { margin-top: 8px; }
.evento p { margin: 6px 0; color: #bdc2cc; }
#conexao { font-size: 12px; color: #bdc2cc; padding: 6px 9px; border: 1px solid #39414f; border-radius: 6px; white-space: nowrap; }
a { color: #8eaef6; }
input { font: inherit; color: #eef0f4; border: 1px solid #39414f; border-radius: 8px; background: #13161b; }
label { font-size: 14px; }
[hidden] { display: none !important; }
@media (max-width: 600px) { body { padding: 24px 18px 32px; } header { align-items: flex-start; } h1 { font-size: 26px; } .panel, article { padding: 16px; } main { grid-template-columns: minmax(0,1fr); } }

.mobile-caption { margin: 0 0 8px; font-size: 12px; color: #969da9; }
.mobile-protection #resumo { font-size: 13px; line-height: 1.7; }
.mobile-protection .acoes { margin-bottom: 0; }
.mobile-help details { border: 0; padding: 0; }
.mobile-scope { font-size: 12px; line-height: 1.7; }
nav { position: sticky; top: 12px; z-index: 10; background: #191c22; padding: 4px; border: 1px solid #2b3039; border-radius: 8px; gap: 4px; }
nav button { flex: 1; text-align: center; border-radius: 5px; }
nav button[aria-pressed=true] { background: #2b3852; border-color: transparent; }
main article { padding: 16px 0 0; overflow: hidden; }
main article h2, main article p { margin-left: 16px; margin-right: 16px; overflow-wrap: anywhere; }
main article img { display: block; border-radius: 0; margin-top: 14px; }
#sair { background: transparent; font-size: 12px; margin-top: 8px; }
.panel, article { overflow-wrap: anywhere; }
</style></head><body><header><div><small>Íris</small><h1>Segurança</h1></div><span id="conexao">Conectando</span></header>
<section class="panel mobile-protection" aria-labelledby="status"><p class="mobile-caption">Proteção do ambiente</p><strong id="status">Verificando o computador…</strong><p id="resumo" class="muted"></p><div class="acoes"><button id="notificar" class="primary">Ativar notificações</button><button id="atualizar">Atualizar</button></div><p id="erro" role="status"></p></section>
<section id="parear" class="panel" hidden><label for="link">Cole o link privado de pareamento mostrado no PC</label><input id="link" type="password" autocomplete="off" style="width:100%;padding:12px;margin:10px 0"><button id="confirmar">Conectar à Íris</button></section><nav><button data-aba="cameras" aria-pressed="true">Câmeras</button><button data-aba="eventos" aria-pressed="false">Eventos</button></nav><main id="cameras"></main><section id="eventos" hidden></section><section class="panel mobile-help"><details><summary>Instalar a Íris no celular</summary><p>iPhone: Safari → Compartilhar → Adicionar à Tela de Início. Abra a Íris pelo ícone e toque em Ativar notificações. Requer iOS 16.4 ou mais recente.</p><p>Android: no menu do Chrome, use Instalar aplicativo ou Adicionar à tela inicial. Depois autorize as notificações.</p><p>Fora de casa, conecte a VPN privada para ver as câmeras e o histórico. Alertas push precisam de internet no computador e no celular. Não é necessário deixar a tela aberta para receber notificações após instalar e autorizar.</p></details></section><p class="muted mobile-scope">Somente consulta. Áreas protegidas, horários e configurações são ajustados no computador.</p><button id="sair">Desconectar este navegador</button>
<script>
const erro=document.getElementById('erro'),status=document.getElementById('status'),resumo=document.getElementById('resumo');let versao=0,assinaturaEventos='',ativo=true,aba=new URLSearchParams(location.search).has('evento')?'eventos':'cameras',timer=null,ocupado=false;
function mudar(){document.getElementById('cameras').hidden=aba!=='cameras';document.getElementById('eventos').hidden=aba!=='eventos';document.querySelectorAll('nav button').forEach(b=>b.setAttribute('aria-pressed',b.dataset.aba===aba))}document.querySelectorAll('nav button').forEach(b=>b.onclick=()=>{aba=b.dataset.aba;mudar();atualizar()});mudar();
async function json(url){const controle=new AbortController(),tempo=setTimeout(()=>controle.abort(),8000);try{const r=await fetch(url,{signal:controle.signal});if(!r.ok)throw Error(r.status===403?'Pareamento expirado. Abra o QR no computador novamente.':'Não foi possível consultar o computador.');return await r.json()}catch(e){if(controle.signal.aborted)throw Error('O computador não respondeu. Confira a conexão e a VPN.');throw e}finally{clearTimeout(tempo)}}
async function atualizar(){if(!ativo||ocupado)return;ocupado=true;const ciclo=versao;try{const [cs,v]=await Promise.all([json('/estado'),json('/seguranca')]);if(ciclo!==versao)return;document.getElementById('parear').hidden=true;document.getElementById('conexao').textContent='PC conectado';status.textContent={armado:'Fora de casa · ativo',preparando:'Preparando o monitoramento',desarmado:'Monitoramento desarmado',erro:'Monitoramento indisponível'}[v.modo];resumo.textContent=v.erro||v.cameras.map(c=>c.nome+': '+(c.erro||'analisando')).join(' · ')||(v.modo==='armado'?'Aguardando dados das câmeras.':'Ative o monitoramento no computador.');const main=document.getElementById('cameras');for(const el of [...main.children])if(!cs.some(c=>c.id===el.dataset.id))el.remove();for(const c of cs){let el=[...main.children].find(e=>e.dataset.id===c.id);if(!el){el=document.createElement('article');el.dataset.id=c.id;el.append(document.createElement('h2'),document.createElement('p'),document.createElement('img'));main.append(el)}el.querySelector('h2').textContent=c.nome;el.querySelector('p').textContent=c.ambiente+(c.sinal?' · ao vivo':' · sem vídeo recente');const img=el.querySelector('img');img.alt=c.nome;img.hidden=!c.sinal;if(c.sinal&&aba==='cameras'){img.onerror=()=>{img.hidden=true};img.src='/frame/'+encodeURIComponent(c.id)+'?v='+Date.now()}else img.removeAttribute('src')}
if(aba==='eventos'&&assinaturaEventos!==JSON.stringify(v.eventos)){assinaturaEventos=JSON.stringify(v.eventos);const eventos=document.getElementById('eventos');eventos.replaceChildren();if(!v.eventos.length)eventos.textContent='Nenhum evento registrado.';for(const e of v.eventos){const el=document.createElement('article');el.className='evento';const time=document.createElement('time');time.textContent=new Date(e.momento).toLocaleString();const h=document.createElement('h2');h.textContent=e.camera;const p=document.createElement('p');p.textContent=e.texto;el.append(time,h,p);if(e.temImagem){const img=document.createElement('img');img.loading='lazy';img.alt='Imagem do evento';img.src='/evento/'+encodeURIComponent(e.id);el.append(img)}eventos.append(el)}}
}catch(e){if(ciclo!==versao)return;document.getElementById('conexao').textContent='PC sem conexão';status.textContent='Não foi possível verificar a proteção';resumo.textContent=e.message;if(e.message.includes('Pareamento'))document.getElementById('parear').hidden=false;document.querySelectorAll('main img').forEach(i=>{i.hidden=true;i.removeAttribute('src')})}finally{ocupado=false;clearTimeout(timer);if(ativo)timer=setTimeout(atualizar,2000)}}
document.getElementById('atualizar').onclick=atualizar;document.getElementById('confirmar').onclick=async()=>{try{const link=document.getElementById('link');let token=link.value.trim();if(token.includes('#'))token=token.slice(token.indexOf('#')+1);const r=await fetch('/sessao',{method:'POST',headers:{'content-type':'text/plain'},body:token});link.value='';if(!r.ok)throw Error('Link inválido. Copie o link privado no computador.');ativo=true;document.getElementById('notificar').disabled=false;atualizar()}catch(e){erro.textContent=e.message}};
document.getElementById('notificar').onclick=async()=>{const b=document.getElementById('notificar');b.disabled=true;try{if(!('serviceWorker' in navigator)||!('PushManager' in window)||!('Notification' in window))throw Error('Instale a Íris na tela inicial e abra pelo ícone para ativar os alertas.');const permissao=await Notification.requestPermission();if(permissao!=='granted')throw Error('Permita as notificações nas configurações do celular.');await navigator.serviceWorker.register('/sw.js');const reg=await navigator.serviceWorker.ready;const {key}=await json('/push/chave');const raw=atob(key.replace(/-/g,'+').replace(/_/g,'/'));const bytes=Uint8Array.from(raw,c=>c.charCodeAt(0));const sub=await reg.pushManager.getSubscription()||await reg.pushManager.subscribe({userVisibleOnly:true,applicationServerKey:bytes});const r=await fetch('/push/inscrever',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({subscription:sub.toJSON(),nome:/iPhone|iPad/.test(navigator.userAgent)?'Minha Íris · iPhone':'Minha Íris · celular'})});const resposta=await r.json();if(!r.ok)throw Error(resposta.erro||'Falha ao ativar alertas.');erro.textContent='Alertas ativados neste celular.'}catch(e){erro.textContent=e.message}finally{b.disabled=false}};
(async()=>{try{const token=location.hash.slice(1);history.replaceState(null,'',location.pathname+location.search);if(token){const r=await fetch('/sessao',{method:'POST',headers:{'content-type':'text/plain'},body:token});if(!r.ok)throw Error('Pareamento inválido. Gere outro QR.')}if('serviceWorker' in navigator)navigator.serviceWorker.register('/sw.js').catch(()=>{});atualizar()}catch(e){erro.textContent=e.message}})();document.getElementById('sair').onclick=async()=>{ativo=false;versao++;clearTimeout(timer);document.querySelector('main').replaceChildren();document.getElementById('eventos').replaceChildren();assinaturaEventos='';try{if('serviceWorker' in navigator){const reg=await navigator.serviceWorker.getRegistration();const sub=await reg?.pushManager?.getSubscription();await sub?.unsubscribe()}}catch{}try{const controle=new AbortController(),tempo=setTimeout(()=>controle.abort(),8000);try{await fetch('/sair',{method:'POST',signal:controle.signal})}finally{clearTimeout(tempo)}}catch(e){erro.textContent='Reconecte para encerrar a sessão, ou revogue o acesso no computador.'}status.textContent='Painel desconectado.';document.getElementById('conexao').textContent='Desconectado';resumo.textContent='';document.getElementById('parear').hidden=false;document.getElementById('notificar').disabled=true};
</script></body></html>`
