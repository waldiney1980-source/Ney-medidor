// Sincronização com o Supabase (Postgres + Auth + Edge Functions).

import { state, saveSettings, collectDirty, markClean, applyRemote, emit } from './store.js';
import { idb } from './db.js';
import * as sb from './supabase.js';

/* ------------------------------------------------------------------ */
/* estado da sincronização                                             */
/* ------------------------------------------------------------------ */

let running = null;

/** Folga da marca de sincronização, para absorver diferença de relógio. */
const SOBREPOSICAO = 2 * 60 * 1000;

/**
 * Marca d'água das correções de sincronização.
 *
 * Aparelho que sincronizou antes da paginação parou com a marca adiantada e o
 * cadastro incompleto — faltavam medidores que ele nunca mais iria buscar,
 * porque "já passei desse ponto". Corrigir o download não bastaria: é preciso
 * mandá-lo varrer tudo de novo, uma única vez. Subir este número faz isso em
 * cada aparelho, na primeira sincronização depois da atualização.
 */
const EPOCA_SYNC = 1;

function setStatus(status, message = '') {
  state.sync.status = status;
  state.sync.message = message;
  emit('sync-status');
}

export const connected = () => sb.supabaseConfigured() && !!sb.supabaseSession();

export async function connect({ url, key, email, password, signup = false }) {
  await saveSettings({ supabaseUrl: (url || '').trim(), supabaseKey: (key || '').trim() });
  const session = signup ? await sb.signUp(email, password) : await sb.signIn(email, password);
  await saveSettings({ syncEnabled: true, serverUser: session.email, lastSyncAt: 0 });
  return session;
}

export async function disconnect() {
  await sb.signOut();
  await saveSettings({ syncEnabled: false, lastSyncAt: 0 });
  setStatus('idle', '');
}

/**
 * Sincronização bidirecional: envia o que está sujo, depois puxa o que mudou.
 * Conflito: vence o registro com updatedAt mais recente (garantido por trigger no banco).
 */
export async function sync({ silent = false } = {}) {
  if (!state.settings.syncEnabled || !connected()) {
    setStatus('idle', 'Somente local');
    return { skipped: true };
  }
  if (running) return running;
  if (!navigator.onLine) {
    setStatus('pending', 'Sem conexão');
    return { offline: true };
  }

  running = (async () => {
    setStatus('syncing', 'Sincronizando…');
    try {
      const dirty = await collectDirty();
      const payload = {
        sites: dirty.sites,
        meters: dirty.meters,
        readings: dirty.readings,
        photos: dirty.photos.map((p) => ({
          id: p.id, readingId: p.readingId, data: p.data || '',
          updatedAt: p.updatedAt, deleted: p.deleted || 0,
        })),
      };
      const hasLocal = payload.sites.length || payload.meters.length
        || payload.readings.length || payload.photos.length;
      if (hasLocal) {
        await sb.push(payload);
        await markClean(dirty);
      }

      /* Varredura completa quando este aparelho ainda não passou pela época
         atual: é o que devolve o que ficou para trás na sincronização
         truncada. Custa uma passagem inteira, uma vez só. */
      const varrerTudo = (state.settings.syncEpoca || 0) < EPOCA_SYNC;
      const desde = varrerTudo ? 0 : (state.settings.lastSyncAt || 0);

      const remote = await sb.pull(desde);
      const applied = await applyRemote(remote);
      /* A marca de "até onde já baixei" recua um pouco de propósito. Ela vem do
         relógio deste aparelho, e os registros trazem o relógio de quem gravou:
         alguns segundos de diferença entre os dois bastam para um registro cair
         numa fresta e nunca mais ser buscado. Com a sobreposição, o pior que
         acontece é rebaixar registros já conhecidos — o que é inofensivo. */
      const marca = (remote.now || Date.now()) - SOBREPOSICAO;
      await saveSettings({ lastSyncAt: Math.max(0, marca), syncEpoca: EPOCA_SYNC });

      setStatus('ok', 'Sincronizado');
      return { pushed: hasLocal ? 1 : 0, applied };
    } catch (e) {
      setStatus('error', e.message || 'Falha ao sincronizar');
      if (!silent) throw e;
      return { error: e.message };
    } finally {
      running = null;
    }
  })();

  return running;
}

/* ------------------------------------------------------------------ */
/* fotos e reconhecimento                                              */
/* ------------------------------------------------------------------ */

/** Busca a foto no servidor quando ela não existe neste aparelho. */
export async function fetchPhoto(photoId) {
  if (!photoId) return null;
  const local = await idb.get('photos', photoId);
  if (local && local.data) return local;
  if (!state.settings.syncEnabled || !connected() || !navigator.onLine) return local || null;
  try {
    const remote = await sb.photo(photoId);
    if (remote && remote.data) {
      const rec = {
        id: remote.id, readingId: remote.readingId, data: remote.data,
        updatedAt: remote.updatedAt || Date.now(), dirty: 0, deleted: 0,
      };
      await idb.put('photos', rec);
      return rec;
    }
  } catch { /* mantém o comportamento offline */ }
  return local || null;
}

/** Reconhecimento do valor na foto do medidor. Exige nuvem conectada e rede. */
export async function readMeterPhoto({ image, type, digits }) {
  if (!connected()) {
    const err = new Error('Sem servidor: o app leu apenas com o que roda no aparelho. Para reconhecer relógio de rodinhas, entre no Supabase em Ajustes.');
    err.code = 'offline-config';
    throw err;
  }
  if (!navigator.onLine) {
    const err = new Error('Sem conexão agora. A foto ficou guardada — dá para reconhecer o valor depois pelo histórico do medidor.');
    err.code = 'offline';
    throw err;
  }
  return sb.ocr({ image, type, digits });
}

/* ------------------------------------------------------------------ */

/** Auto-sync: ao voltar a conexão, ao reabrir o app e a cada 5 min. */
export function startAutoSync() {
  const tick = () => { sync({ silent: true }); };
  window.addEventListener('online', tick);
  window.addEventListener('offline', () => setStatus('pending', 'Sem conexão'));
  document.addEventListener('visibilitychange', () => { if (!document.hidden) tick(); });
  setInterval(tick, 5 * 60 * 1000);
  setTimeout(tick, 1200);
}
