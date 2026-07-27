// Gerador de PDF sem dependências: texto (Helvetica/WinAnsi), linhas e
// imagens JPEG embutidas direto como XObject /DCTDecode (sem recodificar).

const A4 = { w: 595.28, h: 841.89 };
const MARGIN = 40;

/* ---------------- primitivas de bytes ---------------- */

/** Texto → bytes CP1252 (WinAnsiEncoding), com acentuação preservada. */
function latin1(str) {
  const map = { '—': 0x97, '–': 0x96, '“': 0x93, '”': 0x94, '‘': 0x91, '’': 0x92, '•': 0x95, '…': 0x85, '€': 0x80 };
  const out = [];
  for (const ch of String(str)) {
    if (map[ch] !== undefined) { out.push(map[ch]); continue; }
    const c = ch.codePointAt(0);
    out.push(c <= 0xff ? c : 0x3f); // '?' para o que não cabe
  }
  return Uint8Array.from(out);
}

const pdfEscape = (s) => String(s).replace(/\\/g, '\\\\').replace(/\(/g, '\\(').replace(/\)/g, '\\)');

function concat(chunks) {
  let len = 0;
  for (const c of chunks) len += c.length;
  const out = new Uint8Array(len);
  let o = 0;
  for (const c of chunks) { out.set(c, o); o += c.length; }
  return out;
}

/** Largura aproximada do texto em Helvetica — suficiente para truncar e alinhar. */
const CHAR_W = 0.5;
const WIDE = 'MMWWmw@%';
export function textWidth(str, size, bold = false) {
  let w = 0;
  for (const ch of String(str)) {
    if (WIDE.includes(ch)) w += 0.85;
    else if ('ilItj.,:;\'|! '.includes(ch)) w += 0.30;
    else if ('0123456789'.includes(ch)) w += 0.556;
    else w += CHAR_W + 0.06;
  }
  return w * size * (bold ? 1.04 : 1);
}

export function fit(str, size, maxW, bold = false) {
  let s = String(str ?? '');
  if (textWidth(s, size, bold) <= maxW) return s;
  while (s.length > 1 && textWidth(s + '…', size, bold) > maxW) s = s.slice(0, -1);
  return s + '…';
}

/* ---------------- JPEG ---------------- */

/** Lê largura/altura/componentes do marcador SOF do JPEG. */
function jpegInfo(bytes) {
  let i = 2;
  while (i < bytes.length) {
    if (bytes[i] !== 0xff) { i++; continue; }
    const marker = bytes[i + 1];
    if (marker === 0xd8 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) { i += 2; continue; }
    const len = (bytes[i + 2] << 8) | bytes[i + 3];
    if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
      return {
        height: (bytes[i + 5] << 8) | bytes[i + 6],
        width: (bytes[i + 7] << 8) | bytes[i + 8],
        components: bytes[i + 9],
      };
    }
    i += 2 + len;
  }
  return null;
}

