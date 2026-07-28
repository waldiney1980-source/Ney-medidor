// Cadastro de medidores: lista, busca, criação/edição, unidades e etiquetas QR.

import {
  activeMeters, activeSites, lastReading, newMeter,
  saveMeter, deleteMeter, saveSite, deleteSite, TYPES,
} from './store.js';
import { icon, toast, openSheet, confirmSheet, typeColor } from './ui.js';
import { qrSVG } from './qr.js';
import { el, esc, fmtAuto, fmtDate, parseNum, uid } from './utils.js';
import { SEGMENTS, segmentLabel, linksResumo } from './gestao.js';

/* ---------------- formulário de medidor ---------------- */

export function meterFormSheet(existing, onSaved) {
  const m = existing ? { ...existing } : newMeter();
  const sites = activeSites();

  openSheet({
    title: existing ? 'Editar medidor' : 'Novo medidor',
    body: `<div class="stack">
      <div class="field">
        <label>Tipo</label>
        <div class="row" style="gap:8px">
          <button type="button" class="chip grow" data-type="energia" style="justify-content:center;height:44px" ${m.type === 'energia' ? 'data-active="true"' : ''}>${icon('bolt', 17)} Energia (kWh)</button>
          <button type="button" class="chip grow" data-type="agua" style="justify-content:center;height:44px" ${m.type === 'agua' ? 'data-active="true"' : ''}>${icon('drop', 17)} Água (m³)</button>
        </div>
      </div>
      <div class="field">
        <label for="f-name">Nome / identificação *</label>
        <input class="input" id="f-name" value="${esc(m.name)}" placeholder="Ex.: Loja 12 — Energia">
      </div>
      <div class="grid-2">
        <div class="field">
          <label for="f-code">Código do medidor</label>
          <input class="input" id="f-code" value="${esc(m.code)}" placeholder="Nº de série / etiqueta" autocomplete="off">
          <span class="hint">Usado na leitura por QR Code.</span>
        </div>
        <div class="field">
          <label for="f-site">Unidade</label>
          <select class="select" id="f-site">
            <option value="">— sem unidade —</option>
            ${sites.map((s) => `<option value="${s.id}" ${s.id === m.siteId ? 'selected' : ''}>${esc(s.name)}</option>`).join('')}
          </select>
        </div>
      </div>
      <div class="field">
        <label for="f-loc">Local de instalação</label>
        <input class="input" id="f-loc" value="${esc(m.location)}" placeholder="Ex.: Subsolo, quadro QDG-2">
      </div>
      <div class="grid-2">
        <div class="field">
          <label for="f-factor">Fator / constante</label>
          <input class="input" id="f-factor" inputmode="decimal" value="${esc(String(m.factor ?? 1))}">
          <span class="hint">Consumo = (leitura atual − anterior) × fator.<br>Ex.: diferença 10 com fator 10 → 100. Sem TC, use 1.</span>
        </div>
        <div class="field">
          <label for="f-digits">Dígitos do relógio</label>
          <input class="input" id="f-digits" inputmode="numeric" value="${esc(String(m.digits ?? 6))}">
          <span class="hint">Para tratar a virada do contador.</span>
        </div>
      </div>
      <div class="grid-2">
        <div class="field">
          <label for="f-tariff">Tarifa própria (R$/unid.)</label>
          <input class="input" id="f-tariff" inputmode="decimal" value="${m.tariff ?? ''}" placeholder="usar padrão">
        </div>
        <div class="field">
          <label for="f-active">Situação</label>
          <select class="select" id="f-active">
            <option value="1" ${m.active ? 'selected' : ''}>Ativo</option>
            <option value="0" ${!m.active ? 'selected' : ''}>Inativo</option>
          </select>
        </div>
      </div>
      <div class="field">
        <label for="f-note">Observações</label>
        <textarea class="input" id="f-note" placeholder="Opcional">${esc(m.note || '')}</textarea>
      </div>
    </div>`,
    actions: `${existing ? `<button class="btn btn--danger" data-act="del">${icon('trash', 18)} Excluir</button>` : '<button class="btn" data-close>Cancelar</button>'}
              <button class="btn btn--primary" data-act="save">Salvar</button>`,
    onMount(sheet, close) {
      let type = m.type;
      sheet.querySelectorAll('[data-type]').forEach((b) => b.onclick = () => {
        type = b.dataset.type;
        sheet.querySelectorAll('[data-type]').forEach((x) => x.dataset.active = String(x === b));
        const digits = sheet.querySelector('#f-digits');
        if (!existing) digits.value = String(TYPES[type].digits);
      });

      sheet.querySelector('[data-act="save"]').onclick = async () => {
        const name = sheet.querySelector('#f-name').value.trim();
        if (!name) { toast('Informe o nome do medidor.', 'error'); return; }
        const code = sheet.querySelector('#f-code').value.trim();
        const dup = activeMeters().find((x) => x.id !== m.id && code && String(x.code || '').toLowerCase() === code.toLowerCase());
        if (dup) { toast(`O código “${code}” já está em uso por ${dup.name}.`, 'error', 4200); return; }

        const factor = parseNum(sheet.querySelector('#f-factor').value);
        const digits = parseInt(sheet.querySelector('#f-digits').value, 10);
        const tariffRaw = sheet.querySelector('#f-tariff').value.trim();

        await saveMeter({
          ...m, name, code, type,
          unit: TYPES[type].unit,
          siteId: sheet.querySelector('#f-site').value,
          location: sheet.querySelector('#f-loc').value.trim(),
          factor: Number.isFinite(factor) && factor > 0 ? factor : 1,
          digits: Number.isFinite(digits) && digits >= 3 && digits <= 12 ? digits : TYPES[type].digits,
          tariff: tariffRaw ? parseNum(tariffRaw) : null,
          active: sheet.querySelector('#f-active').value === '1' ? 1 : 0,
          note: sheet.querySelector('#f-note').value.trim(),
        });
        toast(existing ? 'Medidor atualizado.' : 'Medidor cadastrado.', 'ok');
        close();
        if (onSaved) onSaved();
      };

      const del = sheet.querySelector('[data-act="del"]');
      if (del) del.onclick = async () => {
        close();
        const ok = await confirmSheet({
          title: 'Excluir medidor?',
          message: `“${m.name}” e todas as suas leituras serão removidos deste aparelho e da nuvem.`,
          confirmLabel: 'Excluir', danger: true,
        });
        if (!ok) return;
        await deleteMeter(m.id);
        toast('Medidor excluído.', 'ok');
        if (onSaved) onSaved();
      };
    },
  });
}

