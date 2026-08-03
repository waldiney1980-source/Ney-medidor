// Utilitários gerais — formatação pt-BR, datas, arquivos.

/** UUID v4 — precisa ser um uuid válido para as colunas do Postgres/Supabase. */
export function uid() {
  if (crypto.randomUUID) return crypto.randomUUID();
  const b = new Uint8Array(16);
  crypto.getRandomValues(b);
  b[6] = (b[6] & 0x0f) | 0x40;
  b[8] = (b[8] & 0x3f) | 0x80;
  const h = [...b].map((x) => x.toString(16).padStart(2, '0')).join('');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}

export const nowMs = () => Date.now();

/* ---------------- números ---------------- */

const nf = (min, max) => new Intl.NumberFormat('pt-BR', { minimumFractionDigits: min, maximumFractionDigits: max });

export function fmt(n, decimals = 0) {
  if (n === null || n === undefined || Number.isNaN(n)) return '—';
  return nf(decimals, decimals).format(n);
}

/** Decimais adaptativos: valores pequenos ganham precisão. */
/**
 * Valor de uma LEITURA de medidor.
 *
 * Diferente de fmtAuto, que escolhe a precisão pelo tamanho do número: numa
 * leitura as casas decimais são os dígitos vermelhos do relógio, e cortá-las
 * muda o que a pessoa vê em relação ao que está no visor. Inteiro sai inteiro;
 * com fração, sempre duas casas.
 */
export function fmtLeitura(n) {
  if (n === null || n === undefined || Number.isNaN(Number(n))) return '—';
  const v = Number(n);
  return Number.isInteger(v) ? nf(0, 0).format(v) : nf(2, 2).format(v);
}

export function fmtAuto(n) {
  if (n === null || n === undefined || Number.isNaN(n)) return '—';
  const a = Math.abs(n);
  if (a === 0) return '0';
  if (a < 1) return nf(0, 3).format(n);
  if (a < 100) return nf(0, 2).format(n);
  if (a < 10000) return nf(0, 1).format(n);
  return nf(0, 0).format(n);
}

export function fmtCompact(n) {
  if (n === null || n === undefined || Number.isNaN(n)) return '—';
  const a = Math.abs(n);
  if (a >= 1e6) return nf(0, 1).format(n / 1e6) + 'M';
  if (a >= 10000) return nf(0, 1).format(n / 1000) + 'k';
  return fmtAuto(n);
}

export function fmtMoney(n) {
  if (n === null || n === undefined || Number.isNaN(n)) return '—';
  return new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(n);
}

/** Moeda compacta para cartões de indicador; o valor exato vai no title/tabela. */
export function fmtMoneyCompact(n) {
  if (n === null || n === undefined || Number.isNaN(n)) return '—';
  const a = Math.abs(n);
  if (a >= 1e6) return 'R$ ' + nf(1, 1).format(n / 1e6) + ' mi';
  if (a >= 10000) return 'R$ ' + nf(1, 1).format(n / 1000) + ' mil';
  return fmtMoney(n);
}

export function fmtPct(n, decimals = 1) {
  if (n === null || n === undefined || !Number.isFinite(n)) return '—';
  return (n > 0 ? '+' : '') + nf(decimals, decimals).format(n) + '%';
}

export const clamp = (v, a, b) => Math.min(b, Math.max(a, v));

/** Converte "1.234,56" ou "1234.56" em Number. */
export function parseNum(s) {
  if (typeof s === 'number') return s;
  if (!s) return NaN;
  let t = String(s).trim().replace(/\s/g, '');
  if (t.includes(',')) t = t.replace(/\./g, '').replace(',', '.');
  const v = Number(t);
  return Number.isFinite(v) ? v : NaN;
}

/* ---------------- datas (ISO yyyy-mm-dd, hora local) ---------------- */

export function todayISO() {
  const d = new Date();
  return isoOf(d);
}

