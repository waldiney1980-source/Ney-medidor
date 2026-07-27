// Gráficos SVG — marcas finas, grade discreta, rótulos seletivos e tooltip.
// Uma escala por gráfico: kWh e m³ nunca dividem eixo.

import { esc, fmtAuto, fmtCompact, debounce } from './utils.js';

const PAD = { top: 12, right: 12, bottom: 26, left: 46 };

/* ---------------- escala ---------------- */

function niceStep(raw) {
  const exp = Math.floor(Math.log10(raw));
  const f = raw / Math.pow(10, exp);
  const nice = f <= 1 ? 1 : f <= 2 ? 2 : f <= 2.5 ? 2.5 : f <= 5 ? 5 : 10;
  return nice * Math.pow(10, exp);
}

function scaleFor(max, ticks = 4) {
  if (!(max > 0)) return { max: 1, ticks: [0, 1] };
  const step = niceStep(max / ticks);
  const top = Math.ceil(max / step) * step;
  const out = [];
  for (let v = 0; v <= top + step / 2; v += step) out.push(Number(v.toFixed(10)));
  return { max: top, ticks: out };
}

/* ---------------- tooltip ---------------- */

function ensureTip(container) {
  let tip = container.querySelector('.tip');
  if (!tip) {
    tip = document.createElement('div');
    tip.className = 'tip';
    container.appendChild(tip);
  }
  return tip;
}

function showTip(container, tip, x, y, html) {
  tip.innerHTML = html;
  tip.dataset.show = '1';
  const w = container.clientWidth;
  const tw = tip.offsetWidth;
  const left = Math.max(tw / 2 + 4, Math.min(w - tw / 2 - 4, x));
  tip.style.left = left + 'px';
  tip.style.top = Math.max(tip.offsetHeight + 4, y - 8) + 'px';
}

function hideTip(tip) { tip.dataset.show = '0'; }

/* ---------------- helpers ---------------- */

function roundedTop(x, y, w, h, r) {
  const rr = Math.min(r, w / 2, Math.max(0, h));
  const y0 = y + h;
  if (h <= 0.6) return `M${x},${y0 - 0.8}h${w}v0.8h${-w}z`;
  return `M${x},${y0}V${y + rr}a${rr},${rr} 0 0 1 ${rr},${-rr}h${w - 2 * rr}a${rr},${rr} 0 0 1 ${rr},${rr}V${y0}z`;
}

function roundedRight(x, y, w, h, r) {
  const rr = Math.min(r, w, h / 2);
  if (w <= 0.6) return `M${x},${y}h0.8v${h}h-0.8z`;
  return `M${x},${y}h${w - rr}a${rr},${rr} 0 0 1 ${rr},${rr}v${h - 2 * rr}a${rr},${rr} 0 0 1 ${-rr},${rr}h${-(w - rr)}z`;
}

function emptyState(container, msg) {
  container.innerHTML = `<div class="empty" style="padding:26px 12px">
    <svg viewBox="0 0 24 24" width="26" height="26" aria-hidden="true"><path d="M4 19h16M6 19V9m5 10V5m5 14v-7" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"/></svg>
    <p>${esc(msg)}</p></div>`;
}

/** Re-renderiza no resize sem piscar. */
function autoResize(container, draw) {
  draw();
  if (container._ro) container._ro.disconnect();
  const ro = new ResizeObserver(debounce(() => draw(), 140));
  ro.observe(container);
  container._ro = ro;
}

/* ---------------- colunas (evolução no tempo) ---------------- */

export function columnChart(container, opts) {
  const { data = [], unit = '', color = 'var(--s1)', height = 190, emptyMsg = 'Sem consumo no período.' } = opts;
  const draw = () => {
    const W = Math.max(240, container.clientWidth || 320);
    if (!data.length || data.every((d) => !d.value)) return emptyState(container, emptyMsg);

    const plotW = W - PAD.left - PAD.right;
    const plotH = height - PAD.top - PAD.bottom;
    const max = Math.max(...data.map((d) => d.value));
    const sc = scaleFor(max);
    const band = plotW / data.length;
    const barW = Math.max(3, Math.min(24, band - 6));
    const yOf = (v) => PAD.top + plotH - (v / sc.max) * plotH;

    const grid = sc.ticks.map((t) => {
      const y = yOf(t).toFixed(1);
      return `<line x1="${PAD.left}" y1="${y}" x2="${W - PAD.right}" y2="${y}" stroke="${t === 0 ? 'var(--axis)' : 'var(--grid)'}" stroke-width="1"/>
              <text x="${PAD.left - 8}" y="${y}" text-anchor="end" dominant-baseline="middle" fill="var(--muted)" font-size="10.5" style="font-variant-numeric:tabular-nums">${esc(fmtCompact(t))}</text>`;
    }).join('');

    const maxLabels = Math.max(2, Math.floor(plotW / 46));
    const step = Math.ceil(data.length / maxLabels);
    const half = 17; // meia-largura estimada do rótulo, para não vazar a área útil
    const xLabels = data.map((d, i) => {
      if (i % step !== 0 && i !== data.length - 1) return '';
      const raw = PAD.left + band * i + band / 2;
      const x = Math.min(W - half, Math.max(half, raw));
      return `<text x="${x.toFixed(1)}" y="${height - 8}" text-anchor="middle" fill="var(--muted)" font-size="10.5">${esc(d.label)}</text>`;
    }).join('');

    const bars = data.map((d, i) => {
      if (!d.value) return '';
      const x = PAD.left + band * i + (band - barW) / 2;
      const y = yOf(d.value);
      return `<path d="${roundedTop(x, y, barW, PAD.top + plotH - y, 4)}" fill="${color}"/>`;
    }).join('');

    const hits = data.map((d, i) =>
      `<rect x="${(PAD.left + band * i).toFixed(2)}" y="${PAD.top}" width="${band.toFixed(2)}" height="${plotH}" fill="transparent" data-i="${i}"/>`).join('');

    container.innerHTML =
      `<svg viewBox="0 0 ${W} ${height}" width="${W}" height="${height}" role="img" aria-label="Consumo por período">
        ${grid}${bars}${xLabels}<g class="hit">${hits}</g>
      </svg>`;

    const tip = ensureTip(container);
    const svg = container.querySelector('svg');
    svg.addEventListener('pointermove', (e) => {
      const t = e.target.closest('[data-i]');
      if (!t) return hideTip(tip);
      const d = data[Number(t.dataset.i)];
      const x = PAD.left + band * Number(t.dataset.i) + band / 2;
      showTip(container, tip, x, yOf(d.value || 0),
        `<b>${esc(fmtAuto(d.value))} ${esc(unit)}</b><span>${esc(d.full || d.label)}</span>`);
    });
    svg.addEventListener('pointerleave', () => hideTip(tip));
  };
  autoResize(container, draw);
}

