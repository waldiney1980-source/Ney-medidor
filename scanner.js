// Leitor de QR Code / código de barras da etiqueta do medidor.
// Usa a Barcode Detection API quando disponível; senão, oferece digitação manual.

import { icon, toast } from './ui.js';

export const scannerSupported = () =>
  'BarcodeDetector' in window && !!(navigator.mediaDevices && navigator.mediaDevices.getUserMedia);

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
  let stream = null, raf = 0, done = false;

  const cleanup = () => {
    done = true;
    cancelAnimationFrame(raf);
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

    const detector = new window.BarcodeDetector({
      formats: ['qr_code', 'code_128', 'code_39', 'ean_13', 'data_matrix'],
    });

    const tick = async () => {
      if (done) return;
      try {
        const codes = await detector.detect(video);
        if (codes && codes.length) {
          if (navigator.vibrate) navigator.vibrate(35);
          finish(String(codes[0].rawValue || '').trim());
          return;
        }
      } catch { /* frame inválido — segue para o próximo */ }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
  });
}
