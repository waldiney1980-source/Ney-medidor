// Carga em massa de pontos de medição a partir de planilha (.xlsx ou .csv).
// O leitor de ZIP/XLSX é o mesmo usado no app do Almoxarifado — sem dependência
// externa, apoiado no DecompressionStream do próprio navegador.

import { activeMeters, activeSites, newMeter, saveMeter, saveSite, TYPES } from './store.js';
import { buildXlsx } from './xlsx.js';

/* ------------------------------------------------------------------ */
/* leitura do arquivo                                                  */
/* ------------------------------------------------------------------ */

async function unzip(buf) {
  const dv = new DataView(buf), u8 = new Uint8Array(buf);
  let e = -1;
  for (let i = buf.byteLength - 22; i >= 0; i--) { if (dv.getUint32(i, true) === 0x06054b50) { e = i; break; } }
  if (e < 0) throw new Error('Arquivo .xlsx inválido ou corrompido.');
  const count = dv.getUint16(e + 10, true);
  let off = dv.getUint32(e + 16, true);
  const entries = {};
  for (let i = 0; i < count; i++) {
    if (dv.getUint32(off, true) !== 0x02014b50) break;
    const method = dv.getUint16(off + 10, true);
    const csize = dv.getUint32(off + 20, true);
    const nlen = dv.getUint16(off + 28, true), elen = dv.getUint16(off + 30, true), clen = dv.getUint16(off + 32, true);
    const lho = dv.getUint32(off + 42, true);
    const name = new TextDecoder().decode(u8.subarray(off + 46, off + 46 + nlen));
    entries[name] = { method, csize, lho };
    off += 46 + nlen + elen + clen;
  }
  return {
    names: Object.keys(entries),
    async text(name) {
      const en = entries[name];
      if (!en) return null;
      const nlen = dv.getUint16(en.lho + 26, true), elen = dv.getUint16(en.lho + 28, true);
      const start = en.lho + 30 + nlen + elen;
      const data = u8.slice(start, start + en.csize);
      if (en.method === 0) return new TextDecoder().decode(data);
      if (en.method !== 8) throw new Error('Compressão do arquivo não suportada.');
      const out = await new Response(new Blob([data]).stream().pipeThrough(new DecompressionStream('deflate-raw'))).arrayBuffer();
      return new TextDecoder().decode(out);
    },
  };
}

const colunaDe = (ref) => {
  let c = 0;
  for (const ch of ref) { if (ch >= 'A' && ch <= 'Z') c = c * 26 + (ch.charCodeAt(0) - 64); else break; }
  return c - 1;
};

async function lerXlsx(buf) {
  const z = await unzip(buf);
  let shared = [];
  const ssx = await z.text('xl/sharedStrings.xml');
  if (ssx) {
    const doc = new DOMParser().parseFromString(ssx, 'application/xml');
    shared = [...doc.getElementsByTagName('si')].map((si) => [...si.getElementsByTagName('t')].map((t) => t.textContent).join(''));
  }
  let aba = 'xl/worksheets/sheet1.xml';
  if (!z.names.includes(aba)) aba = z.names.find((n) => /^xl\/worksheets\/.*\.xml$/.test(n));
  if (!aba) throw new Error('Nenhuma aba encontrada na planilha.');
  const doc = new DOMParser().parseFromString(await z.text(aba), 'application/xml');
  const linhas = [];
  for (const rowEl of doc.getElementsByTagName('row')) {
    const linha = [];
    for (const c of rowEl.getElementsByTagName('c')) {
      const ref = c.getAttribute('r') || '';
      const col = ref ? colunaDe(ref) : linha.length;
      const t = c.getAttribute('t');
      let val = '';
      if (t === 'inlineStr') {
        val = [...c.getElementsByTagName('t')].map((x) => x.textContent).join('');
      } else {
        const v = c.getElementsByTagName('v')[0];
        val = v ? v.textContent : '';
        if (t === 's') val = shared[Number(val)] ?? '';
      }
      linha[col] = val;
    }
    linhas.push(linha);
  }
  return linhas;
}

