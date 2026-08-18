// Cadastro de medidores: lista, busca, criação/edição, unidades e etiquetas QR.

import {
  activeMeters, activeSites, lastReading, newMeter, readingsOf,
  saveMeter, deleteMeter, saveSite, deleteSite, TYPES,
} from './store.js';
import { icon, toast, openSheet, confirmSheet, typeColor } from './ui.js';
import { qrSVG } from './qr.js';
import { openExportSheet } from './report.js';
import { lerPlanilha, interpretar, aplicar, planilhaModelo } from './importar.js';
import { el, esc, fmtAuto, fmtLeitura, fmtDate, parseNum, uid, todayISO, downloadFile } from './utils.js';
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
      <div class="field">
        <label for="u-lp">Ou avise pelo aumento (%)</label>
        <input class="input" id="u-lp" inputmode="decimal" value="${esc(v(s.limitPct))}" placeholder="Ex.: 10">
        <span class="hint">Compara cada leitura com a anterior do mesmo medidor, sem você precisar
        saber o valor certo. Com <b>10%</b>: se o consumo anterior foi 100, passar de 110 já dispara o aviso.
        Vale a partir da segunda leitura.</span>
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
          limitEnergia: g('#u-le'), limitAgua: g('#u-la'), limitCost: g('#u-lc'), limitPct: g('#u-lp'),
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

