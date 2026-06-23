// requests.js — Central de Solicitações
import { listRequests, getRequest, addMessage, changeStatus } from './api.js';
import { fmtDT, timeAgo, slaHtml, srStatusBadge, srCategoryLabel, srPriorityBadge, calcSlaStatus } from './sla.js';
import { canManage, esc } from './auth.js';

let page  = 0;
let total = 0;
const PAGE_SIZE = 30;
let filters = { status: '', category: '', plant: '', q: '' };

export async function renderRequests(container, _state) {
  container.innerHTML = `
    <h2 class="page">Central de Solicitações</h2>
    <p class="sub">Todas as solicitações abertas e encerradas do canal Atendimento DP</p>
    <div class="filters">
      <input id="fq" type="search" placeholder="Buscar por título…" value="${esc(filters.q)}"/>
      <select id="fst">
        <option value="">Todos os status</option>
        <option value="RECEIVED">Recebida</option>
        <option value="IN_PROGRESS">Em andamento</option>
        <option value="WAITING_DP">Aguardando DP</option>
        <option value="WAITING_EMPLOYEE">Aguardando colaborador</option>
        <option value="RESOLVED_MANUALLY">Resolvida</option>
        <option value="CLOSED">Fechada</option>
        <option value="CANCELED">Cancelada</option>
        <option value="SLA_OVERDUE">SLA vencido</option>
      </select>
      <select id="fcat">
        <option value="">Todas as categorias</option>
        <option value="point">Ponto</option>
        <option value="payment">Pagamento</option>
        <option value="uniform">Uniforme</option>
        <option value="epi">EPI</option>
        <option value="faq">FAQ</option>
        <option value="general">Geral</option>
      </select>
      <button class="btn" id="fapply">Filtrar</button>
      <button class="btn g" id="fclear">Limpar</button>
    </div>
    <section class="block" style="padding:0">
      <div id="tbl-wrap" style="padding:18px"><div class="spinner"></div> Carregando…</div>
    </section>`;

  // Restaurar filtros ativos
  document.getElementById('fst').value  = filters.status;
  document.getElementById('fcat').value = filters.category;

  document.getElementById('fapply').onclick = () => {
    filters.q        = document.getElementById('fq').value.trim();
    filters.status   = document.getElementById('fst').value;
    filters.category = document.getElementById('fcat').value;
    page = 0;
    loadTable();
  };
  document.getElementById('fclear').onclick = () => {
    filters = { status: '', category: '', plant: '', q: '' };
    document.getElementById('fq').value  = '';
    document.getElementById('fst').value  = '';
    document.getElementById('fcat').value = '';
    page = 0;
    loadTable();
  };
  document.getElementById('fq').addEventListener('keydown', e => {
    if (e.key === 'Enter') document.getElementById('fapply').click();
  });

  loadTable();
}

async function loadTable() {
  const wrap = document.getElementById('tbl-wrap');
  if (!wrap) return;
  wrap.innerHTML = '<div class="spinner"></div> Carregando…';

  const { data, error, count } = await listRequests({
    ...filters, page, pageSize: PAGE_SIZE,
  });

  if (error) { wrap.innerHTML = `<div class="empty">Erro ao carregar: ${esc(error.message)}</div>`; return; }
  total = count ?? 0;

  if (!data?.length) {
    wrap.innerHTML = '<div class="empty">Nenhuma solicitação encontrada.</div>';
    return;
  }

  const rows = data.map(r => {
    const { cls, label } = srStatusBadge(r.status);
    const sla = calcSlaStatus(r.due_at, r.resolved_at);
    return `
      <tr data-id="${r.id}">
        <td><span style="font-size:11px;color:var(--muted)">${esc(r.protocol_code)}</span></td>
        <td>${esc(r.title)}</td>
        <td><span class="pill c-gry">${srCategoryLabel(r.category)}</span></td>
        <td><span class="pill ${cls}">${label}</span></td>
        <td>${slaHtml(sla)}</td>
        <td class="muted">${esc(r.employee_name_snapshot || '—')}</td>
        <td class="muted">${timeAgo(r.created_at)}</td>
      </tr>`;
  }).join('');

  const pages = Math.ceil(total / PAGE_SIZE);
  wrap.innerHTML = `
    <table>
      <thead><tr>
        <th>Protocolo</th><th>Título</th><th>Categoria</th>
        <th>Status</th><th>SLA</th><th>Colaborador</th><th>Criada</th>
      </tr></thead>
      <tbody>${rows}</tbody>
    </table>
    ${pages > 1 ? renderPagination(pages) : ''}
    <div class="note" style="margin-top:8px">${total} resultado(s)</div>`;

  wrap.querySelectorAll('tbody tr').forEach(tr => {
    tr.onclick = () => openDrawer(tr.dataset.id);
  });
  wrap.querySelectorAll('.pg-btn').forEach(btn => {
    btn.onclick = () => { page = +btn.dataset.p; loadTable(); };
  });
}

function renderPagination(pages) {
  const btns = [];
  for (let i = 0; i < pages; i++) {
    btns.push(`<button class="pg-btn${i === page ? ' on' : ''}" data-p="${i}">${i + 1}</button>`);
  }
  return `<div class="pagination">${btns.join('')}</div>`;
}

