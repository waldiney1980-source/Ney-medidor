// Histórico geral de leituras, com filtros e exportação para CSV.

import { state, meterById, activeSites, consumptionEvents, activeMeters, TYPES } from '../store.js';
import { icon, toast, openSheet, typeColor } from '../ui.js';
import { openExportSheet } from '../export/report.js';
import {
  el, esc, fmtAuto, fmtDate, fmtDateShort, todayISO, addDaysISO, dateOf, isoOf,
} from '../utils.js';

const f = {
  from: addDaysISO(todayISO(), -89),
  to: todayISO(),
  type: 'all',
  siteId: 'all',
  q: '',
};

export default async function history({ navigate }) {
  const root = el('<div class="stack"></div>');

  const consumptionIndex = () => {
    const map = new Map();
    activeMeters().forEach((m) => consumptionEvents(m.id).forEach((e) => map.set(e.id, e)));
    return map;
  };

  const collect = () => {
    const evs = consumptionIndex();
    const term = f.q.trim().toLowerCase();
    return state.readings
      .filter((r) => !r.deleted)
      .filter((r) => r.readAt >= f.from && r.readAt <= f.to)
      .map((r) => ({ r, m: meterById(r.meterId), e: evs.get(r.id) || null }))
      .filter((x) => x.m && !x.m.deleted)
      .filter((x) => f.type === 'all' || x.m.type === f.type)
      .filter((x) => f.siteId === 'all' || (x.m.siteId || '') === f.siteId)
      .filter((x) => !term || [x.m.name, x.m.code, x.r.readerName, x.r.note].some((v) => String(v || '').toLowerCase().includes(term)))
      .sort((a, b) => (a.r.readAt === b.r.readAt ? b.r.createdAt - a.r.createdAt : a.r.readAt < b.r.readAt ? 1 : -1));
  };

  const paint = () => {
    root.innerHTML = '';
    const sites = activeSites();
    const rows = collect();

    const head = el(`<div class="stack">
      <div class="row" style="gap:8px">
        <div class="grow" style="position:relative">
          <span style="position:absolute;left:12px;top:50%;transform:translateY(-50%);color:var(--muted)">${icon('search', 18)}</span>
          <input class="input" id="q" placeholder="Medidor, leiturista ou observação" style="padding-left:38px" value="${esc(f.q)}" autocomplete="off">
        </div>
        <button class="btn" id="csv" style="flex:none;width:52px;padding:0" aria-label="Exportar CSV">${icon('download', 21)}</button>
      </div>
      <div class="filters">
        <button class="chip" id="period" data-active="true">${icon('clock', 15)} ${esc(fmtDateShort(f.from))} – ${esc(fmtDateShort(f.to))}</button>
        <button class="chip" data-t="all" ${f.type === 'all' ? 'data-active="true"' : ''}>Todos</button>
        <button class="chip" data-t="energia" ${f.type === 'energia' ? 'data-active="true"' : ''}>${icon('bolt', 15)} Energia</button>
        <button class="chip" data-t="agua" ${f.type === 'agua' ? 'data-active="true"' : ''}>${icon('drop', 15)} Água</button>
        ${sites.length ? `<button class="chip" id="site" ${f.siteId !== 'all' ? 'data-active="true"' : ''}>${icon('filter', 15)} ${esc(f.siteId === 'all' ? 'Unidade' : (sites.find((s) => s.id === f.siteId) || {}).name || 'Unidade')}</button>` : ''}
      </div>
    </div>`);
    root.appendChild(head);

    if (!rows.length) {
      root.appendChild(el(`<section class="card"><div class="card__body"><div class="empty">
        ${icon('history', 30)}<b>Nenhuma leitura no período</b>
        <p>Ajuste os filtros ou registre novas leituras em campo.</p>
      </div></div></section>`));
    } else {
      const groups = new Map();
      rows.forEach((x) => {
        if (!groups.has(x.r.readAt)) groups.set(x.r.readAt, []);
        groups.get(x.r.readAt).push(x);
      });
      [...groups.entries()].forEach(([day, items]) => {
        root.appendChild(el(`<div class="section-title">${esc(fmtDate(day))} · ${items.length} leitura(s)</div>`));
        const box = el(`<div class="list">${items.map(({ r, m, e }) => `
          <button class="item" data-id="${m.id}">
            <span class="item__icon" style="background:${typeColor(m.type)}">${icon(m.type === 'agua' ? 'drop' : 'bolt', 20)}</span>
            <span class="item__main">
              <span class="item__title">${esc(m.name || m.code)}</span>
              <span class="item__sub">${esc([r.readerName, r.note].filter(Boolean).join(' · ') || TYPES[m.type].label)}</span>
            </span>
            <span class="item__right">
              <span class="item__value">${esc(fmtAuto(r.value))}</span>
              <span class="item__meta">${e && e.consumption !== null ? '+' + esc(fmtAuto(e.consumption)) + ' ' + esc(m.unit) : esc(m.unit)}</span>
            </span>
            ${r.photoId ? `<span class="item__chev">${icon('camera', 16)}</span>` : ''}
          </button>`).join('')}</div>`);
        box.querySelectorAll('[data-id]').forEach((b) => b.onclick = () => navigate('medidor/' + b.dataset.id));
        root.appendChild(box);
      });
    }

    head.querySelector('#q').addEventListener('input', (e) => {
      f.q = e.target.value;
      const pos = e.target.selectionStart;
      paint();
      const input = root.querySelector('#q');
      input.focus(); input.setSelectionRange(pos, pos);
    });
    head.querySelectorAll('[data-t]').forEach((b) => b.onclick = () => { f.type = b.dataset.t; paint(); });
    const siteBtn = head.querySelector('#site');
    if (siteBtn) siteBtn.onclick = () => openSheet({
      title: 'Unidade',
      body: `<div class="list">
        <button class="item" data-v="all" style="padding:11px 14px"><span class="grow item__title">Todas as unidades</span></button>
        ${sites.map((s) => `<button class="item" data-v="${s.id}" style="padding:11px 14px"><span class="grow item__title">${esc(s.name)}</span></button>`).join('')}
      </div>`,
      onMount(sheet, close) {
        sheet.querySelectorAll('[data-v]').forEach((b) => b.onclick = () => { f.siteId = b.dataset.v; close(); paint(); });
      },
    });

    head.querySelector('#period').onclick = () => openSheet({
      title: 'Período',
      body: `<div class="grid-2">
        <div class="field"><label for="h-from">De</label><input class="input" type="date" id="h-from" value="${f.from}"></div>
        <div class="field"><label for="h-to">Até</label><input class="input" type="date" id="h-to" value="${f.to}"></div>
      </div>
      <div class="filters" style="margin-top:12px">
        <button class="chip" data-p="30">30 dias</button>
        <button class="chip" data-p="90">90 dias</button>
        <button class="chip" data-p="365">12 meses</button>
        <button class="chip" data-p="year">Ano atual</button>
      </div>`,
      actions: `<button class="btn" data-close>Cancelar</button><button class="btn btn--primary" data-act="ok">Aplicar</button>`,
      onMount(sheet, close) {
        sheet.querySelectorAll('[data-p]').forEach((b) => b.onclick = () => {
          const p = b.dataset.p;
          if (p === 'year') {
            const d = dateOf(todayISO()); d.setMonth(0); d.setDate(1);
            f.from = isoOf(d);
          } else {
            f.from = addDaysISO(todayISO(), -(Number(p) - 1));
          }
          f.to = todayISO();
          close(); paint();
        });
        sheet.querySelector('[data-act="ok"]').onclick = () => {
          const from = sheet.querySelector('#h-from').value || f.from;
          const to = sheet.querySelector('#h-to').value || f.to;
          f.from = from <= to ? from : to;
          f.to = from <= to ? to : from;
          close(); paint();
        };
      },
    });

    head.querySelector('#csv').onclick = () => {
      if (!rows.length) { toast('Nada para exportar no período selecionado.', 'info'); return; }
      openExportSheet({
        filters: { from: f.from, to: f.to, type: f.type, siteId: f.siteId, meterId: 'all' },
        nome: 'relatorio-leituras',
        subtitulo: `${rows.length} leitura(s) · ${fmtDate(f.from)} a ${fmtDate(f.to)}`,
      });
    };

  };

  paint();
  return { el: root, title: 'Histórico', sub: 'Todas as leituras registradas' };
}
