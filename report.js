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
  esc, fmtAuto, fmtLeitura, fmtDate, fmtMoney, downloadFile, toCSV, todayISO,
  monthKey, monthLabel, daysBetween, addDaysISO,
} from './utils.js';
import { sugestoes, segmentLabel } from './gestao.js';

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
    ...analiseGerencial(meters, from, to),
  };
}

/* ---------------- números do relatório gerencial ---------------- */

const diaAntes = (iso, n = 1) => {
  const d = new Date(iso + 'T12:00:00');
  d.setDate(d.getDate() - n);
  return d.toISOString().slice(0, 10);
};

/** Consumo e custo de uma lista de medidores dentro de uma janela de datas. */
function somaJanela(meters, de, ate) {
  const out = { energia: 0, agua: 0, cost: 0 };
  for (const m of meters) {
    const tariff = meterTariff(m);
    for (const e of consumptionEvents(m.id)) {
      if (e.consumption === null || e.readAt < de || e.readAt > ate) continue;
      out[m.type] += e.consumption;
      out.cost += e.consumption * tariff;
    }
  }
  return out;
}

/**
 * Comparação com o período anterior de mesmo tamanho, evolução mês a mês,
 * ranking de maiores consumidores e situação dos limites da unidade.
 */
function analiseGerencial(meters, from, to) {
  const dias = Math.max(1, daysBetween(from, to) + 1);
  const anteriorAte = diaAntes(from);
  const anteriorDe = diaAntes(from, dias);
  const prev = somaJanela(meters, anteriorDe, anteriorAte);

  // evolução mês a mês, separada por tipo (nunca no mesmo eixo)
  const meses = new Map();
  for (const m of meters) {
    for (const e of consumptionEvents(m.id)) {
      if (e.consumption === null || e.readAt < from || e.readAt > to) continue;
      const k = monthKey(e.readAt);
      if (!meses.has(k)) meses.set(k, { mes: k, energia: 0, agua: 0, cost: 0 });
      const r = meses.get(k);
      r[m.type] += e.consumption;
      r.cost += e.consumption * meterTariff(m);
    }
  }
  const mensal = [...meses.values()].sort((a, b) => a.mes.localeCompare(b.mes));

  // unidades envolvidas — definem segmento e limites
  const ids = [...new Set(meters.map((m) => m.siteId || ''))];
  const sites = state.sites.filter((s) => !s.deleted && ids.includes(s.id));

  // limites: comparados contra o mês corrente, que é o que o dono acompanha
  const limites = [];
  const mesAtual = monthKey(todayISO());
  const doMes = mensal.find((r) => r.mes === mesAtual);
  for (const s of sites) {
    const meusMed = meters.filter((m) => (m.siteId || '') === s.id);
    if (!meusMed.length) continue;
    const uso = somaJanela(meusMed, mesAtual + '-01', todayISO());
    const linhas = [
      { tipo: 'energia', rotulo: 'Energia', unidade: 'kWh', limite: Number(s.limitEnergia) || 0, usado: uso.energia },
      { tipo: 'agua', rotulo: 'Água', unidade: 'm³', limite: Number(s.limitAgua) || 0, usado: uso.agua },
      { tipo: 'custo', rotulo: 'Custo estimado', unidade: 'R$', limite: Number(s.limitCost) || 0, usado: uso.cost },
    ].filter((l) => l.limite > 0);
    if (linhas.length) limites.push({ site: s, mes: mesAtual, linhas });
  }

  return { prev, prevRange: { from: anteriorDe, to: anteriorAte }, dias, mensal, sites, limites, mesAtual, doMes };
}

/* ---------------- PDF ---------------- */

const COL_FOTO = { key: 'foto', label: 'Foto', w: 78, align: 'left' };