export function isoOf(d) {
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

export function dateOf(iso) {
  const [y, m, d] = String(iso).slice(0, 10).split('-').map(Number);
  return new Date(y, (m || 1) - 1, d || 1);
}

export function addDaysISO(iso, days) {
  const d = dateOf(iso);
  d.setDate(d.getDate() + days);
  return isoOf(d);
}

export function addMonthsISO(iso, months) {
  const d = dateOf(iso);
  d.setMonth(d.getMonth() + months);
  return isoOf(d);
}

export function daysBetween(isoA, isoB) {
  return Math.round((dateOf(isoB) - dateOf(isoA)) / 86400000);
}

export function fmtDate(iso) {
  if (!iso) return '—';
  const d = dateOf(iso);
  return d.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric' });
}

export function fmtDateShort(iso) {
  if (!iso) return '—';
  return dateOf(iso).toLocaleDateString('pt-BR', { day: '2-digit', month: 'short' }).replace('.', '');
}

/** Rótulo compacto para eixos de gráfico: 28/06 */
export function fmtAxisDate(iso) {
  if (!iso) return '';
  const s = String(iso).slice(0, 10).split('-');
  return `${s[2]}/${s[1]}`;
}

export function fmtDateTime(ms) {
  if (!ms) return '—';
  return new Date(ms).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
}

export function relTime(ms) {
  if (!ms) return 'nunca';
  const diff = Date.now() - ms;
  if (diff < 60000) return 'agora';
  if (diff < 3600000) return `há ${Math.floor(diff / 60000)} min`;
  if (diff < 86400000) return `há ${Math.floor(diff / 3600000)} h`;
  if (diff < 7 * 86400000) return `há ${Math.floor(diff / 86400000)} d`;
  return fmtDateTime(ms);
}

export const monthKey = (iso) => String(iso).slice(0, 7);

export function monthLabel(key) {
  const [y, m] = key.split('-').map(Number);
  const d = new Date(y, m - 1, 1);
  const mon = d.toLocaleDateString('pt-BR', { month: 'short' }).replace('.', '');
  return `${mon}/${String(y).slice(2)}`;
}

/* ---------------- DOM ---------------- */

export function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

export function el(html) {
  const t = document.createElement('template');
  t.innerHTML = html.trim();
  return t.content.firstElementChild;
}

export function debounce(fn, ms = 180) {
  let t;
  return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); };
}

/* ---------------- arquivos ---------------- */

export function downloadFile(filename, content, type = 'text/plain;charset=utf-8') {
  const blob = content instanceof Blob ? content : new Blob(['﻿' + content], { type });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = filename;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

export function toCSV(rows, headers) {
  const cell = (v) => {
    const s = v === null || v === undefined ? '' : String(v);
    return /[";\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
  };
  const head = headers.map((h) => cell(h.label)).join(';');
  const body = rows.map((r) => headers.map((h) => cell(h.get(r))).join(';'));
  return [head, ...body].join('\r\n');
}

/**
 * Decodifica o arquivo uma única vez.
 *
 * Usa objectURL + Image de propósito. O createImageBitmap parece o caminho
 * moderno, mas medido com foto de 12 MP ele saiu ~30× mais lento (128 ms contra
 * 4 ms): ele decodifica tudo na hora, enquanto o Image aproveita o caminho
 * otimizado do navegador. E o FileReader empata em tempo mas gasta memória à
 * toa convertendo o arquivo inteiro para base64 antes de decodificar.
 */
async function decodificarFoto(file) {
  const url = URL.createObjectURL(file);
  try {
    const img = new Image();
    await new Promise((ok, erro) => {
      img.onload = ok;
      img.onerror = () => erro(new Error('Imagem inválida'));
      img.src = url;
    });
    return img;
  } finally {
    setTimeout(() => URL.revokeObjectURL(url), 0);
  }
}

/**
 * Gera várias reduções da mesma foto decodificando o arquivo UMA vez.
 *
 * Chamar compressImage duas vezes custava o dobro: cada chamada relia o arquivo
 * e decodificava de novo o JPEG de 12 megapixels da câmera, que é a parte cara.
 * Aqui a decodificação é única e só a etapa de desenhar/comprimir se repete.
 *
 * @param {File} file
 * @param {Array<{maxSide:number, quality:number}>} versoes
 * @returns {Promise<string[]>} data URLs na mesma ordem
 */
export async function compressImageMulti(file, versoes) {
  const fonte = await decodificarFoto(file);
  const largura = fonte.width, altura = fonte.height;
  const c = document.createElement('canvas');
  const ctx = c.getContext('2d');
  const saida = versoes.map(({ maxSide, quality }) => {
    const escala = Math.min(1, maxSide / Math.max(largura, altura));
    c.width = Math.round(largura * escala);
    c.height = Math.round(altura * escala);
    ctx.drawImage(fonte, 0, 0, c.width, c.height);
    return c.toDataURL('image/jpeg', quality);
  });
  if (fonte.close) fonte.close();
  return saida;
}

/** Redimensiona e comprime uma foto para armazenamento/sync. */
export function compressImage(file, maxSide = 1280, quality = 0.62) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error('Falha ao ler a imagem'));
    reader.onload = () => {
      const img = new Image();
      img.onerror = () => reject(new Error('Imagem inválida'));
      img.onload = () => {
        const scale = Math.min(1, maxSide / Math.max(img.width, img.height));
        const w = Math.round(img.width * scale);
        const h = Math.round(img.height * scale);
        const c = document.createElement('canvas');
        c.width = w; c.height = h;
        const ctx = c.getContext('2d');
        ctx.drawImage(img, 0, 0, w, h);
        resolve(c.toDataURL('image/jpeg', quality));
      };
      img.src = reader.result;
    };
    reader.readAsDataURL(file);
  });
}

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
