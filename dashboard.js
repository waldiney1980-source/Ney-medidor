// Painel — filtros no topo, KPIs, evolução e ranking por tipo de utilidade.

import {
  state, aggregate, previousTotals, pendingMeters, recentReadings,
  activeSites, meterById, activeMeters, TYPES,
} from './store.js';
import { columnChart, barChart } from './charts.js';
import { chartCard, kpi, icon, openSheet, toast, typeColor, emptyBlock } from './ui.js';
import { estouros, linksAviso } from './gestao.js';
import {
  el, esc, fmtAuto, fmtMoney, fmtMoneyCompact, fmtDate, fmtDateShort, fmtAxisDate, todayISO,
  addDaysISO, addMonthsISO, daysBetween, dateOf, isoOf, monthLabel,
} from './utils.js';

const PERIODS = [
  { key: '7d', label: '7 dias' },
  { key: '30d', label: '30 dias' },
  { key: '90d', label: '90 dias' },
  { key: 'mtd', label: 'Mês atual' },
  { key: '12m', label: '12 meses' },
  { key: 'custom', label: 'Personalizado' },
];

// preservado entre navegações
const filters = {
  period: '30d',
  from: addDaysISO(todayISO(), -29),
  to: todayISO(),
  type: 'all',
  siteId: 'all',
  meterId: 'all',
};

function resolvePeriod() {
  const today = todayISO();
  switch (filters.period) {
    case '7d': filters.from = addDaysISO(today, -6); filters.to = today; break;
    case '30d': filters.from = addDaysISO(today, -29); filters.to = today; break;
    case '90d': filters.from = addDaysISO(today, -89); filters.to = today; break;
    case 'mtd': { const d = dateOf(today); d.setDate(1); filters.from = isoOf(d); filters.to = today; break; }
    case '12m': { const d = dateOf(addMonthsISO(today, -11)); d.setDate(1); filters.from = isoOf(d); filters.to = today; break; }
    default: break; // custom mantém from/to
  }
  const span = daysBetween(filters.from, filters.to);
  return { ...filters, granularity: span > 70 ? 'month' : 'day' };
}

function periodLabel() {
  const p = PERIODS.find((x) => x.key === filters.period);
  if (filters.period === 'custom') return `${fmtDateShort(filters.from)} – ${fmtDateShort(filters.to)}`;
  return p ? p.label : '30 dias';
}

/* ---------------- folhas de filtro ---------------- */

function openPeriodSheet(rerender) {
  openSheet({
    title: 'Período',
    body: `<div class="list">
        ${PERIODS.map((p) => `<button class="item" data-p="${p.key}" style="padding:11px 14px">
          <span class="grow item__title">${esc(p.label)}</span>
          ${filters.period === p.key ? `<span style="color:var(--brand)">${icon('check', 18)}</span>` : ''}
        </button>`).join('')}
      </div>
      <div class="divider"></div>
      <div class="grid-2">
        <div class="field"><label for="f-from">De</label><input class="input" type="date" id="f-from" value="${filters.from}"></div>
        <div class="field"><label for="f-to">Até</label><input class="input" type="date" id="f-to" value="${filters.to}"></div>
      </div>`,
    actions: `<button class="btn" data-close>Fechar</button><button class="btn btn--primary" data-act="custom">Aplicar intervalo</button>`,
    onMount(sheet, close) {
      sheet.querySelectorAll('[data-p]').forEach((b) => b.onclick = () => {
        filters.period = b.dataset.p;
        if (filters.period !== 'custom') { close(); rerender(); }
      });
      sheet.querySelector('[data-act="custom"]').onclick = () => {
        const from = sheet.querySelector('#f-from').value || filters.from;
        const to = sheet.querySelector('#f-to').value || filters.to;
        filters.from = from <= to ? from : to;
        filters.to = from <= to ? to : from;
        filters.period = 'custom';
        close(); rerender();
      };
    },
  });
}

function openPickSheet({ title, options, currentValue, onPick }) {
  openSheet({
    title,
    body: `<div class="list">${options.map((o) => `
      <button class="item" data-v="${esc(o.value)}" style="padding:11px 14px">
        <span class="grow item__title">${esc(o.label)}</span>
        ${o.hint ? `<span class="item__meta">${esc(o.hint)}</span>` : ''}
        ${currentValue === o.value ? `<span style="color:var(--brand);margin-left:8px">${icon('check', 18)}</span>` : ''}
      </button>`).join('')}</div>`,
    onMount(sheet, close) {
      sheet.querySelectorAll('[data-v]').forEach((b) => b.onclick = () => { onPick(b.dataset.v); close(); });
    },
  });
}

