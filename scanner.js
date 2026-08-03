// Leitor de QR Code / código de barras da etiqueta do medidor.
//
// Usa a Barcode Detection API quando o navegador tem (Chrome no Android) e cai
// no leitor próprio (qr-decode.js) quando não tem — que é o caso do Safari, ou
// seja, de todo iPhone. Sem esse segundo caminho, o botão de QR não abria a
// câmera no iPhone e sobrava digitar o código na mão.

import { icon, toast } from './ui.js';
import { decodificar } from './qr-decode.js';

/** Basta ter câmera: sem a API do navegador, a leitura é feita aqui mesmo. */
export const scannerSupported = () => !!(navigator.mediaDevices && navigator.mediaDevices.getUserMedia);

export const cameraSupported = () => !!(navigator.mediaDevices && navigator.mediaDevices.getUserMedia);

/**
 * Abre a câmera e resolve com o texto lido, ou null se o usuário cancelar.
 */
export async function scanCode() {
  if (!scannerSupported()) {
    toast('Este navegador não suporta leitura de código. Use a busca por nome ou código.', 'info', 4200);
    return null;
  }

  const overlay = document.createElement('div');
  overlay.className = 'scanner';
  overlay.innerHTML = `
    <video playsinline muted autoplay></video>
    <div class="scanner__overlay"><div class="scanner__frame"></div></div>
    <div class="scanner__bar">
      <button class="icon-btn" data-act="close" aria-label="Fechar" style="color:#fff;background:rgba(0,0,0,.4)">${icon('close', 22)}</button>
      <span class="grow" style="font-size:14px;font-weight:600">Aponte para o código do medidor</span>
      <button class="icon-btn" data-act="torch" aria-label="Lanterna" hidden style="color:#fff;background:rgba(0,0,0,.4)">${icon('bolt', 22)}</button>
    </div>
    <p class="scanner__hint">Mantenha a etiqueta dentro da moldura</p>`;
  document.body.appendChild(overlay);

  const video = overlay.querySelector('video');
  let stream = null, raf = 0, timer = 0, done = false;

  const cleanup = () => {
    done = true;
    cancelAnimationFrame(raf);
    clearTimeout(timer);
    if (stream) stream.getTracks().forEach((t) => t.stop());
    overlay.remove();
  };

  return new Promise(async (resolve) => {
    const finish = (value) => { if (!done) { cleanup(); resolve(value); } };
    overlay.querySelector('[data-act="close"]').onclick = () => finish(null);

    try {
      stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: { ideal: 'environment' }, width: { ideal: 1280 } },
        audio: false,
      });
      video.srcObject = stream;
      await video.play();
    } catch (e) {
      finish(null);
      toast('Não foi possível acessar a câmera. Verifique a permissão do navegador.', 'error', 4200);
      return;
    }

    const track = stream.getVideoTracks()[0];
    const caps = track.getCapabilities ? track.getCapabilities() : {};
    if (caps && caps.torch) {
      const btn = overlay.querySelector('[data-act="torch"]');
      btn.hidden = false;
      let on = false;
      btn.onclick = () => { on = !on; track.applyConstraints({ advanced: [{ torch: on }] }).catch(() => {}); };
    }

    const achou = (valor) => {
      if (navigator.vibrate) navigator.vibrate(35);
      finish(String(valor || '').trim());
    };

    if ('BarcodeDetector' in window) {
      const detector = new window.BarcodeDetector({
        formats: ['qr_code', 'code_128', 'code_39', 'ean_13', 'data_matrix'],
      });
      const tick = async () => {
        if (done) return;
        try {
          const codes = await detector.detect(video);
          if (codes && codes.length) { achou(codes[0].rawValue); return; }
        } catch { /* quadro inválido — segue para o próximo */ }
        raf = requestAnimationFrame(tick);
      };
      raf = requestAnimationFrame(tick);
      return;
    }

    /* Leitor próprio, alternando duas formas de olhar o mesmo quadro:

       1. QUADRO INTEIRO reduzido a 720px — pega o código onde ele estiver, e é
          o que funciona quando a etiqueta preenche boa parte da tela.
       2. RECORTE CENTRAL em resolução cheia — é o que salva a etiqueta pequena
          ou distante. Reduzir o quadro todo espreme o QR a poucos pixels por
          módulo e ele deixa de fechar; recortando o meio, cada módulo mantém o
          tamanho que a câmera capturou.

       Alternar sai mais barato que fazer as duas por quadro, e a mão treme o
       bastante para as duas verem cenas ligeiramente diferentes. */
    const lona = document.createElement('canvas');
    const ctx = lona.getContext('2d', { willReadFrequently: true });
    let modo = 0;

    const tickProprio = () => {
      if (done) return;
      const vw = video.videoWidth, vh = video.videoHeight;
      if (vw && vh) {
        try {
          if (modo === 0) {
            const escala = Math.min(1, 720 / Math.max(vw, vh));
            lona.width = Math.round(vw * escala);
            lona.height = Math.round(vh * escala);
            ctx.drawImage(video, 0, 0, lona.width, lona.height);
          } else {
            // quadrado central, do tamanho do lado menor, com folga de 15%
            const lado = Math.min(vw, vh) * 0.85;
            const sx = (vw - lado) / 2, sy = (vh - lado) / 2;
            const destino = Math.min(900, Math.round(lado));
            lona.width = destino;
            lona.height = destino;
            ctx.drawImage(video, sx, sy, lado, lado, 0, 0, destino, destino);
          }
          const texto = decodificar(ctx.getImageData(0, 0, lona.width, lona.height));
          if (texto) { achou(texto); return; }
        } catch { /* quadro ruim — tenta o próximo */ }
        modo = modo ? 0 : 1;
      }
      // intervalo em vez de quadro a quadro: a decodificação é pesada
      timer = setTimeout(tickProprio, 120);
    };
    timer = setTimeout(tickProprio, 250);
  });
}
