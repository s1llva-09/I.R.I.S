import { useEffect } from 'react'

// Ciclo de captura independente da navegação. O main valida a sessão de cada quadro.
export default function WebcamsContinuas(): null {
  useEffect(()=>{
    let morto=false,consultando=false
    const sessoes=new Map<string,{sessao:string;parar:()=>void}>()
    const atualizar=async ():Promise<void>=>{
      if(consultando)return
      consultando=true
      try {
        const cameras=await window.api.central.listar()
        if(morto)return
        for(const [id,s] of sessoes) if(!cameras.some(c=>c.id===id&&c.tipo==='webcam'&&c.ligada&&c.sessao===s.sessao)) {s.parar();sessoes.delete(id)}
        for(const c of cameras.filter(c=>c.tipo==='webcam'&&c.ligada&&c.sessao)) {
          if(sessoes.has(c.id))continue
          let cancelado=false,stream:MediaStream|null=null,ultimoTempo=-1,ultimoQuadro=0,abrindo=false,ultimaTentativa=0,negado=false
          const video=document.createElement('video');video.muted=true;video.playsInline=true
          const canvas=document.createElement('canvas');canvas.width=640;canvas.height=480
          const abrir=async ():Promise<void>=>{
            if(cancelado||abrindo||negado)return
            abrindo=true;ultimaTentativa=Date.now();stream?.getTracks().forEach(t=>t.stop())
            try {
              const s=await navigator.mediaDevices.getUserMedia({audio:false,video:{deviceId:{exact:c.endereco},width:{ideal:640},height:{ideal:480},frameRate:{ideal:5}}})
              if(cancelado){s.getTracks().forEach(t=>t.stop());return}
              stream=s;video.srcObject=s;await video.play();ultimoTempo=-1
            } catch(e) {negado=['NotAllowedError','SecurityError'].includes((e as Error).name)}
            finally{abrindo=false}
          }
          const timer=window.setInterval(()=>{
            if(cancelado)return
            if(video.readyState>=2&&video.videoWidth&&video.currentTime!==ultimoTempo&&stream?.getVideoTracks()[0]?.readyState==='live'){
              ultimoTempo=video.currentTime;ultimoQuadro=Date.now()
              canvas.height=Math.max(1,Math.round(640*video.videoHeight/video.videoWidth))
              canvas.getContext('2d')!.drawImage(video,0,0,canvas.width,canvas.height)
              window.api.central.webcam(c.id,c.sessao!,canvas.toDataURL('image/jpeg',0.65).split(',')[1])
            }else if(Date.now()-Math.max(ultimaTentativa,ultimoQuadro)>6000)void abrir()
          },200)
          sessoes.set(c.id,{sessao:c.sessao!,parar:()=>{cancelado=true;window.clearInterval(timer);stream?.getTracks().forEach(t=>t.stop());video.pause();video.srcObject=null}})
          void abrir()
        }
      }catch{/* Sem main, a próxima consulta tenta novamente. */}finally{consultando=false}
    }
    void atualizar();const timer=window.setInterval(()=>void atualizar(),1000)
    return()=>{morto=true;window.clearInterval(timer);for(const s of sessoes.values())s.parar()}
  },[])
  return null
}