/* ---------------- view ---------------- */

export default async function dashboard({ navigate }) {
  const root = el('<div class="stack"></div>');

  const paint = () => {
    const f = resolvePeriod();
    root.innerHTML = '';

    if (!activeMeters().length) {
      root.appendChild(el(`<section class="card"><div class="card__body">${emptyBlock({
        title: 'Nenhum medidor cadastrado',
        message: 'Cadastre os medidores de energia e água para começar a registrar leituras e acompanhar o consumo.',
        actionLabel: 'Cadastrar medidor',
        actionAttr: 'data-go="medidores"',
      })}</div></section>`));
      root.querySelector('[data-go]').onclick = () => navigate('medidores');
      return;
    }

    /* --- barra de filtros --- */
    const sites = activeSites();
    const metersForPick = activeMeters().filter((m) => f.type === 'all' || m.type === f.type);
    const bar = el(`<div class="filters">
      <button class="chip" data-f="period" data-active="true">${icon('clock', 15)} ${esc(periodLabel())}</button>
      <button class="chip" data-t="all" ${f.type === 'all' ? 'data-active="true"' : ''}>Todos</button>
      <button class="chip" data-t="energia" ${f.type === 'energia' ? 'data-active="true"' : ''}>${icon('bolt', 15)} Energia</button>
      <button class="chip" data-t="agua" ${f.type === 'agua' ? 'data-active="true"' : ''}>${icon('drop', 15)} Água</button>
      ${sites.length ? `<button class="chip" data-f="site" ${f.siteId !== 'all' ? 'data-active="true"' : ''}>${icon('filter', 15)} ${esc(f.siteId === 'all' ? 'Unidade' : (sites.find((s) => s.id === f.siteId) || {}).name || 'Unidade')}</button>` : ''}
      <button class="chip" data-f="meter" ${f.meterId !== 'all' ? 'data-active="true"' : ''}>${icon('gauge', 15)} ${esc(f.meterId === 'all' ? 'Medidor' : (meterById(f.meterId) || {}).name || 'Medidor')}</button>
    </div>`);
    root.appendChild(bar);

    bar.querySelector('[data-f="period"]').onclick = () => openPeriodSheet(paint);
    bar.querySelectorAll('[data-t]').forEach((b) => b.onclick = () => {
      filters.type = b.dataset.t;
      if (filters.meterId !== 'all') {
        const m = meterById(filters.meterId);
        if (!m || (filters.type !== 'all' && m.type !== filters.type)) filters.meterId = 'all';
      }
      paint();
    });
    const siteBtn = bar.querySelector('[data-f="site"]');
    if (siteBtn) siteBtn.onclick = () => openPickSheet({
      title: 'Unidade',
      currentValue: filters.siteId,
      options: [{ value: 'all', label: 'Todas as unidades' }, ...sites.map((s) => ({ value: s.id, label: s.name }))],
      onPick: (v) => { filters.siteId = v; paint(); },
    });
    bar.querySelector('[data-f="meter"]').onclick = () => openPickSheet({
      title: 'Medidor',
      currentValue: filters.meterId,
      options: [{ value: 'all', label: 'Todos os medidores' },
        ...metersForPick.map((m) => ({ value: m.id, label: m.name || m.code, hint: TYPES[m.type].label }))],
      onPick: (v) => { filters.meterId = v; paint(); },
    });

    /* --- KPIs --- */
    const blocks = aggregate(f);
    const prev = previousTotals(f);
    const pend = pendingMeters(f);
    const totalCost = blocks.reduce((s, b) => s + b.cost, 0);
    const totalReadings = blocks.reduce((s, b) => s + b.readingsCount, 0);

    const deltaOf = (b) => {
      const p = prev[b.type];
      if (!p || !Number.isFinite(p) || p === 0) return { delta: null, label: 'sem base anterior' };
      const pct = ((b.total - p) / p) * 100;
      return { delta: pct, label: `${Math.abs(pct).toFixed(1).replace('.', ',')}% vs. período anterior` };
    };

    const kpiCards = [];
    blocks.forEach((b) => {
      const d = deltaOf(b);
      kpiCards.push(kpi({
        label: b.label, value: fmtAuto(b.total), unit: b.unit,
        colorVar: `var(${b.colorVar})`, delta: d.delta, deltaLabel: d.label,
        hero: blocks.length === 1,
      }));
    });
    kpiCards.push(kpi({
      label: 'Custo estimado',
      value: fmtMoneyCompact(totalCost),
      title: fmtMoney(totalCost),
      deltaLabel: `${totalReadings} leitura${totalReadings === 1 ? '' : 's'} no período`,
    }));
    kpiCards.push(kpi({ label: 'Medidores a ler', value: String(pend.length), deltaLabel: pend.length ? 'sem leitura no período' : 'todos em dia' }));
    root.appendChild(el(`<div class="kpis">${kpiCards.join('')}</div>`));

    /* --- limites do mês estourados --- */
    const furos = estouros();
    if (furos.length) {
      const cartao = el(`<section class="card card--alert">
        <div class="card__head">
          <span class="item__icon" style="background:var(--critical);width:38px;height:38px">${icon('alert', 20)}</span>
          <div class="grow"><h2>Consumo acima do limite</h2>
          <p>${furos.length} limite(s) do mês ultrapassado(s).</p></div>
        </div>
        <div class="card__body stack" id="furos"></div>
      </section>`);
      const box = cartao.querySelector('#furos');

      furos.forEach((e, i) => {
        const links = linksAviso(e);
        const rot = e.tipo === 'custo' ? 'Custo estimado' : TYPES[e.tipo].label;
        const usado = e.tipo === 'custo' ? fmtMoney(e.consumido) : `${fmtAuto(e.consumido)} ${e.unidade}`;
        const lim = e.tipo === 'custo' ? fmtMoney(e.limite) : `${fmtAuto(e.limite)} ${e.unidade}`;
        const item = el(`<div class="stack" style="gap:8px">
          <div class="row">
            <span class="grow item__main">
              <span class="item__title">${esc(e.site.name)} · ${esc(rot)}</span>
              <span class="item__sub">${esc(usado)} de ${esc(lim)} — ${e.pct.toFixed(0)}% acima do limite</span>
            </span>
          </div>
          <div class="row" style="gap:8px;flex-wrap:wrap">
            ${links.whatsapp ? `<a class="btn btn--sm btn--primary" href="${links.whatsapp}" target="_blank" rel="noopener">Avisar por WhatsApp</a>` : ''}
            ${links.email ? `<a class="btn btn--sm" href="${links.email}">Avisar por e-mail</a>` : ''}
            <button class="btn btn--sm" data-ver="${i}">Ver a mensagem</button>
            ${(!links.whatsapp && !links.email)
              ? '<span class="hint">Cadastre o WhatsApp ou o e-mail do proprietário na unidade.</span>' : ''}
          </div>
        </div>`);
        item.querySelector('[data-ver]').onclick = () => openSheet({
          title: 'Mensagem de aviso',
          sub: 'Nada é enviado sozinho — você confere e envia.',
          body: `<textarea class="input" id="msg" rows="14" style="font-size:13px">${esc(links.texto)}</textarea>`,
          actions: `<button class="btn" data-close>Fechar</button>
            <button class="btn btn--primary" data-act="copy">Copiar</button>`,
          onMount(sheet) {
            sheet.querySelector('[data-act="copy"]').onclick = async () => {
              try {
                await navigator.clipboard.writeText(sheet.querySelector('#msg').value);
                toast('Mensagem copiada.', 'ok');
              } catch { toast('Selecione o texto e copie manualmente.', 'info'); }
            };
          },
        });
        box.appendChild(item);
        if (i < furos.length - 1) box.appendChild(el('<div class="divider"></div>'));
      });
      root.appendChild(cartao);
    }

    /* --- por tipo: evolução + ranking --- */
    blocks.forEach((b) => {
      if (!b.metersCount) return;
      const color = typeColor(b.type);
      root.appendChild(el(`<div class="section-title"><span class="dot" style="background:${color}"></span>${esc(b.label)} · ${esc(b.unit)}</div>`));

      const series = b.series.map((s) => ({
        ...s,
        label: f.granularity === 'month' ? s.label : fmtAxisDate(s.key),
        full: f.granularity === 'month' ? monthLabel(s.key) : fmtDate(s.key),
      }));

      root.appendChild(chartCard({
        title: `Consumo de ${b.label.toLowerCase()}`,
        subtitle: `${f.granularity === 'month' ? 'Por mês' : 'Por dia'} · ${fmtDate(f.from)} a ${fmtDate(f.to)}`,
        unit: b.unit,
        rows: series.filter((s) => s.value > 0).map((s) => ({ label: s.full, value: `${fmtAuto(s.value)} ${b.unit}` })),
        render: (wrap) => columnChart(wrap, { data: series, unit: b.unit, color, height: 196 }),
      }));

      if (b.ranking.length > 1) {
        const top = b.ranking.slice(0, 8);
        root.appendChild(chartCard({
          title: `Maiores consumos — ${b.label.toLowerCase()}`,
          subtitle: b.ranking.length > 8 ? `8 de ${b.ranking.length} medidores` : `${b.ranking.length} medidores`,
          unit: b.unit,
          rows: b.ranking.map((r) => ({ label: r.name, value: `${fmtAuto(r.value)} ${b.unit}` })),
          render: (wrap) => barChart(wrap, {
            data: top.map((r) => ({ label: r.name, full: `${r.name}${r.code ? ' · ' + r.code : ''}`, value: r.value })),
            unit: b.unit, color,
          }),
        }));
      }
    });

    /* --- pendências --- */
    if (pend.length) {
      const card = el(`<section class="card">
        <div class="card__head"><div class="grow"><h2>Medidores a ler</h2><p>Sem leitura desde ${esc(fmtDate(f.from))}</p></div></div>
        <div class="card__body"><div class="list">
          ${pend.slice(0, 8).map(({ meter, lastAt }) => `
            <button class="item" data-meter="${meter.id}">
              <span class="item__icon" style="background:${typeColor(meter.type)}">${icon(meter.type === 'agua' ? 'drop' : 'bolt', 20)}</span>
              <span class="item__main">
                <span class="item__title">${esc(meter.name || meter.code)}</span>
                <span class="item__sub">${esc([meter.code, meter.location].filter(Boolean).join(' · ') || TYPES[meter.type].label)}</span>
              </span>
              <span class="item__right">
                <span class="item__meta">${lastAt ? 'última: ' + esc(fmtDateShort(lastAt)) : 'nunca lido'}</span>
              </span>
              <span class="item__chev">${icon('chev', 18)}</span>
            </button>`).join('')}
        </div>
        ${pend.length > 8 ? `<p class="small muted" style="margin-top:10px">e mais ${pend.length - 8} medidor(es).</p>` : ''}
        </div></section>`);
      card.querySelectorAll('[data-meter]').forEach((b) => b.onclick = () => navigate('ler/' + b.dataset.meter));
      root.appendChild(card);
    }

    /* --- últimas leituras --- */
    const recent = recentReadings(6);
    if (recent.length) {
      const card = el(`<section class="card">
        <div class="card__head"><div class="grow"><h2>Últimas leituras</h2></div></div>
        <div class="card__body"><div class="list">
          ${recent.map((r) => {
            const m = meterById(r.meterId) || { name: 'Medidor removido', type: 'energia', unit: '' };
            return `<button class="item" data-open="${m.id || ''}">
              <span class="item__icon" style="background:${typeColor(m.type)}">${icon(m.type === 'agua' ? 'drop' : 'bolt', 20)}</span>
              <span class="item__main">
                <span class="item__title">${esc(m.name || '—')}</span>
                <span class="item__sub">${esc(fmtDate(r.readAt))}${r.readerName ? ' · ' + esc(r.readerName) : ''}</span>
              </span>
              <span class="item__right">
                <span class="item__value">${esc(fmtAuto(r.value))}</span>
                <span class="item__meta">${esc(m.unit || '')}</span>
              </span>
            </button>`;
          }).join('')}
        </div></div></section>`);
      card.querySelectorAll('[data-open]').forEach((b) => b.onclick = () => {
        if (b.dataset.open) navigate('medidor/' + b.dataset.open);
      });
      root.appendChild(card);
    }
  };

  paint();

  return {
    el: root,
    title: 'Painel',
    sub: state.settings.readerName ? `Olá, ${state.settings.readerName}` : 'Consumo de energia e água',
  };
}
