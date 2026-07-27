// Monta o relatório (dados + fotos) e exporta em PDF, Excel ou CSV.

import {
  state, meterById, readingsOf, consumptionEvents, activeMeters,
  siteName, meterTariff, TYPES,
} from './store.js';
import { fetchPhoto } from './api.js';
import { PDF, PAGE, PAGE_MARGIN, fit, textWidth } from './pdf.js';
import { buildXlsx } from './xlsx.js';
import { icon, toast, openSheet } from './ui.js';
import {
  esc, fmtAuto, fmtDate, fmtMoney, downloadFile, toCSV, todayISO,
} from './utils.js';

const INK = [0.04, 0.04, 0.04];
const MUTED = [0.54, 0.53, 0.51];
const RULE = [0.85, 0.85, 0.82];
const BRAND = [0.165, 0.471, 0.839];

/* ---------------- coleta ---------------- */

function dataUrlToBytes(dataUrl) {
  const b64 = String(dataUrl || '').split(',')[1] || '';
  try {
    const bin = atob(b64);
    const out = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
  } catch { return null; }
}

/**
 * Reúne medidores, leituras, consumo e fotos do período.
 * @param {function} onProgress recebe (feitos, total) durante a busca das fotos
 */
export async function collectReport(filters, { includePhotos = false, onProgress = null } = {}) {
  const { from, to, type = 'all', siteId = 'all', meterId = 'all' } = filters;
  const meters = activeMeters()
    .filter((m) => (type === 'all' || m.type === type))
    .filter((m) => (siteId === 'all' || (m.siteId || '') === siteId))
    .filter((m) => (meterId === 'all' || m.id === meterId))
    .sort((a, b) => String(a.name || a.code).localeCompare(String(b.name || b.code), 'pt-BR'));

  const blocks = [];
  const pending = [];

  for (const meter of meters) {
    const events = new Map(consumptionEvents(meter.id).map((e) => [e.id, e]));
    const rows = readingsOf(meter.id)
      .filter((r) => r.readAt >= from && r.readAt <= to)
      .map((r) => ({ reading: r, event: events.get(r.id) || null, photo: null }));
    if (!rows.length) continue;
    const factor = Number(meter.factor) > 0 ? Number(meter.factor) : 1;
    const tariff = meterTariff(meter);
    const total = rows.reduce((s, x) => s + (x.event && x.event.consumption !== null ? x.event.consumption : 0), 0);
    blocks.push({ meter, factor, tariff, rows, total, cost: total * tariff });
    if (includePhotos) rows.forEach((x) => { if (x.reading.photoId) pending.push(x); });
  }

  if (includePhotos && pending.length) {
    let done = 0;
    for (const item of pending) {
      try {
        const p = await fetchPhoto(item.reading.photoId);
        if (p && p.data) item.photo = p.data;
      } catch { /* segue sem a foto */ }
      done++;
      if (onProgress) onProgress(done, pending.length);
    }
  }

  const totals = { energia: 0, agua: 0, cost: 0, readings: 0, photos: 0 };
  blocks.forEach((b) => {
    totals[b.meter.type] += b.total;
    totals.cost += b.cost;
    totals.readings += b.rows.length;
    totals.photos += b.rows.filter((r) => r.photo).length;
  });

  return {
    filters: { from, to, type, siteId, meterId },
    generatedAt: new Date(),
    author: state.settings.readerName || '',
    blocks, totals, includePhotos,
  };
}

/* ---------------- PDF ---------------- */

const COLS = [
  { key: 'data', label: 'Data', w: 62, align: 'left' },
  { key: 'leitura', label: 'Leitura', w: 70, align: 'right' },
  { key: 'dif', label: 'Diferença', w: 68, align: 'right' },
  { key: 'consumo', label: 'Consumo', w: 76, align: 'right' },
  { key: 'dias', label: 'Dias', w: 38, align: 'right' },
  { key: 'custo', label: 'Custo', w: 72, align: 'right' },
  { key: 'leiturista', label: 'Leiturista', w: 0, align: 'left' },
];

