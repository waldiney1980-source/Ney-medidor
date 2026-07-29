// Componentes de interface: ícones, toasts, folhas modais e cartões de gráfico.

import { esc } from './utils.js';

/* ---------------- ícones ---------------- */

const PATHS = {
  bolt: '<path d="M13.5 3 6 13.2h4.6L9.8 21l7.7-10.4h-4.7L13.5 3Z" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linejoin="round"/>',
  drop: '<path d="M12 3.2c3.4 4 5.8 7.2 5.8 10A5.8 5.8 0 0 1 6.2 13.2c0-2.8 2.4-6 5.8-10Z" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linejoin="round"/>',
  home: '<path d="M4 10.6 12 4l8 6.6V20a1 1 0 0 1-1 1h-4v-6H9v6H5a1 1 0 0 1-1-1v-9.4Z" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linejoin="round"/>',
  gauge: '<path d="M4.5 18a8.5 8.5 0 1 1 15 0" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"/><path d="M12 14.5 15.5 10" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"/><circle cx="12" cy="15" r="1.4" fill="currentColor"/>',
  list: '<path d="M8 6h12M8 12h12M8 18h12M4 6h.01M4 12h.01M4 18h.01" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"/>',
  history: '<path d="M3.5 12a8.5 8.5 0 1 0 2.6-6.1" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"/><path d="M3.2 4.4v4h4" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"/><path d="M12 7.6V12l3 1.8" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"/>',
  settings: '<circle cx="12" cy="12" r="3" fill="none" stroke="currentColor" stroke-width="1.7"/><path d="M19.4 13.6a1.6 1.6 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.6 1.6 0 0 0-2.7 1.1v.2a2 2 0 1 1-4 0v-.1a1.6 1.6 0 0 0-2.8-1.1l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.6 1.6 0 0 0-1.1-2.7h-.2a2 2 0 1 1 0-4h.1a1.6 1.6 0 0 0 1.1-2.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.6 1.6 0 0 0 1.8.3 1.6 1.6 0 0 0 1-1.5v-.2a2 2 0 1 1 4 0v.1a1.6 1.6 0 0 0 2.7 1.1l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.6 1.6 0 0 0 1.1 2.7h.2a2 2 0 1 1 0 4h-.1a1.6 1.6 0 0 0-1.5 1Z" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linejoin="round"/>',
  plus: '<path d="M12 5v14M5 12h14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>',
  chev: '<path d="M9 5l7 7-7 7" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/>',
  camera: '<path d="M4 8h3l1.4-2h7.2L17 8h3a1 1 0 0 1 1 1v9a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V9a1 1 0 0 1 1-1Z" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"/><circle cx="12" cy="13.4" r="3.4" fill="none" stroke="currentColor" stroke-width="1.6"/>',
  qr: '<path d="M4 4h5v5H4zM15 4h5v5h-5zM4 15h5v5H4z" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linejoin="round"/><path d="M15 15h2v2h-2zM19 19h1M15 19v1M19 15h1" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"/>',
  check: '<path d="M4.5 12.5 9.5 17.5 19.5 6.5" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>',
  alert: '<path d="M12 4.5 21 20H3l9-15.5Z" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linejoin="round"/><path d="M12 10v4.2M12 17.2h.01" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/>',
  info: '<circle cx="12" cy="12" r="8.6" fill="none" stroke="currentColor" stroke-width="1.7"/><path d="M12 11v5.2M12 7.9h.01" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/>',
  trash: '<path d="M4.5 7h15M9.5 7V5.2A1.2 1.2 0 0 1 10.7 4h2.6a1.2 1.2 0 0 1 1.2 1.2V7M6.5 7l.8 12.1a1.2 1.2 0 0 0 1.2 1.1h7a1.2 1.2 0 0 0 1.2-1.1L17.5 7" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/>',
  edit: '<path d="M4 20h4L19.2 8.8a2 2 0 0 0 0-2.8l-1.2-1.2a2 2 0 0 0-2.8 0L4 16v4Z" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"/>',
  download: '<path d="M12 4v11m0 0 4-4m-4 4-4-4M4 19h16" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"/>',
  upload: '<path d="M12 20V9m0 0 4 4M12 9l-4 4M4 5h16" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"/>',
  sync: '<path d="M20 12a8 8 0 0 1-13.7 5.6M4 12a8 8 0 0 1 13.7-5.6" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"/><path d="M17.7 2.8v3.8h-3.8M6.3 21.2v-3.8h3.8" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"/>',
  search: '<circle cx="11" cy="11" r="6.5" fill="none" stroke="currentColor" stroke-width="1.7"/><path d="m16 16 4 4" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/>',
  close: '<path d="M6 6l12 12M18 6 6 18" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round"/>',
  print: '<path d="M7 9V4h10v5M7 18H5a1 1 0 0 1-1-1v-6a1 1 0 0 1 1-1h14a1 1 0 0 1 1 1v6a1 1 0 0 1-1 1h-2" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"/><path d="M7 14h10v6H7z" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"/>',
  clock: '<circle cx="12" cy="12" r="8.6" fill="none" stroke="currentColor" stroke-width="1.7"/><path d="M12 7.4V12l3 1.8" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"/>',
  filter: '<path d="M4 6h16l-6.2 7.3V19l-3.6-1.8v-3.9L4 6Z" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"/>',
};