/* ---------------- barras horizontais (ranking) ---------------- */

export function barChart(container, opts) {
  const { data = [], unit = '', color = 'var(--s1)', emptyMsg = 'Sem dados no período.' } = opts;
  const draw = () => {
    const W = Math.max(240, container.clientWidth || 320);
    if (!data.length) return emptyState(container, emptyMsg);

    const rowH = 34, barH = 18, labelW = Math.min(150, Math.max(88, Math.round(W * 0.32))), valueW = 74;
    const H = data.length * rowH + 6;
    const plotW = W - labelW - valueW - 8;
    const max = Math.max(...data.map((d) => d.value), 1);

    const rows = data.map((d, i) => {
      const y = i * rowH + 4;
      const w = Math.max(2, (d.value / max) * plotW);
      const maxChars = Math.max(6, Math.floor((labelW - 10) / 6.6)); // ~6.6px por caractere a 12.5px
      const label = d.label.length > maxChars ? d.label.slice(0, maxChars - 1).trimEnd() + '…' : d.label;
      return `<g data-i="${i}">
        <rect x="0" y="${y}" width="${W}" height="${rowH}" fill="transparent"/>
        <text x="0" y="${y + rowH / 2}" dominant-baseline="middle" fill="var(--ink)" font-size="12.5">${esc(label)}</text>
        <path d="${roundedRight(labelW, y + (rowH - barH) / 2, w, barH, 4)}" fill="${color}"/>
        <text x="${(labelW + w + 8).toFixed(1)}" y="${y + rowH / 2}" dominant-baseline="middle" fill="var(--ink-2)" font-size="12" style="font-variant-numeric:tabular-nums">${esc(fmtCompact(d.value))}</text>
      </g>`;
    }).join('');

    container.innerHTML =
      `<svg viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" role="img" aria-label="Ranking de consumo">${rows}</svg>`;

    const tip = ensureTip(container);
    const svg = container.querySelector('svg');
    svg.addEventListener('pointermove', (e) => {
      const g = e.target.closest('g[data-i]');
      if (!g) return hideTip(tip);
      const i = Number(g.dataset.i);
      const d = data[i];
      showTip(container, tip, Math.min(W - 60, labelW + 40), i * rowH + 8,
        `<b>${esc(fmtAuto(d.value))} ${esc(unit)}</b><span>${esc(d.full || d.label)}</span>`);
    });
    svg.addEventListener('pointerleave', () => hideTip(tip));
  };
  autoResize(container, draw);
}

/* ---------------- sparkline ---------------- */

export function sparkline(container, opts) {
  const { values = [], color = 'var(--s1)', height = 44 } = opts;
  const draw = () => {
    const W = Math.max(60, container.clientWidth || 120);
    const clean = values.filter((v) => Number.isFinite(v));
    if (clean.length < 2) { container.innerHTML = ''; return; }
    const max = Math.max(...clean), min = Math.min(...clean, 0);
    const span = max - min || 1;
    const stepX = W / (clean.length - 1);
    const yOf = (v) => 6 + (height - 14) * (1 - (v - min) / span);
    const pts = clean.map((v, i) => `${(i * stepX).toFixed(1)},${yOf(v).toFixed(1)}`);
    const area = `M0,${height} L${pts.join(' L')} L${W},${height} Z`;
    const last = clean[clean.length - 1];
    container.innerHTML =
      `<svg viewBox="0 0 ${W} ${height}" width="${W}" height="${height}" aria-hidden="true">
        <path d="${area}" fill="${color}" opacity="0.10"/>
        <polyline points="${pts.join(' ')}" fill="none" stroke="${color}" stroke-width="2" stroke-linejoin="round" stroke-linecap="round"/>
        <circle cx="${(W - 0.5).toFixed(1)}" cy="${yOf(last).toFixed(1)}" r="4" fill="${color}" stroke="var(--surface)" stroke-width="2"/>
      </svg>`;
  };
  autoResize(container, draw);
}