export function buildPdf(report) {
  const doc = new PDF({ title: 'Relatório de leituras — HidroLuz' });
  const W = doc.contentWidth;
  const X = doc.x0;
  const periodo = `${fmtDate(report.filters.from)} a ${fmtDate(report.filters.to)}`;

  // convenção: doc.y é o topo do próximo elemento; nada desenha acima dele.
  const pageHeader = () => {
    doc.rect(X, doc.y - 20, W, 20, { fill: [0.98, 0.98, 0.97] });
    doc.text('HidroLuz · Relatório de leituras', X + 8, doc.y - 13, { size: 9.5, bold: true, color: BRAND });
    doc.text(periodo, X + W - 8, doc.y - 13, { size: 8.5, color: MUTED, align: 'right' });
    doc.y -= 34;
  };

  // capa / cabeçalho
  doc.text('Relatório de leituras', X, doc.y - 20, { size: 20, bold: true, color: INK });
  doc.y -= 30;
  doc.text(`Energia e água · ${periodo}`, X, doc.y - 11, { size: 11, color: MUTED });
  doc.y -= 17;
  doc.text(
    `Emitido em ${report.generatedAt.toLocaleString('pt-BR')}${report.author ? ' · ' + report.author : ''}`,
    X, doc.y - 9, { size: 9, color: MUTED }
  );
  doc.y -= 24;

  // resumo
  const cards = [
    ['Energia', `${fmtAuto(report.totals.energia)} kWh`],
    ['Água', `${fmtAuto(report.totals.agua)} m³`],
    ['Custo estimado', fmtMoney(report.totals.cost)],
    ['Leituras', String(report.totals.readings)],
  ];
  const cw = (W - 12 * 3) / 4;
  cards.forEach(([label, value], i) => {
    const x = X + i * (cw + 12);
    doc.rect(x, doc.y - 46, cw, 46, { fill: [0.985, 0.985, 0.975], stroke: RULE, width: 0.5 });
    doc.text(label, x + 8, doc.y - 16, { size: 8.5, color: MUTED, maxW: cw - 16 });
    doc.text(value, x + 8, doc.y - 33, { size: 13, bold: true, color: INK, maxW: cw - 16 });
  });
  doc.y -= 60;

  const drawTableHeader = (unit, factor) => {
    const cols = COLS.map((c) => ({ ...c }));
    cols[cols.length - 1].w = W - cols.reduce((s, c) => s + c.w, 0);
    cols[2].label = factor !== 1 ? 'Diferença' : '—';
    let x = X;
    doc.rect(X, doc.y - 16, W, 16, { fill: [0.96, 0.96, 0.95] });
    for (const c of cols) {
      if (c.key === 'dif' && factor === 1) { x += c.w; continue; }
      const label = c.key === 'consumo' ? `Consumo (${unit})` : c.label;
      doc.text(label, c.align === 'right' ? x + c.w - 6 : x + 6, doc.y - 11,
        { size: 8, bold: true, color: MUTED, align: c.align, maxW: c.w - 10 });
      x += c.w;
    }
    doc.y -= 22;
    return cols;
  };

  for (const block of report.blocks) {
    const { meter, factor, tariff } = block;
    const unit = TYPES[meter.type].unit;

    doc.ensure(140, pageHeader);
    doc.y -= 8;

    // cabeçalho do medidor
    doc.rect(X, doc.y - 28, 3, 28, { fill: meter.type === 'agua' ? BRAND : [0.922, 0.408, 0.204] });
    doc.text(meter.name || meter.code, X + 10, doc.y - 12, { size: 12.5, bold: true, color: INK, maxW: W - 160 });
    doc.text(`${fmtAuto(block.total)} ${unit}`, X + W, doc.y - 12, { size: 12.5, bold: true, color: INK, align: 'right' });
    const sub = [TYPES[meter.type].label, meter.code, siteName(meter.siteId), meter.location]
      .filter(Boolean).join(' · ');
    doc.text(sub, X + 10, doc.y - 25, { size: 8.5, color: MUTED, maxW: W - 160 });
    if (tariff) doc.text(fmtMoney(block.cost), X + W, doc.y - 25, { size: 9, color: MUTED, align: 'right' });
    doc.y -= 34;
    if (factor !== 1) {
      doc.text(`Consumo = diferença de leitura × fator ${fmtAuto(factor)}`, X + 10, doc.y - 9, { size: 8.5, color: MUTED });
      doc.y -= 15;
    }

    let cols = drawTableHeader(unit, factor);

    for (const { reading, event } of block.rows) {
      if (doc.ensure(20, pageHeader)) cols = drawTableHeader(unit, factor);
      const has = event && event.consumption !== null;
      const values = {
        data: fmtDate(reading.readAt),
        leitura: fmtAuto(reading.value),
        dif: has ? fmtAuto(event.consumption / factor) : '—',
        consumo: has ? fmtAuto(event.consumption) : '—',
        dias: event ? String(event.days) : '—',
        custo: has && tariff ? fmtMoney(event.consumption * tariff) : '—',
        leiturista: reading.readerName || '',
      };
      let x = X;
      for (const c of cols) {
        if (c.key === 'dif' && factor === 1) { x += c.w; continue; }
        doc.text(values[c.key], c.align === 'right' ? x + c.w - 6 : x + 6, doc.y - 11,
          { size: 9, color: INK, align: c.align, maxW: c.w - 10 });
        x += c.w;
      }
      doc.line(X, doc.y - 16, X + W, doc.y - 16, { color: [0.91, 0.91, 0.89], width: 0.4 });
      doc.y -= 18;
      if (reading.note) {
        doc.text(fit(reading.note, 8, W - 20), X + 6, doc.y - 8, { size: 8, color: MUTED });
        doc.y -= 13;
      }
    }

    // comprovantes fotográficos
    const withPhotos = block.rows.filter((r) => r.photo);
    if (report.includePhotos && withPhotos.length) {
      doc.y -= 8;
      const perRow = 4;
      const gap = 10;
      const cellW = (W - gap * (perRow - 1)) / perRow;
      const cellH = cellW * 0.78;

      doc.ensure(cellH + 46, pageHeader);
      doc.text('Comprovantes fotográficos', X, doc.y - 10, { size: 9.5, bold: true, color: MUTED });
      doc.y -= 18;

      for (let i = 0; i < withPhotos.length; i += perRow) {
        if (doc.ensure(cellH + 30, pageHeader)) {
          doc.text('Comprovantes fotográficos (continuação)', X, doc.y - 10, { size: 9.5, bold: true, color: MUTED });
          doc.y -= 18;
        }
        const slice = withPhotos.slice(i, i + perRow);
        slice.forEach((item, k) => {
          const x = X + k * (cellW + gap);
          const yTop = doc.y;
          doc.rect(x, yTop - cellH, cellW, cellH, { fill: [0.96, 0.96, 0.95], stroke: RULE, width: 0.4 });
          const box = doc.imageBox(item.photo, cellW - 6, cellH - 6);
          if (box) {
            doc.image(item.photo, x + (cellW - box.w) / 2, yTop - cellH + (cellH - box.h) / 2, box.w, box.h);
          }
          doc.text(
            `${fmtDate(item.reading.readAt)} · ${fmtAuto(item.reading.value)} ${unit}`,
            x, yTop - cellH - 11, { size: 7.5, color: MUTED, maxW: cellW }
          );
        });
        doc.y -= cellH + 24;
      }
    }

    doc.y -= 12;
    doc.line(X, doc.y, X + W, doc.y, { color: RULE, width: 0.5 });
    doc.y -= 8;
  }

  if (!report.blocks.length) {
    doc.text('Nenhuma leitura no período selecionado.', X, doc.y, { size: 11, color: MUTED });
  }

  return doc.build();
}

