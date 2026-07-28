// Ajustes: leiturista, tarifas, alertas, nuvem, backup e instalação.

import { state, saveSettings, exportBackup, importBackup, activeMeters, marcarTudoExcluido } from './store.js';
import { idb, storageEstimate } from './db.js';
import { connect, disconnect, sync } from './api.js';
import { icon, toast, openSheet, confirmSheet } from './ui.js';
import { el, esc, downloadFile, relTime, fmt } from './utils.js';
import { installPrompt, triggerInstall, applyTheme } from './app.js';

export default async function settings() {
  const root = el('<div class="stack"></div>');
  const est = await storageEstimate();

  const paint = () => {
    root.innerHTML = '';
    const s = state.settings;

    /* --- identificação --- */
    const identity = el(`<section class="card"><div class="card__head"><div class="grow"><h2>Leiturista</h2><p>Nome gravado em cada leitura registrada neste aparelho.</p></div></div>
      <div class="card__body">
        <div class="field"><label for="s-name">Nome</label><input class="input" id="s-name" value="${esc(s.readerName)}" placeholder="Ex.: João Silva"></div>
      </div></section>`);
    identity.querySelector('#s-name').onchange = (e) => saveSettings({ readerName: e.target.value.trim() });
    root.appendChild(identity);

    /* --- nuvem --- */
    const cloud = el(`<section class="card">
      <div class="card__head"><div class="grow"><h2>Sincronização na nuvem</h2>
        <p>${s.syncEnabled ? 'Conectado ao Supabase — as leituras são compartilhadas entre os aparelhos.' : 'Desativada — os dados ficam apenas neste aparelho.'}</p></div></div>
      <div class="card__body stack">
        ${s.syncEnabled ? `
          <div class="preview-line"><span>Projeto</span><b>${esc(s.supabaseUrl)}</b></div>
          <div class="preview-line"><span>Usuário</span><b>${esc(s.serverUser || '—')}</b></div>
          <div class="preview-line"><span>Última sincronização</span><b>${esc(relTime(s.lastSyncAt))}</b></div>
          <div class="preview-line"><span>Pendentes de envio</span><b>${state.sync.pending}</b></div>
          <div class="row" style="gap:8px">
            <button class="btn btn--primary grow" id="do-sync">${icon('sync', 18)} Sincronizar agora</button>
            <button class="btn btn--danger" id="disconnect">Sair</button>
          </div>`
        : `<div class="alert alert--info">${icon('info', 18)}<span>Sem a nuvem, cada celular mantém a própria base. Entre para consolidar as leituras da equipe — cada leiturista usa o próprio e-mail e senha.</span></div>
           <button class="btn btn--primary btn--block" id="connect">${icon('sync', 18)} Entrar no Supabase</button>`}
      </div></section>`);
    root.appendChild(cloud);

    if (s.syncEnabled) {
      cloud.querySelector('#do-sync').onclick = async (e) => {
        const btn = e.currentTarget;
        btn.disabled = true;
        try { const r = await sync(); toast(r && r.applied ? `Sincronizado — ${r.applied} registro(s) atualizados.` : 'Tudo sincronizado.', 'ok'); }
        catch (err) { toast(err.message || 'Falha ao sincronizar.', 'error', 4200); }
        finally { btn.disabled = false; paint(); }
      };
      cloud.querySelector('#disconnect').onclick = async () => {
        const ok = await confirmSheet({ title: 'Sair da conta?', message: 'Os dados continuam neste aparelho, mas deixam de ser enviados ao servidor.', confirmLabel: 'Sair', danger: true });
        if (!ok) return;
        await disconnect();
        toast('Desconectado.', 'ok');
        paint();
      };
    } else {
      cloud.querySelector('#connect').onclick = () => openSheet({
        title: 'Entrar no Supabase',
        sub: 'Cada leiturista usa o próprio e-mail e senha. Os medidores e leituras são compartilhados pela equipe.',
        body: `<div class="stack">
          <div class="field"><label for="sb-url">URL do projeto</label>
            <input class="input" id="sb-url" value="${esc(s.supabaseUrl)}" placeholder="https://xxxx.supabase.co" autocomplete="off"></div>
          <div class="field"><label for="sb-key">Chave publicável (anon)</label>
            <input class="input" id="sb-key" value="${esc(s.supabaseKey)}" placeholder="sb_publishable_…" autocomplete="off">
            <span class="hint">Painel do Supabase → Project Settings → API Keys.</span></div>
          <div class="field"><label for="sb-mail">E-mail</label>
            <input class="input" id="sb-mail" type="email" autocomplete="username"></div>
          <div class="field"><label for="sb-pass">Senha</label>
            <input class="input" id="sb-pass" type="password" autocomplete="current-password"></div>
          <div class="filters" style="padding-bottom:0">
            <button type="button" class="chip" data-mode="in" data-active="true">Entrar</button>
            <button type="button" class="chip" data-mode="up">Criar conta</button>
          </div>
        </div>`,
        actions: `<button class="btn" data-close>Cancelar</button><button class="btn btn--primary" data-act="go">Conectar</button>`,
        onMount(sheet, close) {
          let signup = false;
          sheet.querySelectorAll('[data-mode]').forEach((b) => b.onclick = () => {
            signup = b.dataset.mode === 'up';
            sheet.querySelectorAll('[data-mode]').forEach((x) => x.dataset.active = String(x === b));
          });
          sheet.querySelector('[data-act="go"]').onclick = async (e) => {
            const btn = e.currentTarget;
            const url = sheet.querySelector('#sb-url').value.trim();
            const key = sheet.querySelector('#sb-key').value.trim();
            const email = sheet.querySelector('#sb-mail').value.trim();
            const password = sheet.querySelector('#sb-pass').value;
            if (!url || !key) { toast('Informe a URL e a chave do projeto.', 'error'); return; }
            if (!email || !password) { toast('Informe e-mail e senha.', 'error'); return; }
            btn.disabled = true; btn.textContent = 'Conectando…';
            try {
              await connect({ url, key, email, password, signup });
              await sync();
              toast('Conectado ao Supabase.', 'ok');
              close(); paint();
            } catch (err) {
              toast(err.message || 'Não foi possível conectar.', 'error', 5000);
              btn.disabled = false; btn.textContent = 'Conectar';
            }
          };
        },
      });
    }

    /* --- tarifas e alertas --- */
    const rates = el(`<section class="card">
      <div class="card__head"><div class="grow"><h2>Tarifas e alertas</h2><p>Usadas no custo estimado e na validação das leituras.</p></div></div>
      <div class="card__body stack">
        <div class="grid-2">
          <div class="field"><label for="t-energia">Energia (R$/kWh)</label><input class="input" id="t-energia" inputmode="decimal" value="${esc(String(s.tariff.energia))}"></div>
          <div class="field"><label for="t-agua">Água (R$/m³)</label><input class="input" id="t-agua" inputmode="decimal" value="${esc(String(s.tariff.agua))}"></div>
        </div>
        <div class="field">
          <label for="t-alert">Alerta de variação (%)</label>
          <input class="input" id="t-alert" inputmode="numeric" value="${esc(String(s.alertPct))}">
          <span class="hint">Avisa quando o consumo diário desviar acima deste percentual da média recente.</span>
        </div>
      </div></section>`);

    const ocrCard = el(`<section class="card">
      <div class="card__head"><div class="grow"><h2>Leitura pela foto</h2>
        <p>Ao fotografar o relógio, o app tenta reconhecer os dígitos e sugere o valor. Você sempre confirma antes de registrar.</p></div></div>
      <div class="card__body stack">
        <div class="filters" style="padding-bottom:0">
          <button class="chip" data-ocr="1" ${s.ocrEnabled !== false ? 'data-active="true"' : ''}>Ativado</button>
          <button class="chip" data-ocr="0" ${s.ocrEnabled === false ? 'data-active="true"' : ''}>Desativado</button>
        </div>
        <div class="alert alert--info">${icon('info', 18)}<span>Funciona com o app conectado e com internet no momento da foto — o reconhecimento roda numa Edge Function do Supabase. Sem sinal, fotografe e digite o valor; depois dá para reconhecer pelo histórico do medidor.</span></div>
        <div class="alert alert--warn">${icon('alert', 18)}<span>Relógios analógicos de ponteiros e displays com reflexo têm leitura menos confiável. <b>Sempre confira o número sugerido contra a foto.</b></span></div>
      </div></section>`);
    ocrCard.querySelectorAll('[data-ocr]').forEach((b) => b.onclick = async () => {
      await saveSettings({ ocrEnabled: b.dataset.ocr === '1' });
      paint();
    });

    const num = (v, fallback) => {
      const n = Number(String(v).replace(',', '.'));
      return Number.isFinite(n) && n >= 0 ? n : fallback;
    };
    rates.querySelector('#t-energia').onchange = (e) =>
      saveSettings({ tariff: { ...state.settings.tariff, energia: num(e.target.value, s.tariff.energia) } });
    rates.querySelector('#t-agua').onchange = (e) =>
      saveSettings({ tariff: { ...state.settings.tariff, agua: num(e.target.value, s.tariff.agua) } });
    rates.querySelector('#t-alert').onchange = (e) =>
      saveSettings({ alertPct: num(e.target.value, s.alertPct) });

    root.appendChild(rates);
    root.appendChild(ocrCard);

    /* --- aparência --- */
    const theme = el(`<section class="card">
      <div class="card__head"><div class="grow"><h2>Aparência</h2></div></div>
      <div class="card__body">
        <div class="filters" style="padding-bottom:0">
          ${[['auto', 'Automático'], ['light', 'Claro'], ['dark', 'Escuro']].map(([k, l]) =>
            `<button class="chip" data-theme="${k}" ${s.theme === k ? 'data-active="true"' : ''}>${l}</button>`).join('')}
        </div>
      </div></section>`);
    theme.querySelectorAll('[data-theme]').forEach((b) => b.onclick = async () => {
      await saveSettings({ theme: b.dataset.theme });
      applyTheme(b.dataset.theme);
      paint();
    });
    root.appendChild(theme);

    /* --- app --- */
    const installed = window.matchMedia('(display-mode: standalone)').matches || window.navigator.standalone;
    const app = el(`<section class="card">
      <div class="card__head"><div class="grow"><h2>Aplicativo</h2><p>${installed ? 'Instalado neste aparelho.' : 'Instale para usar em tela cheia e offline.'}</p></div></div>
      <div class="card__body stack">
        ${!installed ? `<button class="btn btn--block" id="install">${icon('download', 18)} Instalar no aparelho</button>` : ''}
        <div class="preview-line"><span>Medidores</span><b>${activeMeters().length}</b></div>
        <div class="preview-line"><span>Leituras</span><b>${state.readings.filter((r) => !r.deleted).length}</b></div>
        ${est ? `<div class="preview-line"><span>Espaço usado</span><b>${fmt((est.usage || 0) / 1048576, 1)} MB</b></div>` : ''}
      </div></section>`);
    const installBtn = app.querySelector('#install');
    if (installBtn) installBtn.onclick = async () => {
      if (!installPrompt()) {
        openSheet({
          title: 'Instalar o aplicativo',
          sub: 'No Android/Chrome: menu ⋮ → “Instalar aplicativo”. No iPhone/Safari: botão Compartilhar → “Adicionar à Tela de Início”.',
          actions: '<button class="btn btn--primary" data-close>Entendi</button>',
        });
        return;
      }
      const ok = await triggerInstall();
      if (ok) toast('Aplicativo instalado.', 'ok');
    };
    root.appendChild(app);

    /* --- backup --- */
    const backup = el(`<section class="card">
      <div class="card__head"><div class="grow"><h2>Cópia de segurança</h2><p>Arquivo técnico (.json) para restaurar o app noutro aparelho. <b>Não é o relatório</b> — o relatório em PDF e Excel fica no Histórico.</p></div></div>
      <div class="card__body stack">
        <div class="row" style="gap:8px">
          <button class="btn grow" id="export">${icon('download', 18)} Salvar cópia (.json)</button>
          <button class="btn grow" id="import">${icon('upload', 18)} Importar</button>
        </div>
        <input type="file" accept="application/json" id="file" hidden>
        <button class="btn btn--danger btn--block" id="wipe">${icon('trash', 18)} Apagar dados</button>
        <span class="hint">${s.syncEnabled
          ? 'Você escolhe: limpar só este celular (os dados voltam da nuvem) ou apagar de vez, aqui e na nuvem. O login e os ajustes são sempre mantidos.'
          : 'Apaga medidores, leituras e fotos deste celular. O acesso à nuvem e os ajustes são mantidos.'}</span>
      </div></section>`);
    backup.querySelector('#export').onclick = async () => {
      const json = await exportBackup();
      downloadFile(`hidroluz-backup-${new Date().toISOString().slice(0, 10)}.json`, json, 'application/json');
      toast('Backup exportado.', 'ok');
    };
    const file = backup.querySelector('#file');
    backup.querySelector('#import').onclick = () => file.click();
    file.onchange = async () => {
      const f = file.files && file.files[0];
      if (!f) return;
      try {
        const text = await f.text();
        const res = await importBackup(text);
        toast(`Importado: ${res.meters} medidor(es) e ${res.readings} leitura(s).`, 'ok', 4200);
        paint();
      } catch (e) { toast(e.message || 'Arquivo inválido.', 'error', 4200); }
      file.value = '';
    };
    /** Limpa só o aparelho — a nuvem devolve tudo na próxima sincronização. */
    const limparSoAqui = async () => {
      await idb.wipeData();
      await saveSettings({ lastSyncAt: 0 });
      location.reload();
    };

    /**
     * Apaga de vez. Marca tudo como excluído e empurra para a nuvem antes de
     * limpar aqui — do contrário o servidor devolveria os mesmos registros.
     */
    const apagarDeVez = async () => {
      const contas = await marcarTudoExcluido();
      try {
        await sync();
        await idb.wipeData();
        await saveSettings({ lastSyncAt: Date.now() });
        location.reload();
      } catch {
        // sem sinal: já sumiu da tela e a exclusão sobe quando a conexão voltar
        toast('Apagado aqui. A exclusão sobe para a nuvem assim que houver sinal — não desinstale o app antes disso.', 'info', 7000);
        paint();
      }
      return contas;
    };

    backup.querySelector('#wipe').onclick = async () => {
      const total = activeMeters().length;
      const leituras = state.readings.filter((r) => !r.deleted).length;
      const quanto = `${total} medidor(es) e ${leituras} leitura(s)`;

      if (!state.settings.syncEnabled) {
        const ok = await confirmSheet({
          title: 'Apagar os dados deste aparelho?',
          message: `${quanto} serão removidos. Como a nuvem não está conectada, não há cópia — isso não tem volta. Seus ajustes e o acesso são mantidos.`,
          confirmLabel: 'Apagar', danger: true,
        });
        if (ok) await limparSoAqui();
        return;
      }

      openSheet({
        title: 'Apagar dados',
        sub: `Hoje há ${quanto}.`,
        body: `<div class="stack">
          <div class="alert alert--info">${icon('info', 18)}
            <span>Seu login no Supabase e seus ajustes <b>não</b> são apagados em nenhuma das opções.</span></div>
          <button class="btn btn--block" data-modo="aqui">Limpar só este celular</button>
          <span class="hint" style="margin-top:-4px">Libera espaço aqui. Os dados continuam na nuvem e <b>voltam</b> na próxima sincronização.</span>
          <div class="divider"></div>
          <button class="btn btn--danger btn--block" data-modo="tudo">${icon('trash', 18)} Apagar de vez, aqui e na nuvem</button>
          <span class="hint" style="margin-top:-4px">Remove ${esc(quanto)} deste celular <b>e do servidor</b>, e de qualquer outro aparelho conectado. <b>Não tem volta.</b> Salve uma cópia antes, se quiser.</span>
        </div>`,
        actions: `<button class="btn" data-close>Cancelar</button>`,
        onMount(sheet, close) {
          sheet.querySelector('[data-modo="aqui"]').onclick = async () => { close(); await limparSoAqui(); };
          sheet.querySelector('[data-modo="tudo"]').onclick = async () => {
            close();
            const ok = await confirmSheet({
              title: 'Apagar de vez?',
              message: `${quanto} serão removidos deste celular e do servidor. Nenhum aparelho conectado vai mais ter esses dados. Isso não tem volta.`,
              confirmLabel: 'Apagar de vez', danger: true,
            });
            if (ok) await apagarDeVez();
          };
        },
      });
    };
    root.appendChild(backup);

    root.appendChild(el(`<p class="small muted" style="text-align:center;padding:8px 0 4px">HidroLuz · PWA de leitura de utilidades</p>`));
  };

  paint();
  return { el: root, title: 'Ajustes', sub: 'Configurações do aplicativo' };
}
