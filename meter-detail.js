// Histórico completo de um medidor: evolução, consumo mensal e leituras.

import {
  meterById, readingsOf, consumptionEvents, lastReading, siteName,
  deleteReading, saveReading, meterTariff, TYPES,
} from './store.js';
import { fetchPhoto, readMeterPhoto } from './api.js';
import { columnChart } from './charts.js';
import { chartCard, kpi, icon, toast, openSheet, confirmSheet, typeColor } from './ui.js';
import { meterFormSheet, printLabels } from './meters.js';
import { openExportSheet } from './report.js';
import {
  el, esc, fmtAuto, fmtDate, fmtAxisDate, fmtMoney, monthKey, monthLabel,
  todayISO, daysBetween,
} from './utils.js';

/**
 * Mostra a foto e permite rodar o reconhecimento depois — o caso de quem
 * fotografou em campo sem sinal e só agora está conectado.
 */
async function showPhoto(photoId, meter, reading, onApplied) {
  const rec = await fetchPhoto(photoId);
  if (!rec || !rec.data) { toast('Foto não disponível neste aparelho.', 'info'); return; }
  openSheet({
    title: 'Foto da leitura',
    sub: `${fmtDate(reading.readAt)} · registrado ${fmtAuto(reading.value)} ${TYPES[meter.type].unit}`,
    body: `<img src="${rec.data}" alt="Foto do medidor" style="width:100%;border-radius:12px;display:block">
           <div id="ph-ocr" style="margin-top:12px"></div>`,
    actions: `<button class="btn" data-close>Fechar</button>
              <button class="btn btn--primary" data-act="ocr">${icon('camera', 18)} Ler valor da foto</button>`,
    onMount(sheet, close) {
      const box = sheet.querySelector('#ph-ocr');
      sheet.querySelector('[data-act="ocr"]').onclick = async (e) => {
        const btn = e.currentTarget;
        btn.disabled = true;
        box.innerHTML = `<div class="alert alert--info"><span class="spinner"></span><span>Lendo o valor na foto…</span></div>`;
        try {
          const res = await readMeterPhoto({ image: rec.data, type: meter.type, digits: meter.digits });
          if (res && res.legible && res.value) {
            const val = Number(String(res.value).replace(/^0+(?=\d)/, ''));
            const same = Math.abs(val - Number(reading.value)) < 0.0005;
            box.innerHTML = `<div class="alert alert--${same ? 'good' : 'warn'}">${icon(same ? 'check' : 'alert', 18)}
                <span><b>Foto indica ${fmtAuto(val)} ${TYPES[meter.type].unit}</b><br>
                ${same ? 'Confere com o valor registrado.' : `O registro atual é ${fmtAuto(reading.value)} ${TYPES[meter.type].unit}.`}</span></div>
              ${same ? '' : `<button class="btn btn--sm btn--primary" id="apply" style="margin-top:8px">Corrigir para ${fmtAuto(val)}</button>`}`;
            const apply = box.querySelector('#apply');
            if (apply) apply.onclick = async () => {
              await saveReading({ ...reading, value: val });
              toast('Leitura corrigida.', 'ok');
              close();
              if (onApplied) onApplied();
            };
          } else {
            box.innerHTML = `<div class="alert alert--warn">${icon('alert', 18)}<span>Não deu para ler os dígitos com segurança nesta foto. Ajuste o valor manualmente pelo botão de edição.</span></div>`;
          }
        } catch (err) {
          box.innerHTML = `<div class="alert alert--critical">${icon('alert', 18)}<span>${esc(err.message || 'Falha no reconhecimento.')}</span></div>`;
        }
        btn.disabled = false;
      };
    },
  });
}

