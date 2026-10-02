import { safeStorage } from 'electron'
import webpush from 'web-push'
import { randomUUID } from 'crypto'
import { lerConfig, gravarConfig } from './banco'
import type { EventoVigilancia } from '../shared/vigilancia'
type Dispositivo={id:string;nome:string;subscription:webpush.PushSubscription}
const dispositivos=():Dispositivo[] => (lerConfig('celularesPush') as Dispositivo[]|null)??[]
export function estadoPush():{configurado:boolean;dispositivos:{id:string;nome:string}[]} {const ds=dispositivos();return{configurado:!!ds.length,dispositivos:ds.map(({id,nome})=>({id,nome}))}}
function chaves():{publicKey:string;privateKey:string} {
  if(!safeStorage.isEncryptionAvailable())throw new Error('Armazenamento seguro indisponível.')
  const salvas=lerConfig('chavesPush') as {publicKey:string;privateKey:string}|null
  if(salvas)return{publicKey:salvas.publicKey,privateKey:safeStorage.decryptString(Buffer.from(salvas.privateKey,'base64'))}
  const novas=webpush.generateVAPIDKeys()
  gravarConfig('chavesPush',{publicKey:novas.publicKey,privateKey:safeStorage.encryptString(novas.privateKey).toString('base64')})
  return novas
}
export function chavePublicaPush():string {return chaves().publicKey}
export function cadastrarPush(subscription:webpush.PushSubscription,nome:string):void {
  let url:URL
  try{url=new URL(subscription.endpoint)}catch{throw new Error('Inscrição de notificação inválida.')}
  const permitido=['fcm.googleapis.com','updates.push.services.mozilla.com','web.push.apple.com'].includes(url.hostname)||url.hostname.endsWith('.push.apple.com')||url.hostname.endsWith('.notify.windows.com')
  if(url.protocol!=='https:'||!permitido||url.username||url.password||url.port&&url.port!=='443'||url.href.length>2048)throw new Error('Serviço de notificações não suportado neste navegador.')
  if(!subscription.keys || [subscription.keys.auth,subscription.keys.p256dh].some(k=>typeof k!=='string'||! /^[A-Za-z0-9_=-]{16,200}$/.test(k)))throw new Error('Chaves de notificação inválidas.')
  const ds=dispositivos(),antigo=ds.find(d=>d.subscription.endpoint===subscription.endpoint)
  if(!antigo&&ds.length>=5)throw new Error('Limite de cinco celulares. Remova um no computador.')
  const d={id:antigo?.id??randomUUID(),nome:String(nome||'Meu celular').slice(0,60),subscription}
  gravarConfig('celularesPush',antigo?ds.map(x=>x.id===d.id?d:x):[...ds,d])
}
export function removerPush(id:string):void {gravarConfig('celularesPush',dispositivos().filter(d=>d.id!==id))}
export function revogarPush():void {gravarConfig('celularesPush',[])}
export class FilaAlertas {
  private ocupada=false
  private versao=0
  private tentativas=new Map<string,{n:number;quando:number}>()
  constructor(private listar:()=>EventoVigilancia[],private salvar:(e:EventoVigilancia)=>void){}
  cancelar():void {this.versao++;this.tentativas.clear()}
  async tique():Promise<void> {
    if(this.ocupada)return
    const e=this.listar().find(e=>e.entrega==='pendente'&&(this.tentativas.get(e.id)?.quando??0)<=Date.now())
    if(!e)return
    if(Date.now()-e.momento>3600000){this.salvar({...e,entrega:'falhou',erro:'Alerta expirou sem entrega em uma hora.'});return}
    const ds=dispositivos()
    if(!ds.length){this.salvar({...e,entrega:'desativado',erro:'Nenhum celular com notificações ativadas.'});return}
    const ciclo=this.versao;this.ocupada=true
    const enviados=[...(e.enviados??[])]
    try {
      const keys=chaves()
      for(const d of ds) {
        if(ciclo!==this.versao) return
        if(enviados.includes(d.id))continue
        try {
          await webpush.sendNotification(d.subscription,JSON.stringify({title:`Íris · ${e.camera}`,body:e.texto,id:e.id}),{TTL:3600,timeout:15000,vapidDetails:{subject:'mailto:admin@iris.local',publicKey:keys.publicKey,privateKey:keys.privateKey}})
          enviados.push(d.id)
        }catch(erro){if([404,410].includes((erro as {statusCode?:number}).statusCode??0))removerPush(d.id);throw new Error('Não foi possível entregar a todos os celulares. Confira a internet e as permissões.')}
      }
      if(ciclo===this.versao){this.salvar({...e,enviados,entrega:'enviado',erro:undefined});this.tentativas.delete(e.id)}
    }catch(erro){
      const n=(this.tentativas.get(e.id)?.n??0)+1;this.tentativas.set(e.id,{n,quando:Date.now()+Math.min(300000,15000*2**n)})
      if(ciclo===this.versao)this.salvar({...e,enviados,entrega:n>=4?'falhou':'pendente',erro:(erro as Error).message})
    }finally{this.ocupada=false}
  }
}
