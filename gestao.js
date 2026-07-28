// Camada gerencial: segmento do negócio, sugestões de economia e limites de
// consumo com aviso ao proprietário.

import { state, activeMeters, consumptionEvents, meterTariff, TYPES } from './store.js';
import { fmtAuto, fmtMoney, fmtDate, monthKey } from './utils.js';

/* ---------------- segmentos ---------------- */

/**
 * Cada segmento traz o que costuma pesar na conta e o que dá para fazer.
 * `energia` e `agua` são listas de sugestões; `geral` vale para todos.
 */
export const SEGMENTS = {
  '': { label: 'Não informado', energia: [], agua: [] },

  padaria: {
    label: 'Padaria / confeitaria',
    energia: [
      'O forno é quase sempre o maior gasto. Ligue já com a produção pronta para entrar e evite reaquecer com a câmara vazia.',
      'Câmaras frias e balcões refrigerados: confira as borrachas de vedação. Uma porta que não fecha direito faz o motor trabalhar o dia inteiro.',
      'Degele o freezer quando a camada de gelo passar de meio dedo — gelo acumulado aumenta muito o consumo do compressor.',
      'Concentre o forno fora do horário de ponta (geralmente 18h às 21h) quando a tarifa da sua distribuidora for diferenciada.',
    ],
    agua: [
      'Torneira de lavagem de formas com fechamento automático evita o desperdício entre uma peça e outra.',
      'Reaproveite a água do resfriamento (quando houver) para a limpeza do piso.',
    ],
  },

  restaurante: {
    label: 'Restaurante / lanchonete',
    energia: [
      'Chapa e fritadeira ligadas o dia todo são o gasto invisível. Defina horário para ligar e desligar entre os picos de movimento.',
      'A coifa puxa ar refrigerado para fora. Use só durante o preparo, não o expediente inteiro.',
      'Câmara fria: verifique vedação e não deixe a porta aberta durante o abastecimento — organize antes de abrir.',
      'Troque as lâmpadas do salão por LED e use o ar-condicionado em 23 ºC; cada grau a menos custa cerca de 8% a mais.',
    ],
    agua: [
      'Pré-lave a louça com rodo e balde antes da torneira aberta — a lavagem contínua é o maior consumo da cozinha.',
      'Arejadores nas torneiras da pia reduzem o fluxo sem atrapalhar o trabalho.',
      'Verifique o vaso sanitário do banheiro de clientes: vazamento silencioso em caixa acoplada passa despercebido por meses.',
    ],
  },

  mercado: {
    label: 'Mercado / mercearia',
    energia: [
      'Balcões e ilhas de congelados respondem pela maior fatia. Nunca ultrapasse a linha de carga máxima — produto acima dela bloqueia o ar frio.',
      'Instale cortinas de ar ou tampas noturnas nas ilhas abertas: reduzem bastante o consumo fora do horário de atendimento.',
      'Limpe os condensadores dos refrigeradores a cada três meses; poeira faz o motor puxar mais corrente.',
      'Iluminação em LED dentro dos balcões esquenta menos e alivia o trabalho da refrigeração.',
    ],
    agua: [
      'Hortifruti: use borrifador em vez de mangueira para manter os produtos frescos.',
      'Confira o sistema de degelo — dreno entupido às vezes mascara vazamento.',
    ],
  },

  acougue: {
    label: 'Açougue / frios',
    energia: [
      'Câmara fria bem vedada e com cortina de PVC na porta economiza o dia inteiro.',
      'Programe o degelo automático para a madrugada, fora do horário de ponta.',
      'Serras e moedores ligados em vazio consomem sem produzir — desligue entre um atendimento e outro.',
    ],
    agua: [
      'Lavagem de piso com mangueira aberta é o maior consumo. Use vassoura e balde antes e mangueira com esguicho de pressão só no final.',
      'Torneiras com pedal na área de manipulação evitam torneira esquecida aberta.',
    ],
  },

  bar: {
    label: 'Bar / distribuidora',
    energia: [
      'Chopeira e cervejeiras: mantenha longe de parede quente e do sol, com pelo menos 10 cm de folga atrás para o ar circular.',
      'Freezers antigos consomem muito mais que os novos. Se algum tem mais de 10 anos, faça a conta de trocar.',
      'Letreiros e luminosos em LED com temporizador desligam sozinhos na hora de fechar.',
    ],
    agua: [
      'Lavagem de copos: cuba com água acumulada gasta menos que jato contínuo.',
      'Verifique o banheiro dos clientes semanalmente — é onde os vazamentos aparecem.',
    ],
  },

  salao: {
    label: 'Salão de beleza / barbearia',
    energia: [
      'Secadores e chapinhas ligados em standby aquecem à toa. Desligue da tomada entre clientes.',
      'Aquecedor de água elétrico do lavatório: use boiler com termostato em vez de torneira elétrica no máximo.',
      'Iluminação de espelho em LED dá a mesma qualidade de luz com uma fração do consumo.',
    ],
    agua: [
      'A lavagem de cabelo é o principal consumo. Um redutor de vazão no chuveirinho corta boa parte sem incomodar o cliente.',
      'Feche a água enquanto aplica o produto — o hábito, repetido, aparece na conta.',
    ],
  },

  lavanderia: {
    label: 'Lavanderia',
    energia: [
      'Só ligue máquina e secadora com carga cheia; meia carga consome quase o mesmo.',
      'Limpe o filtro de fiapos da secadora a cada ciclo — filtro sujo alonga a secagem e o consumo.',
      'Programe os ciclos pesados fora do horário de ponta.',
    ],
    agua: [
      'Máquinas de reuso de água do último enxágue para o primeiro do ciclo seguinte pagam o investimento rápido nesse ramo.',
      'Verifique mangueiras e conexões mensalmente: gotejamento constante é volume grande no fim do mês.',
    ],
  },

  oficina: {
    label: 'Oficina / mecânica',
    energia: [
      'Compressor de ar é o vilão: qualquer vazamento na linha faz ele ligar sozinho a noite toda. Feche o registro ao fechar a oficina.',
      'Solda e elevador puxam muita corrente na partida — evite ligar tudo ao mesmo tempo.',
      'Iluminação alta em galpão: troque por LED de galpão, a diferença é grande.',
    ],
    agua: [
      'Lavagem de peças e de veículos: use pistola com gatilho, nunca mangueira livre.',
      'Considere reaproveitar a água de lavagem com caixa separadora — além de economizar, atende a exigência ambiental.',
    ],
  },

  academia: {
    label: 'Academia',
    energia: [
      'Esteiras ligadas sem uso consomem. Configure desligamento automático por inatividade.',
      'Ar-condicionado em 23 ºC com ventiladores de teto circulando o ar rende mais que baixar a temperatura.',
      'Som e TVs em standby somam bastante ao longo do mês — use régua com interruptor.',
    ],
    agua: [
      'Chuveiros do vestiário são o maior consumo. Registro temporizado ou de pressão limita o banho longo.',
      'Torneiras com fechamento automático nas pias evitam torneira aberta esquecida.',
    ],
  },

  hotel: {
    label: 'Hotel / pousada',
    energia: [
      'Chave de cartão no quarto corta luz e ar-condicionado quando o hóspede sai.',
      'Aquecimento de água costuma ser o segundo maior gasto — avalie aquecimento solar com apoio elétrico.',
      'Áreas comuns com sensor de presença nos corredores e escadas.',
    ],
    agua: [
      'Chuveiros e torneiras com redutor de vazão passam despercebidos pelo hóspede e cortam bastante consumo.',
      'Programa de reuso de toalhas reduz lavanderia, que é água e energia ao mesmo tempo.',
      'Faça leitura semanal: em hotel, um vazamento em quarto vazio só aparece na conta.',
    ],
  },

  clinica: {
    label: 'Clínica / consultório',
    energia: [
      'Autoclave e equipamentos de imagem só ligados quando houver procedimento agendado.',
      'Ar-condicionado com manutenção em dia e filtro limpo consome bem menos.',
      'Computadores em modo de suspensão automática após 15 minutos.',
    ],
    agua: [
      'Torneiras de pia com sensor ou fechamento automático nos consultórios.',
      'Monitore o consumo mensal: em clínica, aumento sem novos procedimentos indica vazamento.',
    ],
  },

  escritorio: {
    label: 'Escritório',
    energia: [
      'Ar-condicionado em 23 ºC e desligado 30 minutos antes do fim do expediente — o ambiente segue confortável.',
      'Régua com interruptor nas estações desliga monitores e carregadores de vez à noite.',
      'Sensor de presença em copa, banheiros e sala de reunião.',
      'Se possível, contrate a modalidade tarifária adequada ao seu perfil de uso junto à distribuidora.',
    ],
    agua: [
      'Copa e banheiros concentram o consumo — arejadores e descarga de duplo acionamento resolvem a maior parte.',
      'Registro geral fechado no fim de semana evita vazamento correndo solto por dois dias.',
    ],
  },

  loja: {
    label: 'Loja / varejo',
    energia: [
      'Vitrine iluminada com LED e temporizador para desligar depois do horário de circulação na rua.',
      'Porta aberta com ar-condicionado ligado joga dinheiro fora — use cortina de ar se precisar manter aberta.',
      'Provadores e depósito com sensor de presença.',
    ],
    agua: [
      'O consumo costuma ser baixo; se subir sem motivo, o problema quase sempre é o banheiro. Verifique a caixa acoplada.',
    ],
  },

  farmacia: {
    label: 'Farmácia',
    energia: [
      'Geladeira de termolábeis precisa ficar ligada, mas o resto não: iluminação de gôndola em LED e letreiro com temporizador.',
      'Ar-condicionado dimensionado corretamente; aparelho pequeno demais trabalha sem parar e gasta mais que um adequado.',
    ],
    agua: [
      'Consumo baixo por natureza. Leitura mensal serve principalmente para detectar vazamento cedo.',
    ],
  },

  escola: {
    label: 'Escola / creche',
    energia: [
      'Salas vazias com luz e ventilador ligados são o desperdício mais comum — designe um responsável por turno.',
      'Iluminação em LED e aproveitamento de luz natural nas salas com janela.',
      'Bebedouros refrigerados: desligue no período de férias.',
    ],
    agua: [
      'Torneiras de banheiro infantil com fechamento automático evitam torneira aberta.',
      'Faça leitura na sexta e na segunda: diferença durante o fim de semana fechado é vazamento certo.',
    ],
  },

  igreja: {
    label: 'Igreja / associação',
    energia: [
      'O consumo se concentra nos dias de culto/evento. Confira se ar-condicionado e som ficam desligados nos demais dias.',
      'Iluminação em LED no salão principal tem retorno rápido pelo número de pontos.',
    ],
    agua: [
      'Leitura semanal ajuda a separar o consumo dos dias de evento do vazamento contínuo.',
    ],
  },

  residencia: {
    label: 'Residência',
    energia: [
      'Chuveiro elétrico é o maior consumo da casa: cada 5 minutos a menos por banho já aparece na conta.',
      'Geladeira longe do fogão e do sol, com folga atrás, e borracha da porta em bom estado.',
      'Aparelhos em standby (TV, micro-ondas, roteador antigo) somam o mês inteiro.',
    ],
    agua: [
      'Vazamento em caixa acoplada é o campeão. Teste: pingue corante no reservatório e veja se colore o vaso sem dar descarga.',
      'Lave o carro com balde, não com mangueira.',
    ],
  },

  outro: { label: 'Outro', energia: [], agua: [] },
};

