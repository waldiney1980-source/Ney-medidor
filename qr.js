// Gerador de QR Code (modo byte, nível de correção M, versões 1–10).
// Usado para imprimir etiquetas com o código do medidor. Sem dependências.

/* ---------------- GF(256) ---------------- */

const EXP = new Uint8Array(256);
const LOG = new Uint8Array(256);
(() => {
  for (let i = 0; i < 8; i++) EXP[i] = 1 << i;
  for (let i = 8; i < 256; i++) EXP[i] = EXP[i - 4] ^ EXP[i - 5] ^ EXP[i - 6] ^ EXP[i - 8];
  for (let i = 0; i < 255; i++) LOG[EXP[i]] = i;
})();

const gexp = (n) => { while (n < 0) n += 255; while (n >= 256) n -= 255; return EXP[n]; };
const glog = (n) => LOG[n];

function polyMultiply(a, b) {
  const out = new Array(a.length + b.length - 1).fill(0);
  for (let i = 0; i < a.length; i++) {
    for (let j = 0; j < b.length; j++) {
      if (a[i] === 0 || b[j] === 0) continue;
      out[i + j] ^= gexp(glog(a[i]) + glog(b[j]));
    }
  }
  return out;
}

function polyMod(dividend, divisor) {
  let num = dividend.slice();
  for (;;) {
    let o = 0;
    while (o < num.length && num[o] === 0) o++;
    num = num.slice(o);
    if (num.length < divisor.length) return num;
    const ratio = glog(num[0]) - glog(divisor[0]);
    for (let i = 0; i < divisor.length; i++) num[i] ^= gexp(glog(divisor[i]) + ratio);
  }
}

function ecPolynomial(count) {
  let a = [1];
  for (let i = 0; i < count; i++) a = polyMultiply(a, [1, gexp(i)]);
  return a;
}

/* ---------------- tabelas ---------------- */

// nível M: blocos [totalCodewords, dataCodewords]
const RS_BLOCKS_M = {
  1: [[26, 16]],
  2: [[44, 28]],
  3: [[70, 44]],
  4: [[50, 32], [50, 32]],
  5: [[67, 43], [67, 43]],
  6: [[43, 27], [43, 27], [43, 27], [43, 27]],
  7: [[49, 31], [49, 31], [49, 31], [49, 31]],
  8: [[60, 38], [60, 38], [61, 39], [61, 39]],
  9: [[58, 36], [58, 36], [58, 36], [59, 37], [59, 37]],
  10: [[69, 43], [69, 43], [69, 43], [69, 43], [70, 44]],
};

const ALIGN = {
  1: [], 2: [6, 18], 3: [6, 22], 4: [6, 26], 5: [6, 30],
  6: [6, 34], 7: [6, 22, 38], 8: [6, 24, 42], 9: [6, 26, 46], 10: [6, 28, 50],
};

const G15 = 0b10100110111;        // x^10+x^8+x^5+x^4+x^2+x+1
const G15_MASK = 0b101010000010010;
const G18 = 0b1111100100101;      // x^12+x^11+x^10+x^9+x^8+x^5+x^2+1

function bchDigit(v) { let n = 0; while (v !== 0) { n++; v >>>= 1; } return n; }

function bchTypeInfo(data) {
  let d = data << 10;
  while (bchDigit(d) - bchDigit(G15) >= 0) d ^= G15 << (bchDigit(d) - bchDigit(G15));
  return ((data << 10) | d) ^ G15_MASK;
}

function bchTypeNumber(data) {
  let d = data << 12;
  while (bchDigit(d) - bchDigit(G18) >= 0) d ^= G18 << (bchDigit(d) - bchDigit(G18));
  return (data << 12) | d;
}

const MASK_FN = [
  (i, j) => (i + j) % 2 === 0,
  (i) => i % 2 === 0,
  (i, j) => j % 3 === 0,
  (i, j) => (i + j) % 3 === 0,
  (i, j) => (Math.floor(i / 2) + Math.floor(j / 3)) % 2 === 0,
  (i, j) => ((i * j) % 2) + ((i * j) % 3) === 0,
  (i, j) => (((i * j) % 2) + ((i * j) % 3)) % 2 === 0,
  (i, j) => (((i * j) % 3) + ((i + j) % 2)) % 2 === 0,
];

/* ---------------- construção ---------------- */

function toUtf8Bytes(str) {
  return Array.from(new TextEncoder().encode(str));
}

function pickVersion(byteLen) {
  for (let v = 1; v <= 10; v++) {
    const dataCodewords = RS_BLOCKS_M[v].reduce((s, b) => s + b[1], 0);
    const countBits = v < 10 ? 8 : 16;
    const capacity = Math.floor((dataCodewords * 8 - 4 - countBits) / 8);
    if (byteLen <= capacity) return v;
  }
  return null;
}

