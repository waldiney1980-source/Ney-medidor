// Leitura do visor direto no aparelho, sem internet e sem servidor.
//
// Cobre medidores digitais (LCD/LED de sete segmentos), que são a maioria dos
// de energia. Relógio de ponteiro ou de rodinhas impressas não é reconhecido
// aqui — nesses casos o valor é digitado e o servidor confere depois.
//
// O caminho é: achar a faixa horizontal onde estão os dígitos, cortar essa
// faixa em colunas de tinta (cada dígito é uma coluna), e em cada dígito medir
// quais dos sete traços estão acesos.

const LARGURA_MAX = 900;

/** Traços acesos → dígito. Ordem: a b c d e f g. */
const PADROES = {
  '1111110': '0',
  '0110000': '1',
  '1101101': '2',
  '1111001': '3',
  '0110011': '4',
  '1011011': '5',
  '1011111': '6',
  '1110000': '7',
  '1111111': '8',
  '1111011': '9',
};

/** Janela de cada traço dentro da caixa do dígito, em fração da caixa. */
const TRACOS = [
  [0.28, 0.02, 0.72, 0.18],   // a — topo
  [0.72, 0.12, 0.98, 0.44],   // b — canto superior direito
  [0.72, 0.56, 0.98, 0.88],   // c — canto inferior direito
  [0.28, 0.82, 0.72, 0.98],   // d — base
  [0.02, 0.56, 0.28, 0.88],   // e — canto inferior esquerdo
  [0.02, 0.12, 0.28, 0.44],   // f — canto superior esquerdo
  [0.28, 0.43, 0.72, 0.57],   // g — meio
];

const ACESO = 0.40;   // fração de pixels a partir da qual o traço conta como aceso

/* ---------------- preparo da imagem ---------------- */

function carregar(dataUrl) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('Não consegui abrir a foto.'));
    img.src = dataUrl;
  });
}

function cinza(fonte, larguraNatural, alturaNatural) {
  const escala = Math.min(1, LARGURA_MAX / larguraNatural);
  const w = Math.max(1, Math.round(larguraNatural * escala));
  const h = Math.max(1, Math.round(alturaNatural * escala));
  const cv = document.createElement('canvas');
  cv.width = w; cv.height = h;
  const ctx = cv.getContext('2d', { willReadFrequently: true });
  ctx.drawImage(fonte, 0, 0, w, h);
  const px = ctx.getImageData(0, 0, w, h).data;
  const g = new Uint8ClampedArray(w * h);
  for (let i = 0, j = 0; i < px.length; i += 4, j++) {
    g[j] = (px[i] * 0.299 + px[i + 1] * 0.587 + px[i + 2] * 0.114) | 0;
  }
  return { g, w, h };
}

/** Limiar de Otsu: separa figura e fundo sem ajuste manual. */
function otsu(g) {
  const hist = new Array(256).fill(0);
  for (const v of g) hist[v]++;
  const total = g.length;
  let soma = 0;
  for (let i = 0; i < 256; i++) soma += i * hist[i];
  let somaB = 0, pesoB = 0, melhor = -1, limiar = 127;
  for (let t = 0; t < 256; t++) {
    pesoB += hist[t];
    if (!pesoB) continue;
    const pesoF = total - pesoB;
    if (!pesoF) break;
    somaB += t * hist[t];
    const mB = somaB / pesoB;
    const mF = (soma - somaB) / pesoF;
    const entre = pesoB * pesoF * (mB - mF) * (mB - mF);
    if (entre > melhor) { melhor = entre; limiar = t; }
  }
  return limiar;
}

/* ---------------- faixas e colunas ---------------- */

/** Trechos contínuos de um vetor acima do limite, com folga para pequenos furos. */
function trechos(vetor, minimo, furoTolerado) {
  const out = [];
  let ini = -1, vazio = 0;
  for (let i = 0; i < vetor.length; i++) {
    if (vetor[i] > minimo) {
      if (ini < 0) ini = i;
      vazio = 0;
    } else if (ini >= 0) {
      vazio++;
      if (vazio > furoTolerado) { out.push([ini, i - vazio]); ini = -1; vazio = 0; }
    }
  }
  if (ini >= 0) out.push([ini, vetor.length - 1 - vazio]);
  return out.filter(([a, b]) => b >= a);
}

