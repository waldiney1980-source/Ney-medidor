// Leitor de QR Code: da imagem da câmera ao texto, sem dependência externa.
//
// Existe porque o Safari não tem o BarcodeDetector — no iPhone, o botão de QR
// do app não abria a câmera e caía no "digitar código". Aqui o app lê sozinho.
//
// Cobre o que a etiqueta do HidroLuz produz: nível de correção M, versões 1–10.
// QR de outra origem (outro nível de correção) é recusado sem estardalhaço, e a
// tela oferece o campo de digitação.

import {
  gexp, glog, RS_BLOCKS_M, ALIGN, MASK_FN,
  blankMatrix, placeStatic, reserveFormat,
} from './qr.js';

/* ------------------------------------------------------------------ */
/* GF(256)                                                             */
/* ------------------------------------------------------------------ */

const gmul = (a, b) => (a === 0 || b === 0 ? 0 : gexp(glog(a) + glog(b)));
const gdiv = (a, b) => (a === 0 ? 0 : gexp(glog(a) - glog(b) + 255));

/* ------------------------------------------------------------------ */
/* 1. binarização                                                      */
/* ------------------------------------------------------------------ */

const BLOCO = 8;

/**
 * Limiar adaptativo por blocos: foto de medidor tem sombra de um lado e brilho
 * do outro, e um limiar único perderia metade do código.
 * @returns {{dados:Uint8Array,largura:number,altura:number}} 1 = escuro
 */
export function binarizar(imageData) {
  const { width: w, height: h, data } = imageData;
  const bruto = new Uint8ClampedArray(w * h);
  for (let i = 0, p = 0; i < data.length; i += 4, p++) {
    bruto[p] = (data[i] * 77 + data[i + 1] * 150 + data[i + 2] * 29) >> 8;
  }

  /* Média 3×3 antes de limiarizar. Sensor de celular com pouca luz gera pontos
     isolados, e um único pixel trocado no meio de um módulo parte o trecho em
     dois — o que destrói a proporção 1:1:3:1:1 que localiza os alvos. */
  const cinza = new Uint8ClampedArray(w * h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let soma = 0, n = 0;
      for (let dy = -1; dy <= 1; dy++) {
        const yy = y + dy;
        if (yy < 0 || yy >= h) continue;
        for (let dx = -1; dx <= 1; dx++) {
          const xx = x + dx;
          if (xx < 0 || xx >= w) continue;
          soma += bruto[yy * w + xx]; n++;
        }
      }
      cinza[y * w + x] = soma / n;
    }
  }

  const bw = Math.max(1, Math.ceil(w / BLOCO));
  const bh = Math.max(1, Math.ceil(h / BLOCO));
  const medias = new Float32Array(bw * bh);
  /* Bloco liso não tem limiar próprio: ele pode ser papel branco ou o miolo
     preto do alvo, e a média sozinha não distingue os dois. Usar o mínimo daria
     um limiar que nenhum pixel alcança, e o preto viraria branco. Esses blocos
     ficam sem valor aqui e recebem o limiar da vizinhança depois. */
  const definido = new Uint8Array(bw * bh);
  let somaGlobal = 0, nGlobal = 0;

  for (let by = 0; by < bh; by++) {
    for (let bx = 0; bx < bw; bx++) {
      let soma = 0, n = 0, min = 255, max = 0;
      const y0 = by * BLOCO, x0 = bx * BLOCO;
      for (let y = y0; y < Math.min(y0 + BLOCO, h); y++) {
        for (let x = x0; x < Math.min(x0 + BLOCO, w); x++) {
          const v = cinza[y * w + x];
          soma += v; n++;
          if (v < min) min = v;
          if (v > max) max = v;
        }
      }
      const i = by * bw + bx;
      if (n && max - min > 24) {
        medias[i] = soma / n;
        definido[i] = 1;
        somaGlobal += medias[i];
        nGlobal++;
      }
    }
  }

  const limiarGlobal = nGlobal ? somaGlobal / nGlobal : 128;

  // preenche os blocos lisos com a média dos vizinhos que têm contraste
  for (let by = 0; by < bh; by++) {
    for (let bx = 0; bx < bw; bx++) {
      const i = by * bw + bx;
      if (definido[i]) continue;
      let soma = 0, n = 0;
      for (let raio = 1; raio <= 3 && n === 0; raio++) {
        for (let dy = -raio; dy <= raio; dy++) {
          for (let dx = -raio; dx <= raio; dx++) {
            const y = by + dy, x = bx + dx;
            if (y < 0 || y >= bh || x < 0 || x >= bw) continue;
            const j = y * bw + x;
            if (!definido[j]) continue;
            soma += medias[j]; n++;
          }
        }
      }
      medias[i] = n ? soma / n : limiarGlobal;
    }
  }

  // suaviza entre blocos vizinhos para não criar costura na fronteira
  const suave = new Float32Array(bw * bh);
  for (let by = 0; by < bh; by++) {
    for (let bx = 0; bx < bw; bx++) {
      let soma = 0, n = 0;
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          const y = by + dy, x = bx + dx;
          if (y < 0 || y >= bh || x < 0 || x >= bw) continue;
          soma += medias[y * bw + x]; n++;
        }
      }
      suave[by * bw + bx] = soma / n;
    }
  }

  const bits = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) {
    const by = Math.min(bh - 1, y >> 3);
    for (let x = 0; x < w; x++) {
      const bx = Math.min(bw - 1, x >> 3);
      bits[y * w + x] = cinza[y * w + x] < suave[by * bw + bx] ? 1 : 0;
    }
  }
  return { dados: bits, largura: w, altura: h };
}