/** Sugestões que valem para qualquer negócio. */
const GERAIS = {
  energia: [
    'Compare a leitura do seu medidor com a conta da distribuidora todo mês — divergência precisa ser contestada dentro do prazo.',
    'Registre a leitura sempre no mesmo dia do mês: períodos de tamanhos diferentes atrapalham a comparação.',
  ],
  agua: [
    'Teste de vazamento: feche todas as torneiras, anote a leitura e confira 1 hora depois. Se mudou, há vazamento.',
    'Leia o hidrômetro no fim do expediente e na abertura do dia seguinte; com tudo fechado o número não pode subir.',
  ],
};

export const segmentLabel = (s) => (SEGMENTS[s] || SEGMENTS['']).label;

/**
 * Sugestões para uma unidade, filtradas pelos tipos de medidor que ela tem.
 * @returns {{energia: string[], agua: string[]}}
 */
export function sugestoes(segment, tipos = ['energia', 'agua']) {
  const seg = SEGMENTS[segment] || SEGMENTS[''];
  const out = { energia: [], agua: [] };
  for (const t of ['energia', 'agua']) {
    if (!tipos.includes(t)) continue;
    out[t] = [...(seg[t] || []), ...GERAIS[t]];
  }
  return out;
}

/* ---------------- limites de consumo ---------------- */