/* ---------------- Excel ---------------- */

export function buildExcel(report) {
  const periodo = `${fmtDate(report.filters.from)} a ${fmtDate(report.filters.to)}`;
  const withPhotos = report.includePhotos;

  const head = ['Data', 'Unidade', 'Medidor', 'Código', 'Tipo', 'Local', 'Leitura',
    'Diferença', 'Fator', 'Consumo', 'Unid.', 'Dias', 'Custo', 'Leiturista', 'Observação'];
  if (withPhotos) head.push('Foto');

  const rows = [
    { cells: [{ value: 'HidroLuz — Relatório de leituras', style: 6 }] },
    { cells: [{ value: `Período ${periodo} · emitido em ${report.generatedAt.toLocaleString('pt-BR')}`, style: 0 }] },
    { cells: [] },
    { cells: head.map((h) => ({ value: h, style: 1 })), height: 26 },
  ];
  const headerRows = rows.length;
  const images = [];
  const photoCol = head.length - 1;

  report.blocks.forEach((block) => {
    const { meter, factor, tariff } = block;
    block.rows.forEach((item) => {
      const { reading, event, photo } = item;
      const has = event && event.consumption !== null;
      const cells = [
        { type: 'date', value: reading.readAt, style: 3 },
        siteName(meter.siteId),
        meter.name || '',
        meter.code || '',
        TYPES[meter.type].label,
        meter.location || '',
        { type: 'number', value: reading.value, style: 2 },
        has ? { type: 'number', value: event.consumption / factor, style: 2 } : '',
        { type: 'number', value: factor, style: 0 },
        has ? { type: 'number', value: event.consumption, style: 2 } : '',
        TYPES[meter.type].unit,
        event ? { type: 'number', value: event.days, style: 0 } : '',
        has && tariff ? { type: 'number', value: event.consumption * tariff, style: 5 } : '',
        reading.readerName || '',
        reading.note || '',
      ];
      if (withPhotos) cells.push(photo ? '' : 'sem foto');
      const rowIndex = rows.length;           // 0-based para a âncora do desenho
      rows.push({ cells, height: photo ? 70 : undefined });
      if (photo) {
        const bytes = dataUrlToBytes(photo);
        if (bytes) images.push({ col: photoCol, row: rowIndex, w: 120, h: 88, bytes });
      }
    });
  });

  const widths = [11, 18, 26, 12, 10, 18, 13, 12, 8, 13, 8, 7, 12, 14, 26];
  if (withPhotos) widths.push(18);

  const resumo = [
    { cells: [{ value: 'Resumo por medidor', style: 6 }] },
    { cells: [] },
    {
      cells: ['Medidor', 'Código', 'Tipo', 'Unidade', 'Leituras', 'Consumo', 'Unid.', 'Custo']
        .map((h) => ({ value: h, style: 1 })),
      height: 22,
    },
    ...report.blocks.map((b) => ({
      cells: [
        b.meter.name || '', b.meter.code || '', TYPES[b.meter.type].label, siteName(b.meter.siteId),
        { type: 'number', value: b.rows.length, style: 0 },
        { type: 'number', value: b.total, style: 2 },
        TYPES[b.meter.type].unit,
        { type: 'number', value: b.cost, style: 5 },
      ],
    })),
    { cells: [] },
    {
      cells: [{ value: 'TOTAL', style: 4 }, '', '', '', '',
        { type: 'number', value: report.totals.energia + report.totals.agua, style: 2 },
        'kWh + m³',
        { type: 'number', value: report.totals.cost, style: 5 }],
    },
  ];

  return buildXlsx([
    {
      name: 'Leituras', rows, widths,
      freezeRow: headerRows,
      autoFilter: `A${headerRows}:${String.fromCharCode(64 + head.length)}${rows.length}`,
      images,
    },
    { name: 'Resumo', rows: resumo, widths: [26, 12, 10, 18, 10, 14, 10, 14] },
  ]);
}