/* ------------------------------------------------------------------ */
/* 2. localização dos três alvos                                       */
/* ------------------------------------------------------------------ */

const escuro = (b, x, y) =>
  x >= 0 && y >= 0 && x < b.largura && y < b.altura && b.dados[y * b.largura + x] === 1;

/** Proporção 1:1:3:1:1 dos cinco trechos do alvo, com folga de 50%. */
function proporcaoOk(contagem) {
  const total = contagem[0] + contagem[1] + contagem[2] + contagem[3] + contagem[4];
  if (total < 7) return false;
  const modulo = total / 7;
  const folga = modulo / 2;
  return Math.abs(modulo - contagem[0]) < folga
    && Math.abs(modulo - contagem[1]) < folga
    && Math.abs(modulo * 3 - contagem[2]) < folga * 3
    && Math.abs(modulo - contagem[3]) < folga
    && Math.abs(modulo - contagem[4]) < folga;
}

const centroDoTrecho = (c, fim) => fim - c[4] - c[3] - c[2] / 2;

/** Confere o mesmo padrão na vertical, a partir de um centro achado na linha. */
function confereVertical(b, cx, cy, maxContagem) {
  const c = [0, 0, 0, 0, 0];
  let y = cy;
  while (y >= 0 && escuro(b, cx, y) && c[2] <= maxContagem) { c[2]++; y--; }
  if (y < 0) return null;
  while (y >= 0 && !escuro(b, cx, y) && c[1] <= maxContagem) { c[1]++; y--; }
  if (y < 0 || c[1] > maxContagem) return null;
  while (y >= 0 && escuro(b, cx, y) && c[0] <= maxContagem) { c[0]++; y--; }
  if (c[0] > maxContagem) return null;

  y = cy + 1;
  while (y < b.altura && escuro(b, cx, y) && c[2] <= maxContagem) { c[2]++; y++; }
  if (y === b.altura) return null;
  while (y < b.altura && !escuro(b, cx, y) && c[3] <= maxContagem) { c[3]++; y++; }
  if (y === b.altura || c[3] > maxContagem) return null;
  while (y < b.altura && escuro(b, cx, y) && c[4] <= maxContagem) { c[4]++; y++; }
  if (c[4] > maxContagem) return null;

  return proporcaoOk(c) ? centroDoTrecho(c, y) : null;
}