export default async function meterDetail({ params, navigate }) {
  const meter = meterById(params[0]);
  const root = el('<div class="stack"></div>');

  if (!meter || meter.deleted) {
    root.innerHTML = `<div class="empty"><b>Medidor não encontrado</b><p>Ele pode ter sido excluído.</p></div>`;
    return { el: root, title: 'Medidor' };
  }

  const unit = TYPES[meter.type].unit;
  const color = typeColor(meter.type);
  const factor = Number(meter.factor) > 0 ? Number(meter.factor) : 1;

  const paint = () => {
    root.innerHTML = '';
    const readings = readingsOf(meter.id);
    const events = consumptionEvents(meter.id);
    const last = lastReading(meter.id);
    const valid = events.filter((e) => e.consumption !== null);
    const tariff = meterTariff(meter);

    /* --- cabeçalho --- */
    const header = el(`<section class="card">
      <div class="card__body stack">
        <div class="row">
          <span class="item__icon" style="background:${color};width:44px;height:44px">${icon(meter.type === 'agua' ? 'drop' : 'bolt', 24)}</span>
          <span class="grow item__main">
            <span class="item__title" style="font-size:16px">${esc(meter.name || meter.code)}</span>
            <span class="item__sub">${esc([TYPES[meter.type].label, meter.code, siteName(meter.siteId), meter.location].filter(Boolean).join(' · '))}</span>
          </span>
        </div>
        ${meter.note ? `<p class="small muted">${esc(meter.note)}</p>` : ''}
        <div class="row" style="gap:8px;flex-wrap:wrap">
          <span class="badge"><span class="dot" style="background:${color}"></span>${esc(unit)}</span>
          ${Number(meter.factor) !== 1 ? `<span class="badge">fator ×${esc(fmtAuto(meter.factor))}</span>` : ''}
          <span class="badge">${meter.digits} dígitos</span>
          ${tariff ? `<span class="badge">${esc(fmtMoney(tariff))}/${esc(unit)}</span>` : ''}
          ${meter.active ? '' : '<span class="badge">inativo</span>'}
        </div>
        <div class="row" style="gap:8px;flex-wrap:wrap">
          <button class="btn btn--primary grow" id="new">${icon('plus', 18)} Nova leitura</button>
          <button class="btn" id="edit" aria-label="Editar medidor">${icon('edit', 18)}</button>
          <button class="btn" id="label" aria-label="Imprimir etiqueta">${icon('print', 18)}</button>
          <button class="btn" id="csv" aria-label="Exportar relatório">${icon('download', 18)}</button>
        </div>
      </div>
    </section>`);
    root.appendChild(header);
    header.querySelector('#new').onclick = () => navigate('ler/' + meter.id);
    header.querySelector('#edit').onclick = () => meterFormSheet(meter, () => {
      const fresh = meterById(meter.id);
      if (!fresh || fresh.deleted) navigate('medidores'); else paint();
    });
    header.querySelector('#label').onclick = () => printLabels([meter]);
    header.querySelector('#csv').onclick = () => {
      const all = readingsOf(meter.id);
      const from = all.length ? all[0].readAt : todayISO();
      openExportSheet({
        filters: { from, to: todayISO(), type: 'all', siteId: 'all', meterId: meter.id },
        nome: `relatorio-${meter.code || meter.name}`,
        subtitulo: `${meter.name || meter.code} · ${all.length} leitura(s)`,
      });
    };

    /* --- KPIs --- */
    const last12 = valid.filter((e) => e.readAt >= todayISO().slice(0, 4) + '-01-01' || daysBetween(e.readAt, todayISO()) <= 365);
    const total12 = last12.reduce((s, e) => s + e.consumption, 0);
    const lastEvent = valid.length ? valid[valid.length - 1] : null;
    const avgDay = valid.length
      ? valid.slice(-6).reduce((s, e) => s + e.perDay, 0) / Math.min(6, valid.length)
      : null;

    root.appendChild(el(`<div class="kpis">
      ${kpi({ label: 'Última leitura', value: last ? fmtAuto(last.value) : '—', unit: last ? unit : '', deltaLabel: last ? fmtDate(last.readAt) : 'nenhuma leitura' })}
      ${kpi({ label: 'Último consumo', value: lastEvent ? fmtAuto(lastEvent.consumption) : '—', unit: lastEvent ? unit : '', deltaLabel: lastEvent ? `${lastEvent.days} dia(s)` : '—', colorVar: color })}
      ${kpi({ label: 'Média diária', value: avgDay !== null ? fmtAuto(avgDay) : '—', unit: avgDay !== null ? unit + '/dia' : '', deltaLabel: 'últimas 6 leituras' })}
      ${kpi({ label: 'Últimos 12 meses', value: fmtAuto(total12), unit, deltaLabel: tariff ? fmtMoney(total12 * tariff) : `${valid.length} período(s)` })}
    </div>`));

    /* --- gráficos --- */
    if (valid.length) {
      const perReading = valid.slice(-24).map((e) => ({
        key: e.readAt, label: fmtAxisDate(e.readAt), full: `${fmtDate(e.fromAt)} → ${fmtDate(e.readAt)}`, value: e.consumption,
      }));
      root.appendChild(chartCard({
        title: 'Consumo por leitura',
        subtitle: factor !== 1
          ? `Diferença entre leituras × fator ${fmtAuto(factor)} · ${unit}`
          : `Diferença entre leituras consecutivas · ${unit}`,
        unit,
        rows: perReading.map((p) => ({ label: p.full, value: `${fmtAuto(p.value)} ${unit}` })),
        render: (wrap) => columnChart(wrap, { data: perReading, unit, color, height: 190 }),
      }));

      const byMonth = new Map();
      valid.forEach((e) => {
        const k = monthKey(e.readAt);
        byMonth.set(k, (byMonth.get(k) || 0) + e.consumption);
      });
      const months = [...byMonth.entries()].sort((a, b) => a[0].localeCompare(b[0])).slice(-12)
        .map(([k, v]) => ({ key: k, label: monthLabel(k), full: monthLabel(k), value: v }));
      if (months.length > 1) {
        root.appendChild(chartCard({
          title: 'Consumo mensal',
          subtitle: `Últimos ${months.length} meses · ${unit}`,
          unit,
          rows: months.map((m) => ({ label: m.label, value: `${fmtAuto(m.value)} ${unit}` })),
          render: (wrap) => columnChart(wrap, { data: months, unit, color, height: 190 }),
        }));
      }
    }

    /* --- tabela de leituras --- */
    const evByReading = new Map(events.map((e) => [e.id, e]));
    const rows = [...readings].reverse();
    const table = el(`<section class="card">
      <div class="card__head"><div class="grow"><h2>Leituras registradas</h2>
        <p>${rows.length} registro(s)${factor !== 1 ? ` · consumo = diferença × ${fmtAuto(factor)}` : ''}</p></div></div>
      <div class="card__body">
        ${rows.length ? `<div class="table-scroll"><table class="data-table">
          <thead><tr><th>Data</th><th>Leitura</th>${factor !== 1 ? '<th>Diferença</th>' : ''}<th>Consumo</th><th>Dias</th><th></th></tr></thead>
          <tbody>${rows.map((r) => {
            const ev = evByReading.get(r.id);
            const has = ev && ev.consumption !== null;
            return `<tr data-r="${r.id}">
              <td>${esc(fmtDate(r.readAt))}${r.readerName ? `<br><span class="muted" style="font-size:11px">${esc(r.readerName)}</span>` : ''}</td>
              <td>${esc(fmtAuto(r.value))}</td>
              ${factor !== 1 ? `<td>${has ? esc(fmtAuto(ev.consumption / factor)) : '—'}</td>` : ''}
              <td>${has ? esc(fmtAuto(ev.consumption)) : '—'}</td>
              <td>${ev ? ev.days : '—'}</td>
              <td style="white-space:nowrap">
                ${r.photoId ? `<button class="icon-btn" data-photo="${r.photoId}" style="width:30px;height:30px" aria-label="Ver foto">${icon('camera', 16)}</button>` : ''}
                <button class="icon-btn" data-edit="${r.id}" style="width:30px;height:30px" aria-label="Editar">${icon('edit', 16)}</button>
                <button class="icon-btn" data-del="${r.id}" style="width:30px;height:30px" aria-label="Excluir">${icon('trash', 16)}</button>
              </td>
            </tr>${r.note ? `<tr><td colspan="${factor !== 1 ? 6 : 5}" class="muted" style="font-size:11.5px;padding-top:0">${esc(r.note)}</td></tr>` : ''}`;
          }).join('')}</tbody>
        </table></div>` : '<div class="empty"><p>Nenhuma leitura registrada ainda.</p></div>'}
      </div>
    </section>`);
    root.appendChild(table);

    table.querySelectorAll('[data-photo]').forEach((b) => b.onclick = () => {
      const reading = rows.find((r) => r.photoId === b.dataset.photo);
      showPhoto(b.dataset.photo, meter, reading, paint);
    });
    table.querySelectorAll('[data-edit]').forEach((b) => b.onclick = () => navigate(`ler/${meter.id}/${b.dataset.edit}`));
    table.querySelectorAll('[data-del]').forEach((b) => b.onclick = async () => {
      const ok = await confirmSheet({ title: 'Excluir leitura?', message: 'O consumo calculado será recalculado a partir das leituras restantes.', confirmLabel: 'Excluir', danger: true });
      if (!ok) return;
      await deleteReading(b.dataset.del);
      toast('Leitura excluída.', 'ok');
      paint();
    });
  };


  paint();
  return { el: root, title: meter.name || meter.code, sub: TYPES[meter.type].label + (meter.location ? ' · ' + meter.location : '') };
}
