// Estado do domínio: medidores, leituras, consumo e agregações do painel.

import { idb } from './db.js';
import { uid, nowMs, todayISO, dateOf, daysBetween, monthKey, monthLabel, fmtDateShort, isoOf, addDaysISO } from './utils.js';

export const TYPES = {
  energia: { key: 'energia', label: 'Energia', unit: 'kWh', colorVar: '--energy', digits: 8, icon: 'bolt' },
  agua: { key: 'agua', label: 'Água', unit: 'm³', colorVar: '--water', digits: 6, icon: 'drop' },
};

export const DEFAULT_SETTINGS = {
  readerName: '',
  syncEnabled: false,
  serverUser: '',
  supabaseUrl: '',
  supabaseKey: '',
  supabaseSession: null,
  tariff: { energia: 0.92, agua: 12.5 },
  theme: 'auto',
  alertPct: 40,
  ocrEnabled: true,
  lastSyncAt: 0,
  onboarded: false,
};

const listeners = new Set();

export const state = {
  ready: false,
  sites: [],
  meters: [],
  readings: [],
  settings: { ...DEFAULT_SETTINGS },
  sync: { status: 'idle', message: '', pending: 0 },
};

export function onChange(fn) { listeners.add(fn); return () => listeners.delete(fn); }
export function emit(reason = 'data') { listeners.forEach((fn) => fn(reason)); }

/* ------------------------------------------------------------------ */
/* carga                                                               */
/* ------------------------------------------------------------------ */

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Versões antigas do app geravam códigos no formato `id-xxxx`, que o Postgres
 * recusa. Reescreve esses registros com UUID válido, preservando os vínculos
 * entre medidor, leitura e foto. Roda uma única vez, na carga.
 */
async function migrarIdsAntigos(sites, meters, readings) {
  const photos = await idb.getAll('photos');
  const todos = [...sites, ...meters, ...readings, ...photos];
  if (!todos.some((r) => r && !UUID_RE.test(String(r.id)))) return null;

  const mapa = new Map();
  const trocar = (id) => {
    if (!id) return id;
    const s = String(id);
    if (UUID_RE.test(s)) return s;
    if (!mapa.has(s)) mapa.set(s, uid());
    return mapa.get(s);
  };

  const novoSite = sites.map((s) => ({ ...s, id: trocar(s.id), dirty: 1 }));
  const novoMeter = meters.map((m) => ({ ...m, id: trocar(m.id), siteId: m.siteId ? trocar(m.siteId) : '', dirty: 1 }));
  const novoRead = readings.map((r) => ({
    ...r, id: trocar(r.id), meterId: trocar(r.meterId),
    photoId: r.photoId ? trocar(r.photoId) : null, dirty: 1,
  }));
  const novoPhoto = photos.map((p) => ({
    ...p, id: trocar(p.id), readingId: p.readingId ? trocar(p.readingId) : null, dirty: 1,
  }));

  // limpa as chaves antigas antes de gravar as novas
  for (const [store, antigos] of [['sites', sites], ['meters', meters], ['readings', readings], ['photos', photos]]) {
    for (const r of antigos) if (mapa.has(String(r.id))) await idb.del(store, r.id);
  }
  await idb.bulkPut('sites', novoSite);
  await idb.bulkPut('meters', novoMeter);
  await idb.bulkPut('readings', novoRead);
  await idb.bulkPut('photos', novoPhoto);

  return { sites: novoSite, meters: novoMeter, readings: novoRead, convertidos: mapa.size };
}

export async function load() {
  const [sites, meters, readings, settings] = await Promise.all([
    idb.getAll('sites'), idb.getAll('meters'), idb.getAll('readings'),
    idb.kvGet('settings', null),
  ]);
  const migrado = await migrarIdsAntigos(sites || [], meters || [], readings || []);
  if (migrado) {
    console.info(`[HidroLuz] ${migrado.convertidos} registro(s) antigos convertidos para o formato novo.`);
    state.sites = migrado.sites;
    state.meters = migrado.meters;
    state.readings = migrado.readings;
    state.settings = { ...DEFAULT_SETTINGS, ...(settings || {}),
      tariff: { ...DEFAULT_SETTINGS.tariff, ...((settings && settings.tariff) || {}) } };
    state.ready = true;
    recountPending();
    emit('load');
    return;
  }
  state.sites = sites || [];
  state.meters = meters || [];
  state.readings = readings || [];
  state.settings = {
    ...DEFAULT_SETTINGS,
    ...(settings || {}),
    tariff: { ...DEFAULT_SETTINGS.tariff, ...((settings && settings.tariff) || {}) },
  };
  state.ready = true;
  recountPending();
  emit('load');
}