/** Varre a imagem procurando os quadrados de canto. */
export function acharAlvos(b) {
  const achados = [];
  const passo = Math.max(1, Math.floor(b.altura / 240));

  for (let y = passo; y < b.altura; y += passo) {
    const c = [0, 0, 0, 0, 0];
    let estado = 0;
    for (let x = 0; x < b.largura; x++) {
      if (escuro(b, x, y)) {
        if (estado % 2 === 1) estado++;
        c[estado]++;
      } else {
        if (estado % 2 === 0) {
          if (estado === 4) {
            if (proporcaoOk(c)) {
              const cx = centroDoTrecho(c, x);
              const total = c[0] + c[1] + c[2] + c[3] + c[4];
              const cyv = confereVertical(b, Math.round(cx), y, c[2]);
              if (cyv !== null) achados.push({ x: cx, y: cyv, modulo: total / 7 });
            }
            c[0] = c[2]; c[1] = c[3]; c[2] = c[4]; c[3] = 1; c[4] = 0;
            estado = 3;
            continue;
          }
          estado++;
        }
        c[estado]++;
      }
    }
    if (estado === 4 && proporcaoOk(c)) {
      const cx = centroDoTrecho(c, b.largura);
      const total = c[0] + c[1] + c[2] + c[3] + c[4];
      const cyv = confereVertical(b, Math.round(cx), y, c[2]);
      if (cyv !== null) achados.push({ x: cx, y: cyv, modulo: total / 7 });
    }
  }

  // agrupa detecções do mesmo alvo (cada um aparece em várias linhas)
  const grupos = [];
  for (const a of achados) {
    const g = grupos.find((z) => Math.abs(z.x - a.x) < z.modulo * 2 && Math.abs(z.y - a.y) < z.modulo * 2);
    if (g) {
      g.x = (g.x * g.n + a.x) / (g.n + 1);
      g.y = (g.y * g.n + a.y) / (g.n + 1);
      g.modulo = (g.modulo * g.n + a.modulo) / (g.n + 1);
      g.n++;
    } else {
      grupos.push({ x: a.x, y: a.y, modulo: a.modulo, n: 1 });
    }
  }
  return grupos.filter((g) => g.n >= 2).sort((a, b2) => b2.n - a.n);
}

/**
 * Escolhe o melhor trio entre os candidatos e diz quem é cada canto.
 *
 * Não dá para confiar só na contagem de votos: um trecho de imagem qualquer
 * pode imitar o padrão e aparecer em várias linhas. Os três alvos de verdade
 * têm módulo parecido e formam um triângulo retângulo isósceles — é isso que
 * separa o joio.
 */
function escolherTrio(alvos) {
  const cand = alvos.slice(0, 8);
  if (cand.length < 3) return null;
  let melhor = null, melhorNota = Infinity;

  for (let i = 0; i < cand.length; i++) {
    for (let j = i + 1; j < cand.length; j++) {
      for (let k = j + 1; k < cand.length; k++) {
        const t = [cand[i], cand[j], cand[k]];
        const mods = t.map((p) => p.modulo);
        const mediaMod = (mods[0] + mods[1] + mods[2]) / 3;
        const desvioMod = Math.max(...mods.map((m) => Math.abs(m - mediaMod))) / mediaMod;
        if (desvioMod > 0.35) continue;

        const d = (p, q) => Math.hypot(p.x - q.x, p.y - q.y);
        const lados = [d(t[0], t[1]), d(t[0], t[2]), d(t[1], t[2])].sort((x, y) => x - y);
        if (lados[0] < mediaMod * 8) continue;              // perto demais para ser QR
        // dois catetos iguais e hipotenusa = cateto·√2
        const notaCatetos = Math.abs(lados[1] - lados[0]) / lados[1];
        const notaHipotenusa = Math.abs(lados[2] - lados[1] * Math.SQRT2) / lados[2];
        const nota = notaCatetos + notaHipotenusa + desvioMod * 0.5;
        if (nota < melhorNota) { melhorNota = nota; melhor = t; }
      }
    }
  }
  return melhorNota < 0.5 ? melhor : null;
}