/** Consumo do mês corrente, por unidade e tipo. */
export function consumoDoMes(mes = monthKey(new Date().toISOString().slice(0, 10))) {
  const porUnidade = new Map();
  for (const meter of activeMeters()) {
    const tariff = meterTariff(meter);
    let total = 0;
    for (const e of consumptionEvents(meter.id)) {
      if (e.consumption === null) continue;
      if (monthKey(e.readAt) !== mes) continue;
      total += e.consumption;
    }
    if (!total) continue;
    const key = meter.siteId || '';
    if (!porUnidade.has(key)) porUnidade.set(key, { energia: 0, agua: 0, custo: 0, medidores: [] });
    const u = porUnidade.get(key);
    u[meter.type] += total;
    u.custo += total * tariff;
    u.medidores.push({ meter, total, custo: total * tariff });
  }
  return porUnidade;
}

const num = (v) => { const n = Number(v); return Number.isFinite(n) && n > 0 ? n : 0; };

/**
 * Unidades que passaram do limite configurado no mês.
 * @returns {Array} { site, tipo, consumido, limite, excesso, pct, custo, unidade }
 */
const mesAnterior = (mes) => {
  const d = new Date(mes + '-15T12:00:00');
  d.setMonth(d.getMonth() - 1);
  return monthKey(d.toISOString().slice(0, 10));
};