export function icon(name, size = 20) {
  return `<svg viewBox="0 0 24 24" width="${size}" height="${size}" aria-hidden="true">${PATHS[name] || ''}</svg>`;
}

export const typeIcon = (type, size = 20) => icon(type === 'agua' ? 'drop' : 'bolt', size);
export const typeColor = (type) => (type === 'agua' ? 'var(--water)' : 'var(--energy)');

/* ---------------- toasts ---------------- */

export function toast(message, kind = 'info', ms = 3200) {
  const root = document.getElementById('toasts');
  const node = document.createElement('div');
  node.className = 'toast';
  node.dataset.kind = kind;
  node.innerHTML = `${icon(kind === 'ok' ? 'check' : kind === 'error' ? 'alert' : 'info', 18)}<span>${esc(message)}</span>`;
  root.appendChild(node);
  setTimeout(() => {
    node.style.opacity = '0';
    node.style.transition = 'opacity .2s';
    setTimeout(() => node.remove(), 220);
  }, ms);
}

/* ---------------- folha modal ---------------- */

const openSheets = new Set();

export function openSheet({ title = '', sub = '', body = '', actions = '', onMount, onClose, dismissible = true }) {
  // uma folha por vez: abrir outra fecha a anterior, para nunca ficarem empilhadas
  [...openSheets].forEach((fn) => fn());

  const root = document.getElementById('modal-root');
  const back = document.createElement('div');
  back.className = 'sheet-backdrop';
  back.innerHTML = `<div class="sheet" role="dialog" aria-modal="true" aria-label="${esc(title)}">
      <div class="sheet__grab"></div>
      ${title ? `<h2>${esc(title)}</h2>` : ''}
      ${sub ? `<p>${esc(sub)}</p>` : ''}
      <div class="sheet__content">${body}</div>
      ${actions ? `<div class="sheet__actions">${actions}</div>` : ''}
    </div>`;
  root.appendChild(back);
  document.body.style.overflow = 'hidden';

  let closed = false;
  const close = () => {
    if (closed) return;
    closed = true;
    openSheets.delete(close);
    back.remove();
    if (!root.children.length) document.body.style.overflow = '';
    document.removeEventListener('keydown', onKey);
    if (onClose) onClose();
  };
  openSheets.add(close);
  const onKey = (e) => { if (e.key === 'Escape' && dismissible) close(); };
  document.addEventListener('keydown', onKey);
  back.addEventListener('click', (e) => { if (e.target === back && dismissible) close(); });
  back.querySelectorAll('[data-close]').forEach((b) => b.addEventListener('click', close));

  if (onMount) onMount(back.querySelector('.sheet'), close);
  const first = back.querySelector('input, select, textarea, button');
  if (first && window.matchMedia('(min-width: 940px)').matches) first.focus();
  return close;
}

export function confirmSheet({ title, message = '', confirmLabel = 'Confirmar', danger = false }) {
  return new Promise((resolve) => {
    let answer = false;
    openSheet({
      title, sub: message,
      actions: `<button class="btn" data-act="no">Cancelar</button>
                <button class="btn ${danger ? 'btn--danger' : 'btn--primary'}" data-act="yes">${esc(confirmLabel)}</button>`,
      onMount(sheet, closeFn) {
        sheet.querySelector('[data-act="no"]').onclick = () => closeFn();
        sheet.querySelector('[data-act="yes"]').onclick = () => { answer = true; closeFn(); };
      },
      onClose: () => resolve(answer),
    });
  });
}