/* ---------------- CSV ---------------- */

export function buildCsv(report) {
  const flat = [];
  report.blocks.forEach((b) => b.rows.forEach((item) => flat.push({ ...item, block: b })));
  return toCSV(flat, [
    { label: 'Data', get: (x) => fmtDate(x.reading.readAt) },
    { label: 'Unidade', get: (x) => siteName(x.block.meter.siteId) },
    { label: 'Medidor', get: (x) => x.block.meter.name },
    { label: 'Código', get: (x) => x.block.meter.code || '' },
    { label: 'Tipo', get: (x) => TYPES[x.block.meter.type].label },
    { label: 'Local', get: (x) => x.block.meter.location || '' },
    { label: 'Leitura', get: (x) => String(x.reading.value).replace('.', ',') },
    { label: 'Diferença', get: (x) => (x.event && x.event.consumption !== null ? (x.event.consumption / x.block.factor).toFixed(3).replace('.', ',') : '') },
    { label: 'Fator', get: (x) => String(x.block.factor).replace('.', ',') },
    { label: 'Consumo', get: (x) => (x.event && x.event.consumption !== null ? x.event.consumption.toFixed(3).replace('.', ',') : '') },
    { label: 'Unid.', get: (x) => TYPES[x.block.meter.type].unit },
    { label: 'Dias', get: (x) => (x.event ? x.event.days : '') },
    { label: 'Custo', get: (x) => (x.event && x.event.consumption !== null && x.block.tariff ? (x.event.consumption * x.block.tariff).toFixed(2).replace('.', ',') : '') },
    { label: 'Leiturista', get: (x) => x.reading.readerName || '' },
    { label: 'Observação', get: (x) => x.reading.note || '' },
    { label: 'Tem foto', get: (x) => (x.reading.photoId ? 'sim' : 'não') },
  ]);
}