/* ---------------- unidades ---------------- */

/** Ficha da unidade: perfil do negócio, contato do dono e limites do mês. */
export function siteFormSheet(site, onSaved) {
  const s = site || { id: uid(), name: '' };
  const novo = !site;
  const v = (x) => (x === null || x === undefined ? '' : String(x));
  // medidores órfãos: sem eles vinculados, a unidade não gera sugestão nem aviso
  const soltos = activeMeters().filter((m) => !m.siteId);

  openSheet({
    title: novo ? 'Nova unidade' : 'Editar unidade',
    sub: 'Loja, prédio ou setor. O segmento define as sugestões de economia do relatório.',
    body: `<div class="stack">
      <div class="field">
        <label for="u-name">Nome da unidade</label>
        <input class="input" id="u-name" value="${esc(s.name || '')}" placeholder="Ex.: Padaria Central">
      </div>
      <div class="field">
        <label for="u-seg">Segmento do negócio</label>
        <select class="select" id="u-seg">
          ${Object.entries(SEGMENTS).map(([k, o]) =>
            `<option value="${k}" ${k === (s.segment || '') ? 'selected' : ''}>${esc(o.label)}</option>`).join('')}
        </select>
        <span class="hint">O relatório gerencial traz dicas específicas para esse ramo.</span>
      </div>

      <div class="divider"></div>
      <p class="small muted" style="margin:0"><b>Proprietário</b> — para quem o aviso de consumo alto é enviado.</p>
      <div class="field">
        <label for="u-own">Nome</label>
        <input class="input" id="u-own" value="${esc(s.ownerName || '')}" placeholder="Nome do dono">
      </div>
      <div class="row" style="gap:8px">
        <div class="field grow">
          <label for="u-fone">WhatsApp</label>
          <input class="input" id="u-fone" inputmode="tel" value="${esc(s.ownerPhone || '')}" placeholder="(11) 98888-7777">
        </div>
      </div>
      <div class="field">
        <label for="u-mail">E-mail</label>
        <input class="input" id="u-mail" inputmode="email" value="${esc(s.ownerEmail || '')}" placeholder="dono@email.com">
      </div>

      <div class="divider"></div>
      <p class="small muted" style="margin:0"><b>Limite do mês</b> — deixe em branco o que não quiser acompanhar.
      Ao passar do limite, o app avisa e monta a mensagem pronta.</p>
      <div class="row" style="gap:8px">
        <div class="field grow">
          <label for="u-le">Energia (kWh)</label>
          <input class="input" id="u-le" inputmode="decimal" value="${esc(v(s.limitEnergia))}" placeholder="—">
        </div>
        <div class="field grow">
          <label for="u-la">Água (m³)</label>
          <input class="input" id="u-la" inputmode="decimal" value="${esc(v(s.limitAgua))}" placeholder="—">
        </div>
      </div>
      <div class="field">
        <label for="u-lc">Custo estimado (R$)</label>
        <input class="input" id="u-lc" inputmode="decimal" value="${esc(v(s.limitCost))}" placeholder="—">
      </div>
      ${(!novo && (s.ownerPhone || s.ownerEmail)) ? `
        <div class="divider"></div>
        <div class="field">
          <label>Enviar o resumo do mês</label>
          <div class="row" style="gap:8px;flex-wrap:wrap">
            <button class="btn btn--sm btn--primary" data-envio="whatsapp">WhatsApp</button>
            <button class="btn btn--sm" data-envio="email">E-mail</button>
          </div>
          <span class="hint">Consumo, limites e sugestões do ramo. Abre o aplicativo com o texto pronto — quem envia é você.</span>
        </div>` : ''}
      ${soltos.length ? `
        <div class="divider"></div>
        <div class="field">
          <label>Medidores sem unidade (${soltos.length})</label>
          <div class="filters" style="padding-bottom:0">
            <button class="chip" data-vinc="1" data-active="true">Incluir nesta unidade</button>
            <button class="chip" data-vinc="0">Deixar como estão</button>
          </div>
          <span class="hint">${esc(soltos.slice(0, 4).map((m) => m.name || m.code).join(', '))}${soltos.length > 4 ? ` e mais ${soltos.length - 4}` : ''}.
          Sem unidade, eles não entram nas sugestões nem no aviso ao proprietário.</span>
        </div>` : ''}
    </div>`,
    actions: `${novo ? '' : '<button class="btn btn--danger" data-act="del">Excluir</button>'}
      <button class="btn" data-close>Cancelar</button>
      <button class="btn btn--primary" data-act="save">Salvar</button>`,
    onMount(sheet, close) {
      const g = (id) => sheet.querySelector(id).value.trim();

      // envio do resumo: abre o WhatsApp/e-mail com o texto pronto
      sheet.querySelectorAll('[data-envio]').forEach((b) => b.onclick = () => {
        const links = linksResumo(s);
        const alvo = links[b.dataset.envio];
        if (!alvo) { toast('Falta o contato do proprietário nesta unidade.', 'info'); return; }
        window.open(alvo, b.dataset.envio === 'whatsapp' ? '_blank' : '_self');
      });

      let vincular = soltos.length > 0;
      sheet.querySelectorAll('[data-vinc]').forEach((b) => b.onclick = () => {
        vincular = b.dataset.vinc === '1';
        sheet.querySelectorAll('[data-vinc]').forEach((x) => x.dataset.active = String(x === b));
      });

      sheet.querySelector('[data-act="save"]').onclick = async () => {
        const name = g('#u-name');
        if (!name) { toast('Dê um nome à unidade.', 'warn'); return; }
        await saveSite({
          ...s, name,
          segment: g('#u-seg'),
          ownerName: g('#u-own'), ownerPhone: g('#u-fone'), ownerEmail: g('#u-mail'),
          limitEnergia: g('#u-le'), limitAgua: g('#u-la'), limitCost: g('#u-lc'),
        });
        if (vincular && soltos.length) {
          for (const m of soltos) await saveMeter({ ...m, siteId: s.id });
        }
        toast(vincular && soltos.length
          ? `Unidade salva com ${soltos.length} medidor(es).`
          : 'Unidade salva.', 'ok');
        close();
        if (onSaved) onSaved();
      };
      const del = sheet.querySelector('[data-act="del"]');
      if (del) del.onclick = async () => {
        if (!await confirmSheet({
          title: 'Excluir unidade?',
          message: `Os medidores de “${s.name}” continuam cadastrados, mas ficam sem unidade.`,
          danger: true, confirmLabel: 'Excluir',
        })) return;
        await deleteSite(s.id);
        close();
        if (onSaved) onSaved();
      };
    },
  });
}

