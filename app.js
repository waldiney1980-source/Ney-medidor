// Bootstrap, roteador e casca do aplicativo.

import { load, state, onChange } from './store.js';
import { requestPersistence } from './db.js';
import { startAutoSync, sync } from './api.js';
import { icon, toast } from './ui.js';
import { esc } from './utils.js';

import dashboard from './views/dashboard.js';
import capture from './views/capture.js';
import meters from './views/meters.js';
import meterDetail from './views/meter-detail.js';
import history from './views/history.js';
import settings from './views/settings.js';

const ROUTES = [
  { path: 'painel', view: dashboard, title: 'Painel', icon: 'home', tab: true },
  { path: 'ler', view: capture, title: 'Nova leitura', icon: 'gauge', tab: true, accent: true, label: 'Ler' },
  { path: 'medidores', view: meters, title: 'Medidores', icon: 'list', tab: true },
  { path: 'historico', view: history, title: 'Histórico', icon: 'history', tab: true },
  { path: 'ajustes', view: settings, title: 'Ajustes', icon: 'settings', tab: true },
  { path: 'medidor', view: meterDetail, title: 'Medidor', icon: 'gauge', tab: false, deep: true },
];

const viewEl = () => document.getElementById('view');
let current = null;
let deferredInstall = null;

export function navigate(path, replace = false) {
  const url = '#/' + path.replace(/^#?\/?/, '');
  if (replace) location.replace(url); else location.hash = url;
}

export const installPrompt = () => deferredInstall;
export async function triggerInstall() {
  if (!deferredInstall) return false;
  deferredInstall.prompt();
  const res = await deferredInstall.userChoice;
  deferredInstall = null;
  return res && res.outcome === 'accepted';
}

/* ---------------- navegação ---------------- */

function buildNav() {
  const tabbar = document.getElementById('tabbar');
  const sidenav = document.getElementById('sidebar-nav');
  const tabs = ROUTES.filter((r) => r.tab);

  tabbar.innerHTML = tabs.map((r) => `
    <button class="tab ${r.accent ? 'tab--accent' : ''}" data-path="${r.path}">
      <span class="tab__icon">${icon(r.icon, r.accent ? 20 : 22)}</span>
      <span>${esc(r.label || r.title)}</span>
    </button>`).join('');

  sidenav.innerHTML = tabs.map((r) => `
    <button class="snav" data-path="${r.path}">${icon(r.icon, 19)}<span>${esc(r.label || r.title)}</span></button>`).join('');

  document.querySelectorAll('[data-path]').forEach((b) => {
    b.addEventListener('click', () => navigate(b.dataset.path));
  });

  document.getElementById('btn-back').addEventListener('click', () => history_back());
  document.getElementById('sync-chip').addEventListener('click', async () => {
    if (!state.settings.syncEnabled) { navigate('ajustes'); return; }
    try { await sync(); toast('Dados sincronizados.', 'ok'); }
    catch (e) { toast(e.message || 'Falha na sincronização.', 'error'); }
  });
}

function history_back() {
  if (window.history.length > 1) window.history.back();
  else navigate('painel', true);
}

function markActive(path) {
  document.querySelectorAll('[data-path]').forEach((b) => {
    if (b.dataset.path === path) b.setAttribute('aria-current', 'page');
    else b.removeAttribute('aria-current');
  });
}

function parseHash() {
  const raw = location.hash.replace(/^#\/?/, '').trim();
  if (!raw) return { path: 'painel', params: [] };
  const parts = raw.split('/').filter(Boolean);
  return { path: parts[0], params: parts.slice(1) };
}

async function renderRoute() {
  const { path, params } = parseHash();
  const route = ROUTES.find((r) => r.path === path) || ROUTES[0];
  const container = viewEl();

  if (current && current.destroy) { try { current.destroy(); } catch { /* noop */ } }

  container.innerHTML = '<div class="row" style="justify-content:center;padding:40px"><span class="spinner"></span></div>';
  let out;
  try {
    out = await route.view({ params, navigate });
  } catch (e) {
    console.error(e);
    container.innerHTML = `<div class="empty"><b>Não foi possível abrir esta tela</b><p>${esc(e.message || '')}</p></div>`;
    return;
  }
  current = out || {};

  container.innerHTML = '';
  if (out && out.el) container.appendChild(out.el);

  document.getElementById('page-title').textContent = (out && out.title) || route.title;
  document.getElementById('page-sub').textContent = (out && out.sub) || '';
  document.getElementById('btn-back').hidden = !route.deep;
  markActive(route.tab ? route.path : '');
  container.scrollTop = 0;
  window.scrollTo({ top: 0 });
}

/* ---------------- chip de sincronização ---------------- */

function paintSync() {
  const chip = document.getElementById('sync-chip');
  const label = document.getElementById('sync-label');
  const s = state.sync;
  if (!state.settings.syncEnabled) {
    chip.dataset.state = 'idle';
    label.textContent = 'Local';
    chip.title = 'Somente neste aparelho — toque para entrar no Supabase';
    return;
  }
  if (s.status === 'syncing') { chip.dataset.state = 'syncing'; label.textContent = 'Sincronizando'; return; }
  if (s.status === 'error') { chip.dataset.state = 'error'; label.textContent = 'Erro'; chip.title = s.message; return; }
  if (s.pending > 0 || !navigator.onLine) {
    chip.dataset.state = 'pending';
    label.textContent = s.pending > 0 ? `${s.pending} pend.` : 'Offline';
    return;
  }
  chip.dataset.state = 'ok';
  label.textContent = 'Em dia';
  chip.title = 'Tudo sincronizado';
}

/* ---------------- tema ---------------- */

export function applyTheme(theme) {
  document.documentElement.dataset.theme = theme || 'auto';
}

/* ---------------- start ---------------- */

async function main() {
  await load();
  applyTheme(state.settings.theme);
  buildNav();
  paintSync();

  onChange((reason) => {
    paintSync();
    if (reason === 'settings') applyTheme(state.settings.theme);
  });

  window.addEventListener('hashchange', renderRoute);
  window.addEventListener('online', paintSync);
  window.addEventListener('offline', paintSync);

  if (!location.hash) navigate('painel', true);
  await renderRoute();

  document.getElementById('splash').remove();
  document.getElementById('app').hidden = false;

  requestPersistence();
  startAutoSync();

  if ('serviceWorker' in navigator && location.protocol !== 'file:') {
    navigator.serviceWorker.register('./sw.js').catch(() => {});
  }
}

window.addEventListener('beforeinstallprompt', (e) => {
  e.preventDefault();
  deferredInstall = e;
});

main().catch((e) => {
  console.error(e);
  const splash = document.getElementById('splash');
  if (splash) splash.innerHTML = `<p style="max-width:30ch;text-align:center">Falha ao iniciar o aplicativo.<br><small>${esc(e.message || '')}</small></p>`;
});