/**
 * Faixas horizontais candidatas a conter a fileira de dígitos.
 *
 * Um número como "0000" não tem nenhum traço do meio aceso, então a linha
 * inteira fica sem tinta no centro e a faixa se parte em duas. Por isso, além
 * das faixas soltas, também são testadas as junções de faixas vizinhas.
 */
function faixas(bin, w, h) {
  const porLinha = new Int32Array(h);
  for (let y = 0; y < h; y++) {
    let n = 0;
    const base = y * w;
    for (let x = 0; x < w; x++) n += bin[base + x];
    porLinha[y] = n;
  }

  const brutas = trechos(porLinha, Math.max(2, w * 0.008), Math.max(2, h * 0.012))
    .map(([y0, y1]) => ({ y0, y1 }))
    .sort((a, b) => a.y0 - b.y0);

  const montar = (y0, y1) => {
    let tinta = 0;
    for (let y = y0; y <= y1; y++) tinta += porLinha[y];
    return { y0, y1, alt: y1 - y0 + 1, tinta };
  };

  const cands = [];
  for (let i = 0; i < brutas.length; i++) {
    cands.push(montar(brutas[i].y0, brutas[i].y1));
    // junta com até duas vizinhas, quando o vão entre elas for pequeno
    for (let j = i + 1; j < Math.min(brutas.length, i + 3); j++) {
      const y0 = brutas[i].y0, y1 = brutas[j].y1;
      const altura = y1 - y0 + 1;
      let vao = 0;
      for (let k = i; k < j; k++) vao += brutas[k + 1].y0 - brutas[k].y1 - 1;
      if (vao < altura * 0.5) cands.push(montar(y0, y1));
    }
  }

  return cands
    .filter((f) => f.alt >= Math.max(12, h * 0.05) && f.alt <= h * 0.95)
    .sort((a, b) => b.tinta - a.tinta)
    .slice(0, 6);
}

/** Colunas de tinta dentro da faixa — cada uma é um dígito em potencial. */
function colunas(bin, w, faixa) {
  const alt = faixa.alt;
  const porColuna = new Int32Array(w);
  for (let y = faixa.y0; y <= faixa.y1; y++) {
    const base = y * w;
    for (let x = 0; x < w; x++) porColuna[x] += bin[base + x];
  }
  return trechos(porColuna, Math.max(1, alt * 0.03), 1)
    .map(([x0, x1]) => ({ x0, x1, larg: x1 - x0 + 1 }))
    .filter((c) => c.larg >= 3 && c.larg <= alt * 1.25);
}

/* ---------------- leitura ---------------- */

function fracaoAcesa(bin, w, caixa, janela) {
  const [fx0, fy0, fx1, fy1] = janela;
  const x0 = Math.round(caixa.x + fx0 * caixa.w);
  const x1 = Math.round(caixa.x + fx1 * caixa.w);
  const y0 = Math.round(caixa.y + fy0 * caixa.h);
  const y1 = Math.round(caixa.y + fy1 * caixa.h);
  let acesos = 0, total = 0;
  for (let y = y0; y < y1; y++) {
    for (let x = x0; x < x1; x++, total++) if (bin[y * w + x]) acesos++;
  }
  return total ? acesos / total : 0;
}

function lerCaixa(bin, w, caixa) {
  const fracoes = TRACOS.map((t) => fracaoAcesa(bin, w, caixa, t));
  const d = PADROES[fracoes.map((f) => (f > ACESO ? '1' : '0')).join('')];
  if (!d) return { d: null, conf: 0 };
  // quanto mais longe do limiar cada traço estiver, mais firme é o padrão
  const margem = fracoes.reduce((s, f) => s + Math.min(Math.abs(f - ACESO) / ACESO, 1), 0) / 7;
  return { d, conf: 0.55 + margem * 0.45 };
}