function sitesSheet(onSaved) {
  const paint = (sheet) => {
    const list = sheet.querySelector('#site-list');
    const sites = activeSites();
    list.innerHTML = sites.length ? sites.map((s) => {
      const marcas = [
        s.segment ? segmentLabel(s.segment) : '',
        `${activeMeters().filter((m) => m.siteId === s.id).length} medidor(es)`,
        (s.ownerPhone || s.ownerEmail) ? 'proprietário cadastrado' : 'sem contato do dono',
        (s.limitEnergia || s.limitAgua || s.limitCost) ? 'com limite' : 'sem limite',
      ].filter(Boolean).join(' · ');
      return `<div class="item" data-edit="${s.id}">
        <span class="grow item__main"><span class="item__title">${esc(s.name)}</span>
        <span class="item__sub">${esc(marcas)}</span></span>
        ${icon('chev', 18)}
      </div>`;
    }).join('') : '<p class="small muted">Nenhuma unidade cadastrada.</p>';

    list.querySelectorAll('[data-edit]').forEach((b) => b.onclick = () => {
      const alvo = activeSites().find((x) => x.id === b.dataset.edit);
      siteFormSheet(alvo, () => { paint(sheet); if (onSaved) onSaved(); });
    });
  };

  openSheet({
    title: 'Unidades',
    sub: 'Agrupe medidores por prédio, loja ou setor. Toque para editar.',
    body: `<div class="list" id="site-list"></div>
      <div class="divider"></div>
      <button class="btn btn--primary btn--block" id="site-add">${icon('plus', 18)} Nova unidade</button>`,
    onMount(sheet) {
      paint(sheet);
      sheet.querySelector('#site-add').onclick = () =>
        siteFormSheet(null, () => { paint(sheet); if (onSaved) onSaved(); });
    },
  });
}

