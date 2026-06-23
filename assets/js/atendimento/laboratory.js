// laboratory.js — Laboratório do Assistente (simulador de fluxos determinísticos)
// 7 fluxos: batida_ausente, consulta_pagamento, uniforme, epi,
//           acompanhar_solicitacao, faq, triagem_manual
// PILOT_SILENT_MODE=true: NUNCA notifica — apenas registra a solicitação (Ajuste security)
import { createRequest, FLAGS } from './api.js';
import { esc } from './auth.js';
import { fmtDate } from './sla.js';

// ── Definições de fluxo ───────────────────────────────────────────────────────
const FLOWS = {
  missed_punch: {
    id:       'missed_punch',
    label:    'Batida ausente',
    triggers: ['esqueci', 'batida', 'saída ausente', 'não bati', 'esqueç'],
    category: 'point',
    steps: [
      { id: 'date',   prompt: '📅 Qual foi a data do esquecimento?\n(ex: hoje, ontem, 20/06)' },
      { id: 'time',   prompt: '🕐 Qual o horário aproximado da saída?\n(ex: 17:30)' },
      { id: 'reason', prompt: '📝 Qual o motivo?\n(ex: esquecimento, saída emergencial)' },
    ],
    buildTitle: d => `Batida de saída ausente em ${d.date}`,
    buildDesc:  d => `Colaborador informou batida ausente.\nData: ${d.date}\nHorário: ${d.time}\nMotivo: ${d.reason}`,
  },
  payment: {
    id:       'payment',
    label:    'Consulta de pagamento',
    triggers: ['pagamento', 'salário', 'holerite', 'cai hoje', 'depositado', 'recebi'],
    category: 'payment',
    steps: [
      { id: 'month', prompt: '📅 Sobre qual competência (mês/ano)?\n(ex: junho/2026)' },
      { id: 'doubt', prompt: '❓ Qual a sua dúvida específica?\n(ex: desconto indevido, valor diferente)' },
    ],
    buildTitle: d => `Consulta de pagamento — ${d.month}`,
    buildDesc:  d => `Competência: ${d.month}\nDúvida: ${d.doubt}`,
  },
  uniform: {
    id:       'uniform',
    label:    'Solicitação de uniforme',
    triggers: ['uniforme', 'roupa', 'camisa', 'calça', 'farda', 'vestimenta'],
    category: 'uniform',
    steps: [
      { id: 'item',  prompt: '👕 Qual item de uniforme precisa?\n(ex: camisa M, calça G)' },
      { id: 'qty',   prompt: '🔢 Quantas peças?' },
      { id: 'reason', prompt: '📝 Motivo da solicitação?\n(ex: desgaste, novo funcionário, extravio)' },
    ],
    buildTitle: d => `Uniforme: ${d.item} (${d.qty} pç)`,
    buildDesc:  d => `Item: ${d.item}\nQuantidade: ${d.qty}\nMotivo: ${d.reason}`,
  },
  epi: {
    id:       'epi',
    label:    'Solicitação de EPI',
    triggers: ['epi', 'equipamento', 'proteção', 'capacete', 'luva', 'bota', 'óculos', 'protetor'],
    category: 'epi',
    steps: [
      { id: 'item',  prompt: '🦺 Qual equipamento de proteção precisa?' },
      { id: 'size',  prompt: '📐 Qual o tamanho/numeração? (ex: M, 44, não se aplica)' },
      { id: 'reason', prompt: '📝 Motivo? (ex: vencido, danificado, primeiro uso)' },
    ],
    buildTitle: d => `EPI: ${d.item}`,
    buildDesc:  d => `EPI: ${d.item}\nTamanho: ${d.size}\nMotivo: ${d.reason}`,
  },
  track: {
    id:       'track',
    label:    'Acompanhar solicitação',
    triggers: ['acompanhar', 'protocolo', 'status', 'minha solicitação', 'abri', 'chamado'],
    category: 'faq',
    steps: [
      { id: 'protocol', prompt: '🔍 Informe o número de protocolo.\n(ex: SR-20260623-0001)' },
    ],
    buildTitle: d => `Consulta de protocolo ${d.protocol}`,
    buildDesc:  d => `Colaborador solicitou consulta de protocolo: ${d.protocol}`,
  },
  faq: {
    id:       'faq',
    label:    'Dúvida / FAQ',
    triggers: ['dúvida', 'como funciona', 'prazo', 'férias', 'atestado', 'política', 'regra'],
    category: 'faq',
    steps: [
      { id: 'question', prompt: '📖 Descreva a sua dúvida com detalhes:' },
    ],
    buildTitle: d => `FAQ: ${d.question.substring(0, 60)}${d.question.length > 60 ? '…' : ''}`,
    buildDesc:  d => `Dúvida: ${d.question}`,
  },
  manual: {
    id:       'manual',
    label:    'Triagem manual',
    triggers: [],         // fallback — não tem triggers automáticos
    category: 'general',
    steps: [
      { id: 'subject', prompt: '📝 Descreva brevemente o assunto:' },
      { id: 'details', prompt: '📋 Forneça mais detalhes para que a DP possa ajudar:' },
    ],
    buildTitle: d => d.subject,
    buildDesc:  d => `${d.subject}\n\n${d.details}`,
  },
};