export async function saveSettings(patch) {
  state.settings = { ...state.settings, ...patch };
  await idb.kvSet('settings', state.settings);
  emit('settings');
  return state.settings;
}

/* ------------------------------------------------------------------ */
/* CRUD                                                                */
/* ------------------------------------------------------------------ */

function stamp(rec) {
  rec.updatedAt = nowMs();
  rec.dirty = 1;
  return rec;
}

export function newMeter(patch = {}) {
  const type = patch.type || 'energia';
  return {
    id: uid(),
    code: '',
    name: '',
    type,
    unit: TYPES[type].unit,
    siteId: '',
    location: '',
    factor: 1,
    digits: TYPES[type].digits,
    tariff: null,
    initial: null,
    active: 1,
    note: '',
    createdAt: nowMs(),
    updatedAt: nowMs(),
    deleted: 0,
    dirty: 1,
    ...patch,
  };
}

export async function saveMeter(meter) {
  const rec = stamp({ ...meter });
  rec.unit = TYPES[rec.type] ? TYPES[rec.type].unit : rec.unit;
  const i = state.meters.findIndex((m) => m.id === rec.id);
  if (i >= 0) state.meters[i] = rec; else state.meters.push(rec);
  await idb.put('meters', rec);
  recountPending();
  emit('meters');
  return rec;
}

export async function deleteMeter(id) {
  const m = state.meters.find((x) => x.id === id);
  if (!m) return;
  await saveMeter({ ...m, deleted: 1, active: 0 });
  for (const r of state.readings.filter((r) => r.meterId === id && !r.deleted)) {
    await deleteReading(r.id, true);
  }
  emit('meters');
}

const numOuNulo = (v) => { const n = Number(String(v).replace(',', '.')); return Number.isFinite(n) && n > 0 ? n : null; };

export async function saveSite(site) {
  const rec = stamp({
    id: site.id || uid(),
    name: site.name || '',
    note: site.note || '',
    // perfil do negócio — alimenta as sugestões de economia do relatório
    segment: site.segment || '',
    ownerName: site.ownerName || '',
    ownerPhone: site.ownerPhone || '',
    ownerEmail: site.ownerEmail || '',
    // limites do mês; nulo = sem limite
    limitEnergia: numOuNulo(site.limitEnergia),
    limitAgua: numOuNulo(site.limitAgua),
    limitCost: numOuNulo(site.limitCost),
    // aumento aceitável em % sobre o mês anterior
    limitPct: numOuNulo(site.limitPct),
    deleted: site.deleted || 0,
  });
  const i = state.sites.findIndex((s) => s.id === rec.id);
  if (i >= 0) state.sites[i] = rec; else state.sites.push(rec);
  await idb.put('sites', rec);
  emit('sites');
  return rec;
}

export async function deleteSite(id) {
  const s = state.sites.find((x) => x.id === id);
  if (!s) return;
  await saveSite({ ...s, deleted: 1 });
}

export function newReading(patch = {}) {
  return {
    id: uid(),
    meterId: '',
    value: null,
    readAt: todayISO(),
    readerName: state.settings.readerName || '',
    note: '',
    photoId: null,
    source: 'manual',
    createdAt: nowMs(),
    updatedAt: nowMs(),
    deleted: 0,
    dirty: 1,
    ...patch,
  };
}

export async function saveReading(reading, photoDataUrl = undefined) {
  const rec = stamp({ ...reading });
  if (photoDataUrl === null && rec.photoId) {
    await idb.del('photos', rec.photoId);
    rec.photoId = null;
  } else if (typeof photoDataUrl === 'string' && photoDataUrl) {
    const photoId = rec.photoId || uid();
    await idb.put('photos', { id: photoId, readingId: rec.id, data: photoDataUrl, updatedAt: nowMs(), dirty: 1, deleted: 0 });
    rec.photoId = photoId;
  }
  const i = state.readings.findIndex((r) => r.id === rec.id);
  if (i >= 0) state.readings[i] = rec; else state.readings.push(rec);
  await idb.put('readings', rec);
  recountPending();
  emit('readings');
  return rec;
}