export function estouros(mes = monthKey(new Date().toISOString().slice(0, 10))) {
  const porUnidade = consumoDoMes(mes);
  const out = [];

  for (const site of state.sites.filter((s) => !s.deleted)) {
    const u = porUnidade.get(site.id);
    if (!u) continue;

    // limites fixos: valor absoluto que não deve ser passado no mês
    const checar = [
      { tipo: 'energia', limite: num(site.limitEnergia), consumido: u.energia, unidade: 'kWh' },
      { tipo: 'agua', limite: num(site.limitAgua), consumido: u.agua, unidade: 'm³' },
      { tipo: 'custo', limite: num(site.limitCost), consumido: u.custo, unidade: 'R$' },
    ];
    for (const c of checar) {
      if (!c.limite || c.consumido <= c.limite) continue;
      out.push({
        site, ...c,
        excesso: c.consumido - c.limite,
        pct: ((c.consumido - c.limite) / c.limite) * 100,
        detalhe: u, mes,
      });
    }

    // Limite por percentual: compara UMA LEITURA COM A ANTERIOR, medidor a
    // medidor. Com 10% e consumo anterior de 100, o teto é 110 — 111 dispara.
    // É por leitura, e não por mês, para valer já na segunda leitura.
    const aumento = num(site.limitPct);
    if (!aumento) continue;

    for (const meter of activeMeters().filter((m) => (m.siteId || '') === site.id)) {
      const eventos = consumptionEvents(meter.id).filter((e) => e.consumption !== null);
      if (eventos.length < 2) continue;

      const ultimo = eventos[eventos.length - 1];
      const penultimo = eventos[eventos.length - 2];
      const base = penultimo.consumption;
      if (!(base > 0)) continue;

      const teto = base * (1 + aumento / 100);
      if (ultimo.consumption <= teto) continue;

      out.push({
        site, meter,
        tipo: meter.type,
        unidade: TYPES[meter.type].unit,
        consumido: ultimo.consumption,
        limite: teto,
        excesso: ultimo.consumption - teto,
        pct: ((ultimo.consumption - teto) / teto) * 100,
        // dados que só o alarme por percentual tem
        porPercentual: true,
        aumentoAceito: aumento,
        base,
        subiu: ((ultimo.consumption - base) / base) * 100,
        dias: ultimo.days,
        diasBase: penultimo.days,
        lidoEm: ultimo.readAt,
        detalhe: u,
        mes: monthKey(ultimo.readAt),
      });
    }
  }
  return out.sort((a, b) => b.pct - a.pct);
}

const rotuloTipo = (t) => (t === 'custo' ? 'Custo estimado' : TYPES[t] ? TYPES[t].label : t);
const valor = (e) => (e.tipo === 'custo' ? fmtMoney(e.consumido) : `${fmtAuto(e.consumido)} ${e.unidade}`);
const valorLim = (e) => (e.tipo === 'custo' ? fmtMoney(e.limite) : `${fmtAuto(e.limite)} ${e.unidade}`);