// ── Estado da conversa ────────────────────────────────────────────────────────
let session = null;

function newSession() {
  return {
    flowId:    null,
    stepIndex: 0,
    data:      {},
    done:      false,
    requestId: null,
  };
}

// ── Renderização ──────────────────────────────────────────────────────────────
export function renderLaboratory(container, _state) {
  session = newSession();

  container.innerHTML = `
    <h2 class="page">Laboratório do Assistente</h2>
    <p class="sub">Simulador dos fluxos determinísticos do bot de atendimento</p>
    <div class="lab-container">
      <div>
        <div class="chat-window">
          <div class="chat-header">
            <span>🤖 Assistente DP</span>
            <span class="chat-status" id="chat-status">aguardando</span>
          </div>
          <div class="chat-messages" id="chat-msg"></div>
          <div class="chat-input">
            <input id="chat-in" type="text" placeholder="Digite uma mensagem…" autocomplete="off"/>
            <button id="chat-send">Enviar</button>
          </div>
        </div>
      </div>
      <div>
        <div class="lab-info">
          <h4>Fluxo ativo</h4>
          <div id="flow-name" class="muted" style="margin-bottom:12px">—</div>
          <div id="flow-data"></div>
          <h4 style="margin-top:16px">Atalhos</h4>
          <div class="quick-btns">
            ${Object.values(FLOWS).map(f =>
              `<button class="quick-flow" data-flow="${f.id}">${f.label}</button>`
            ).join('')}
          </div>
        </div>
        ${FLAGS.silentMode ? '<div class="note" style="margin-top:10px">🔕 PILOT_SILENT_MODE ativo — solicitações são registradas mas não enviadas.</div>' : ''}
      </div>
    </div>`;

  pushBotMsg(greeting());

  const input  = document.getElementById('chat-in');
  const send   = document.getElementById('chat-send');

  const submit = () => {
    const txt = input.value.trim();
    if (!txt) return;
    pushUserMsg(txt);
    input.value = '';
    processMessage(txt);
  };

  send.onclick = submit;
  input.addEventListener('keydown', e => e.key === 'Enter' && submit());

  document.querySelectorAll('.quick-flow').forEach(btn => {
    btn.onclick = () => {
      const flow = FLOWS[btn.dataset.flow];
      if (!flow) return;
      session = newSession();
      session.flowId = flow.id;
      pushBotMsg(`Iniciando fluxo: *${flow.label}*\n\n${flow.steps[0].prompt}`);
      updateSidebar();
    };
  });
}

// ── Motor de fluxo ────────────────────────────────────────────────────────────
function greeting() {
  return `Olá! 👋 Sou o assistente do Departamento Pessoal.\n\nComo posso ajudar?\n\n` +
    Object.values(FLOWS).map((f, i) => `${i + 1}. ${f.label}`).join('\n') +
    `\n\nOu escreva sua dúvida diretamente.`;
}

function processMessage(text) {
  const lower = text.toLowerCase();

  // Comando reset
  if (/^(reiniciar|reset|recomeç|início|menu)/.test(lower)) {
    session = newSession();
    pushBotMsg(greeting());
    updateSidebar();
    return;
  }

  // Fluxo em andamento
  if (session.flowId && !session.done) {
    continueFlow(text);
    return;
  }

  // Selecionar fluxo por número
  const num = parseInt(text, 10);
  const flowKeys = Object.keys(FLOWS);
  if (num >= 1 && num <= flowKeys.length) {
    startFlow(flowKeys[num - 1]);
    return;
  }

  // Detecção por palavra-chave
  for (const flow of Object.values(FLOWS)) {
    if (flow.triggers.some(t => lower.includes(t))) {
      startFlow(flow.id);
      return;
    }
  }

  // Fallback: triagem manual
  pushBotMsg(`Não reconheci o assunto. Vou abrir uma triagem para a DP analisar.`);
  startFlow('manual');
}