export async function deleteReading(id, silent = false) {
  const r = state.readings.find((x) => x.id === id);
  if (!r) return;
  const rec = stamp({ ...r, deleted: 1 });
  state.readings[state.readings.findIndex((x) => x.id === id)] = rec;
  await idb.put('readings', rec);
  if (rec.photoId) {
    const p = await idb.get('photos', rec.photoId);
    if (p) await idb.put('photos', { ...p, deleted: 1, dirty: 1, data: '', updatedAt: nowMs() });
  }
  recountPending();
  if (!silent) emit('readings');
}

export function getPhoto(id) { return id ? idb.get('photos', id) : Promise.resolve(null); }

/* ------------------------------------------------------------------ */
/* seletores                                                           */
/* ------------------------------------------------------------------ */

export const activeMeters = () => state.meters.filter((m) => !m.deleted);
export const activeSites = () => state.sites.filter((s) => !s.deleted).sort((a, b) => a.name.localeCompare(b.name, 'pt-BR'));
export const meterById = (id) => state.meters.find((m) => m.id === id) || null;
export const siteName = (id) => (state.sites.find((s) => s.id === id) || {}).name || '';

export function meterByCode(code) {
  const c = String(code || '').trim().toLowerCase();
  if (!c) return null;
  return activeMeters().find((m) => String(m.code || '').trim().toLowerCase() === c) || null;
}

export function readingsOf(meterId) {
  return state.readings
    .filter((r) => r.meterId === meterId && !r.deleted)
    .sort((a, b) => (a.readAt === b.readAt ? a.createdAt - b.createdAt : a.readAt < b.readAt ? -1 : 1));
}

export function lastReading(meterId) {
  const list = readingsOf(meterId);
  return list.length ? list[list.length - 1] : null;
}

/** Consumo entre duas leituras, tratando fator multiplicador e virada do relógio. */
export function consumptionBetween(meter, prev, cur) {
  if (!prev || !cur) return null;
  const factor = Number(meter.factor) > 0 ? Number(meter.factor) : 1;
  let delta = Number(cur.value) - Number(prev.value);
  if (delta < 0) {
    const roll = Math.pow(10, Number(meter.digits) || 6);
    const rolled = roll - Number(prev.value) + Number(cur.value);
    // uma virada real é sempre bem menor que a capacidade total do relógio
    if (rolled > roll * 0.5) return null;
    delta = rolled;
  }
  return delta * factor;
}

/** Série de eventos de consumo de um medidor (um por leitura, exceto a primeira). */
export function consumptionEvents(meterId) {
  const meter = meterById(meterId);
  if (!meter) return [];
  const list = readingsOf(meterId);
  const out = [];
  for (let i = 1; i < list.length; i++) {
    const prev = list[i - 1], cur = list[i];
    const value = consumptionBetween(meter, prev, cur);
    const days = Math.max(1, daysBetween(prev.readAt, cur.readAt));
    out.push({
      id: cur.id, meterId, readAt: cur.readAt, fromAt: prev.readAt,
      days, consumption: value, perDay: value === null ? null : value / days,
      reading: cur, prev,
    });
  }
  return out;
}

/* ------------------------------------------------------------------ */
/* média de consumo por dia da semana                                   */
/* ------------------------------------------------------------------ */

/**
 * Consumo espalhado dia a dia. Cada período entre duas leituras distribui o
 * consumo por igual entre os seus dias — sem isso, o consumo de um mês inteiro
 * cairia todo no dia em que a leitura foi feita.
 * @returns {Map<string, number>} data ISO → consumo daquele dia
 */
export function dailyConsumption(meters) {
  const porDia = new Map();
  for (const m of meters) {
    for (const ev of consumptionEvents(m.id)) {
      if (ev.consumption === null || !ev.days) continue;
      const fatia = ev.consumption / ev.days;
      // o período é (leitura anterior, leitura atual]: termina no dia da leitura
      for (let i = 0; i < ev.days; i++) {
        const iso = addDaysISO(ev.readAt, -(ev.days - 1 - i));
        porDia.set(iso, (porDia.get(iso) || 0) + fatia);
      }
    }
  }
  return porDia;
}