/**
 * Lê uma fileira de colunas como um número.
 * As colunas 1, 3 e 7 são mais estreitas que as demais porque não têm traço à
 * esquerda; a caixa dos dois últimos é esticada para a esquerda antes de medir.
 */
function lerFileira(bin, w, faixa, cols) {
  // Um número só de 1 ou só de 7 tem todas as colunas estreitas; nesse caso a
  // coluna mais larga não serve de referência. O passo entre os dígitos serve:
  // ele não depende de quais traços estão acesos.
  const passos = [];
  for (let i = 1; i < cols.length; i++) passos.push(cols[i].x0 - cols[i - 1].x0);
  passos.sort((a, b) => a - b);
  const passo = passos.length ? passos[passos.length >> 1] : 0;

  const larguraCheia = Math.max(...cols.map((c) => c.larg), passo * 0.55);
  const digitos = [];
  let somaConf = 0;

  for (const c of cols) {
    const proporcao = c.larg / larguraCheia;
    if (proporcao < 0.45) { digitos.push('1'); somaConf += 0.85; continue; }

    const x = proporcao < 0.85 ? Math.max(0, c.x1 - larguraCheia + 1) : c.x0;
    const caixa = { x, y: faixa.y0, w: Math.min(larguraCheia, w - x), h: faixa.alt };
    const { d, conf } = lerCaixa(bin, w, caixa);
    if (!d) return null;
    digitos.push(d);
    somaConf += conf;
  }
  if (digitos.length < 3) return null;
  return { valor: digitos.join(''), conf: somaConf / digitos.length };
}

/**
 * Tenta ler o número do visor sem usar internet.
 * @param {string|HTMLCanvasElement} entrada foto em data:image/... ou canvas
 * @param {{digits?: number}} opts número de dígitos esperado, se souber
 * @returns {Promise<{legible: boolean, value: string|null, confidence: number, local: true, motivo?: string}>}
 */
export async function lerLocal(entrada, { digits = 0 } = {}) {
  let fonte, lw, lh;
  if (typeof entrada === 'string') {
    try { fonte = await carregar(entrada); } catch {
      return { legible: false, value: null, confidence: 0, local: true, motivo: 'foto-invalida' };
    }
    lw = fonte.naturalWidth; lh = fonte.naturalHeight;
  } else {
    fonte = entrada; lw = entrada.width; lh = entrada.height;
  }
  if (!lw || !lh) return { legible: false, value: null, confidence: 0, local: true, motivo: 'foto-invalida' };

  const { g, w, h } = cinza(fonte, lw, lh);
  const limiar = otsu(g);
  let melhor = null;

  // visor claro no fundo escuro e o contrário — não dá para saber de antemão
  for (const claroNoEscuro of [true, false]) {
    const bin = new Uint8Array(w * h);
    for (let i = 0; i < g.length; i++) {
      bin[i] = (claroNoEscuro ? g[i] > limiar : g[i] < limiar) ? 1 : 0;
    }

    for (const faixa of faixas(bin, w, h)) {
      const cols = colunas(bin, w, faixa);
      if (cols.length < 3 || cols.length > 14) continue;

      const lido = lerFileira(bin, w, faixa, cols);
      if (!lido) continue;

      const casa = digits ? 1 - Math.min(Math.abs(lido.valor.length - digits) / digits, 1) : 0.7;
      const nota = lido.conf * 0.6 + casa * 0.4;
      if (!melhor || nota > melhor.nota) melhor = { ...lido, nota };
    }
  }

  if (!melhor) return { legible: false, value: null, confidence: 0, local: true, motivo: 'sem-fileira' };
  if (melhor.conf < 0.62) {
    return { legible: false, value: null, confidence: melhor.conf, local: true, motivo: 'baixa-confianca' };
  }
  return { legible: true, value: melhor.valor, confidence: Math.min(melhor.conf, 0.95), local: true };
}
