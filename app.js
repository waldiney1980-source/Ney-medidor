// Bootstrap, roteador e casca do aplicativo.

import { load, state, onChange } from './store.js';
import { requestPersistence } from './db.js';
import { startAutoSync, sync } from './api.js';
import { icon, toast } from './ui.js';
import { esc } from './utils.js';

import dashboard from './dashboard.js';
import capture from './capture.js';
import meters from './meters.js';
import meterDetail from './meter-detail.js';
import history from './history.js';
import settings from './settings.js';

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
  document.getElementById('brand').hidden = !!route.deep;   // não competem pelo mesmo canto
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
  medirTopbar();

  if ('serviceWorker' in navigator && location.protocol !== 'file:') {
    navigator.serviceWorker.register('./sw.js').then((reg) => {
      /* Procura versão nova ao abrir e de hora em hora — sem isso o navegador
         só reconsulta o sw.js de tempos em tempos e a correção fica esperando. */
      reg.update().catch(() => {});
      setInterval(() => reg.update().catch(() => {}), 60 * 60 * 1000);
    }).catch(() => {});

    /* O service worker novo assume sozinho e troca os arquivos em cache, mas a
       tela em uso continua com os módulos antigos até recarregar. Em vez de
       recarregar no meio de uma leitura, avisamos e deixamos a decisão com quem
       está usando. */
    navigator.serviceWorker.addEventListener('controllerchange', avisoDeVersaoNova);
  }
}

/**
 * Publica a altura da barra superior em --topbar-h.
 *
 * A barra de filtros gruda logo abaixo dela, e essa altura muda com o aparelho:
 * o recorte da tela do iPhone entra na conta. Medir é mais seguro do que chutar
 * um valor fixo que ficaria errado em metade dos celulares.
 */
function medirTopbar() {
  const barra = document.querySelector('.topbar');
  if (!barra) return;
  const aplicar = () => {
    const h = Math.round(barra.getBoundingClientRect().height);
    if (h) document.documentElement.style.setProperty('--topbar-h', `${h}px`);
  };
  aplicar();
  window.addEventListener('resize', aplicar);
  window.addEventListener('orientationchange', () => setTimeout(aplicar, 200));
  if (window.ResizeObserver) new ResizeObserver(aplicar).observe(barra);
}

/** Faixa discreta no rodapé: nova versão baixada, esperando um toque. */
function avisoDeVersaoNova() {
  if (document.getElementById('versao-nova')) return;
  const barra = document.createElement('div');
  barra.id = 'versao-nova';
  barra.className = 'update-bar';
  barra.innerHTML = `<span>Nova versão do aplicativo disponível.</span>
    <button type="button" id="versao-ok">Atualizar</button>
    <button type="button" id="versao-depois" aria-label="Agora não">✕</button>`;
  barra.querySelector('#versao-ok').onclick = () => location.reload();
  barra.querySelector('#versao-depois').onclick = () => barra.remove();
  document.body.appendChild(barra);
}

window.addEventListener('beforeinstallprompt', (e) => {
  e.preventDefault();
  deferredInstall = e;
});

/** Última linha de defesa: se o app não abrir, oferece um reinício de verdade. */
function telaDeFalha(mensagem) {
  const splash = document.getElementById('splash');
  if (!splash) return;
  splash.innerHTML = `
    <div style="max-width:32ch;text-align:center;display:grid;gap:14px;color:var(--ink)">
      <p style="font-weight:600">Não foi possível abrir o aplicativo.</p>
      <p style="font-size:13px;color:var(--muted);line-height:1.5">
        Toque no botão abaixo para reinstalar a versão mais recente. Leituras já
        enviadas para a nuvem não se perdem.
      </p>
      <button id="recuperar" style="height:46px;border:0;border-radius:12px;background:var(--brand);
        color:#fff;font-size:15px;font-weight:600">Reiniciar o aplicativo</button>
      <p style="font-size:11px;color:var(--muted);word-break:break-word">${esc(mensagem || '')}</p>
    </div>`;
  splash.querySelector('#recuperar').onclick = async () => {
    try {
      const regs = await navigator.serviceWorker.getRegistrations();
      await Promise.all(regs.map((r) => r.unregister()));
      const chaves = await caches.keys();
      await Promise.all(chaves.map((k) => caches.delete(k)));
    } catch { /* segue para o recarregamento de qualquer forma */ }
    location.replace(location.pathname + '?r=' + Date.now());
  };
}

// se a carga travar por mais de 15s, mostra a saída em vez de ficar girando
const travou = setTimeout(() => {
  if (document.getElementById('splash')) telaDeFalha('A inicialização demorou demais.');
}, 15000);

main()
  .then(() => clearTimeout(travou))
  .catch((e) => {
    clearTimeout(travou);
    console.error(e);
    telaDeFalha(e && e.message);
  });