function buildDataCodewords(bytes, version) {
  const blocks = RS_BLOCKS_M[version];
  const totalData = blocks.reduce((s, b) => s + b[1], 0);
  const countBits = version < 10 ? 8 : 16;

  const bits = [];
  const push = (value, len) => { for (let k = len - 1; k >= 0; k--) bits.push((value >>> k) & 1); };
  push(0b0100, 4);
  push(bytes.length, countBits);
  bytes.forEach((b) => push(b, 8));

  const capacityBits = totalData * 8;
  for (let i = 0; i < 4 && bits.length < capacityBits; i++) bits.push(0);
  while (bits.length % 8 !== 0) bits.push(0);

  const data = [];
  for (let i = 0; i < bits.length; i += 8) {
    let b = 0;
    for (let k = 0; k < 8; k++) b = (b << 1) | bits[i + k];
    data.push(b);
  }
  const PAD = [0xec, 0x11];
  let p = 0;
  while (data.length < totalData) data.push(PAD[p++ % 2]);
  return data;
}

function interleave(data, version) {
  const blocks = RS_BLOCKS_M[version];
  const dc = [], ec = [];
  let offset = 0;
  let maxDc = 0, maxEc = 0;

  blocks.forEach(([total, dataCount]) => {
    const ecCount = total - dataCount;
    const chunk = data.slice(offset, offset + dataCount);
    offset += dataCount;
    dc.push(chunk);
    maxDc = Math.max(maxDc, chunk.length);

    const gen = ecPolynomial(ecCount);
    const raw = chunk.concat(new Array(gen.length - 1).fill(0));
    const mod = polyMod(raw, gen);
    const out = new Array(ecCount).fill(0);
    const shift = ecCount - mod.length;
    for (let i = 0; i < mod.length; i++) {
      const idx = i + shift;
      if (idx >= 0) out[idx] = mod[i];
    }
    ec.push(out);
    maxEc = Math.max(maxEc, ecCount);
  });

  const out = [];
  for (let i = 0; i < maxDc; i++) for (const b of dc) if (i < b.length) out.push(b[i]);
  for (let i = 0; i < maxEc; i++) for (const b of ec) if (i < b.length) out.push(b[i]);
  return out;
}

function blankMatrix(size) {
  return Array.from({ length: size }, () => new Array(size).fill(null));
}

function placeStatic(m, version) {
  const size = m.length;

  const finder = (row, col) => {
    for (let r = -1; r <= 7; r++) {
      if (row + r < 0 || row + r >= size) continue;
      for (let c = -1; c <= 7; c++) {
        if (col + c < 0 || col + c >= size) continue;
        m[row + r][col + c] =
          (r >= 0 && r <= 6 && (c === 0 || c === 6)) ||
          (c >= 0 && c <= 6 && (r === 0 || r === 6)) ||
          (r >= 2 && r <= 4 && c >= 2 && c <= 4);
      }
    }
  };
  finder(0, 0); finder(size - 7, 0); finder(0, size - 7);

  const pos = ALIGN[version];
  for (const row of pos) {
    for (const col of pos) {
      if (m[row][col] !== null) continue;
      for (let r = -2; r <= 2; r++) {
        for (let c = -2; c <= 2; c++) {
          m[row + r][col + c] = r === -2 || r === 2 || c === -2 || c === 2 || (r === 0 && c === 0);
        }
      }
    }
  }

  for (let r = 8; r < size - 8; r++) if (m[r][6] === null) m[r][6] = r % 2 === 0;
  for (let c = 8; c < size - 8; c++) if (m[6][c] === null) m[6][c] = c % 2 === 0;

  if (version >= 7) {
    const bits = bchTypeNumber(version);
    for (let i = 0; i < 18; i++) {
      const mod = ((bits >> i) & 1) === 1;
      m[Math.floor(i / 3)][(i % 3) + size - 8 - 3] = mod;
      m[(i % 3) + size - 8 - 3][Math.floor(i / 3)] = mod;
    }
  }
}

function placeFormat(m, mask) {
  const size = m.length;
  const bits = bchTypeInfo((0 << 3) | mask); // nível M = 0
  for (let i = 0; i < 15; i++) {
    const mod = ((bits >> i) & 1) === 1;
    if (i < 6) m[i][8] = mod;
    else if (i < 8) m[i + 1][8] = mod;
    else m[size - 15 + i][8] = mod;
  }
  for (let i = 0; i < 15; i++) {
    const mod = ((bits >> i) & 1) === 1;
    if (i < 8) m[8][size - i - 1] = mod;
    else if (i < 9) m[8][15 - i - 1 + 1] = mod;
    else m[8][15 - i - 1] = mod;
  }
  m[size - 8][8] = true;
}