/* ---------------- interface ---------------- */

const slug = (s) => String(s || 'relatorio').normalize('NFD').replace(/[̀-ͯ]/g, '')
  .replace(/\W+/g, '-').replace(/^-|-$/g, '').toLowerCase();

/**
 * Folha de exportação: escolhe formato e se leva as fotos.
 * @param {object} opts { filters, nome, subtitulo }
 */
export function openExportSheet({ filters, nome = 'leituras', subtitulo = '' }) {
  let includePhotos = true;

  openSheet({
    title: 'Exportar relatório',
    sub: subtitulo,
    body: `<div class="stack">
      <div class="field">
        <label>Incluir as fotos das leituras</label>
        <div class="filters" style="padding-bottom:0">
          <button class="chip" data-ph="1" data-active="true">Com fotos</button>
          <button class="chip" data-ph="0">Só os dados</button>
        </div>
        <span class="hint">As fotos entram no PDF e nas linhas da planilha. Fotos que estão só na nuvem são baixadas na hora.</span>
      </div>
      <div class="stack" style="gap:9px">
        <button class="btn btn--primary btn--block" data-fmt="pdf">${icon('download', 18)} Relatório em PDF</button>
        <button class="btn btn--block" data-fmt="xlsx">${icon('download', 18)} Planilha Excel (.xlsx)</button>
        <button class="btn btn--block" data-fmt="csv">${icon('download', 18)} CSV simples</button>
      </div>
      <div id="exp-status"></div>
    </div>`,
    onMount(sheet, close) {
      const status = sheet.querySelector('#exp-status');
      sheet.querySelectorAll('[data-ph]').forEach((b) => b.onclick = () => {
        includePhotos = b.dataset.ph === '1';
        sheet.querySelectorAll('[data-ph]').forEach((x) => x.dataset.active = String(x === b));
      });

      sheet.querySelectorAll('[data-fmt]').forEach((btn) => btn.onclick = async () => {
        const fmt = btn.dataset.fmt;
        const wantPhotos = includePhotos && fmt !== 'csv';
        sheet.querySelectorAll('[data-fmt]').forEach((b) => b.disabled = true);
        status.innerHTML = `<div class="alert alert--info"><span class="spinner"></span><span id="exp-msg">Montando o relatório…</span></div>`;
        const msg = status.querySelector('#exp-msg');

        try {
          const report = await collectReport(filters, {
            includePhotos: wantPhotos,
            onProgress: (done, total) => { msg.textContent = `Carregando fotos… ${done}/${total}`; },
          });
          if (!report.blocks.length) {
            status.innerHTML = `<div class="alert alert--warn">${icon('alert', 18)}<span>Nenhuma leitura no período selecionado.</span></div>`;
            sheet.querySelectorAll('[data-fmt]').forEach((b) => b.disabled = false);
            return;
          }
          msg.textContent = 'Gerando o arquivo…';
          const stamp = `${report.filters.from}-a-${report.filters.to}`;
          if (fmt === 'pdf') {
            downloadFile(`${slug(nome)}-${stamp}.pdf`, buildPdf(report));
          } else if (fmt === 'xlsx') {
            downloadFile(`${slug(nome)}-${stamp}.xlsx`, buildExcel(report));
          } else {
            downloadFile(`${slug(nome)}-${stamp}.csv`, buildCsv(report), 'text/csv;charset=utf-8');
          }
          toast(`Relatório exportado — ${report.totals.readings} leitura(s)${report.totals.photos ? ` e ${report.totals.photos} foto(s)` : ''}.`, 'ok', 4200);
          close();
        } catch (e) {
          status.innerHTML = `<div class="alert alert--critical">${icon('alert', 18)}<span>${esc(e.message || 'Falha ao gerar o relatório.')}</span></div>`;
          sheet.querySelectorAll('[data-fmt]').forEach((b) => b.disabled = false);
        }
      });
    },
  });
}