/** Dos alvos achados, decide qual é o de cima-esquerda, cima-direita e baixo-esquerda. */
function ordenarCantos(alvos) {
  const trio = escolherTrio(alvos);
  if (!trio) return null;
  const [a, b, c] = trio;
  const d = (p, q) => (p.x - q.x) ** 2 + (p.y - q.y) ** 2;
  const ab = d(a, b), ac = d(a, c), bc = d(b, c);

  // o canto do ângulo reto é o oposto ao maior lado (a hipotenusa)
  let topo, p, q;
  if (bc >= ab && bc >= ac) { topo = a; p = b; q = c; }
  else if (ac >= ab && ac >= bc) { topo = b; p = a; q = c; }
  else { topo = c; p = a; q = b; }

  // produto vetorial decide quem é direita e quem é baixo
  const cruz = (p.x - topo.x) * (q.y - topo.y) - (p.y - topo.y) * (q.x - topo.x);
  const direita = cruz < 0 ? q : p;
  const baixo = cruz < 0 ? p : q;
  return { topo, direita, baixo };
}

/* ------------------------------------------------------------------ */
/* 3. transformação de perspectiva                                     */
/* ------------------------------------------------------------------ */

/** Matriz que leva o quadrado unitário ao quadrilátero informado. */
function quadradoParaQuad(p) {
  const dx3 = p[0].x - p[1].x + p[2].x - p[3].x;
  const dy3 = p[0].y - p[1].y + p[2].y - p[3].y;
  if (Math.abs(dx3) < 1e-9 && Math.abs(dy3) < 1e-9) {
    return [p[1].x - p[0].x, p[2].x - p[1].x, p[0].x,
      p[1].y - p[0].y, p[2].y - p[1].y, p[0].y, 0, 0, 1];
  }
  const dx1 = p[1].x - p[2].x, dx2 = p[3].x - p[2].x;
  const dy1 = p[1].y - p[2].y, dy2 = p[3].y - p[2].y;
  const den = dx1 * dy2 - dx2 * dy1;
  const a13 = (dx3 * dy2 - dx2 * dy3) / den;
  const a23 = (dx1 * dy3 - dx3 * dy1) / den;
  return [
    p[1].x - p[0].x + a13 * p[1].x, p[3].x - p[0].x + a23 * p[3].x, p[0].x,
    p[1].y - p[0].y + a13 * p[1].y, p[3].y - p[0].y + a23 * p[3].y, p[0].y,
    a13, a23, 1,
  ];
}

const aplicar = (m, x, y) => {
  const den = m[6] * x + m[7] * y + m[8];
  return { x: (m[0] * x + m[1] * y + m[2]) / den, y: (m[3] * x + m[4] * y + m[5]) / den };
};

/** Adjunta — serve de inversa, já que a escala não importa em coordenada homogênea. */
const inverter = (m) => [
  m[4] * m[8] - m[5] * m[7], m[2] * m[7] - m[1] * m[8], m[1] * m[5] - m[2] * m[4],
  m[5] * m[6] - m[3] * m[8], m[0] * m[8] - m[2] * m[6], m[2] * m[3] - m[0] * m[5],
  m[3] * m[7] - m[4] * m[6], m[1] * m[6] - m[0] * m[7], m[0] * m[4] - m[1] * m[3],
];

const multiplicar = (a, b) => [
  a[0] * b[0] + a[1] * b[3] + a[2] * b[6], a[0] * b[1] + a[1] * b[4] + a[2] * b[7], a[0] * b[2] + a[1] * b[5] + a[2] * b[8],
  a[3] * b[0] + a[4] * b[3] + a[5] * b[6], a[3] * b[1] + a[4] * b[4] + a[5] * b[7], a[3] * b[2] + a[4] * b[5] + a[5] * b[8],
  a[6] * b[0] + a[7] * b[3] + a[8] * b[6], a[6] * b[1] + a[7] * b[4] + a[8] * b[7], a[6] * b[2] + a[7] * b[5] + a[8] * b[8],
];