/** Texto do aviso, o mesmo para WhatsApp e e-mail. */
export function mensagemAviso(estouro) {
  const { site } = estouro;
  const nomeMes = new Date(estouro.mes + '-02').toLocaleDateString('pt-BR', { month: 'long', year: 'numeric' });
  const linhas = estouro.porPercentual
    ? [
        `Aviso de consumo — ${site.name}`,
        '',
        `${estouro.meter.name || estouro.meter.code} (${rotuloTipo(estouro.tipo)})`,
        `Leitura de ${fmtDate(estouro.lidoEm)}: ${valor(estouro)} em ${estouro.dias} dia(s).`,
        `Na leitura anterior foram ${fmtAuto(estouro.base)} ${estouro.unidade} em ${estouro.diasBase} dia(s) — subiu ${estouro.subiu.toFixed(0)}%.`,
        `O aumento combinado é de até ${estouro.aumentoAceito}%, o que daria ${valorLim(estouro)}.`,
        '',
      ]
    : [
        `Aviso de consumo — ${site.name}`,
        '',
        `${rotuloTipo(estouro.tipo)} em ${nomeMes} já está em ${valor(estouro)}.`,
        `O limite combinado é ${valorLim(estouro)} — ultrapassou ${estouro.pct.toFixed(0)}%.`,
        '',
      ];

  const medidores = (estouro.detalhe.medidores || [])
    .filter((m) => estouro.tipo === 'custo' || m.meter.type === estouro.tipo)
    .sort((a, b) => b.total - a.total)
    .slice(0, 4);
  if (medidores.length) {
    linhas.push('Onde está o consumo:');
    medidores.forEach((m) => {
      linhas.push(`• ${m.meter.name || m.meter.code}: ${fmtAuto(m.total)} ${TYPES[m.meter.type].unit}`
        + (m.custo ? ` (${fmtMoney(m.custo)})` : ''));
    });
    linhas.push('');
  }

  const dicas = sugestoes(site.segment, estouro.tipo === 'custo' ? ['energia', 'agua'] : [estouro.tipo]);
  const primeiras = [...dicas.energia.slice(0, 2), ...dicas.agua.slice(0, 2)];
  if (primeiras.length) {
    linhas.push('Sugestões para reduzir:');
    primeiras.forEach((d) => linhas.push(`• ${d}`));
    linhas.push('');
  }

  linhas.push(`Enviado por ${state.settings.readerName || 'HidroLuz'} em ${fmtDate(new Date().toISOString().slice(0, 10))}.`);
  return linhas.join('\n');
}

/* ---------------- resumo do mês (sem depender de estouro) ---------------- */

/** Números do mês para uma unidade, com o mês anterior para comparação. */
export function resumoMensal(site, mes = monthKey(new Date().toISOString().slice(0, 10))) {
  const anterior = (() => {
    const d = new Date(mes + '-15T12:00:00');
    d.setMonth(d.getMonth() - 1);
    return monthKey(d.toISOString().slice(0, 10));
  })();

  const doMes = consumoDoMes(mes).get(site.id) || { energia: 0, agua: 0, custo: 0, medidores: [] };
  const doAnterior = consumoDoMes(anterior).get(site.id) || { energia: 0, agua: 0, custo: 0 };

  const variacao = (a, b) => (b > 0 ? ((a - b) / b) * 100 : null);
  return {
    site, mes, anterior,
    energia: doMes.energia, agua: doMes.agua, custo: doMes.custo,
    medidores: doMes.medidores,
    varEnergia: variacao(doMes.energia, doAnterior.energia),
    varAgua: variacao(doMes.agua, doAnterior.agua),
    varCusto: variacao(doMes.custo, doAnterior.custo),
    limites: [
      { rotulo: 'Energia', unidade: 'kWh', usado: doMes.energia, limite: num(site.limitEnergia) },
      { rotulo: 'Água', unidade: 'm³', usado: doMes.agua, limite: num(site.limitAgua) },
      { rotulo: 'Custo estimado', unidade: 'R$', usado: doMes.custo, limite: num(site.limitCost) },
    ].filter((l) => l.limite > 0),
  };
}

const pct = (v) => (v === null ? '' : ` (${v >= 0 ? '+' : '-'}${Math.abs(v).toFixed(0)}% vs. mês anterior)`);

