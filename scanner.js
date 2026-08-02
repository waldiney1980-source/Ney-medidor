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

    /* Leitor próprio. Reduz o quadro para no máximo 640px no lado maior: acima
       disso o custo cresce sem melhorar a leitura, e o objetivo é sobrar tempo
       de processador para a prévia da câmera não travar na mão do leiturista. */
    const lona = document.createElement('canvas');
    const ctx = lona.getContext('2d', { willReadFrequently: true });

    const tickProprio = () => {
      if (done) return;
      const vw = video.videoWidth, vh = video.videoHeight;
      if (vw && vh) {
        const escala = Math.min(1, 640 / Math.max(vw, vh));
        lona.width = Math.round(vw * escala);
        lona.height = Math.round(vh * escala);
        ctx.drawImage(video, 0, 0, lona.width, lona.height);
        try {
          const texto = decodificar(ctx.getImageData(0, 0, lona.width, lona.height));
          if (texto) { achou(texto); return; }
        } catch { /* quadro ruim — tenta o próximo */ }
      }
      // intervalo em vez de quadro a quadro: a decodificação é pesada
      timer = setTimeout(tickProprio, 130);
    };
    timer = setTimeout(tickProprio, 250);
  });
}