/**
 * Transformação que leva coordenadas de módulo até pixels da imagem.
 * Os quatro pontos de referência não formam um retângulo em coordenadas de
 * módulo — o alinhamento fica em (dim-6,5) e não em (dim-3,5) —, então não dá
 * para usar um fator de escala só: é preciso compor as duas projeções.
 */
const moduloParaImagem = (origem, destino) =>
  multiplicar(quadradoParaQuad(destino), inverter(quadradoParaQuad(origem)));

/* ------------------------------------------------------------------ */
/* 4. amostragem da grade                                              */
/* ------------------------------------------------------------------ */

/** Procura o centro do quadradinho de alinhamento perto do ponto estimado. */
function acharAlinhamento(b, xEst, yEst, modulo) {
  const raio = Math.max(4, Math.round(modulo * 3));
  let melhor = null, melhorDist = Infinity;
  for (let dy = -raio; dy <= raio; dy++) {
    for (let dx = -raio; dx <= raio; dx++) {
      const x = Math.round(xEst + dx), y = Math.round(yEst + dy);
      if (!escuro(b, x, y)) continue;
      // centro escuro cercado de claro nas quatro direções
      const passo = Math.max(1, Math.round(modulo));
      if (escuro(b, x - passo, y) || escuro(b, x + passo, y)
        || escuro(b, x, y - passo) || escuro(b, x, y + passo)) continue;
      const dist = dx * dx + dy * dy;
      if (dist < melhorDist) { melhorDist = dist; melhor = { x, y }; }
    }
  }
  return melhor;
}

/** Lê a grade de módulos usando a transformação. */
function amostrar(b, m, dimensao) {
  const grade = Array.from({ length: dimensao }, () => new Array(dimensao).fill(false));
  for (let linha = 0; linha < dimensao; linha++) {
    for (let col = 0; col < dimensao; col++) {
      const p = aplicar(m, col + 0.5, linha + 0.5);
      const x = Math.round(p.x), y = Math.round(p.y);
      // voto de 5 pontos: tolera meio pixel de erro no canto do módulo
      let votos = 0;
      votos += escuro(b, x, y) ? 2 : 0;
      votos += escuro(b, x - 1, y) ? 1 : 0;
      votos += escuro(b, x + 1, y) ? 1 : 0;
      votos += escuro(b, x, y - 1) ? 1 : 0;
      votos += escuro(b, x, y + 1) ? 1 : 0;
      grade[linha][col] = votos >= 3;
    }
  }
  return grade;
}

/* ------------------------------------------------------------------ */
/* 5. formato (máscara e nível de correção)                            */
/* ------------------------------------------------------------------ */

const FORMATO_MASCARA = 0x5412;

/** As 32 combinações válidas, para corrigir o formato por proximidade. */
const FORMATOS = (() => {
  const G15 = 0b10100110111;
  const bchDigit = (v) => { let n = 0; while (v !== 0) { n++; v >>>= 1; } return n; };
  const lista = [];
  for (let i = 0; i < 32; i++) {
    let d = i << 10;
    while (bchDigit(d) - bchDigit(G15) >= 0) d ^= G15 << (bchDigit(d) - bchDigit(G15));
    lista.push({ valor: i, bits: (((i << 10) | d) ^ FORMATO_MASCARA) });
  }
  return lista;
})();

const contarBits = (n) => { let c = 0; while (n) { c += n & 1; n >>>= 1; } return c; };