function reserveFormat(m) {
  const size = m.length;
  for (let i = 0; i < 15; i++) {
    if (i < 6) m[i][8] = false;
    else if (i < 8) m[i + 1][8] = false;
    else m[size - 15 + i][8] = false;
    if (i < 8) m[8][size - i - 1] = false;
    else if (i < 9) m[8][15 - i - 1 + 1] = false;
    else m[8][15 - i - 1] = false;
  }
  m[size - 8][8] = true;
}

function mapData(m, data, mask) {
  const size = m.length;
  let inc = -1, row = size - 1, bitIndex = 7, byteIndex = 0;
  for (let col = size - 1; col > 0; col -= 2) {
    if (col === 6) col--;
    for (;;) {
      for (let c = 0; c < 2; c++) {
        if (m[row][col - c] === null) {
          let dark = false;
          if (byteIndex < data.length) dark = ((data[byteIndex] >>> bitIndex) & 1) === 1;
          if (MASK_FN[mask](row, col - c)) dark = !dark;
          m[row][col - c] = dark;
          bitIndex--;
          if (bitIndex === -1) { byteIndex++; bitIndex = 7; }
        }
      }
      row += inc;
      if (row < 0 || row >= size) { row -= inc; inc = -inc; break; }
    }
  }
}

function lostPoint(m) {
  const size = m.length;
  let lost = 0;

  // regra 1 — sequências de 5+ do mesmo tom
  for (let row = 0; row < size; row++) {
    for (let col = 0; col < size; col++) {
      let same = 0;
      const dark = m[row][col];
      for (let r = -1; r <= 1; r++) {
        if (row + r < 0 || row + r >= size) continue;
        for (let c = -1; c <= 1; c++) {
          if (col + c < 0 || col + c >= size) continue;
          if (r === 0 && c === 0) continue;
          if (dark === m[row + r][col + c]) same++;
        }
      }
      if (same > 5) lost += 3 + same - 5;
    }
  }

  // regra 2 — blocos 2x2
  for (let row = 0; row < size - 1; row++) {
    for (let col = 0; col < size - 1; col++) {
      let count = 0;
      if (m[row][col]) count++;
      if (m[row + 1][col]) count++;
      if (m[row][col + 1]) count++;
      if (m[row + 1][col + 1]) count++;
      if (count === 0 || count === 4) lost += 3;
    }
  }

  // regra 3 — padrão 1:1:3:1:1
  for (let row = 0; row < size; row++) {
    for (let col = 0; col < size - 6; col++) {
      if (m[row][col] && !m[row][col + 1] && m[row][col + 2] && m[row][col + 3] &&
          m[row][col + 4] && !m[row][col + 5] && m[row][col + 6]) lost += 40;
    }
  }
  for (let col = 0; col < size; col++) {
    for (let row = 0; row < size - 6; row++) {
      if (m[row][col] && !m[row + 1][col] && m[row + 2][col] && m[row + 3][col] &&
          m[row + 4][col] && !m[row + 5][col] && m[row + 6][col]) lost += 40;
    }
  }

  // regra 4 — proporção de módulos escuros
  let dark = 0;
  for (let col = 0; col < size; col++) for (let row = 0; row < size; row++) if (m[row][col]) dark++;
  const ratio = Math.abs((100 * dark) / (size * size) - 50) / 5;
  return lost + ratio * 10;
}

/** Matriz booleana do QR (true = módulo escuro). */
export function qrMatrix(text) {
  const bytes = toUtf8Bytes(String(text));
  const version = pickVersion(bytes.length);
  if (!version) throw new Error('Texto longo demais para o QR (máx. 213 caracteres).');
  const codewords = interleave(buildDataCodewords(bytes, version), version);
  const size = version * 4 + 17;

  let best = null;
  for (let mask = 0; mask < 8; mask++) {
    const m = blankMatrix(size);
    placeStatic(m, version);
    reserveFormat(m);
    mapData(m, codewords, mask);
    placeFormat(m, mask);
    const score = lostPoint(m);
    if (!best || score < best.score) best = { score, m, mask };
  }
  return { size, modules: best.m, version, mask: best.mask };
}

/** SVG quadrado do QR, com zona silenciosa de 4 módulos. */
export function qrSVG(text, { size = 160, dark = '#0b0b0b', light = '#ffffff', quiet = 4 } = {}) {
  const { size: n, modules } = qrMatrix(text);
  const total = n + quiet * 2;
  let path = '';
  for (let r = 0; r < n; r++) {
    let c = 0;
    while (c < n) {
      if (!modules[r][c]) { c++; continue; }
      let len = 1;
      while (c + len < n && modules[r][c + len]) len++;
      path += `M${c + quiet},${r + quiet}h${len}v1h${-len}z`;
      c += len;
    }
  }
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${total} ${total}" width="${size}" height="${size}" shape-rendering="crispEdges" role="img" aria-label="QR Code ${String(text).replace(/[<>&"]/g, '')}">
    <rect width="${total}" height="${total}" fill="${light}"/>
    <path d="${path}" fill="${dark}"/>
  </svg>`;
}