/** Resumo do mês em texto, para mandar ao proprietário a qualquer momento. */
export function mensagemResumo(site, mes) {
  const r = resumoMensal(site, mes);
  const nomeMes = new Date(r.mes + '-15T12:00:00').toLocaleDateString('pt-BR', { month: 'long', year: 'numeric' });
  const linhas = [`Consumo de ${site.name} — ${nomeMes}`, ''];

  if (r.energia) linhas.push(`Energia: ${fmtAuto(r.energia)} kWh${pct(r.varEnergia)}`);
  if (r.agua) linhas.push(`Água: ${fmtAuto(r.agua)} m³${pct(r.varAgua)}`);
  if (r.custo) linhas.push(`Custo estimado: ${fmtMoney(r.custo)}${pct(r.varCusto)}`);
  if (!r.energia && !r.agua) linhas.push('Ainda não há leitura registrada neste mês.');
  linhas.push('');

  for (const l of r.limites) {
    const usado = l.rotulo === 'Custo estimado' ? fmtMoney(l.usado) : `${fmtAuto(l.usado)} ${l.unidade}`;
    const lim = l.rotulo === 'Custo estimado' ? fmtMoney(l.limite) : `${fmtAuto(l.limite)} ${l.unidade}`;
    const p = (l.usado / l.limite) * 100;
    linhas.push(`${l.rotulo}: ${usado} de ${lim} (${p.toFixed(0)}% do limite)${p >= 100 ? ' — LIMITE ULTRAPASSADO' : ''}`);
  }
  if (r.limites.length) linhas.push('');

  const top = [...r.medidores].sort((a, b) => b.total - a.total).slice(0, 3);
  if (top.length) {
    linhas.push('Maiores consumos:');
    top.forEach((m) => linhas.push(`• ${m.meter.name || m.meter.code}: ${fmtAuto(m.total)} ${TYPES[m.meter.type].unit}`));
    linhas.push('');
  }

  const tipos = [r.energia > 0 && 'energia', r.agua > 0 && 'agua'].filter(Boolean);
  const d = sugestoes(site.segment, tipos.length ? tipos : ['energia', 'agua']);
  const primeiras = [...d.energia.slice(0, 2), ...d.agua.slice(0, 2)];
  if (primeiras.length) {
    linhas.push('Sugestões para reduzir:');
    primeiras.forEach((x) => linhas.push(`• ${x}`));
    linhas.push('');
  }

  linhas.push(`Enviado por ${state.settings.readerName || 'HidroLuz'} em ${fmtDate(new Date().toISOString().slice(0, 10))}.`);
  return linhas.join('\n');
}

/** Links de envio do resumo do mês — disponíveis mesmo sem estouro de limite. */
export function linksResumo(site, mes) {
  const texto = mensagemResumo(site, mes);
  const zap = normalizaWhats(site.ownerPhone);
  return {
    texto,
    whatsapp: zap ? `https://wa.me/${zap}?text=${encodeURIComponent(texto)}` : '',
    email: site.ownerEmail
      ? `mailto:${encodeURIComponent(site.ownerEmail)}?subject=${encodeURIComponent(`Consumo de ${site.name}`)}&body=${encodeURIComponent(texto)}`
      : '',
  };
}

/** Só dígitos, com 55 na frente quando o número vier sem código do país. */
export function normalizaWhats(tel) {
  let d = String(tel || '').replace(/\D/g, '');
  if (!d) return '';
  if (d.length <= 11) d = '55' + d;
  return d;
}

/**
 * Links prontos de aviso. O envio é sempre confirmado pela pessoa no
 * WhatsApp ou no aplicativo de e-mail — o app nunca dispara sozinho.
 */
export function linksAviso(estouro) {
  const texto = mensagemAviso(estouro);
  const site = estouro.site;
  const zap = normalizaWhats(site.ownerPhone);
  const assunto = `Aviso de consumo — ${site.name}`;
  return {
    texto,
    whatsapp: zap ? `https://wa.me/${zap}?text=${encodeURIComponent(texto)}` : '',
    email: site.ownerEmail
      ? `mailto:${encodeURIComponent(site.ownerEmail)}?subject=${encodeURIComponent(assunto)}&body=${encodeURIComponent(texto)}`
      : '',
  };
}