function lerFormato(grade) {
  const size = grade.length;
  const bit = (r, c) => (grade[r][c] ? 1 : 0);

  let a = 0;
  for (let i = 0; i < 6; i++) a = (a << 1) | bit(8, i);
  a = (a << 1) | bit(8, 7);
  a = (a << 1) | bit(7, 8);
  for (let i = 5; i >= 0; i--) a = (a << 1) | bit(i, 8);

  let b = 0;
  for (let i = 0; i < 7; i++) b = (b << 1) | bit(size - 1 - i, 8);
  for (let i = 0; i < 8; i++) b = (b << 1) | bit(8, size - 8 + i);

  for (const candidato of [a, b]) {
    let melhor = null, melhorDist = 4;
    for (const f of FORMATOS) {
      const dist = contarBits(candidato ^ f.bits);
      if (dist < melhorDist) { melhorDist = dist; melhor = f.valor; }
    }
    if (melhor !== null) {
      return { nivel: (melhor >> 3) & 3, mascara: melhor & 7 };
    }
  }
  return null;
}

/* ------------------------------------------------------------------ */
/* 6. leitura dos códigos                                              */
/* ------------------------------------------------------------------ */

/** Percurso em ziguezague — o inverso exato do usado na geração. */
function lerCodewords(grade, versao, mascara) {
  const size = grade.length;
  const reservado = blankMatrix(size);
  placeStatic(reservado, versao);
  reserveFormat(reservado);

  const bytes = [];
  let atual = 0, bits = 0;
  let inc = -1, row = size - 1;

  for (let col = size - 1; col > 0; col -= 2) {
    if (col === 6) col--;
    for (;;) {
      for (let c = 0; c < 2; c++) {
        if (reservado[row][col - c] === null) {
          let escuroAqui = grade[row][col - c];
          if (MASK_FN[mascara](row, col - c)) escuroAqui = !escuroAqui;
          atual = (atual << 1) | (escuroAqui ? 1 : 0);
          bits++;
          if (bits === 8) { bytes.push(atual); atual = 0; bits = 0; }
        }
      }
      row += inc;
      if (row < 0 || row >= size) { row -= inc; inc = -inc; break; }
    }
  }
  return bytes;
}

/* ------------------------------------------------------------------ */
/* 7. Reed–Solomon                                                     */
/* ------------------------------------------------------------------ */

/** Corrige até ecCount/2 erros. Devolve null quando não dá para recuperar. */
function corrigir(bloco, ecCount) {
  const n = bloco.length;
  const sindromes = new Array(ecCount).fill(0);
  let comErro = false;
  for (let i = 0; i < ecCount; i++) {
    let s = 0;
    for (let j = 0; j < n; j++) {
      if (bloco[j] !== 0) s ^= gexp(glog(bloco[j]) + i * (n - 1 - j));
    }
    sindromes[i] = s;
    if (s !== 0) comErro = true;
  }
  if (!comErro) return bloco;

  // Berlekamp–Massey
  let C = [1], B = [1], L = 0, m = 1, b = 1;
  for (let k = 0; k < ecCount; k++) {
    let d = sindromes[k];
    for (let i = 1; i <= L; i++) d ^= gmul(C[i] || 0, sindromes[k - i]);
    if (d === 0) { m++; continue; }
    const T = C.slice();
    const coef = gdiv(d, b);
    for (let i = 0; i < B.length; i++) C[i + m] = (C[i + m] || 0) ^ gmul(coef, B[i]);
    if (2 * L <= k) { L = k + 1 - L; B = T; b = d; m = 1; } else m++;
  }
  if (L === 0 || L > ecCount / 2) return null;

  // Chien: raízes de C dão as posições
  const posicoes = [];
  for (let i = 0; i < 255; i++) {
    let v = 0;
    for (let j = 0; j < C.length; j++) if (C[j]) v ^= gexp(glog(C[j]) + i * j);
    if (v === 0) {
      const loc = (255 - i) % 255;
      const idx = n - 1 - loc;
      if (idx >= 0 && idx < n) posicoes.push({ idx, x: gexp(loc) });
    }
  }
  if (posicoes.length !== L) return null;

  // Ω(x) = S(x)·Λ(x) mod x^ec
  const omega = new Array(ecCount).fill(0);
  for (let i = 0; i < ecCount; i++) {
    let v = 0;
    for (let j = 0; j <= i; j++) if (C[j]) v ^= gmul(sindromes[i - j], C[j]);
    omega[i] = v;
  }

  // Forney
  const saida = bloco.slice();
  for (const { idx, x } of posicoes) {
    const xInv = gexp(255 - glog(x));
    let num = 0;
    for (let i = 0; i < omega.length; i++) if (omega[i]) num ^= gexp(glog(omega[i]) + i * glog(xInv));
    let den = 0;
    for (let i = 1; i < C.length; i += 2) if (C[i]) den ^= gexp(glog(C[i]) + (i - 1) * glog(xInv));
    if (den === 0) return null;
    saida[idx] ^= gmul(gmul(x, num), gexp(255 - glog(den)));
  }

  // confere: síndromes têm de zerar
  for (let i = 0; i < ecCount; i++) {
    let s = 0;
    for (let j = 0; j < n; j++) if (saida[j] !== 0) s ^= gexp(glog(saida[j]) + i * (n - 1 - j));
    if (s !== 0) return null;
  }
  return saida;
}