function startFlow(flowId) {
  const flow = FLOWS[flowId];
  if (!flow) return;
  session = newSession();
  session.flowId = flowId;
  pushBotMsg(flow.steps[0].prompt);
  updateSidebar();
}

function continueFlow(text) {
  const flow = FLOWS[session.flowId];
  if (!flow) return;

  const step = flow.steps[session.stepIndex];
  session.data[step.id] = text;
  session.stepIndex++;

  if (session.stepIndex < flow.steps.length) {
    pushBotMsg(flow.steps[session.stepIndex].prompt);
  } else {
    finishFlow(flow);
  }
  updateSidebar();
}

async function finishFlow(flow) {
  session.done = true;
  const title = flow.buildTitle(session.data);
  const desc  = flow.buildDesc(session.data);

  pushBotMsg(`✅ Entendi! Registrando a solicitação…`);
  setStatus('criando…');

  try {
    const result = await createRequest({
      source:       'internal',
      category:     flow.category,
      title,
      description:  desc,
      metadata:     { flow: flow.id, collected: session.data, lab_mode: true },
      idempotency_key: `lab-${Date.now()}-${Math.random().toString(36).slice(2)}`,
    });

    session.requestId = result.id;
    const protocol = result.protocol_code;
    pushBotMsg(
      `✅ Solicitação registrada!\n\n` +
      `*Protocolo:* ${protocol}\n` +
      `*Categoria:* ${flow.label}\n\n` +
      (FLAGS.silentMode
        ? '🔕 Modo silencioso — DP foi notificada internamente.'
        : '📲 Notificação enviada ao colaborador.') +
      `\n\nDigite *reiniciar* para iniciar nova simulação.`
    );
    setStatus('concluído');
  } catch (e) {
    pushBotMsg(`❌ Erro ao registrar: ${e.message}\n\nTente novamente ou verifique a conexão.`);
    session.done = false;
    setStatus('erro');
  }
  updateSidebar();
}

// ── UI helpers ────────────────────────────────────────────────────────────────
function pushBotMsg(text) {
  const msgs = document.getElementById('chat-msg');
  if (!msgs) return;
  const div = document.createElement('div');
  div.className = 'msg bot';
  div.innerHTML = `<div class="msg-bubble">${esc(text).replace(/\*(.*?)\*/g, '<b>$1</b>').replace(/\n/g, '<br>')}</div>`;
  msgs.appendChild(div);
  msgs.scrollTop = msgs.scrollHeight;
}

function pushUserMsg(text) {
  const msgs = document.getElementById('chat-msg');
  if (!msgs) return;
  const div = document.createElement('div');
  div.className = 'msg outbound';
  div.innerHTML = `<div class="msg-bubble">${esc(text)}</div>`;
  msgs.appendChild(div);
  msgs.scrollTop = msgs.scrollHeight;
}

function setStatus(s) {
  const el = document.getElementById('chat-status');
  if (el) el.textContent = s;
}

function updateSidebar() {
  const nameEl = document.getElementById('flow-name');
  const dataEl = document.getElementById('flow-data');
  if (!nameEl || !dataEl) return;

  if (!session.flowId) {
    nameEl.textContent = '—';
    dataEl.innerHTML = '';
    return;
  }

  const flow = FLOWS[session.flowId];
  nameEl.textContent = flow.label;

  const rows = Object.entries(session.data).map(([k, v]) =>
    `<div class="field-row"><span class="fk">${esc(k)}</span><span>${esc(v)}</span></div>`
  ).join('');

  const stepInfo = session.done
    ? `<div class="pill c-grn" style="margin-top:8px">Concluído</div>`
    : `<div class="muted" style="margin-top:8px;font-size:12px">Passo ${session.stepIndex + 1} / ${flow.steps.length}</div>`;

  dataEl.innerHTML = (rows || '<div class="muted">Nenhum dado ainda</div>') + stepInfo;
}
