// Leitor de QR Code / código de barras da etiqueta do medidor.
//
// O leitor próprio (qr-decode.js) é o caminho principal, porque funciona em
// qualquer navegador com câmera. A Barcode Detection API do navegador entra
// apenas como tentativa extra, quando declara suportar qr_code — e sai de cena
// sozinha se ficar alguns segundos sem achar nada.
//
// A ordem importa: confiar na API só porque ela existe deixou o Chrome do
// Windows com a câmera aberta e sem ler nada, enquanto o iPhone, que não tem a
// API, lia normalmente pelo leitor próprio.

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
  let stream = null, timer = 0, done = false;

  const cleanup = () => {
    done = true;
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

    /* O leitor próprio é o caminho PRINCIPAL, e a API do navegador vira apenas
       uma tentativa extra.
     *
     * A versão anterior fazia o contrário: bastava a API existir para o app se
     * entregar a ela. No Chrome do Windows ela existe e não lê código nenhum —
     * a câmera abria e nunca reconhecia nada, enquanto o mesmo app no iPhone,
     * que não tem a API e caía no leitor próprio, funcionava. Perguntar "existe?"
     * não serve; o que vale é se lê.
     *
     * A API só é usada quando ela mesma declara suportar qr_code, e ainda assim
     * é desligada se ficar um tempo sem achar nada — nesse caso não custa nada
     * parar de tentar. */
    let detector = null;
    try {
      if ('BarcodeDetector' in window) {
        const suportados = await window.BarcodeDetector.getSupportedFormats();
        if (suportados && suportados.includes('qr_code')) {
          detector = new window.BarcodeDetector({
            formats: ['qr_code', 'code_128', 'code_39', 'ean_13', 'data_matrix'],
          });
        }
      }
    } catch { detector = null; }

    const DESISTIR_DA_API_MS = 3000;
    const comecouEm = Date.now();

    /* Duas formas de olhar o mesmo quadro, alternadas:
       1. QUADRO INTEIRO reduzido a 720px — pega o código onde ele estiver, e é
          o que funciona quando a etiqueta preenche boa parte da tela.
       2. RECORTE CENTRAL em resolução cheia — salva a etiqueta pequena ou
          distante. Reduzir o quadro todo espreme o QR a poucos pixels por
          módulo e ele deixa de fechar; recortando o meio, cada módulo mantém o
          tamanho que a câmera capturou. */
    const lona = document.createElement('canvas');
    const ctx = lona.getContext('2d', { willReadFrequently: true });
    let modo = 0;

    const tickProprio = async () => {
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

          /* A API primeiro, quando há: é rápida e também lê código de barras.
             Recebe o canvas, não o elemento de vídeo — alguns navegadores só
             funcionam com um dos dois. */
          if (detector) {
            try {
              const codes = await detector.detect(lona);
              if (codes && codes.length) { achou(codes[0].rawValue); return; }
            } catch { detector = null; }
            if (detector && Date.now() - comecouEm > DESISTIR_DA_API_MS) detector = null;
          }
          if (done) return;

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