/** Desfaz o entrelaçamento e corrige bloco a bloco. */
function blocosParaDados(codewords, versao) {
  const blocos = RS_BLOCKS_M[versao];
  if (!blocos) return null;
  const dc = blocos.map(([, d]) => new Array(d).fill(0));
  const ecPorBloco = blocos.map(([t, d]) => t - d);
  const ec = blocos.map((_, i) => new Array(ecPorBloco[i]).fill(0));

  const maxDc = Math.max(...blocos.map(([, d]) => d));
  const maxEc = Math.max(...ecPorBloco);

  let p = 0;
  for (let i = 0; i < maxDc; i++) {
    for (let bl = 0; bl < blocos.length; bl++) if (i < dc[bl].length) dc[bl][i] = codewords[p++];
  }
  for (let i = 0; i < maxEc; i++) {
    for (let bl = 0; bl < blocos.length; bl++) if (i < ec[bl].length) ec[bl][i] = codewords[p++];
  }

  const dados = [];
  for (let bl = 0; bl < blocos.length; bl++) {
    const corrigido = corrigir(dc[bl].concat(ec[bl]), ecPorBloco[bl]);
    if (!corrigido) return null;
    dados.push(...corrigido.slice(0, dc[bl].length));
  }
  return dados;
}

/* ------------------------------------------------------------------ */
/* 8. bits para texto                                                  */
/* ------------------------------------------------------------------ */

const ALFANUM = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ $%*+-./:';

function lerTexto(dados, versao) {
  let pos = 0;
  const total = dados.length * 8;
  const ler = (n) => {
    let v = 0;
    for (let i = 0; i < n; i++) {
      if (pos >= total) throw new Error('fim dos dados');
      const byte = dados[pos >> 3];
      v = (v << 1) | ((byte >> (7 - (pos & 7))) & 1);
      pos++;
    }
    return v;
  };

  const bytes = [];
  let texto = '';
  for (;;) {
    if (total - pos < 4) break;
    const modo = ler(4);
    if (modo === 0) break;                                   // fim
    if (modo === 0b0100) {                                   // byte
      const n = ler(versao < 10 ? 8 : 16);
      for (let i = 0; i < n; i++) bytes.push(ler(8));
    } else if (modo === 0b0001) {                            // numérico
      const n = ler(versao < 10 ? 10 : 12);
      let lidos = 0;
      while (lidos + 3 <= n) { texto += String(ler(10)).padStart(3, '0'); lidos += 3; }
      if (n - lidos === 2) texto += String(ler(7)).padStart(2, '0');
      else if (n - lidos === 1) texto += String(ler(4));
    } else if (modo === 0b0010) {                            // alfanumérico
      const n = ler(versao < 10 ? 9 : 11);
      let lidos = 0;
      while (lidos + 2 <= n) {
        const v = ler(11);
        texto += ALFANUM[Math.floor(v / 45)] + ALFANUM[v % 45];
        lidos += 2;
      }
      if (lidos < n) texto += ALFANUM[ler(6)];
    } else {
      break;                                                 // modo não suportado
    }
  }
  if (bytes.length) texto = new TextDecoder().decode(new Uint8Array(bytes)) + texto;
  return texto;
}