/**
 * Média de cada dia da semana: soma de todos os sábados dividida pelo número
 * de sábados, e assim por diante. Com um único dia, ele mesmo é a média.
 * @returns {Array<number|null>} índice 0 = domingo … 6 = sábado
 */
export function weekdayAverage(porDia, from, to) {
  const soma = new Array(7).fill(0);
  const quantos = new Array(7).fill(0);
  for (const [iso, valor] of porDia) {
    if (from && iso < from) continue;
    if (to && iso > to) continue;
    const d = dateOf(iso).getDay();
    soma[d] += valor;
    quantos[d] += 1;
  }
  return soma.map((s, i) => (quantos[i] ? s / quantos[i] : null));
}

/** Média esperada para uma data, pelo dia da semana dela. */
export const averageOfDate = (medias, iso) => medias[dateOf(iso).getDay()];

/** Soma das médias de cada dia do intervalo — a média esperada do período. */
export function averageForRange(medias, de, ate) {
  let total = 0, contou = 0;
  for (let iso = de; iso <= ate; iso = addDaysISO(iso, 1)) {
    const m = averageOfDate(medias, iso);
    if (m === null) continue;
    total += m;
    contou++;
  }
  return contou ? total : null;
}

export function meterTariff(meter) {
  const t = Number(meter.tariff);
  if (Number.isFinite(t) && t > 0) return t;
  return Number(state.settings.tariff[meter.type]) || 0;
}

/* ------------------------------------------------------------------ */
/* agregação para o painel                                             */
/* ------------------------------------------------------------------ */

export function filterMeters({ type = 'all', siteId = 'all', meterId = 'all', includeInactive = false } = {}) {
  return activeMeters().filter((m) => {
    if (!includeInactive && !m.active) return false;
    if (type !== 'all' && m.type !== type) return false;
    if (siteId !== 'all' && (m.siteId || '') !== siteId) return false;
    if (meterId !== 'all' && m.id !== meterId) return false;
    return true;
  });
}

function bucketOf(iso, granularity) {
  return granularity === 'month' ? monthKey(iso) : iso;
}

function bucketLabel(key, granularity) {
  return granularity === 'month' ? monthLabel(key) : fmtDateShort(key);
}

/** Preenche todos os baldes do período, inclusive os vazios. */
function bucketRange(from, to, granularity) {
  const keys = [];
  if (granularity === 'month') {
    const d = dateOf(from); d.setDate(1);
    const end = dateOf(to);
    while (d <= end) { keys.push(monthKey(isoOf(d))); d.setMonth(d.getMonth() + 1); }
  } else {
    const d = dateOf(from), end = dateOf(to);
    while (d <= end) { keys.push(isoOf(d)); d.setDate(d.getDate() + 1); }
  }
  return keys;
}

/**
 * Agrega consumo por tipo dentro do período.
 * Retorna um bloco por tipo presente — nunca mistura kWh e m³ num mesmo gráfico.
 */
export function aggregate(filters) {
  const { from, to, granularity } = filters;
  const meters = filterMeters(filters);
  const types = filters.type === 'all' ? ['energia', 'agua'] : [filters.type];
  const keys = bucketRange(from, to, granularity);

  const blocks = types.map((type) => {
    const typeMeters = meters.filter((m) => m.type === type);
    const buckets = new Map(keys.map((k) => [k, 0]));
    const byMeter = new Map();
    let total = 0, cost = 0, readingsCount = 0, unknown = 0;

    for (const m of typeMeters) {
      const tariff = meterTariff(m);
      let mTotal = 0;
      for (const ev of consumptionEvents(m.id)) {
        if (ev.readAt < from || ev.readAt > to) continue;
        readingsCount++;
        if (ev.consumption === null) { unknown++; continue; }
        const k = bucketOf(ev.readAt, granularity);
        if (buckets.has(k)) buckets.set(k, buckets.get(k) + ev.consumption);
        total += ev.consumption;
        mTotal += ev.consumption;
        cost += ev.consumption * tariff;
      }
      if (mTotal > 0) byMeter.set(m.id, mTotal);
    }

    // média por dia da semana, calculada sobre todo o histórico do medidor —
    // um período curto não teria sábados suficientes para uma média confiável
    const medias = weekdayAverage(dailyConsumption(typeMeters));

    const mediaDoBalde = (k) => {
      if (granularity === 'month') {
        const inicio = `${k}-01`;
        const d = dateOf(inicio); d.setMonth(d.getMonth() + 1); d.setDate(0);
        return averageForRange(medias, inicio < from ? from : inicio, isoOf(d) > to ? to : isoOf(d));
      }
      return averageOfDate(medias, k);
    };

    const series = keys.map((k) => ({
      key: k,
      label: bucketLabel(k, granularity),
      value: buckets.get(k) || 0,
      average: mediaDoBalde(k),
    }));
    const ranking = [...byMeter.entries()]
      .map(([id, value]) => ({ id, name: (meterById(id) || {}).name || '—', code: (meterById(id) || {}).code || '', value }))
      .sort((a, b) => b.value - a.value);

    return {
      type, unit: TYPES[type].unit, label: TYPES[type].label,
      colorVar: TYPES[type].colorVar,
      total, cost, readingsCount, unknown,
      metersCount: typeMeters.length,
      series, ranking,
      weekdayAvg: medias,
    };
  });

  return blocks.filter((b) => b.metersCount > 0 || filters.type !== 'all');
}