/* ---------------- etiquetas com QR ---------------- */

export function printLabels(meters) {
  const withCode = meters.filter((m) => m.code);
  if (!withCode.length) {
    toast('Nenhum medidor com código cadastrado. Preencha o campo “Código” para gerar as etiquetas.', 'info', 5000);
    return;
  }
  const area = document.createElement('div');
  area.id = 'print-area';
  area.innerHTML = `<h2 style="font:600 16px system-ui;margin-bottom:6mm">Etiquetas de medidores — HidroLuz</h2>
    <div class="label-sheet">
      ${withCode.map((m) => {
        let svg = '';
        try { svg = qrSVG(m.code, { size: 150 }); }
        catch { svg = '<p style="font:11px system-ui">Código longo demais para QR</p>'; }
        return `<div class="label-card">
          ${svg}
          <b>${esc(m.name || '')}</b>
          <span class="code">${esc(m.code)}</span>
          <small>${esc([TYPES[m.type].label, m.location].filter(Boolean).join(' · '))}</small>
        </div>`;
      }).join('')}
    </div>`;
  document.body.appendChild(area);
  const cleanup = () => { area.remove(); window.removeEventListener('afterprint', cleanup); };
  window.addEventListener('afterprint', cleanup);
  setTimeout(() => window.print(), 120);
  setTimeout(cleanup, 60000);
}

/* ---------------- view ---------------- */