function dataUrlToBytes(dataUrl) {
  const b64 = String(dataUrl).split(',')[1] || '';
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

/* ---------------- documento ---------------- */

export class PDF {
  constructor({ title = '', author = 'HidroLuz' } = {}) {
    this.title = title;
    this.author = author;
    this.pages = [];
    this.images = [];       // { id, bytes, width, height, components }
    this.imageByHash = new Map();
    this.ops = null;
    this.y = 0;
    this.newPage();
  }

  newPage() {
    this.ops = [];
    this.pages.push(this.ops);
    this.y = A4.h - MARGIN;
    return this;
  }

  get contentWidth() { return A4.w - MARGIN * 2; }
  get x0() { return MARGIN; }

  /** Garante espaço vertical; quebra a página se faltar. */
  ensure(h, onNewPage) {
    if (this.y - h < MARGIN + 24) {
      this.newPage();
      if (onNewPage) onNewPage();
      return true;
    }
    return false;
  }

  text(str, x, y, { size = 10, bold = false, color = [0.04, 0.04, 0.04], align = 'left', maxW = null } = {}) {
    let s = maxW ? fit(str, size, maxW, bold) : String(str ?? '');
    let px = x;
    if (align === 'right') px = x - textWidth(s, size, bold);
    else if (align === 'center') px = x - textWidth(s, size, bold) / 2;
    this.ops.push(
      `BT /${bold ? 'F2' : 'F1'} ${size} Tf ${color[0]} ${color[1]} ${color[2]} rg ` +
      `1 0 0 1 ${px.toFixed(2)} ${y.toFixed(2)} Tm (${pdfEscape(s)}) Tj ET`
    );
    return this;
  }

  line(x1, y1, x2, y2, { width = 0.6, color = [0.78, 0.78, 0.74] } = {}) {
    this.ops.push(
      `${color[0]} ${color[1]} ${color[2]} RG ${width} w ` +
      `${x1.toFixed(2)} ${y1.toFixed(2)} m ${x2.toFixed(2)} ${y2.toFixed(2)} l S`
    );
    return this;
  }

  rect(x, y, w, h, { fill = null, stroke = null, width = 0.6 } = {}) {
    let op = '';
    if (fill) op += `${fill[0]} ${fill[1]} ${fill[2]} rg `;
    if (stroke) op += `${stroke[0]} ${stroke[1]} ${stroke[2]} RG ${width} w `;
    op += `${x.toFixed(2)} ${y.toFixed(2)} ${w.toFixed(2)} ${h.toFixed(2)} re `;
    op += fill && stroke ? 'B' : fill ? 'f' : 'S';
    this.ops.push(op);
    return this;
  }

  /** Insere um JPEG (data URL). Retorna false se a imagem não for utilizável. */
  image(dataUrl, x, y, w, h) {
    if (!dataUrl || !/^data:image\/jpe?g/i.test(dataUrl)) return false;
    let entry = this.imageByHash.get(dataUrl);
    if (!entry) {
      let bytes;
      try { bytes = dataUrlToBytes(dataUrl); } catch { return false; }
      const info = jpegInfo(bytes);
      if (!info || !info.width) return false;
      entry = { id: 'Im' + (this.images.length + 1), bytes, ...info };
      this.images.push(entry);
      this.imageByHash.set(dataUrl, entry);
    }
    this.ops.push(`q ${w.toFixed(2)} 0 0 ${h.toFixed(2)} ${x.toFixed(2)} ${y.toFixed(2)} cm /${entry.id} Do Q`);
    return true;
  }

  /** Proporção da imagem, para caber numa caixa sem distorcer. */
  imageBox(dataUrl, boxW, boxH) {
    if (!dataUrl || !/^data:image\/jpe?g/i.test(dataUrl)) return null;
    let entry = this.imageByHash.get(dataUrl);
    if (!entry) {
      let bytes;
      try { bytes = dataUrlToBytes(dataUrl); } catch { return null; }
      const info = jpegInfo(bytes);
      if (!info || !info.width) return null;
      entry = { id: 'Im' + (this.images.length + 1), bytes, ...info };
      this.images.push(entry);
      this.imageByHash.set(dataUrl, entry);
    }
    const s = Math.min(boxW / entry.width, boxH / entry.height);
    return { w: entry.width * s, h: entry.height * s };
  }

  /* ---------------- serialização ---------------- */

  build() {
    const objects = [];   // array de Uint8Array (corpo de cada objeto, sem "n 0 obj")
    const push = (bytes) => { objects.push(bytes); return objects.length; };  // 1-based

    const nPages = this.pages.length;
    // reserva: 1 catálogo, 2 pages, 3 font F1, 4 font F2
    const catalogId = 1, pagesId = 2, f1 = 3, f2 = 4;
    objects.length = 4;

    const imageIds = new Map();
    for (const img of this.images) {
      const header = latin1(
        `<< /Type /XObject /Subtype /Image /Width ${img.width} /Height ${img.height} ` +
        `/ColorSpace ${img.components === 1 ? '/DeviceGray' : '/DeviceRGB'} /BitsPerComponent 8 ` +
        `/Filter /DCTDecode /Length ${img.bytes.length} >>\nstream\n`
      );
      imageIds.set(img.id, push(concat([header, img.bytes, latin1('\nendstream')])));
    }

    const pageIds = [];
    const contentIds = [];
    for (let i = 0; i < nPages; i++) {
      const content = latin1(this.pages[i].join('\n'));
      contentIds.push(push(concat([latin1(`<< /Length ${content.length} >>\nstream\n`), content, latin1('\nendstream')])));
      pageIds.push(0); // preenchido abaixo
    }
    for (let i = 0; i < nPages; i++) {
      const xobjs = [...imageIds.entries()].map(([name, id]) => `/${name} ${id} 0 R`).join(' ');
      pageIds[i] = push(latin1(
        `<< /Type /Page /Parent ${pagesId} 0 R /MediaBox [0 0 ${A4.w} ${A4.h}] ` +
        `/Resources << /Font << /F1 ${f1} 0 R /F2 ${f2} 0 R >>` +
        (xobjs ? ` /XObject << ${xobjs} >>` : '') + ' >> ' +
        `/Contents ${contentIds[i]} 0 R >>`
      ));
    }

    objects[catalogId - 1] = latin1(`<< /Type /Catalog /Pages ${pagesId} 0 R >>`);
    objects[pagesId - 1] = latin1(
      `<< /Type /Pages /Count ${nPages} /Kids [${pageIds.map((id) => `${id} 0 R`).join(' ')}] >>`
    );
    objects[f1 - 1] = latin1('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>');
    objects[f2 - 1] = latin1('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>');

    const infoId = push(latin1(
      `<< /Title (${pdfEscape(this.title)}) /Author (${pdfEscape(this.author)}) /Producer (HidroLuz) >>`
    ));

    // montagem com xref
    const chunks = [latin1('%PDF-1.4\n%\xE2\xE3\xCF\xD3\n')];
    let offset = chunks[0].length;
    const offsets = [];
    for (let i = 0; i < objects.length; i++) {
      const body = objects[i] || latin1('<< >>');
      const head = latin1(`${i + 1} 0 obj\n`);
      const tail = latin1('\nendobj\n');
      offsets[i] = offset;
      chunks.push(head, body, tail);
      offset += head.length + body.length + tail.length;
    }

    const xrefStart = offset;
    let xref = `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
    for (let i = 0; i < objects.length; i++) {
      xref += String(offsets[i]).padStart(10, '0') + ' 00000 n \n';
    }
    xref += `trailer\n<< /Size ${objects.length + 1} /Root ${catalogId} 0 R /Info ${infoId} 0 R >>\n` +
            `startxref\n${xrefStart}\n%%EOF\n`;
    chunks.push(latin1(xref));

    return new Blob([concat(chunks)], { type: 'application/pdf' });
  }
}

export const PAGE = A4;
export const PAGE_MARGIN = MARGIN;