/** Total do período anterior de mesmo tamanho, para o delta dos KPIs. */
export function previousTotals(filters) {
  const span = Math.max(1, daysBetween(filters.from, filters.to) + 1);
  const prevTo = dateOf(filters.from); prevTo.setDate(prevTo.getDate() - 1);
  const prevFrom = new Date(prevTo); prevFrom.setDate(prevFrom.getDate() - span + 1);
  const blocks = aggregate({ ...filters, from: isoOf(prevFrom), to: isoOf(prevTo) });
  const map = {};
  blocks.forEach((b) => { map[b.type] = b.total; });
  return map;
}

/** Medidores sem leitura dentro do período — a fila de trabalho do leitor. */
export function pendingMeters(filters) {
  return filterMeters(filters)
    .map((m) => {
      const last = lastReading(m.id);
      return { meter: m, last, lastAt: last ? last.readAt : null };
    })
    .filter((x) => !x.lastAt || x.lastAt < filters.from)
    .sort((a, b) => (a.lastAt || '') > (b.lastAt || '') ? 1 : -1);
}

export function recentReadings(limit = 12) {
  return state.readings
    .filter((r) => !r.deleted)
    .sort((a, b) => b.createdAt - a.createdAt)
    .slice(0, limit);
}

/** Variação vs. média das últimas leituras — alimenta o alerta na captura. */
export function anomalyCheck(meter, prevReading, value, readAt) {
  if (!prevReading) return { level: 'info', consumption: null, message: 'Primeira leitura do medidor — servirá de base para o próximo consumo.' };
  const cur = { value: Number(value), readAt };
  const consumption = consumptionBetween(meter, prevReading, cur);
  if (consumption === null) {
    return { level: 'critical', consumption: null, message: 'Valor menor que a leitura anterior e incompatível com uma virada de relógio. Confira os dígitos.' };
  }
  const days = Math.max(1, daysBetween(prevReading.readAt, readAt));
  const perDay = consumption / days;
  const history = consumptionEvents(meter.id).filter((e) => e.perDay !== null).slice(-6);
  if (history.length < 2) {
    return { level: 'good', consumption, perDay, days, message: 'Consumo registrado. Histórico ainda curto para comparação.' };
  }
  const avg = history.reduce((s, e) => s + e.perDay, 0) / history.length;
  if (avg <= 0) return { level: 'good', consumption, perDay, days, avg, message: 'Consumo registrado.' };
  const pct = ((perDay - avg) / avg) * 100;
  const limit = Number(state.settings.alertPct) || 40;
  if (Math.abs(pct) >= limit) {
    return {
      level: Math.abs(pct) >= limit * 2 ? 'critical' : 'warn',
      consumption, perDay, days, avg, pct,
      message: `Consumo diário ${pct > 0 ? 'acima' : 'abaixo'} da média das últimas leituras.`,
    };
  }
  return { level: 'good', consumption, perDay, days, avg, pct, message: 'Consumo dentro do padrão histórico.' };
}

/* ------------------------------------------------------------------ */
/* sincronização — contadores e aplicação de dados do servidor          */
/* ------------------------------------------------------------------ */