// `wc` é a largura usada quando a coluna da foto ocupa parte da linha
const COLS = [
  { key: 'data', label: 'Data', w: 66, wc: 64, align: 'left' },
  { key: 'leitura', label: 'Leitura', w: 70, wc: 62, align: 'right' },
  { key: 'dif', label: 'Diferença', w: 68, wc: 58, align: 'right' },
  { key: 'consumo', label: 'Consumo', w: 80, wc: 78, align: 'right' },
  { key: 'dias', label: 'Dias', w: 36, wc: 30, align: 'right' },
  { key: 'custo', label: 'Custo', w: 72, wc: 68, align: 'right' },
  { key: 'leiturista', label: 'Leiturista', w: 0, wc: 0, align: 'left' },
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

  desenharBlocos(doc, report, X, W, pageHeader);

  if (!report.blocks.length) {
    doc.text('Nenhuma leitura no período selecionado.', X, doc.y, { size: 11, color: MUTED });
  }

  return doc.build();
}

/** Tabela de leituras por medidor — compartilhada pelos dois relatórios. */
function desenharBlocos(doc, report, X, W, pageHeader) {
  const comFotos = !!report.includePhotos;

  const drawTableHeader = (unit, factor) => {
    const corpo = COLS
      .filter((c) => !(c.key === 'dif' && factor === 1))   // sem fator, não há diferença a mostrar
      .map((c) => ({ ...c, w: comFotos ? c.wc : c.w }));
    const cols = comFotos ? [{ ...COL_FOTO }, ...corpo] : corpo;
    cols[cols.length - 1].w = W - cols.reduce((s, c) => s + c.w, 0);   // leiturista ocupa a sobra

    let x = X;
    doc.rect(X, doc.y - 16, W, 16, { fill: [0.96, 0.96, 0.95] });
    for (const c of cols) {
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

    const alturaLinha = comFotos ? 74 : 18;

    for (const { reading, event, photo } of block.rows) {
      if (doc.ensure(alturaLinha + 4, pageHeader)) cols = drawTableHeader(unit, factor);
      const has = event && event.consumption !== null;
      const values = {
        data: fmtDate(reading.readAt),
        leitura: fmtLeitura(reading.value),
        dif: has ? fmtAuto(event.consumption / factor) : '—',
        consumo: has ? fmtAuto(event.consumption) : '—',
        dias: event ? String(event.days) : '—',
        custo: has && tariff ? fmtMoney(event.consumption * tariff) : '—',
        leiturista: reading.readerName || '',
      };
      // linha centralizada verticalmente quando há foto
      const meio = comFotos ? doc.y - alturaLinha / 2 - 3 : doc.y - 11;
      let x = X;
      for (const c of cols) {
        if (c.key === 'foto') {
          const cw2 = c.w - 8, ch2 = alturaLinha - 8;
          const bx = x + 2, by = doc.y - alturaLinha + 4;
          doc.rect(bx, by, cw2, ch2, { fill: [0.96, 0.96, 0.95], stroke: RULE, width: 0.4 });
          const box = photo ? doc.imageBox(photo, cw2 - 4, ch2 - 4) : null;
          if (box) doc.image(photo, bx + (cw2 - box.w) / 2, by + (ch2 - box.h) / 2, box.w, box.h);
          else doc.text('sem foto', bx + cw2 / 2, by + ch2 / 2 - 3, { size: 7.5, color: MUTED, align: 'center' });
          x += c.w;
          continue;
        }
        doc.text(values[c.key], c.align === 'right' ? x + c.w - 6 : x + 6, meio,
          { size: 9, color: INK, align: c.align, maxW: c.w - 10 });
        x += c.w;
      }
      doc.line(X, doc.y - alturaLinha + 2, X + W, doc.y - alturaLinha + 2, { color: [0.91, 0.91, 0.89], width: 0.4 });
      doc.y -= alturaLinha;
      if (reading.note) {
        doc.text(fit(reading.note, 8, W - 20), X + 6, doc.y - 8, { size: 8, color: MUTED });
        doc.y -= 13;
      }
    }

    doc.y -= 12;
    doc.line(X, doc.y, X + W, doc.y, { color: RULE, width: 0.5 });
    doc.y -= 8;
  }
}

/* ---------------- relatório gerencial ---------------- */

const C_ENERGIA = [0.922, 0.408, 0.204];
const C_AGUA = [0.165, 0.471, 0.839];
const C_OK = [0.13, 0.52, 0.33];
const C_ATENCAO = [0.80, 0.56, 0.11];
const C_ESTOURO = [0.78, 0.21, 0.18];
const corTipo = (t) => (t === 'agua' ? C_AGUA : C_ENERGIA);

/** Quebra o texto em linhas que cabem na largura, sem cortar palavra. */
function quebrar(texto, size, maxW, bold = false) {
  const palavras = String(texto || '').split(/\s+/).filter(Boolean);
  const linhas = [];
  let atual = '';
  for (const p of palavras) {
    const teste = atual ? `${atual} ${p}` : p;
    if (textWidth(teste, size, bold) <= maxW) { atual = teste; continue; }
    if (atual) linhas.push(atual);
    atual = textWidth(p, size, bold) <= maxW ? p : fit(p, size, maxW, bold);
  }
  if (atual) linhas.push(atual);
  return linhas;
}

const variacao = (atual, anterior) => {
  if (!anterior) return null;
  return ((atual - anterior) / anterior) * 100;
};

export function buildManagerialPdf(report) {
  const doc = new PDF({ title: 'Relatório gerencial de consumo — HidroLuz' });
  const W = doc.contentWidth;
  const X = doc.x0;
  const periodo = `${fmtDate(report.filters.from)} a ${fmtDate(report.filters.to)}`;

  const site = report.sites.length === 1 ? report.sites[0] : null;
  const titulo = site ? site.name : (report.sites.length ? 'Todas as unidades' : 'Consumo geral');
  const temEnergia = report.totals.energia > 0;
  const temAgua = report.totals.agua > 0;

  const pageHeader = () => {
    doc.rect(X, doc.y - 20, W, 20, { fill: [0.98, 0.98, 0.97] });
    doc.text(`${titulo} · Relatório gerencial`, X + 8, doc.y - 13, { size: 9.5, bold: true, color: BRAND, maxW: W - 150 });
    doc.text(periodo, X + W - 8, doc.y - 13, { size: 8.5, color: MUTED, align: 'right' });
    doc.y -= 34;
  };

  /* ---- faixa de capa ---- */
  const bandaH = 84;
  doc.rect(X, doc.y - bandaH, W, bandaH, { fill: [0.09, 0.11, 0.14] });
  doc.text('RELATÓRIO GERENCIAL DE CONSUMO', X + 18, doc.y - 24,
    { size: 8.5, bold: true, color: [0.62, 0.68, 0.76] });
  doc.text(titulo, X + 18, doc.y - 47, { size: 19, bold: true, color: [1, 1, 1], maxW: W - 190 });
  const linhaSub = [site && site.segment ? segmentLabel(site.segment) : '', `Energia e água`]
    .filter(Boolean).join(' · ');
  doc.text(linhaSub, X + 18, doc.y - 65, { size: 9.5, color: [0.72, 0.77, 0.83], maxW: W - 190 });
  doc.text('Período', X + W - 18, doc.y - 26, { size: 8, color: [0.62, 0.68, 0.76], align: 'right' });
  doc.text(periodo, X + W - 18, doc.y - 41, { size: 10.5, bold: true, color: [1, 1, 1], align: 'right' });
  doc.text(`${report.dias} dias · ${report.totals.readings} leitura(s)`, X + W - 18, doc.y - 56,
    { size: 8.5, color: [0.72, 0.77, 0.83], align: 'right' });
  doc.y -= bandaH + 12;

  const rodapeCapa = [
    `Emitido em ${report.generatedAt.toLocaleString('pt-BR')}`,
    report.author ? `Responsável: ${report.author}` : '',
    site && site.ownerName ? `Proprietário: ${site.ownerName}` : '',
  ].filter(Boolean).join('  ·  ');
  doc.text(rodapeCapa, X, doc.y - 9, { size: 8.5, color: MUTED, maxW: W });
  doc.y -= 22;

  /* ---- resumo executivo ---- */
  const varCusto = variacao(report.totals.cost, report.prev.cost);
  const cards = [
    { label: 'Energia no período', valor: `${fmtAuto(report.totals.energia)} kWh`, cor: temEnergia ? C_ENERGIA : MUTED },
    { label: 'Água no período', valor: `${fmtAuto(report.totals.agua)} m³`, cor: temAgua ? C_AGUA : MUTED },
    { label: 'Custo estimado', valor: fmtMoney(report.totals.cost), cor: INK },
    {
      label: 'Vs. período anterior',
      valor: varCusto === null ? 'sem base' : `${varCusto >= 0 ? '+' : '-'}${Math.abs(varCusto).toFixed(0)}%`,
      cor: varCusto === null ? MUTED : (varCusto > 5 ? C_ESTOURO : (varCusto < -5 ? C_OK : INK)),
    },
  ];
  const cw = (W - 12 * 3) / 4;
  cards.forEach((c, i) => {
    const x = X + i * (cw + 12);
    doc.rect(x, doc.y - 52, cw, 52, { fill: [0.985, 0.985, 0.975], stroke: RULE, width: 0.5 });
    doc.rect(x, doc.y - 52, 2.5, 52, { fill: c.cor });
    doc.text(c.label, x + 10, doc.y - 17, { size: 8, color: MUTED, maxW: cw - 18 });
    doc.text(c.valor, x + 10, doc.y - 36, { size: 13.5, bold: true, color: c.cor, maxW: cw - 18 });
  });
  doc.y -= 66;

  /* ---- comparativo com o período anterior ---- */
  const secao = (nome, sub = '') => {
    doc.text(nome, X, doc.y - 12, { size: 12, bold: true, color: INK });
    doc.y -= sub ? 16 : 20;
    if (sub) {
      doc.text(sub, X, doc.y - 9, { size: 8.5, color: MUTED, maxW: W });
      doc.y -= 16;
    }
  };

  doc.ensure(120, pageHeader);
  secao('Comparativo com o período anterior',
    `Período anterior de mesmo tamanho: ${fmtDate(report.prevRange.from)} a ${fmtDate(report.prevRange.to)}.`);

  const compCols = [180, 110, 110, W - 400];
  const compHead = ['Indicador', 'Período atual', 'Período anterior', 'Variação'];
  doc.rect(X, doc.y - 16, W, 16, { fill: [0.96, 0.96, 0.95] });
  compHead.forEach((h, i) => {
    const x = X + compCols.slice(0, i).reduce((s, v) => s + v, 0);
    doc.text(h, i === 0 ? x + 6 : x + compCols[i] - 6, doc.y - 11,
      { size: 8, bold: true, color: MUTED, align: i === 0 ? 'left' : 'right' });
  });
  doc.y -= 20;

  const linhasComp = [
    temEnergia && ['Energia (kWh)', report.totals.energia, report.prev.energia, fmtAuto],
    temAgua && ['Água (m³)', report.totals.agua, report.prev.agua, fmtAuto],
    ['Custo estimado', report.totals.cost, report.prev.cost, fmtMoney],
  ].filter(Boolean);

  for (const [rot, at, ant, fmt] of linhasComp) {
    const v = variacao(at, ant);
    const cor = v === null ? MUTED : (v > 5 ? C_ESTOURO : (v < -5 ? C_OK : INK));
    const txt = v === null ? 'sem base' : `${v >= 0 ? '+' : '-'}${Math.abs(v).toFixed(1)}%`;
    const vals = [rot, fmt(at), ant ? fmt(ant) : '—', txt];
    vals.forEach((val, i) => {
      const x = X + compCols.slice(0, i).reduce((s, v2) => s + v2, 0);
      doc.text(val, i === 0 ? x + 6 : x + compCols[i] - 6, doc.y - 11,
        { size: 9.5, color: i === 3 ? cor : INK, bold: i === 3, align: i === 0 ? 'left' : 'right' });
    });
    doc.line(X, doc.y - 17, X + W, doc.y - 17, { color: [0.92, 0.92, 0.90], width: 0.4 });
    doc.y -= 20;
  }
  doc.y -= 10;

  /* ---- situação dos limites ---- */
  if (report.limites.length) {
    doc.ensure(120, pageHeader);
    secao('Situação dos limites', `Mês de ${monthLabel(report.mesAtual)}, acumulado até hoje.`);
    for (const bloco of report.limites) {
      for (const l of bloco.linhas) {
        doc.ensure(40, pageHeader);
        const pct = (l.usado / l.limite) * 100;
        const cor = pct >= 100 ? C_ESTOURO : (pct >= 80 ? C_ATENCAO : C_OK);
        const usadoTxt = l.tipo === 'custo' ? fmtMoney(l.usado) : `${fmtAuto(l.usado)} ${l.unidade}`;
        const limTxt = l.tipo === 'custo' ? fmtMoney(l.limite) : `${fmtAuto(l.limite)} ${l.unidade}`;
        const rot = report.limites.length > 1 ? `${bloco.site.name} · ${l.rotulo}` : l.rotulo;

        doc.text(rot, X, doc.y - 10, { size: 9.5, bold: true, color: INK, maxW: W - 180 });
        doc.text(`${usadoTxt} de ${limTxt}  (${pct.toFixed(0)}%)`, X + W, doc.y - 10,
          { size: 9.5, bold: true, color: cor, align: 'right' });
        doc.y -= 16;
        doc.rect(X, doc.y - 9, W, 9, { fill: [0.93, 0.93, 0.91] });
        doc.rect(X, doc.y - 9, Math.max(2, Math.min(1, pct / 100) * W), 9, { fill: cor });
        if (pct >= 100) {
          doc.y -= 13;
          const excesso = l.tipo === 'custo' ? fmtMoney(l.usado - l.limite) : `${fmtAuto(l.usado - l.limite)} ${l.unidade}`;
          doc.text(`Limite ultrapassado em ${excesso}. Avise o proprietário.`, X, doc.y - 9,
            { size: 8.5, color: C_ESTOURO });
        }
        doc.y -= 20;
      }
    }
    doc.y -= 4;
  }

  /* ---- maiores consumidores ---- */
  const ranking = (tipo, rotulo) => {
    const itens = report.blocks
      .filter((b) => b.meter.type === tipo && b.total > 0)
      .sort((a, b) => b.total - a.total)
      .slice(0, 6);
    if (itens.length < 2) return;

    doc.ensure(60 + itens.length * 22, pageHeader);
    secao(`Maiores consumidores — ${rotulo}`);
    const max = itens[0].total;
    const totalTipo = report.totals[tipo] || 1;
    const barX = X + 168, barW = W - 168 - 110;
    for (const it of itens) {
      const frac = it.total / max;
      doc.text(it.meter.name || it.meter.code, X, doc.y - 11, { size: 9, color: INK, maxW: 160 });
      doc.rect(barX, doc.y - 13, barW, 10, { fill: [0.95, 0.95, 0.93] });
      doc.rect(barX, doc.y - 13, Math.max(2, frac * barW), 10, { fill: corTipo(tipo) });
      doc.text(`${fmtAuto(it.total)} ${TYPES[tipo].unit} · ${((it.total / totalTipo) * 100).toFixed(0)}%`,
        X + W, doc.y - 11, { size: 8.5, color: MUTED, align: 'right' });
      doc.y -= 22;
    }
    doc.y -= 6;
  };
  if (temEnergia) ranking('energia', 'Energia');
  if (temAgua) ranking('agua', 'Água');

  /* ---- evolução mês a mês (um gráfico por tipo, nunca no mesmo eixo) ---- */
  const grafico = (tipo, rotulo) => {
    const dados = report.mensal.filter((r) => r[tipo] > 0);
    if (dados.length < 2) return;

    const alturaG = 96;
    doc.ensure(alturaG + 60, pageHeader);
    secao(`Evolução mensal — ${rotulo} (${TYPES[tipo].unit})`);

    const max = Math.max(...dados.map((r) => r[tipo]));
    const base = doc.y - alturaG;
    const passo = W / dados.length;
    const larguraBarra = Math.min(42, passo * 0.55);

    doc.line(X, base, X + W, base, { color: RULE, width: 0.6 });
    dados.forEach((r, i) => {
      const h = Math.max(2, (r[tipo] / max) * (alturaG - 18));
      const bx = X + i * passo + (passo - larguraBarra) / 2;
      doc.rect(bx, base, larguraBarra, h, { fill: corTipo(tipo) });
      doc.text(fmtAuto(r[tipo]), bx + larguraBarra / 2, base + h + 4,
        { size: 7.5, bold: true, color: INK, align: 'center' });
      doc.text(monthLabel(r.mes), bx + larguraBarra / 2, base - 11,
        { size: 7.5, color: MUTED, align: 'center', maxW: passo - 2 });
    });
    doc.y = base - 22;
  };
  if (temEnergia) grafico('energia', 'Energia');
  if (temAgua) grafico('agua', 'Água');

  /* ---- detalhamento por medidor ---- */
  doc.ensure(140, pageHeader);
  secao('Detalhamento das leituras', report.includePhotos
    ? 'Cada linha traz a foto do relógio no momento da leitura.'
    : 'Leituras registradas no período.');
  desenharBlocos(doc, report, X, W, pageHeader);

  /* ---- sugestões de economia ---- */
  const segs = [...new Set(report.sites.map((s) => s.segment || ''))];
  const tipos = [temEnergia && 'energia', temAgua && 'agua'].filter(Boolean);
  const dicas = { energia: [], agua: [] };
  for (const seg of (segs.length ? segs : [''])) {
    const d = sugestoes(seg, tipos);
    dicas.energia.push(...d.energia);
    dicas.agua.push(...d.agua);
  }
  dicas.energia = [...new Set(dicas.energia)];
  dicas.agua = [...new Set(dicas.agua)];

  if (dicas.energia.length || dicas.agua.length) {
    doc.ensure(150, pageHeader);
    doc.y -= 10;
    const rotSeg = site && site.segment ? ` — ${segmentLabel(site.segment).toLowerCase()}` : '';
    secao(`Sugestões para reduzir o consumo${rotSeg}`,
      'Recomendações práticas, ordenadas pelo que costuma pesar mais na conta deste ramo.');

    const lista = (arr, rotulo, cor) => {
      if (!arr.length) return;
      doc.ensure(46, pageHeader);
      doc.rect(X, doc.y - 15, 3, 15, { fill: cor });
      doc.text(rotulo, X + 9, doc.y - 11, { size: 10, bold: true, color: cor });
      doc.y -= 21;
      arr.forEach((d, i) => {
        const linhas = quebrar(d, 9, W - 26);
        doc.ensure(linhas.length * 12 + 8, pageHeader);
        doc.text(`${i + 1}.`, X + 2, doc.y - 9, { size: 9, bold: true, color: MUTED });
        linhas.forEach((ln, j) => {
          doc.text(ln, X + 22, doc.y - 9 - j * 12, { size: 9, color: INK });
        });
        doc.y -= linhas.length * 12 + 6;
      });
      doc.y -= 6;
    };
    lista(dicas.energia, 'Energia', C_ENERGIA);
    lista(dicas.agua, 'Água', C_AGUA);
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
  /* O período chega pronto de quem abriu a folha, mas dá para reduzi-lo aqui.
     "Tudo" volta para o intervalo original — por isso guardamos as duas pontas. */
  const cheio = { from: filters.from, to: filters.to };
  let from = filters.from;
  let to = filters.to;

  openSheet({
    title: 'Exportar relatório',
    sub: subtitulo,
    body: `<div class="stack">
      <div class="field">
        <label>Período</label>
        <div class="filters" style="padding-bottom:0">
          <button class="chip" data-p="tudo" data-active="true">Tudo</button>
          <button class="chip" data-p="30">30 dias</button>
          <button class="chip" data-p="90">90 dias</button>
          <button class="chip" data-p="365">12 meses</button>
          <button class="chip" data-p="ano">Ano atual</button>
        </div>
        <div class="row" style="gap:8px;margin-top:10px">
          <div class="field grow" style="margin:0"><label for="exp-de">De</label><input class="input" type="date" id="exp-de" value="${from}"></div>
          <div class="field grow" style="margin:0"><label for="exp-ate">Até</label><input class="input" type="date" id="exp-ate" value="${to}"></div>
        </div>
        <span class="hint" id="exp-periodo">Exportando de ${fmtDate(from)} a ${fmtDate(to)}.</span>
      </div>
      <div class="field">
        <label>Incluir as fotos das leituras</label>
        <div class="filters" style="padding-bottom:0">
          <button class="chip" data-ph="1" data-active="true">Com fotos</button>
          <button class="chip" data-ph="0">Só os dados</button>
        </div>
        <span class="hint">As fotos entram no PDF e nas linhas da planilha. Fotos que estão só na nuvem são baixadas na hora.</span>
      </div>
      <div class="stack" style="gap:9px">
        <button class="btn btn--primary btn--block" data-fmt="gerencial">${icon('download', 18)} Relatório gerencial em PDF</button>
        <span class="hint" style="margin-top:-4px">Para o lojista: resumo, comparação com o mês anterior, maiores consumidores, situação dos limites e sugestões de economia do ramo.</span>
        <button class="btn btn--block" data-fmt="xlsx">${icon('download', 18)} Planilha Excel (.xlsx)</button>
        <button class="btn btn--block" data-fmt="pdf">${icon('download', 18)} PDF simples (só as leituras)</button>
        <button class="btn btn--block" data-fmt="csv">${icon('download', 18)} CSV</button>
      </div>
      <div id="exp-status"></div>
    </div>`,
    onMount(sheet, close) {
      const status = sheet.querySelector('#exp-status');
      const deEl = sheet.querySelector('#exp-de');
      const ateEl = sheet.querySelector('#exp-ate');
      const resumo = sheet.querySelector('#exp-periodo');

      /* Reflete o período nos campos, no texto de apoio e nos chips. Um preset
         nunca pode passar do intervalo que existe de fato, senão o relatório
         anuncia um começo que não tem leitura nenhuma. */
      const pintarPeriodo = (preset = null) => {
        if (from > to) [from, to] = [to, from];
        if (from < cheio.from) from = cheio.from;
        if (to > cheio.to) to = cheio.to;
        deEl.value = from;
        ateEl.value = to;
        resumo.textContent = `Exportando de ${fmtDate(from)} a ${fmtDate(to)}.`;
        sheet.querySelectorAll('[data-p]').forEach((x) => {
          if (preset) x.dataset.active = String(x.dataset.p === preset);
          else delete x.dataset.active;
        });
      };

      sheet.querySelectorAll('[data-p]').forEach((b) => b.onclick = () => {
        const p = b.dataset.p;
        if (p === 'tudo') {
          from = cheio.from;
          to = cheio.to;
        } else if (p === 'ano') {
          from = cheio.to.slice(0, 4) + '-01-01';
          to = cheio.to;
        } else {
          to = cheio.to;
          from = addDaysISO(cheio.to, -(Number(p) - 1));
        }
        pintarPeriodo(p);
      });

      /* Digitar uma data à mão desmarca os presets: o intervalo virou manual. */
      [deEl, ateEl].forEach((input) => input.onchange = () => {
        from = deEl.value || from;
        to = ateEl.value || to;
        pintarPeriodo();
      });

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
          const report = await collectReport({ ...filters, from, to }, {
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
          if (fmt === 'gerencial') {
            downloadFile(`gerencial-${slug(nome)}-${stamp}.pdf`, buildManagerialPdf(report));
          } else if (fmt === 'pdf') {
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

