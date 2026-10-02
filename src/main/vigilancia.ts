import { randomUUID } from 'crypto'
import { Notification, nativeImage, powerSaveBlocker } from 'electron'
import { lerConfig, gravarConfig, listarEventosPerimetro, salvarEventoPerimetro, apagarEventosPerimetro } from './banco'
import { DetectorPessoas } from './detectorPessoas'
import { VigiaMotor } from './vigiaMotor'
import { FilaAlertas, estadoPush } from './notificacoesCelular'
import { PADRAO_VIGILANCIA, horarioAtivo, validarAjustes, type AjustesVigilancia, type EstadoVigilancia, type EventoVigilancia } from '../shared/vigilancia'
import type { criarCentralCameras } from './centralCameras'

export class Vigilancia {
  private modo:EstadoVigilancia['modo']='desarmado'
  private erro=''
  private ciclo=0
  private blocker:number|null=null
  private timer:NodeJS.Timeout|null=null
  private detector=new DetectorPessoas()
  private motor:VigiaMotor
  private fila:FilaAlertas
  private porAgenda=false
  private tentativaAgenda=0
  constructor(private central:ReturnType<typeof criarCentralCameras>) {
    this.motor=new VigiaMotor({listar:()=>central.listar(),quadro:id=>central.quadro(id),analisar:(j,c)=>this.detector.analisar(j,c),evento:(e,j)=>this.evento(e,j)})
    this.fila=new FilaAlertas(()=>listarEventosPerimetro(this.ajustes().retencaoDias),salvarEventoPerimetro)
  }
  ajustes():AjustesVigilancia { return (lerConfig('vigilancia') as AjustesVigilancia|null) ?? structuredClone(PADRAO_VIGILANCIA) }
  ativo():boolean { return this.modo==='armado'||this.modo==='preparando' }
  protegido(id:string):boolean { return this.ativo()&&this.ajustes().cameras.some(c=>c.cameraId===id) }
  salvar(valor:AjustesVigilancia):void {
    if(this.ativo()) throw new Error('Desarme o modo Fora de casa antes de alterar as áreas e os horários.')
    const v=validarAjustes(valor)
    if(v.cameras.some(c=>!this.central.listar().some(x=>x.id===c.cameraId))) throw new Error('Uma câmera não existe mais. Atualize a seleção.')
    gravarConfig('vigilancia',v)
  }
  estado():EstadoVigilancia {
    return {modo:this.modo,erro:this.erro,modelo:'YOLOS tiny · pessoas · processamento local',ajustes:this.ajustes(),cameras:this.motor.estado(),eventos:listarEventosPerimetro(this.ajustes().retencaoDias).slice(0,100),notificacoes:estadoPush()}
  }
  async armar(agenda=false):Promise<void> {
    if(this.ativo()) return
    const ajustes=validarAjustes(this.ajustes())
    if(!ajustes.cameras.length) throw new Error('Marque uma área em pelo menos uma câmera.')
    if(ajustes.cameras.some(c=>!this.central.listar().some(x=>x.id===c.cameraId))) throw new Error('Uma câmera protegida foi removida.')
    const ciclo=++this.ciclo; this.modo='preparando'; this.erro=''; this.porAgenda=agenda
    this.blocker=powerSaveBlocker.start('prevent-app-suspension')
    try {
      await this.detector.iniciar()
      if(ciclo!==this.ciclo) return
      for(const c of ajustes.cameras) {
        await this.central.conectar(c.cameraId)
        if(ciclo!==this.ciclo) return
      }
      this.motor.armar(ajustes); this.modo='armado'
    } catch(e) {
      if(ciclo!==this.ciclo) return
      this.desarmar(false); this.modo='erro'; this.erro=(e as Error).message
      throw new Error(this.erro)
    }
  }
  desarmar(desligarAgenda=true):void {
    this.ciclo++; this.motor.parar(); this.detector.parar(); this.modo='desarmado'; this.erro=''; this.porAgenda=false
    if(this.blocker!==null) { powerSaveBlocker.stop(this.blocker); this.blocker=null }
    if(desligarAgenda) { const c=this.ajustes(); if(c.agenda.ativa) gravarConfig('vigilancia',{...c,agenda:{...c.agenda,ativa:false}}) }
  }
  privacidade():void {
    this.desarmar(); this.fila.cancelar()
    for(const e of listarEventosPerimetro(this.ajustes().retencaoDias)) if(e.entrega==='pendente') salvarEventoPerimetro({...e,entrega:'desativado',erro:'Cancelado pelo modo privacidade.'})
  }
  limpar():void { this.fila.cancelar(); apagarEventosPerimetro() }
  repetir(id:string):void {
    const e=listarEventosPerimetro(this.ajustes().retencaoDias).find(e=>e.id===id)
    if(e && e.entrega==='falhou') salvarEventoPerimetro({...e,entrega:'pendente',erro:undefined})
  }
  testar(): void {
    if (!estadoPush().configurado) throw new Error('Ative as notifica??es na ?ris do celular primeiro.')
    this.evento({id:randomUUID(),momento:Date.now(),cameraId:'',camera:'Seguran?a',tipo:'sistema',texto:'Teste de alerta da ?ris. Seu celular est? conectado.',entrega:'pendente'})
  }
  private evento(e:EventoVigilancia,jpeg?:string):void {
    if(jpeg && this.ajustes().guardarImagem) {
      const img=nativeImage.createFromBuffer(Buffer.from(jpeg,'base64'))
      if(!img.isEmpty()) e.imagem=`data:image/jpeg;base64,${img.resize({width:640}).toJPEG(65).toString('base64')}`
    }
    e.entrega=estadoPush().configurado?'pendente':'desativado'
    salvarEventoPerimetro(e)
    if(Notification.isSupported()) new Notification({title:`Íris · ${e.camera}`,body:e.texto}).show()
  }
  iniciar():void {
    if(this.timer) return
    this.timer=setInterval(()=>{
      void this.motor.tique(); void this.fila.tique()
      const a=this.ajustes(), horario=horarioAtivo(a.agenda)
      if(horario && !this.ativo() && Date.now()-this.tentativaAgenda>60000) {this.tentativaAgenda=Date.now();void this.armar(true).catch(()=>{})}
      else if(!horario && this.porAgenda) this.desarmar(false)
    },1000)
  }
  fechar():void { if(this.timer)clearInterval(this.timer); this.timer=null;this.desarmar(false);this.fila.cancelar() }
}