/** CSV com separador detectado pela primeira linha (ponto e vírgula ou vírgula). */
function lerCsv(texto) {
  texto = texto.replace(/^﻿/, '');
  const primeira = texto.split(/\r?\n/, 1)[0] || '';
  const sep = (primeira.match(/;/g) || []).length >= (primeira.match(/,/g) || []).length ? ';' : ',';
  const linhas = [];
  let linha = [], cur = '', aspas = false;
  for (let i = 0; i < texto.length; i++) {
    const ch = texto[i];
    if (aspas) {
      if (ch === '"') { if (texto[i + 1] === '"') { cur += '"'; i++; } else aspas = false; } else cur += ch;
    } else if (ch === '"') aspas = true;
    else if (ch === sep) { linha.push(cur); cur = ''; }
    else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && texto[i + 1] === '\n') i++;
      linha.push(cur); cur = '';
      if (linha.some((v) => v !== '')) linhas.push(linha);
      linha = [];
    } else cur += ch;
  }
  linha.push(cur);
  if (linha.some((v) => v !== '')) linhas.push(linha);
  return linhas;
}

/** Lê o arquivo escolhido e devolve as linhas cruas da planilha. */
export async function lerPlanilha(file) {
  const nome = String(file.name || '').toLowerCase();
  if (nome.endsWith('.xlsx')) return lerXlsx(await file.arrayBuffer());
  if (nome.endsWith('.csv') || nome.endsWith('.txt')) return lerCsv(await file.text());
  if (nome.endsWith('.xls')) throw new Error('Formato .xls antigo não é lido. Abra no Excel e salve como .xlsx ou .csv.');
  throw new Error('Envie um arquivo .xlsx ou .csv.');
}

/* ------------------------------------------------------------------ */
/* interpretação das colunas                                           */
/* ------------------------------------------------------------------ */

const chave = (s) => String(s || '').trim().toLowerCase()
  .normalize('NFD').replace(/[̀-ͯ]/g, '')
  .replace(/[^a-z0-9]/g, '');

/* Cada campo aceita vários cabeçalhos — a planilha do cliente raramente vem
   com o nome exato que a gente escolheu. */
const COLUNAS = {
  name:     ['nome', 'medidor', 'nomedomedidor', 'identificacao', 'descricao', 'pontodemedicao', 'ponto'],
  type:     ['tipo', 'tipodemedidor', 'grandeza', 'utilidade'],
  code:     ['codigo', 'codigodomedidor', 'numero', 'numerodomedidor', 'nserie', 'numerodeserie', 'serie'],
  site:     ['unidade', 'loja', 'cliente', 'estabelecimento', 'nomedaunidade'],
  location: ['local', 'localdeinstalacao', 'instalacao', 'localizacao', 'posicao'],
  factor:   ['fator', 'constante', 'multiplicador', 'fatordemultiplicacao'],
  digits:   ['digitos', 'casas', 'numerodedigitos'],
  tariff:   ['tarifa', 'tarifapropria', 'preco', 'valorunitario'],
  active:   ['situacao', 'ativo', 'status'],
  note:     ['observacao', 'observacoes', 'obs', 'nota'],
};

/* Segunda passada, por semelhança: cabeçalho de cliente nunca cabe numa lista
   fechada. "Nº do Medidor", por exemplo, vira "ndomedidor" ao ser normalizado
   e não bate com apelido nenhum, mas casa aqui. */
const SEMELHANTES = [
  ['code', /codigo|serie|matricula|^n.*medidor$|medidor.*n$/],
  ['type', /tipo|grandeza|utilidade/],
  ['site', /unidade|loja|cliente|estabelecimento/],
  ['location', /local|instalacao|posicao/],
  ['factor', /fator|constante|multiplic/],
  ['digits', /digito|casas/],
  ['tariff', /tarifa|preco|valor/],
  ['active', /situacao|ativo|status/],
  ['note', /observ|nota/],
  ['name', /nome|descricao|ponto|medidor/],
];