// ── Drawer de detalhe ─────────────────────────────────────────────────────────
async function openDrawer(id) {
  const existing = document.getElementById('ov');
  if (existing) existing.remove();

  const ov = document.createElement('div');
  ov.id = 'ov';
  ov.innerHTML = `<div id="dr"><div class="spinner"></div> Carregando…</div>`;
  document.body.appendChild(ov);
  ov.addEventListener('click', e => { if (e.target === ov) ov.remove(); });

  const { data: r, error } = await getRequest(id);
  if (error || !r) {
    document.getElementById('dr').innerHTML = `<div class="empty">Erro ao carregar.</div>`;
    return;
  }

  const { cls, label } = srStatusBadge(r.status);
  const events = (r.service_events || []).sort((a, b) => new Date(a.created_at) - new Date(b.created_at));
  const messages = (r.service_messages || []).sort((a, b) => new Date(a.created_at) - new Date(b.created_at));

  const actionsHtml = canManage() ? renderActions(r) : '';

  document.getElementById('dr').innerHTML = `
    <div style="display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:16px">
      <div>
        <h3 style="margin:0 0 4px">${esc(r.title)}</h3>
        <code style="font-size:11px;color:var(--muted)">${esc(r.protocol_code)}</code>
      </div>
      <span class="pill ${cls}" style="margin-top:4px">${label}</span>
    </div>

    <div class="kv"><span>Categoria</span> ${srCategoryLabel(r.category)}${r.subcategory ? ' / ' + esc(r.subcategory) : ''}</div>
    <div class="kv"><span>Colaborador</span> ${esc(r.employee_name_snapshot || '—')}</div>
    <div class="kv"><span>Planta / Setor</span> ${esc(r.plant || '—')} / ${esc(r.department || '—')}</div>
    <div class="kv"><span>Origem</span> ${esc(r.source)}</div>
    <div class="kv"><span>Criada em</span> ${fmtDT(r.created_at)}</div>
    <div class="kv"><span>1ª resposta</span> ${fmtDT(r.first_response_at)}</div>
    <div class="kv"><span>Resolução</span> ${fmtDT(r.resolved_at)}</div>
    <div class="kv"><span>SLA resposta</span> ${slaHtml(r.sla_first_response_status)}</div>
    <div class="kv"><span>SLA resolução</span> ${slaHtml(r.sla_resolution_status)}</div>
    ${r.description ? `<div class="expl">${esc(r.description)}</div>` : ''}

    ${actionsHtml}

    ${messages.length ? `
      <h4 style="margin:18px 0 8px">Mensagens</h4>
      <div class="timeline">
        ${messages.map(m => `
          <div class="tl-item">
            <div class="tl-dot" style="background:${m.direction === 'internal_note' ? '#94a3b8' : 'var(--azul2)'}"></div>
            <div style="flex:1">
              <div>${esc(m.message_text || '')}</div>
              <div class="tl-time">${m.direction} · ${fmtDT(m.created_at)}</div>
            </div>
          </div>`).join('')}
      </div>` : ''}

    <h4 style="margin:18px 0 8px">Histórico</h4>
    <div class="timeline">
      ${events.map(e => `
        <div class="tl-item">
          <div class="tl-dot"></div>
          <div style="flex:1">
            <div><b>${esc(e.event_type)}</b>${e.previous_status ? ` <span class="muted">${esc(e.previous_status)} → ${esc(e.new_status)}</span>` : ''}</div>
            <div class="tl-time">${e.actor_type} · ${fmtDT(e.created_at)}</div>
          </div>
        </div>`).join('')}
    </div>

    ${canManage() ? `
      <div style="margin-top:18px">
        <h4 style="margin:0 0 8px">Nota interna</h4>
        <textarea id="note-txt" placeholder="Escreva uma nota interna…"></textarea>
        <button class="btn" style="margin-top:6px" id="note-send">Registrar nota</button>
      </div>` : ''}`;

  if (canManage()) {
    document.getElementById('note-send')?.addEventListener('click', async () => {
      const txt = document.getElementById('note-txt').value.trim();
      if (!txt) return;
      const { error } = await addMessage(r.id, txt, 'internal_note', null);
      if (!error) { ov.remove(); openDrawer(id); }
    });
    bindStatusActions(r.id, ov);
  }
}

function renderActions(r) {
  const next = nextStatuses(r.status);
  if (!next.length) return '';
  const btns = next.map(s => {
    const { cls, label } = srStatusBadge(s);
    return `<button class="btn sm g action-btn" data-status="${s}" data-id="${r.id}">${label}</button>`;
  }).join('');
  return `<div style="margin:14px 0"><div class="opts">${btns}</div></div>`;
}

function nextStatuses(current) {
  const map = {
    RECEIVED:           ['TRIAGED','WAITING_DP','IN_PROGRESS','CANCELED'],
    AUTO_HANDLING:      ['TRIAGED','WAITING_DP'],
    WAITING_EMPLOYEE:   ['IN_PROGRESS','CANCELED'],
    TRIAGED:            ['WAITING_DP','IN_PROGRESS','CANCELED'],
    WAITING_DP:         ['IN_PROGRESS','WAITING_EMPLOYEE','WAITING_APPROVAL','CANCELED'],
    WAITING_OTHER_TEAM: ['IN_PROGRESS','WAITING_DP'],
    IN_PROGRESS:        ['RESOLVED_MANUALLY','WAITING_EMPLOYEE','WAITING_APPROVAL','CANCELED'],
    WAITING_APPROVAL:   ['IN_PROGRESS','RESOLVED_MANUALLY','CANCELED'],
    RESOLVED_MANUALLY:  ['CLOSED'],
    RESOLVED_AUTOMATICALLY: ['CLOSED'],
    SLA_OVERDUE:        ['IN_PROGRESS'],
  };
  return map[current] || [];
}

function bindStatusActions(reqId, ov) {
  document.querySelectorAll('.action-btn').forEach(btn => {
    btn.onclick = async () => {
      btn.disabled = true;
      try { await changeStatus(reqId, btn.dataset.status); }
      catch(e) { alert('Erro: ' + e.message); btn.disabled = false; return; }
      ov.remove();
      openDrawer(reqId);
      loadTable();
    };
  });
}