/* ------------------------------------------------------------------ */
/* entrada                                                             */
/* ------------------------------------------------------------------ */

/**
 * Decodifica um QR presente na imagem.
 * @param {ImageData} imageData quadro da câmera
 * @returns {string|null} texto lido, ou null quando não há QR legível
 */
export function decodificar(imageData) {
  const b = binarizar(imageData);
  const alvos = acharAlvos(b);
  const cantos = ordenarCantos(alvos);
  if (!cantos) return null;

  const { topo, direita, baixo } = cantos;
  const modulo = (topo.modulo + direita.modulo + baixo.modulo) / 3;
  if (!(modulo > 0.9)) return null;

  /* O tamanho do módulo medido na varredura horizontal não serve para deduzir a
     versão: uma linha horizontal atravessa um alvo girado por um caminho mais
     longo, e a 45° a medida sai inflada em √2. Em vez de corrigir o ângulo, a
     estimativa serve só para ordenar as tentativas — a versão certa é a que
     decodifica, e as erradas morrem no formato ou na correção de erro. */
  const dist = Math.hypot(direita.x - topo.x, direita.y - topo.y);
  const estimada = Math.round((dist / modulo + 7 - 17) / 4);

  const candidatas = [];
  for (let v = 1; v <= 10; v++) candidatas.push(v);
  candidatas.sort((p, q) => Math.abs(p - estimada) - Math.abs(q - estimada));

  for (const versao of candidatas) {
    const dimensao = versao * 4 + 17;

    /* Quarto ponto de referência, em duas variantes. O quadradinho de
       alinhamento corrige a perspectiva e costuma ser o melhor; mas quando a
       busca por ele erra o alvo — acontece com o código bem torto — o
       paralelogramo simples acerta. Tentar as duas custa pouco e evita
       depender de a busca acertar de primeira. */
    const variantes = [];

    if (versao >= 2) {
      const pos = ALIGN[versao];
      const centro = pos[pos.length - 1];
      const fracao = (centro + 0.5 - 3.5) / (dimensao - 7);
      const est = {
        x: topo.x + (direita.x - topo.x) * fracao + (baixo.x - topo.x) * fracao,
        y: topo.y + (direita.y - topo.y) * fracao + (baixo.y - topo.y) * fracao,
      };
      const achado = acharAlinhamento(b, est.x, est.y, dist / (dimensao - 7));
      if (achado) {
        variantes.push({ imagem: achado, modulo: { x: centro + 0.5, y: centro + 0.5 } });
      }
    }

    variantes.push({
      imagem: { x: direita.x + baixo.x - topo.x, y: direita.y + baixo.y - topo.y },
      modulo: { x: dimensao - 3.5, y: dimensao - 3.5 },
    });

    for (const variante of variantes) {
      const m = moduloParaImagem(
        [{ x: 3.5, y: 3.5 }, { x: dimensao - 3.5, y: 3.5 }, variante.modulo, { x: 3.5, y: dimensao - 3.5 }],
        [topo, direita, variante.imagem, baixo],
      );
      const texto = decodificarGrade(amostrar(b, m, dimensao), versao);
      if (texto) return texto;
    }
  }
  return null;
}

/** Da grade de módulos ao texto — separado para poder testar sem imagem. */
export function decodificarGrade(grade, versao) {
  const formato = lerFormato(grade);
  if (!formato) return null;
  if (formato.nivel !== 0) return null;                       // só nível M

  const codewords = lerCodewords(grade, versao, formato.mascara);
  const dados = blocosParaDados(codewords, versao);
  if (!dados) return null;
  try {
    const texto = lerTexto(dados, versao);
    return texto || null;
  } catch { return null; }
}