/* ---------------- cartão de gráfico com tabela-espelho ---------------- */

let chartSeq = 0;

/**
 * Todo gráfico vem com a tabela equivalente: nenhum valor fica preso ao tooltip.
 */
export function chartCard({ title, subtitle = '', unit = '', rows, render, extraCol = '', legendColor = '' }) {
  const id = 'ch' + (++chartSeq);
  const node = document.createElement('section');
  node.className = 'card chart-card';
  node.innerHTML = `
    <div class="card__head">
      <div class="grow">
        <h2>${esc(title)}</h2>
        ${subtitle ? `<p>${esc(subtitle)}</p>` : ''}
      </div>
      <div class="chart-toggle" role="group" aria-label="Modo de exibição">
        <button type="button" data-mode="chart" aria-pressed="true">Gráfico</button>
        <button type="button" data-mode="table" aria-pressed="false">Tabela</button>
      </div>
    </div>
    <div class="card__body">
      ${extraCol ? `<div class="legenda">
        <span><i class="legenda__barra" style="background:${esc(legendColor || 'var(--s1)')}"></i>Consumo</span>
        <span><i class="legenda__linha"></i>${esc(extraCol.replace(/\s*\(.*\)$/, ''))}</span>
      </div>` : ''}
      <div class="chart-wrap" id="${id}"></div>
      <div class="table-scroll" hidden>
        <table class="data-table">
          <thead><tr><th>Período</th><th>${esc(unit || 'Valor')}</th>${extraCol ? `<th>${esc(extraCol)}</th>` : ''}</tr></thead>
          <tbody>${(rows || []).map((r) => `<tr><td>${esc(r.label)}</td><td>${esc(r.value)}</td>${extraCol ? `<td>${esc(r.extra ?? '—')}</td>` : ''}</tr>`).join('') || `<tr><td colspan="${extraCol ? 3 : 2}" class="muted">Sem dados</td></tr>`}</tbody>
        </table>
      </div>
    </div>`;

  const wrap = node.querySelector('.chart-wrap');
  const table = node.querySelector('.table-scroll');
  node.querySelectorAll('[data-mode]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const mode = btn.dataset.mode;
      node.querySelectorAll('[data-mode]').forEach((b) => b.setAttribute('aria-pressed', String(b === btn)));
      wrap.hidden = mode !== 'chart';
      table.hidden = mode !== 'table';
      if (mode === 'chart') requestAnimationFrame(() => render(wrap));
    });
  });

  // renderiza depois que o nó estiver no DOM (precisa de largura medida)
  requestAnimationFrame(() => render(wrap));
  return node;
}

/* ---------------- misc ---------------- */

export function kpi({ label, value, unit = '', delta = null, deltaLabel = '', colorVar = null, hero = false, title = '' }) {
  const dir = delta === null ? '' : delta > 0.05 ? 'up' : delta < -0.05 ? 'down' : 'flat';
  return `<div class="kpi ${hero ? 'kpi--hero' : ''}">
    <div class="kpi__label">${colorVar ? `<span class="dot" style="background:${colorVar}"></span>` : ''}${esc(label)}</div>
    <div class="kpi__value"${String(value).length > 8 ? ' data-long="1"' : ''}${title ? ` title="${esc(title)}"` : ''}>${esc(value)}${unit ? `<small>${esc(unit)}</small>` : ''}</div>
    ${delta === null ? (deltaLabel ? `<div class="kpi__delta">${esc(deltaLabel)}</div>` : '')
      : `<div class="kpi__delta" data-dir="${dir}">${dir === 'up' ? '▲' : dir === 'down' ? '▼' : '•'} ${esc(deltaLabel)}</div>`}
  </div>`;
}

export function emptyBlock({ title, message, actionLabel = '', actionAttr = '' }) {
  return `<div class="empty">
    ${icon('gauge', 30)}
    <b>${esc(title)}</b>
    <p>${esc(message)}</p>
    ${actionLabel ? `<button class="btn btn--primary btn--sm" ${actionAttr}>${esc(actionLabel)}</button>` : ''}
  </div>`;
}
