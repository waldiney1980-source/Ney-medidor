// Backend alternativo: Supabase (PostgREST + Auth), sem SDK — só fetch.
// Mesma interface de sincronização do backend Cloudflare.

import { state, saveSettings } from './store.js';

const cfg = () => ({
  url: (state.settings.supabaseUrl || '').trim().replace(/\/+$/, ''),
  key: (state.settings.supabaseKey || '').trim(),
});

export const supabaseConfigured = () => {
  const { url, key } = cfg();
  return !!(url && key);
};

export const supabaseSession = () => state.settings.supabaseSession || null;

async function raw(path, { method = 'GET', body, headers = {}, auth = true, timeout = 25000 } = {}) {
  const { url, key } = cfg();
  if (!url || !key) throw new Error('Supabase não configurado (URL e chave publicável).');
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeout);
  const h = { apikey: key, 'Content-Type': 'application/json', ...headers };
  const session = supabaseSession();
  if (auth && session && session.access_token) h.Authorization = 'Bearer ' + session.access_token;
  try {
    const res = await fetch(url + path, {
      method, headers: h, signal: ctrl.signal,
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const text = await res.text();
    let data = null;
    try { data = text ? JSON.parse(text) : null; } catch { data = { raw: text }; }
    if (!res.ok) {
      const msg = (data && (data.error_description || data.msg || data.message || data.error || data.hint)) || `Erro ${res.status}`;
      const err = new Error(msg);
      err.status = res.status;
      throw err;
    }
    return data;
  } finally {
    clearTimeout(t);
  }
}

/** Renova o token quando expirado e repete a chamada uma vez. */
async function request(path, opts = {}) {
  const s = supabaseSession();
  if (s && s.expires_at && s.expires_at - 60000 < Date.now() && s.refresh_token) {
    await refreshSession().catch(() => {});
  }
  try {
    return await raw(path, opts);
  } catch (e) {
    if (e.status === 401 && supabaseSession()) {
      await refreshSession();
      return raw(path, opts);
    }
    throw e;
  }
}

/* ---------------- autenticação ---------------- */

function storeSession(data) {
  if (!data || !data.access_token) throw new Error('Resposta de autenticação inválida.');
  const session = {
    access_token: data.access_token,
    refresh_token: data.refresh_token,
    expires_at: Date.now() + (Number(data.expires_in) || 3600) * 1000,
    email: (data.user && data.user.email) || '',
    userId: (data.user && data.user.id) || '',
  };
  return saveSettings({ supabaseSession: session }).then(() => session);
}

export async function signIn(email, password) {
  const data = await raw('/auth/v1/token?grant_type=password', {
    method: 'POST', auth: false, body: { email, password },
  });
  return storeSession(data);
}

export async function signUp(email, password) {
  const data = await raw('/auth/v1/signup', { method: 'POST', auth: false, body: { email, password } });
  if (!data || !data.access_token) {
    // projeto com confirmação de e-mail ativada
    const err = new Error('Conta criada. Confirme o e-mail recebido e depois entre normalmente.');
    err.code = 'confirm-email';
    throw err;
  }
  return storeSession(data);
}

export async function refreshSession() {
  const s = supabaseSession();
  if (!s || !s.refresh_token) throw new Error('Sessão expirada. Entre novamente.');
  const data = await raw('/auth/v1/token?grant_type=refresh_token', {
    method: 'POST', auth: false, body: { refresh_token: s.refresh_token },
  });
  return storeSession(data);
}

export async function signOut() {
  try { await raw('/auth/v1/logout', { method: 'POST' }); } catch { /* sessão local basta */ }
  await saveSettings({ supabaseSession: null });
}

/* ---------------- mapeamento ---------------- */

const nz = (v) => (v === '' || v === undefined ? null : v);
const iso = (d) => String(d || '').slice(0, 10) || null;

const nOuNulo = (v) => (v === null || v === undefined || v === '' ? null : Number(v));

const toRowSite = (s) => ({
  id: s.id, nome: s.name || '', observacao: s.note || '',
  segmento: s.segment || '',
  prop_nome: s.ownerName || '', prop_fone: s.ownerPhone || '', prop_email: s.ownerEmail || '',
  limite_energia: nOuNulo(s.limitEnergia),
  limite_agua: nOuNulo(s.limitAgua),
  limite_custo: nOuNulo(s.limitCost),
  limite_pct: nOuNulo(s.limitPct),
  updated_at: s.updatedAt || 0, deleted: s.deleted || 0,
});
const fromRowSite = (r) => ({
  id: r.id, name: r.nome || '', note: r.observacao || '',
  segment: r.segmento || '',
  ownerName: r.prop_nome || '', ownerPhone: r.prop_fone || '', ownerEmail: r.prop_email || '',
  limitEnergia: nOuNulo(r.limite_energia),
  limitAgua: nOuNulo(r.limite_agua),
  limitCost: nOuNulo(r.limite_custo),
  limitPct: nOuNulo(r.limite_pct),
  updatedAt: Number(r.updated_at) || 0, deleted: r.deleted || 0,
});

const toRowMeter = (m) => ({
  id: m.id, codigo: m.code || '', nome: m.name || '', tipo: m.type || 'energia',
  unidade_med: m.unit || '', unidade_id: nz(m.siteId), local: m.location || '',
  fator: Number(m.factor) > 0 ? Number(m.factor) : 1,
  digitos: Number(m.digits) || 6,
  tarifa: m.tariff === null || m.tariff === undefined || m.tariff === '' ? null : Number(m.tariff),
  ativo: m.active ? 1 : 0, observacao: m.note || '',
  created_at: m.createdAt || 0, updated_at: m.updatedAt || 0, deleted: m.deleted || 0,
});
const fromRowMeter = (r) => ({
  id: r.id, code: r.codigo || '', name: r.nome || '', type: r.tipo || 'energia',
  unit: r.unidade_med || '', siteId: r.unidade_id || '', location: r.local || '',
  factor: Number(r.fator) || 1, digits: Number(r.digitos) || 6,
  tariff: r.tarifa === null ? null : Number(r.tarifa),
  active: r.ativo ? 1 : 0, note: r.observacao || '',
  createdAt: Number(r.created_at) || 0, updatedAt: Number(r.updated_at) || 0, deleted: r.deleted || 0,
});

const toRowReading = (r) => ({
  id: r.id, medidor_id: r.meterId, valor: Number(r.value) || 0, lida_em: iso(r.readAt),
  leiturista: r.readerName || '', observacao: r.note || '', foto_id: nz(r.photoId),
  origem: r.source || 'manual',
  created_at: r.createdAt || 0, updated_at: r.updatedAt || 0, deleted: r.deleted || 0,
});
const fromRowReading = (r) => ({
  id: r.id, meterId: r.medidor_id, value: Number(r.valor) || 0, readAt: iso(r.lida_em),
  readerName: r.leiturista || '', note: r.observacao || '', photoId: r.foto_id || null,
  source: r.origem || 'manual',
  createdAt: Number(r.created_at) || 0, updatedAt: Number(r.updated_at) || 0, deleted: r.deleted || 0,
});

const toRowPhoto = (p) => ({
  id: p.id, leitura_id: nz(p.readingId), dados: p.data || '',
  updated_at: p.updatedAt || 0, deleted: p.deleted || 0,
});

/* ---------------- sincronização ---------------- */

const upsert = (table, rows) => rows.length
  ? request(`/rest/v1/${table}`, {
      method: 'POST', body: rows,
      headers: { Prefer: 'resolution=merge-duplicates,return=minimal' },
    })
  : Promise.resolve(null);

export async function push(payload) {
  await upsert('unidades', (payload.sites || []).map(toRowSite));
  await upsert('medidores', (payload.meters || []).map(toRowMeter));
  await upsert('leituras', (payload.readings || []).map(toRowReading));
  const photos = (payload.photos || []).filter((p) => String(p.data || '').length < 4_000_000);
  for (let i = 0; i < photos.length; i += 5) {
    await upsert('leitura_fotos', photos.slice(i, i + 5).map(toRowPhoto));
  }
  return { ok: true };
}

export async function pull(since = 0) {
  const q = `updated_at=gt.${Number(since) || 0}&select=*&order=updated_at.asc&limit=10000`;
  const [sites, meters, readings] = await Promise.all([
    request(`/rest/v1/unidades?${q}`),
    request(`/rest/v1/medidores?${q}`),
    request(`/rest/v1/leituras?${q}`),
  ]);
  return {
    now: Date.now(),
    sites: (sites || []).map(fromRowSite),
    meters: (meters || []).map(fromRowMeter),
    readings: (readings || []).map(fromRowReading),
  };
}

export async function photo(id) {
  const rows = await request(`/rest/v1/leitura_fotos?id=eq.${encodeURIComponent(id)}&select=*&limit=1`);
  if (!rows || !rows.length) return null;
  const r = rows[0];
  return { id: r.id, readingId: r.leitura_id, data: r.dados, updatedAt: Number(r.updated_at) || 0 };
}

/** Sonda de conectividade e de sessão, usada na tela de Ajustes. */
export async function health() {
  const { url } = cfg();
  await raw('/rest/v1/medidores?select=id&limit=1', { auth: true, timeout: 10000 });
  return { ok: true, url, session: supabaseSession() };
}

/** Reconhecimento do valor na foto — Edge Function `ocr` do projeto. */
export function ocr(payload) {
  return request('/functions/v1/ocr', { method: 'POST', body: payload, timeout: 60000 });
}
