// Captura de leitura no celular: seleção do medidor (busca ou QR), teclado
// numérico, validação contra o histórico e foto do relógio.

import {
  state, activeMeters, meterById, meterByCode, lastReading,
  newReading, saveReading, anomalyCheck, TYPES, pendingMeters, readingsOf,
} from './store.js';
import { fetchPhoto, readMeterPhoto } from './api.js';
import { icon, toast, typeColor, openSheet } from './ui.js';
import { scanCode, scannerSupported } from './scanner.js';
import {
  el, esc, fmtAuto, fmtDate, todayISO, parseNum, compressImage, daysBetween,
} from './utils.js';

export default async function capture({ params, navigate }) {
  const root = el('<div class="stack"></div>');
  let meter = params[0] ? meterById(params[0]) : null;
  let editing = params[1] ? readingsOf(meter ? meter.id : '').find((r) => r.id === params[1]) : null;

  // leitura é sempre inteira; um valor legado com fração é arredondado ao editar
  let digits = editing ? String(Math.round(Number(editing.value) || 0)) : '';
  let readAt = editing ? editing.readAt : todayISO();
  let note = editing ? editing.note || '' : '';
  let photoData = undefined;      // undefined = inalterada, null = remover, string = nova
  let photoPreview = null;
  let keyHandler = null;

  const unbindKeys = () => {
    if (keyHandler) document.removeEventListener('keydown', keyHandler);
    keyHandler = null;
  };

  /** Mantém o subtítulo da barra superior em sincronia com a etapa atual. */
  const setHeader = (text) => {
    const sub = document.getElementById('page-sub');
    if (sub) sub.textContent = text;
  };

  /* ---------- reconhecimento do valor na foto ---------- */

  let ocr = { status: 'idle' };
  let refreshDisplay = () => {};

  /** Converte o resultado do modelo no texto que vai para o visor.
   *  A leitura é sempre um número inteiro — qualquer fração é descartada. */
  const ocrDigits = () => {
    if (!ocr.value) return '';
    return String(ocr.value).replace(/^0+(?=\d)/, '');
  };

  function paintOcr() {
    const box = root.querySelector('#ocr');
    if (!box) return;
    if (!photoPreview) { box.innerHTML = ''; return; }

    if (state.settings.ocrEnabled === false) {
      box.innerHTML = `<div class="alert alert--info" style="margin-top:10px">${icon('info', 18)}
        <span>Leitura automática desativada em Ajustes. Digite o valor no teclado acima.</span></div>`;
      return;
    }

    if (ocr.status === 'running') {
      box.innerHTML = `<div class="alert alert--info" style="margin-top:10px"><span class="spinner"></span>
        <span>Lendo o valor na foto…</span></div>`;
      return;
    }

    if (ocr.status === 'ok') {
      const conf = Number.isFinite(ocr.confidence) ? ocr.confidence : null;
      const low = conf !== null && conf < 0.6;
      box.innerHTML = `
        <div class="alert alert--${low ? 'warn' : 'good'}" style="margin-top:10px">${icon(low ? 'alert' : 'check', 18)}
          <span><b>Valor lido na foto: ${esc(ocrDigits())}</b>${conf !== null ? ` · confiança ${(conf * 100).toFixed(0)}%` : ''}<br>
          Confira contra a foto antes de registrar — o valor não é preenchido sozinho.</span></div>
        <div class="row" style="gap:8px;margin-top:8px;flex-wrap:wrap">
          <button class="btn btn--sm btn--primary" data-ocr="use">Usar ${esc(ocrDigits())}</button>
          <button class="btn btn--sm" data-ocr="retry">Ler de novo</button>
        </div>`;
    } else if (ocr.status === 'illegible') {
      box.innerHTML = `
        <div class="alert alert--warn" style="margin-top:10px">${icon('alert', 18)}
          <span><b>Não deu para ler os dígitos com segurança.</b><br>
          Digite o valor no teclado acima, ou tire outra foto mais próxima e sem reflexo.</span></div>
        <div class="row" style="gap:8px;margin-top:8px">
          <button class="btn btn--sm" data-ocr="retry">Tentar de novo</button>
          <button class="btn btn--sm" data-ocr="photo">Outra foto</button>
        </div>`;
    } else if (ocr.status === 'error') {
      box.innerHTML = `
        <div class="alert alert--${ocr.code === 'offline' || ocr.code === 'offline-config' ? 'info' : 'critical'}" style="margin-top:10px">
          ${icon(ocr.code === 'offline' || ocr.code === 'offline-config' ? 'info' : 'alert', 18)}
          <span>${esc(ocr.message)}<br>Digite o valor no teclado acima para não perder a visita.</span></div>
        ${ocr.code === 'offline-config' ? '' : `<div class="row" style="gap:8px;margin-top:8px">
          <button class="btn btn--sm" data-ocr="retry">Tentar de novo</button></div>`}`;
    } else {
      box.innerHTML = `<div class="row" style="gap:8px;margin-top:8px">
        <button class="btn btn--sm" data-ocr="retry">${icon('camera', 16)} Ler valor da foto</button></div>`;
    }

    box.querySelectorAll('[data-ocr]').forEach((b) => b.onclick = () => {
      const act = b.dataset.ocr;
      if (act === 'retry') runOcr();
      else if (act === 'photo') { const f = root.querySelector('#file'); if (f) f.click(); }
      else {
        digits = ocrDigits();
        refreshDisplay();
        toast('Valor preenchido. Confira antes de registrar.', 'ok');
      }
    });
  }

  async function runOcr() {
    if (!photoPreview || state.settings.ocrEnabled === false) { paintOcr(); return; }
    ocr = { status: 'running' };
    paintOcr();
    try {
      const res = await readMeterPhoto({
        image: photoPreview,
        type: meter.type,
        digits: meter.digits,
      });
      if (res && res.legible && res.value) {
        ocr = { status: 'ok', value: res.value, confidence: res.confidence, model: res.model };
      } else {
        ocr = { status: 'illegible' };
      }
    } catch (e) {
      ocr = { status: 'error', message: e.message || 'Falha no reconhecimento.', code: e.code || (e.status === 503 ? 'no-ai' : 'erro') };
    }
    paintOcr();
  }

  if (editing && editing.photoId) {
    const p = await fetchPhoto(editing.photoId);
    if (p && p.data) photoPreview = p.data;
  }

  /* ---------------- seleção do medidor ---------------- */

  function renderPicker() {
    unbindKeys();
    setHeader('Selecione o medidor');
    root.innerHTML = '';
    const all = activeMeters().filter((m) => m.active);
    if (!all.length) {
      root.appendChild(el(`<section class="card"><div class="card__body"><div class="empty">
        ${icon('gauge', 30)}<b>Nenhum medidor ativo</b>
        <p>Cadastre um medidor antes de registrar leituras.</p>
        <button class="btn btn--primary btn--sm" data-go>Ir para medidores</button>
      </div></div></section>`));
      root.querySelector('[data-go]').onclick = () => navigate('medidores');
      return;
    }

    const pendingIds = new Set(pendingMeters({ type: 'all', siteId: 'all', meterId: 'all', from: todayISO().slice(0, 8) + '01', to: todayISO() }).map((p) => p.meter.id));

    const box = el(`<div class="stack">
      <div class="row" style="gap:8px">
        <div class="grow" style="position:relative">
          <span style="position:absolute;left:12px;top:50%;transform:translateY(-50%);color:var(--muted)">${icon('search', 18)}</span>
          <input class="input" id="q" placeholder="Buscar por nome, código ou local" style="padding-left:38px" autocomplete="off">
        </div>
        <button class="btn" id="scan" style="flex:none;width:52px;padding:0" aria-label="Ler código">${icon('qr', 22)}</button>
      </div>
      <div class="list" id="list"></div>
    </div>`);
    root.appendChild(box);

    const list = box.querySelector('#list');
    const paintList = (q = '') => {
      const term = q.trim().toLowerCase();
      const items = all
        .filter((m) => !term || [m.name, m.code, m.location].some((v) => String(v || '').toLowerCase().includes(term)))
        .sort((a, b) => {
          const pa = pendingIds.has(a.id) ? 0 : 1, pb = pendingIds.has(b.id) ? 0 : 1;
          if (pa !== pb) return pa - pb;
          return String(a.name || a.code).localeCompare(String(b.name || b.code), 'pt-BR');
        });
      if (!items.length) {
        list.innerHTML = `<div class="empty"><p>Nenhum medidor encontrado para “${esc(q)}”.</p></div>`;
        return;
      }
      list.innerHTML = items.map((m) => {
        const last = lastReading(m.id);
        return `<button class="item" data-id="${m.id}">
          <span class="item__icon" style="background:${typeColor(m.type)}">${icon(m.type === 'agua' ? 'drop' : 'bolt', 20)}</span>
          <span class="item__main">
            <span class="item__title">${esc(m.name || m.code)}</span>
            <span class="item__sub">${esc([m.code, m.location].filter(Boolean).join(' · ') || TYPES[m.type].label)}</span>
          </span>
          <span class="item__right">
            <span class="item__value">${last ? esc(fmtAuto(last.value)) : '—'}</span>
            <span class="item__meta">${last ? esc(fmtDate(last.readAt)) : 'sem leitura'}</span>
          </span>
          <span class="item__chev">${icon('chev', 18)}</span>
        </button>`;
      }).join('');
      list.querySelectorAll('[data-id]').forEach((b) => b.onclick = () => {
        meter = meterById(b.dataset.id);
        renderForm();
      });
    };
    paintList();

    box.querySelector('#q').addEventListener('input', (e) => paintList(e.target.value));
    box.querySelector('#scan').onclick = async () => {
      if (!scannerSupported()) {
        openSheet({
          title: 'Digitar código',
          sub: 'A leitura por câmera não está disponível neste navegador.',
          body: `<div class="field"><label for="mc">Código do medidor</label><input class="input" id="mc" autocomplete="off"></div>`,
          actions: `<button class="btn" data-close>Cancelar</button><button class="btn btn--primary" data-act="ok">Buscar</button>`,
          onMount(sheet, close) {
            sheet.querySelector('[data-act="ok"]').onclick = () => {
              const found = meterByCode(sheet.querySelector('#mc').value);
              close();
              if (found) { meter = found; renderForm(); } else toast('Nenhum medidor com esse código.', 'error');
            };
          },
        });
        return;
      }
      const code = await scanCode();
      if (!code) return;
      const found = meterByCode(code) || activeMeters().find((m) => m.id === code);
      if (found) { meter = found; renderForm(); }
      else toast(`Código “${code}” não corresponde a nenhum medidor.`, 'error', 4200);
    };
  }

  /* ---------------- formulário de leitura ---------------- */

  function renderForm() {
    const prev = editing
      ? readingsOf(meter.id).filter((r) => r.readAt <= editing.readAt && r.id !== editing.id).pop() || null
      : lastReading(meter.id);
    const unit = TYPES[meter.type].unit;
    const color = typeColor(meter.type);
    const factor = Number(meter.factor) > 0 ? Number(meter.factor) : 1;

    root.innerHTML = '';
    setHeader(meter.name || meter.code);
    const node = el(`<div class="stack">
      <section class="card">
        <div class="card__body">
          <div class="row">
            <span class="item__icon" style="background:${color}">${icon(meter.type === 'agua' ? 'drop' : 'bolt', 20)}</span>
            <span class="grow item__main">
              <span class="item__title">${esc(meter.name || meter.code)}</span>
              <span class="item__sub">${esc([meter.code, meter.location].filter(Boolean).join(' · ') || TYPES[meter.type].label)}</span>
            </span>
            ${params[0] ? '' : `<button class="btn btn--sm btn--ghost" id="change">Trocar</button>`}
          </div>
          <div class="divider"></div>
          <div class="preview-line"><span>Leitura anterior</span><b>${prev ? esc(fmtAuto(prev.value)) + ' ' + esc(unit) : '—'}</b></div>
          <div class="preview-line"><span>Data anterior</span><b>${prev ? esc(fmtDate(prev.readAt)) : '—'}</b></div>
          ${factor !== 1 ? `<div class="preview-line"><span>Fator / constante</span><b>× ${esc(fmtAuto(factor))}</b></div>` : ''}
        </div>
      </section>

      <section class="reader">
        <div class="reader__display">
          <div class="reader__value" id="disp" data-empty="1">0</div>
          <div class="reader__unit">Leitura atual em ${esc(unit)}</div>
        </div>
        <div class="keypad" id="pad">
          ${[1, 2, 3, 4, 5, 6, 7, 8, 9].map((n) => `<button class="key" data-k="${n}">${n}</button>`).join('')}
          <button class="key key--fn" data-k="clear" aria-label="Limpar">C</button>
          <button class="key" data-k="0">0</button>
          <button class="key key--fn" data-k="del" aria-label="Apagar">⌫</button>
        </div>
      </section>

      <div id="feedback"></div>

      <section class="card"><div class="card__body stack">
        <div class="grid-2">
          <div class="field">
            <label for="date">Data da leitura</label>
            <input class="input" type="date" id="date" value="${readAt}" max="${todayISO()}">
          </div>
          <div class="field">
            <label for="reader">Leiturista</label>
            <input class="input" id="reader" value="${esc(editing ? editing.readerName || '' : state.settings.readerName || '')}" placeholder="Seu nome">
          </div>
        </div>
        <div class="field">
          <label>Foto do relógio <span class="muted">${state.settings.ocrEnabled === false ? '(opcional)' : '(o app tenta ler o valor sozinho)'}</span></label>
          <div class="photo-slot" id="photo">
            ${photoPreview ? `<img src="${photoPreview}" alt="Foto da leitura"><button class="photo-slot__clear" type="button" id="clearPhoto" aria-label="Remover foto">${icon('close', 16)}</button>`
              : `${icon('camera', 26)}<span>Tocar para fotografar o medidor</span>`}
          </div>
          <input type="file" accept="image/*" capture="environment" id="file" hidden>
          <div id="ocr"></div>
        </div>
        <div class="field">
          <label for="note">Observação <span class="muted">(opcional)</span></label>
          <textarea class="input" id="note" placeholder="Ex.: lacre rompido, relógio embaçado…">${esc(note)}</textarea>
        </div>
      </div></section>

      <button class="btn btn--primary btn--lg btn--block" id="save">${icon('check', 20)} ${editing ? 'Salvar alterações' : 'Registrar leitura'}</button>
    </div>`);
    root.appendChild(node);

    const disp = node.querySelector('#disp');
    const feedback = node.querySelector('#feedback');

    const paintValue = () => {
      disp.textContent = digits || '0';
      disp.dataset.empty = digits ? '0' : '1';
      paintFeedback();
    };
    refreshDisplay = paintValue;

    const paintFeedback = () => {
      const value = parseNum(digits);
      if (!digits || !Number.isFinite(value)) { feedback.innerHTML = ''; return; }
      const check = anomalyCheck(meter, prev, value, readAt);
      const kind = check.level === 'critical' ? 'critical' : check.level === 'warn' ? 'warn' : check.level === 'info' ? 'info' : 'good';
      const days = prev ? Math.max(1, daysBetween(prev.readAt, readAt)) : 0;
      feedback.innerHTML = `
        <div class="alert alert--${kind}">${icon(kind === 'good' ? 'check' : kind === 'info' ? 'info' : 'alert', 18)}
          <span>${esc(check.message)}${check.pct !== undefined && Number.isFinite(check.pct)
            ? ` <b>${check.pct > 0 ? '+' : ''}${check.pct.toFixed(0)}%</b> vs. média diária de ${esc(fmtAuto(check.avg))} ${esc(TYPES[meter.type].unit)}/dia.` : ''}</span>
        </div>
        ${check.consumption !== null ? `<section class="card" style="margin-top:10px"><div class="card__body">
          ${factor !== 1 ? `
            <div class="preview-line"><span>Diferença de leitura</span><b>${esc(fmtAuto(check.consumption / factor))}</b></div>
            <div class="preview-line"><span>Fator / constante</span><b>× ${esc(fmtAuto(factor))}</b></div>` : ''}
          <div class="preview-line"><span>Consumo no período</span><b>${esc(fmtAuto(check.consumption))} ${esc(TYPES[meter.type].unit)}</b></div>
          <div class="preview-line"><span>Intervalo</span><b>${days} dia${days === 1 ? '' : 's'}</b></div>
          <div class="preview-line"><span>Média diária</span><b>${esc(fmtAuto(check.perDay))} ${esc(TYPES[meter.type].unit)}/dia</b></div>
        </div></section>` : ''}`;
    };

    node.querySelector('#pad').addEventListener('click', (e) => {
      const b = e.target.closest('[data-k]');
      if (!b) return;
      const k = b.dataset.k;
      if (k === 'del') digits = digits.slice(0, -1);
      else if (k === 'clear') digits = '';
      else if (digits.length < 12) digits += k;
      if (navigator.vibrate) navigator.vibrate(8);
      paintValue();
    });

    unbindKeys();
    keyHandler = onKey;
    document.addEventListener('keydown', onKey);
    function onKey(e) {
      if (document.querySelector('.sheet-backdrop')) return;
      if (['INPUT', 'TEXTAREA'].includes(document.activeElement.tagName)) return;
      if (/^[0-9]$/.test(e.key)) { digits += e.key; paintValue(); }
      else if (e.key === 'Backspace') { digits = digits.slice(0, -1); paintValue(); }
    }
    node.querySelector('#date').onchange = (e) => { readAt = e.target.value || todayISO(); paintFeedback(); };
    node.querySelector('#note').oninput = (e) => { note = e.target.value; };

    const change = node.querySelector('#change');
    if (change) change.onclick = () => { meter = null; digits = ''; renderPicker(); };

    const fileInput = node.querySelector('#file');
    node.querySelector('#photo').onclick = (e) => {
      if (e.target.closest('#clearPhoto')) {
        photoData = null; photoPreview = null; ocr = { status: 'idle' }; renderForm(); return;
      }
      fileInput.click();
    };
    fileInput.onchange = async () => {
      const f = fileInput.files && fileInput.files[0];
      if (!f) return;
      try {
        photoData = await compressImage(f);
        photoPreview = photoData;
        ocr = { status: 'idle' };
        renderForm();
        runOcr();
      } catch (err) { toast('Não foi possível processar a foto.', 'error'); }
    };

    paintOcr();

    node.querySelector('#save').onclick = async () => {
      const value = parseNum(digits);
      if (!digits || !Number.isFinite(value)) { toast('Informe o valor da leitura.', 'error'); return; }
      const readerName = node.querySelector('#reader').value.trim();
      const check = anomalyCheck(meter, prev, value, readAt);
      if (check.level === 'critical') {
        const ok = await new Promise((resolve) => {
          let answer = false;
          openSheet({
            title: 'Confirmar leitura atípica',
            sub: check.message + ' Deseja registrar mesmo assim?',
            actions: `<button class="btn" data-act="no">Revisar</button><button class="btn btn--primary" data-act="yes">Registrar assim</button>`,
            onMount(sheet, close) {
              sheet.querySelector('[data-act="no"]').onclick = () => close();
              sheet.querySelector('[data-act="yes"]').onclick = () => { answer = true; close(); };
            },
            onClose: () => resolve(answer),
          });
        });
        if (!ok) return;
      }

      const base = editing || newReading({ meterId: meter.id });
      const rec = { ...base, meterId: meter.id, value, readAt, note, readerName, source: editing ? base.source : 'manual' };
      await saveReading(rec, photoData);
      if (readerName && readerName !== state.settings.readerName) {
        const { saveSettings } = await import('../store.js');
        await saveSettings({ readerName });
      }
      toast(editing ? 'Leitura atualizada.' : 'Leitura registrada.', 'ok');
      if (editing) { navigate('medidor/' + meter.id); return; }

      digits = ''; note = ''; photoData = undefined; photoPreview = null;
      openSheet({
        title: 'Leitura registrada',
        sub: `${meter.name || meter.code} · ${fmtAuto(value)} ${TYPES[meter.type].unit}`,
        actions: `<button class="btn" data-act="dash">Ir ao painel</button><button class="btn btn--primary" data-act="next">Ler outro medidor</button>`,
        onMount(sheet, close) {
          sheet.querySelector('[data-act="dash"]').onclick = () => { close(); navigate('painel'); };
          sheet.querySelector('[data-act="next"]').onclick = () => { close(); meter = null; renderPicker(); };
        },
      });
    };

    paintValue();
  }

  if (meter) renderForm(); else renderPicker();

  return {
    el: root,
    title: editing ? 'Editar leitura' : 'Nova leitura',
    sub: meter ? (meter.name || meter.code) : 'Selecione o medidor',
    destroy: unbindKeys,
  };
}