export function recountPending() {
  state.sync.pending =
    state.meters.filter((m) => m.dirty).length +
    state.readings.filter((r) => r.dirty).length +
    state.sites.filter((s) => s.dirty).length;
}

export async function collectDirty() {
  const photos = (await idb.getAll('photos')).filter((p) => p.dirty);
  return {
    sites: state.sites.filter((s) => s.dirty),
    meters: state.meters.filter((m) => m.dirty),
    readings: state.readings.filter((r) => r.dirty),
    photos,
  };
}

export async function markClean(payload) {
  const touch = async (store, list, arr) => {
    for (const rec of list) {
      const clean = { ...rec, dirty: 0 };
      await idb.put(store, clean);
      if (arr) {
        const i = arr.findIndex((x) => x.id === rec.id);
        if (i >= 0 && arr[i].updatedAt === rec.updatedAt) arr[i] = clean;
      }
    }
  };
  await touch('sites', payload.sites, state.sites);
  await touch('meters', payload.meters, state.meters);
  await touch('readings', payload.readings, state.readings);
  await touch('photos', payload.photos, null);
  recountPending();
}

/** Aplica registros vindos do servidor — vence o updatedAt mais recente. */
export async function applyRemote(remote) {
  const merge = async (store, incoming, arr) => {
    let n = 0;
    for (const rec of incoming || []) {
      const i = arr.findIndex((x) => x.id === rec.id);
      const local = i >= 0 ? arr[i] : null;
      if (local && local.updatedAt > rec.updatedAt) continue;
      if (local && local.dirty && local.updatedAt >= rec.updatedAt) continue;
      const clean = { ...rec, dirty: 0 };
      if (i >= 0) arr[i] = clean; else arr.push(clean);
      await idb.put(store, clean);
      n++;
    }
    return n;
  };
  let count = 0;
  count += await merge('sites', remote.sites, state.sites);
  count += await merge('meters', remote.meters, state.meters);
  count += await merge('readings', remote.readings, state.readings);
  recountPending();
  if (count) emit('sync');
  return count;
}

/* ------------------------------------------------------------------ */
/* backup                                                              */
/* ------------------------------------------------------------------ */

/**
 * Marca tudo como excluído para que a exclusão chegue à nuvem na próxima
 * sincronização. Sem isso, apagar só no aparelho não adianta: o servidor
 * devolve os mesmos registros logo em seguida.
 */
export async function marcarTudoExcluido() {
  const agora = nowMs();
  const marcar = (r) => ({ ...r, deleted: 1, dirty: 1, updatedAt: agora });

  state.sites = state.sites.map(marcar);
  state.meters = state.meters.map(marcar);
  state.readings = state.readings.map(marcar);
  const photos = (await idb.getAll('photos')).map(marcar);

  await idb.bulkPut('sites', state.sites);
  await idb.bulkPut('meters', state.meters);
  await idb.bulkPut('readings', state.readings);
  await idb.bulkPut('photos', photos);

  recountPending();
  emit('data');
  return {
    sites: state.sites.length,
    meters: state.meters.length,
    readings: state.readings.length,
    photos: photos.length,
  };
}

export async function exportBackup() {
  const photos = await idb.getAll('photos');
  return JSON.stringify({
    app: 'hidroluz', version: 1, exportedAt: new Date().toISOString(),
    sites: state.sites, meters: state.meters, readings: state.readings, photos,
    settings: { ...state.settings, supabaseSession: null, supabaseKey: '' },
  }, null, 2);
}

export async function importBackup(json, { replace = false } = {}) {
  const data = typeof json === 'string' ? JSON.parse(json) : json;
  if (!data || data.app !== 'hidroluz') throw new Error('Arquivo de backup inválido.');
  if (replace) await idb.wipeData();   // preserva ajustes e login
  const dirtyfy = (r) => ({ ...r, dirty: 1 });
  await idb.bulkPut('sites', (data.sites || []).map(dirtyfy));
  await idb.bulkPut('meters', (data.meters || []).map(dirtyfy));
  await idb.bulkPut('readings', (data.readings || []).map(dirtyfy));
  await idb.bulkPut('photos', (data.photos || []).map(dirtyfy));
  await load();
  return {
    meters: (data.meters || []).length,
    readings: (data.readings || []).length,
  };
}