/** Descobre em que coluna está cada campo, a partir da linha de cabeçalho. */
function mapearCabecalho(linha) {
  const mapa = {};
  const usadas = new Set();

  linha.forEach((celula, i) => {
    const k = chave(celula);
    if (!k) return;
    for (const [campo, apelidos] of Object.entries(COLUNAS)) {
      if (mapa[campo] === undefined && apelidos.includes(k)) {
        mapa[campo] = i; usadas.add(i); return;
      }
    }
  });

  linha.forEach((celula, i) => {
    if (usadas.has(i)) return;
    const k = chave(celula);
    if (!k) return;
    for (const [campo, padrao] of SEMELHANTES) {
      if (mapa[campo] === undefined && padrao.test(k)) {
        mapa[campo] = i; usadas.add(i); return;
      }
    }
  });

  return mapa;
}

const ehEnergia = (v) => /energ|luz|eletr|kwh|kw/.test(chave(v));
const ehAgua = (v) => /agua|hidro|m3|agu/.test(chave(v));

/** Aceita "1.234,56" e "1,234.56" — planilhas vêm nos dois formatos. */
function numero(v) {
  if (v === null || v === undefined || v === '') return null;
  let s = String(v).trim().replace(/[^\d,.-]/g, '');
  if (!s) return null;
  const virgula = s.lastIndexOf(','), ponto = s.lastIndexOf('.');
  if (virgula > ponto) s = s.replace(/\./g, '').replace(',', '.');
  else s = s.replace(/,/g, '');
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

/**
 * Transforma as linhas da planilha em medidores prontos para gravar.
 * Não grava nada — só classifica, para a tela poder mostrar o resumo antes.
 * @returns {{itens:Array, semCabecalho:boolean, colunas:object}}
 */
export function interpretar(linhas) {
  const limpas = linhas.filter((l) => l && l.some((c) => String(c || '').trim() !== ''));
  if (!limpas.length) return { itens: [], semCabecalho: true, colunas: {} };

  const colunas = mapearCabecalho(limpas[0]);
  if (colunas.name === undefined) return { itens: [], semCabecalho: true, colunas };

  const jaTem = activeMeters();
  const sites = activeSites();
  const vistos = new Map();   // evita duplicata dentro da própria planilha
  const itens = [];

  limpas.slice(1).forEach((linha, i) => {
    const campo = (nome) => (colunas[nome] === undefined ? '' : String(linha[colunas[nome]] ?? '').trim());
    const name = campo('name');
    const code = campo('code');
    if (!name && !code) return;                       // linha vazia de verdade

    const erros = [];
    if (!name) erros.push('sem nome');

    const tipoTexto = campo('type');
    let type = 'energia';
    if (ehAgua(tipoTexto)) type = 'agua';
    else if (ehEnergia(tipoTexto)) type = 'energia';
    else if (tipoTexto) erros.push(`tipo "${tipoTexto}" não reconhecido — assumido energia`);
    else if (!tipoTexto) erros.push('tipo em branco — assumido energia');

    const siteNome = campo('site');
    const siteExistente = siteNome ? sites.find((s) => chave(s.name) === chave(siteNome)) : null;

    const fator = numero(campo('factor'));
    if (campo('factor') && fator === null) erros.push('fator inválido — usado 1');
    const digitos = numero(campo('digits'));
    const tarifa = numero(campo('tariff'));
    if (campo('tariff') && tarifa === null) erros.push('tarifa inválida — usada a padrão');

    const situacao = chave(campo('active'));
    const inativo = /^(inativo|nao|n|0|desativado|desligado|false)$/.test(situacao);

    /* Casamento com o que já existe: o código manda, porque é o número gravado
       no relógio. Sem código, cai para nome + unidade. */
    const porCodigo = code ? jaTem.find((m) => chave(m.code) === chave(code)) : null;
    const porNome = !porCodigo && name
      ? jaTem.find((m) => chave(m.name) === chave(name) && chave(siteName(m, sites)) === chave(siteNome))
      : null;
    const existente = porCodigo || porNome;

    const dedupe = chave(code) || chave(name) + '|' + chave(siteNome);
    const repetida = vistos.has(dedupe);
    if (repetida) erros.push(`repetida na planilha (linha ${vistos.get(dedupe)})`);
    else vistos.set(dedupe, i + 2);

    itens.push({
      linha: i + 2,                                   // +2: cabeçalho e base 1
      acao: repetida ? 'ignorar' : existente ? 'atualizar' : 'novo',
      erros,
      existenteId: existente ? existente.id : null,
      siteNome,
      siteId: siteExistente ? siteExistente.id : null,
      criaUnidade: !!siteNome && !siteExistente,
      dados: {
        name: name || code,
        code,
        type,
        unit: TYPES[type].unit,
        location: campo('location'),
        factor: fator && fator > 0 ? fator : 1,
        digits: digitos && digitos > 0 ? Math.round(digitos) : TYPES[type].digits,
        tariff: tarifa,
        active: inativo ? 0 : 1,
        note: campo('note'),
      },
    });
  });

  return { itens, semCabecalho: false, colunas };
}

const siteName = (meter, sites) => {
  const s = sites.find((x) => x.id === meter.siteId);
  return s ? s.name : '';
};

/**
 * Grava os itens já interpretados. Cria as unidades que ainda não existem.
 * @returns {{novos:number, atualizados:number, unidades:number}}
 */
export async function aplicar(itens) {
  const resultado = { novos: 0, atualizados: 0, unidades: 0 };
  const criadas = new Map();

  for (const item of itens) {
    if (item.acao === 'ignorar') continue;

    let siteId = item.siteId;
    if (!siteId && item.siteNome) {
      const k = chave(item.siteNome);
      if (criadas.has(k)) siteId = criadas.get(k);
      else {
        const nova = await saveSite({ name: item.siteNome });
        criadas.set(k, nova.id);
        siteId = nova.id;
        resultado.unidades++;
      }
    }

    if (item.acao === 'atualizar') {
      const atual = activeMeters().find((m) => m.id === item.existenteId);
      if (!atual) continue;
      /* Campos em branco na planilha não apagam o que já estava cadastrado. */
      const patch = { ...atual };
      Object.entries(item.dados).forEach(([k, v]) => {
        if (v === '' || v === null || v === undefined) return;
        patch[k] = v;
      });
      if (siteId) patch.siteId = siteId;
      await saveMeter(patch);
      resultado.atualizados++;
    } else {
      await saveMeter(newMeter({ ...item.dados, siteId: siteId || '' }));
      resultado.novos++;
    }
  }
  return resultado;
}

/** Planilha modelo, com os cabeçalhos que o app entende e dois exemplos. */
export function planilhaModelo() {
  const titulos = ['Nome', 'Tipo', 'Código', 'Unidade', 'Local', 'Fator', 'Dígitos', 'Tarifa', 'Situação', 'Observação'];
  const exemplo = (celulas) => ({ cells: celulas.map((v) => ({ value: v })) });
  return buildXlsx([{
    name: 'Pontos de medição',
    widths: [30, 12, 18, 22, 28, 8, 10, 10, 12, 30],
    freezeRow: 1,
    rows: [
      { cells: titulos.map((t) => ({ value: t, style: 1 })), height: 26 },
      exemplo(['Loja 12 — Energia', 'Energia', 'E-012', 'Loja 12', 'Corredor de serviço, quadro 3', 1, 8, '', 'Ativo', '']),
      exemplo(['Loja 12 — Água', 'Água', 'A-012', 'Loja 12', 'Abrigo do hidrômetro', 1, 6, '', 'Ativo', '']),
      exemplo(['Quiosque 3 — Energia', 'Energia', 'E-Q03', 'Quiosque 3', 'Praça de alimentação', 1, 8, '', 'Ativo', 'apague estas linhas de exemplo']),
    ],
  }]);
}