export function sitesSheet(onSaved) {
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

/** Onde o app mora de verdade — usado quando a etiqueta é gerada de uma cópia local. */
const ENDERECO_PUBLICO = 'https://waldiney1980-source.github.io/Ney-medidor/';

/**
 * Endereço do app sem o arquivo final — base para o link da etiqueta.
 * Ex.: https://…/Ney-medidor/index.html → https://…/Ney-medidor/
 *
 * Etiqueta é papel: fica colada no relógio por anos. Se for gerada de uma cópia
 * aberta em localhost, no arquivo local ou num túnel de teste, o QR nasce
 * apontando para um endereço que só existe naquela máquina — e o celular de
 * quem for ler recebe "não foi possível conectar". Nesses casos vale mais o
 * endereço público do que o de onde a folha saiu.
 */
function baseDoApp() {
  const { protocol, hostname } = location;
  const soLocal = protocol === 'file:'
    || hostname === 'localhost'
    || hostname === '127.0.0.1'
    || hostname === '::1'
    || hostname.endsWith('.local');
  if (soLocal) return ENDERECO_PUBLICO;
  return location.origin + location.pathname.replace(/[^/]*$/, '');
}

/**
 * O que o QR da etiqueta carrega: um link que abre o app já no medidor.
 *
 * A ordem é código → nome → id, e existe por um motivo prático. O id é interno
 * e cada aparelho gera o seu: sem sincronização na nuvem, etiqueta impressa num
 * lugar não é reconhecida no outro. Código e nome vêm do cadastro e são iguais
 * em todo aparelho — e planilha de carga costuma trazer o nome mesmo quando não
 * traz o código.
 */
export const linkDoMedidor = (m) => `${baseDoApp()}#/medidor/${encodeURIComponent(m.code || m.name || m.id)}`;

export function printLabels(meters) {
  if (!meters.length) {
    toast('Nenhum medidor para etiquetar.', 'info', 4000);
    return;
  }
  const area = document.createElement('div');
  area.id = 'print-area';
  area.innerHTML = `<h2 style="font:600 16px system-ui;margin-bottom:6mm">Etiquetas de medidores — HidroLuz</h2>
    <div class="label-sheet">
      ${meters.map((m) => {
        let svg = '';
        try { svg = qrSVG(linkDoMedidor(m), { size: 150 }); }
        catch { svg = '<p style="font:11px system-ui">Não foi possível gerar o QR</p>'; }
        return `<div class="label-card">
          ${svg}
          <b>${esc(m.name || '')}</b>
          <span class="code">${esc(m.code || '')}</span>
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

/* ---------------- escolha das etiquetas ---------------- */

/**
 * Deixa escolher entre etiquetar tudo o que está no filtro ou marcar medidor
 * por medidor. Reimpressão de uma etiqueta só é o caso mais comum em campo —
 * relógio trocado, etiqueta rasgada — e não deve custar uma folha inteira.
 */
export function labelsSheet(lista) {
  if (!lista.length) {
    toast('Nenhum medidor no filtro atual.', 'info');
    return;
  }
  const marcados = new Set(lista.map((m) => m.id));
  let modo = 'todos';

  openSheet({
    title: 'Etiquetas QR',
    sub: `${lista.length} medidor(es) no filtro atual`,
    body: `<div class="stack">
      <div class="field">
        <label>Quais medidores</label>
        <div class="filters" style="padding-bottom:0">
          <button class="chip" data-modo="todos" data-active="true">Todos (${lista.length})</button>
          <button class="chip" data-modo="escolher">Escolher</button>
        </div>
        <span class="hint" id="lab-hint">Sai uma folha com os ${lista.length} medidores do filtro.</span>
      </div>
      <div id="lab-lista" hidden>
        <div class="row" style="gap:8px;margin-bottom:8px">
          <button class="btn btn--sm" data-tudo="1">Marcar todos</button>
          <button class="btn btn--sm" data-tudo="0">Desmarcar</button>
        </div>
        <div class="list">
          ${lista.map((m) => `<label class="item" style="cursor:pointer">
            <input type="checkbox" data-id="${m.id}" checked style="width:20px;height:20px;flex:none;accent-color:var(--brand)">
            <span class="item__main" style="margin-left:10px">
              <span class="item__title">${esc(m.name || m.code)}</span>
              <span class="item__sub">${esc([TYPES[m.type].label, m.code, m.location].filter(Boolean).join(' · '))}</span>
            </span>
          </label>`).join('')}
        </div>
      </div>
    </div>`,
    actions: `<button class="btn" data-close>Cancelar</button>
      <button class="btn btn--primary" data-act="print">${icon('print', 18)} Imprimir</button>`,
    onMount(sheet, close) {
      const caixa = sheet.querySelector('#lab-lista');
      const dica = sheet.querySelector('#lab-hint');
      const botao = sheet.querySelector('[data-act="print"]');

      const atualizar = () => {
        const n = modo === 'todos' ? lista.length : marcados.size;
        botao.disabled = n === 0;
        botao.innerHTML = `${icon('print', 18)} Imprimir ${n}`;
        dica.textContent = modo === 'todos'
          ? `Sai uma folha com os ${lista.length} medidores do filtro.`
          : `${n} de ${lista.length} marcado(s).`;
      };

      sheet.querySelectorAll('[data-modo]').forEach((b) => b.onclick = () => {
        modo = b.dataset.modo;
        sheet.querySelectorAll('[data-modo]').forEach((x) => x.dataset.active = String(x === b));
        caixa.hidden = modo === 'todos';
        atualizar();
      });

      sheet.querySelectorAll('[data-tudo]').forEach((b) => b.onclick = () => {
        const marcar = b.dataset.tudo === '1';
        marcados.clear();
        sheet.querySelectorAll('[data-id]').forEach((c) => {
          c.checked = marcar;
          if (marcar) marcados.add(c.dataset.id);
        });
        atualizar();
      });

      sheet.querySelectorAll('[data-id]').forEach((c) => c.onchange = () => {
        if (c.checked) marcados.add(c.dataset.id); else marcados.delete(c.dataset.id);
        atualizar();
      });

      botao.onclick = () => {
        const alvo = modo === 'todos' ? lista : lista.filter((m) => marcados.has(m.id));
        close();
        printLabels(alvo);
      };

      atualizar();
    },
  });
}

/* ---------------- importação em massa ---------------- */

/**
 * Carga de pontos de medição por planilha. Mostra o resumo do que vai acontecer
 * antes de gravar — importação sem conferência vira faxina depois.
 */
export function importSheet(onDone) {
  let itens = [];

  const resumoHtml = () => {
    const novos = itens.filter((i) => i.acao === 'novo');
    const atualiza = itens.filter((i) => i.acao === 'atualizar');
    const ignora = itens.filter((i) => i.acao === 'ignorar');
    const unidades = new Set(itens.filter((i) => i.criaUnidade && i.acao !== 'ignorar').map((i) => i.siteNome));
    const avisos = itens.filter((i) => i.erros.length);

    return `<div class="stack" style="gap:10px">
      <div class="alert alert--info">${icon('info', 18)}<span>
        <b>${novos.length}</b> medidor(es) novo(s) · <b>${atualiza.length}</b> a atualizar${ignora.length ? ` · <b>${ignora.length}</b> ignorado(s)` : ''}
        ${unidades.size ? `<br>Serão criadas <b>${unidades.size}</b> unidade(s): ${esc([...unidades].join(', '))}` : ''}
      </span></div>
      ${avisos.length ? `<div class="alert alert--warn">${icon('alert', 18)}<span>
        <b>${avisos.length}</b> linha(s) com ressalva:<br>
        ${avisos.slice(0, 6).map((a) => `linha ${a.linha}: ${esc(a.erros.join('; '))}`).join('<br>')}
        ${avisos.length > 6 ? `<br>… e mais ${avisos.length - 6}.` : ''}
      </span></div>` : ''}
    </div>`;
  };

  openSheet({
    title: 'Importar pontos de medição',
    sub: 'Carga em massa por planilha',
    body: `<div class="stack">
      <div class="field">
        <label>1 · Monte a planilha</label>
        <span class="hint">Uma linha por medidor. A primeira linha são os títulos das colunas.
        Obrigatório só <b>Nome</b>; o resto é opcional. Colunas aceitas: Nome, Tipo, Código,
        Unidade, Local, Fator, Dígitos, Tarifa, Situação e Observação.</span>
        <button class="btn btn--sm" id="imp-modelo" style="margin-top:10px">${icon('download', 16)} Baixar modelo (.xlsx)</button>
      </div>
      <div class="field">
        <label for="imp-file">2 · Envie o arquivo</label>
        <!-- sem accept restrito de propósito: no iPhone ele esconde os arquivos
             que não batem exatamente, e a pessoa nem consegue escolher o seu.
             O formato é identificado pelo conteúdo depois de enviado. -->
        <input class="input" type="file" id="imp-file">
        <span class="hint">Aceita <b>.xlsx</b> e <b>.csv</b>. No Excel: Arquivo → Salvar como → Pasta de Trabalho do Excel (.xlsx).</span>
      </div>
      <div id="imp-resumo"></div>
    </div>`,
    actions: `<button class="btn" data-close>Cancelar</button>
      <button class="btn btn--primary" data-act="go" disabled>Importar</button>`,
    onMount(sheet, close) {
      const box = sheet.querySelector('#imp-resumo');
      const botao = sheet.querySelector('[data-act="go"]');

      sheet.querySelector('#imp-modelo').onclick = () => {
        downloadFile('modelo-pontos-de-medicao.xlsx', planilhaModelo());
      };

      sheet.querySelector('#imp-file').onchange = async (e) => {
        const file = e.target.files && e.target.files[0];
        if (!file) return;
        botao.disabled = true;
        box.innerHTML = `<div class="alert alert--info"><span class="spinner"></span><span>Lendo a planilha…</span></div>`;
        try {
          const linhas = await lerPlanilha(file);
          const lido = interpretar(linhas);
          if (lido.semCabecalho) {
            /* Mostrar os títulos que vieram poupa uma ida e volta: dá para ver
               na hora se o cabeçalho está na linha errada, se a aba lida é
               outra, ou se é só o nome da coluna que precisa mudar. */
            const achados = (lido.titulos || []).slice(0, 12);
            box.innerHTML = `<div class="alert alert--critical">${icon('alert', 18)}<span>
              Não encontrei a coluna <b>Nome</b> na primeira linha da planilha.
              ${achados.length
    ? `<br><br>Os títulos que li foram: <b>${esc(achados.join(' · '))}</b>.<br><br>
                 Renomeie a coluna do nome do ponto para <b>Nome</b> (ou <i>Medidor</i>, <i>Descrição</i>,
                 <i>Ponto de Medição</i>), ou baixe o modelo e cole os seus dados nele.`
    : '<br><br>A primeira linha veio vazia. Os títulos precisam estar na <b>linha 1</b>, sem linhas em branco nem título de relatório acima deles.'}
              </span></div>`;
            return;
          }
          itens = lido.itens;
          if (!itens.length) {
            box.innerHTML = `<div class="alert alert--warn">${icon('alert', 18)}<span>
              Li o cabeçalho (<b>${esc((lido.titulos || []).slice(0, 8).join(' · '))}</b>) mas não achei
              nenhuma linha preenchida abaixo dele. Confira se os dados estão na <b>primeira aba</b>
              da planilha.</span></div>`;
            return;
          }
          box.innerHTML = resumoHtml();
          botao.disabled = false;
        } catch (err) {
          box.innerHTML = `<div class="alert alert--critical">${icon('alert', 18)}<span>${esc(err.message || 'Não consegui ler o arquivo.')}</span></div>`;
        }
      };

      botao.onclick = async () => {
        botao.disabled = true;
        box.innerHTML = `<div class="alert alert--info"><span class="spinner"></span><span>Gravando…</span></div>`;
        try {
          const r = await aplicar(itens);
          close();
          const partes = [];
          if (r.novos) partes.push(`${r.novos} medidor(es) novo(s)`);
          if (r.atualizados) partes.push(`${r.atualizados} atualizado(s)`);
          if (r.unidades) partes.push(`${r.unidades} unidade(s) criada(s)`);
          toast(`Importação concluída — ${partes.join(', ')}.`, 'ok', 5000);
          if (onDone) onDone();
        } catch (err) {
          box.innerHTML = `<div class="alert alert--critical">${icon('alert', 18)}<span>${esc(err.message || 'Falha ao gravar.')}</span></div>`;
          botao.disabled = false;
        }
      };
    },
  });
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
      <div class="filters filters--fixas">
        <button class="chip" data-t="all" ${type === 'all' ? 'data-active="true"' : ''}>Todos</button>
        <button class="chip" data-t="energia" ${type === 'energia' ? 'data-active="true"' : ''}>${icon('bolt', 15)} Energia</button>
        <button class="chip" data-t="agua" ${type === 'agua' ? 'data-active="true"' : ''}>${icon('drop', 15)} Água</button>
        <button class="chip" id="sites">${icon('filter', 15)} Unidades (${sites.length})</button>
        <button class="chip" id="labels">${icon('print', 15)} Etiquetas QR</button>
        <button class="chip" id="import">${icon('plus', 15)} Importar planilha</button>
        <button class="chip" id="export-all">${icon('download', 15)} Exportar todos</button>
      </div>
    </div>`);
    root.appendChild(head);

    const term = query.trim().toLowerCase();
    const list = activeMeters()
      .filter((m) => type === 'all' || m.type === type)
      .filter((m) => !term || [m.name, m.code, m.location].some((v) => String(v || '').toLowerCase().includes(term)))
      .sort((a, b) => String(a.name || a.code).localeCompare(String(b.name || b.code), 'pt-BR'));

    if (!list.length) {
      /* Dizer "Nenhum medidor cadastrado" havendo centenas manda investigar o
         lado errado. Foi o que esta tela mostrou no filtro Água de um aparelho
         com 316 medidores de energia e nenhum de água: o cadastro tinha vindo
         pela metade, e a mensagem sugeria que faltava cadastrar. */
      const total = activeMeters().length;
      const nomeTipo = type === 'agua' ? 'de água' : 'de energia';
      const semNada = !total;
      const titulo = semNada ? 'Nenhum medidor cadastrado'
        : term ? 'Nada encontrado'
        : `Nenhum medidor ${nomeTipo} neste aparelho`;
      const texto = semNada
        ? 'Cadastre os relógios de energia e água que serão lidos em campo.'
        : term ? 'Ajuste a busca ou cadastre um novo medidor.'
        : `Há ${total} medidor(es) aqui, nenhum ${nomeTipo}. Se deveria haver, toque em Sincronizar no alto da tela.`;
      root.appendChild(el(`<section class="card"><div class="card__body"><div class="empty">
        ${icon('gauge', 30)}<b>${esc(titulo)}</b>
        <p>${esc(texto)}</p>
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
              <span class="item__value">${last ? esc(fmtLeitura(last.value)) : '—'}</span>
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
    head.querySelector('#import').onclick = () => importSheet(paint);
    head.querySelector('#labels').onclick = () => labelsSheet(
      activeMeters().filter((m) => type === 'all' || m.type === type)
    );

    /* Um único relatório com todos os medidores do filtro atual. O período vai
       da leitura mais antiga até hoje, para não cortar nada sem o usuário pedir. */
    head.querySelector('#export-all').onclick = () => {
      const alvo = activeMeters().filter((m) => type === 'all' || m.type === type);
      let from = todayISO();
      let leituras = 0;
      alvo.forEach((m) => {
        const rs = readingsOf(m.id);
        leituras += rs.length;
        if (rs.length && rs[0].readAt < from) from = rs[0].readAt;
      });
      if (!leituras) {
        toast('Nenhum dos medidores tem leitura para exportar.', 'info');
        return;
      }
      const rotulo = type === 'all' ? 'todos-os-medidores' : `todos-${type}`;
      openExportSheet({
        filters: { from, to: todayISO(), type, siteId: 'all', meterId: 'all' },
        nome: rotulo,
        subtitulo: `${alvo.length} medidor(es) · ${leituras} leitura(s) · desde ${fmtDate(from)}`,
      });
    };
  };

  paint();
  return { el: root, title: 'Medidores', sub: `${activeMeters().length} cadastrado(s)` };
}