export default async function meters({ navigate }) {
  const root = el('<div class="stack"></div>');
  let query = '';
  let type = 'all';

  const paint = () => {
    root.innerHTML = '';
    const sites = activeSites();

    const head = el(`<div class="stack">
      <div class="row" style="gap:8px">
        <div class="grow" style="position:relative">
          <span style="position:absolute;left:12px;top:50%;transform:translateY(-50%);color:var(--muted)">${icon('search', 18)}</span>
          <input class="input" id="q" placeholder="Buscar medidor" style="padding-left:38px" value="${esc(query)}" autocomplete="off">
        </div>
        <button class="btn btn--primary" id="add" style="flex:none;width:52px;padding:0" aria-label="Novo medidor">${icon('plus', 22)}</button>
      </div>
      <div class="filters">
        <button class="chip" data-t="all" ${type === 'all' ? 'data-active="true"' : ''}>Todos</button>
        <button class="chip" data-t="energia" ${type === 'energia' ? 'data-active="true"' : ''}>${icon('bolt', 15)} Energia</button>
        <button class="chip" data-t="agua" ${type === 'agua' ? 'data-active="true"' : ''}>${icon('drop', 15)} Água</button>
        <button class="chip" id="sites">${icon('filter', 15)} Unidades (${sites.length})</button>
        <button class="chip" id="labels">${icon('print', 15)} Etiquetas QR</button>
      </div>
    </div>`);
    root.appendChild(head);

    const term = query.trim().toLowerCase();
    const list = activeMeters()
      .filter((m) => type === 'all' || m.type === type)
      .filter((m) => !term || [m.name, m.code, m.location].some((v) => String(v || '').toLowerCase().includes(term)))
      .sort((a, b) => String(a.name || a.code).localeCompare(String(b.name || b.code), 'pt-BR'));

    if (!list.length) {
      root.appendChild(el(`<section class="card"><div class="card__body"><div class="empty">
        ${icon('gauge', 30)}<b>${term ? 'Nada encontrado' : 'Nenhum medidor cadastrado'}</b>
        <p>${term ? 'Ajuste a busca ou cadastre um novo medidor.' : 'Cadastre os relógios de energia e água que serão lidos em campo.'}</p>
        <button class="btn btn--primary btn--sm" id="add2">Cadastrar medidor</button>
      </div></div></section>`));
      root.querySelector('#add2').onclick = () => meterFormSheet(null, paint);
    } else {
      const grouped = new Map();
      list.forEach((m) => {
        const key = m.siteId || '';
        if (!grouped.has(key)) grouped.set(key, []);
        grouped.get(key).push(m);
      });
      [...grouped.entries()].forEach(([siteId, group]) => {
        const site = sites.find((s) => s.id === siteId);
        if (sites.length) {
          root.appendChild(el(`<div class="section-title">${esc(site ? site.name : 'Sem unidade')}</div>`));
        }
        const box = el(`<div class="list">${group.map((m) => {
          const last = lastReading(m.id);
          return `<button class="item" data-id="${m.id}">
            <span class="item__icon" style="background:${typeColor(m.type)};${m.active ? '' : 'opacity:.4'}">${icon(m.type === 'agua' ? 'drop' : 'bolt', 20)}</span>
            <span class="item__main">
              <span class="item__title">${esc(m.name || m.code)}${m.active ? '' : ' <span class="badge">inativo</span>'}</span>
              <span class="item__sub">${esc([m.code, m.location].filter(Boolean).join(' · ') || TYPES[m.type].label)}</span>
            </span>
            <span class="item__right">
              <span class="item__value">${last ? esc(fmtAuto(last.value)) : '—'}</span>
              <span class="item__meta">${last ? esc(fmtDate(last.readAt)) : 'sem leitura'}</span>
            </span>
            <span class="item__chev">${icon('chev', 18)}</span>
          </button>`;
        }).join('')}</div>`);
        box.querySelectorAll('[data-id]').forEach((b) => b.onclick = () => navigate('medidor/' + b.dataset.id));
        root.appendChild(box);
      });
    }

    head.querySelector('#q').addEventListener('input', (e) => {
      query = e.target.value;
      const pos = e.target.selectionStart;
      paint();
      const input = root.querySelector('#q');
      input.focus();
      input.setSelectionRange(pos, pos);
    });
    head.querySelectorAll('[data-t]').forEach((b) => b.onclick = () => { type = b.dataset.t; paint(); });
    head.querySelector('#add').onclick = () => meterFormSheet(null, paint);
    head.querySelector('#sites').onclick = () => sitesSheet(paint);
    head.querySelector('#labels').onclick = () => printLabels(
      activeMeters().filter((m) => type === 'all' || m.type === type)
    );
  };

  paint();
  return { el: root, title: 'Medidores', sub: `${activeMeters().length} cadastrado(s)` };
}
