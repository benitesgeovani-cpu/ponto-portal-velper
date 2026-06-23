// point-discipline.js — Disciplina de Tratativa do Ponto (SLA B)
// Ajuste 5 (aprovado): fila "hoje", aging básico, KPIs mínimos
import { listOpenExceptions } from './api.js';
import { fmtDate, fmtDT, slaHtml, timeAgo, calcSlaStatus } from './sla.js';
import { esc } from './auth.js';

const EXCEPTION_LABELS = {
  saida_ausente:                'Saída ausente',
  entrada_ausente:              'Entrada ausente',
  escala_ativa_sem_marcacao:    'Sem marcação',
  marcacoes_abaixo_esperado:    'Abaixo do esperado',
  intervalo_incompleto:         'Intervalo incompleto',
  atraso:                       'Atraso',
  saida_antecipada:             'Saída antecipada',
  jornada_abaixo:               'Jornada abaixo',
  jornada_acima:                'Jornada acima',
  possivel_hora_extra:          'Hora extra',
  inconsistencia_feriado_folga: 'Batida em folga',
  marcacoes_duplicadas:         'Batidas duplicadas',
  marcacao_incompativel_escala: 'Incompatível escala',
};

const SEV_CLASS = {
  critica: 'c-red', alta: 'c-red', media: 'c-yel', baixa: 'c-blue',
};

export async function renderPointDiscipline(container, _state) {
  container.innerHTML = `
    <h2 class="page">Disciplina de Tratativa do Ponto</h2>
    <p class="sub">Fila de exceções abertas e métricas de tratativa (SLA B)</p>
    <div id="pd-body"><div class="spinner"></div> Carregando…</div>`;

  const { data, error, count } = await listOpenExceptions({ pageSize: 200 });

  if (error) {
    document.getElementById('pd-body').innerHTML =
      `<div class="empty">Erro ao carregar: ${esc(error.message)}</div>`;
    return;
  }

  const rows = data || [];
  const now  = new Date();
  const todayStr = now.toISOString().slice(0, 10);

  // ── KPIs ─────────────────────────────────────────────────────────────────
  const total    = rows.length;
  const criticas = rows.filter(r => r.severity === 'critica' || r.severity === 'alta').length;
  const hoje     = rows.filter(r => (r.work_date || r.analyzed_date || '') === todayStr).length;
  const old3     = rows.filter(r => calDays(r.available_for_treatment_at || r.created_at) >= 3).length;
  const old7     = rows.filter(r => calDays(r.available_for_treatment_at || r.created_at) >= 7).length;
  const overdue  = rows.filter(r => calcSlaStatus(r.due_for_first_treatment_at) === 'OVERDUE').length;

  // Tipo mais frequente
  const typeCount = {};
  rows.forEach(r => { typeCount[r.exception_type] = (typeCount[r.exception_type] || 0) + 1; });
  const topType = Object.entries(typeCount).sort((a, b) => b[1] - a[1])[0];

  // ── Fila hoje = work_date = hoje OU criadas hoje ──────────────────────────
  const queueToday = rows.filter(r =>
    (r.work_date || r.analyzed_date || '').slice(0, 10) === todayStr ||
    (r.created_at || '').slice(0, 10) === todayStr
  );

  // ── Aging (distribuição de dias de abertura) ──────────────────────────────
  const aging = { '0-1d': 0, '2-3d': 0, '4-7d': 0, '8-14d': 0, '15+d': 0 };
  rows.forEach(r => {
    const d = calDays(r.available_for_treatment_at || r.created_at);
    if (d <= 1)        aging['0-1d']++;
    else if (d <= 3)   aging['2-3d']++;
    else if (d <= 7)   aging['4-7d']++;
    else if (d <= 14)  aging['8-14d']++;
    else               aging['15+d']++;
  });
  const maxAging = Math.max(...Object.values(aging), 1);

  document.getElementById('pd-body').innerHTML = `
    <!-- KPIs -->
    <div class="grid" style="margin-bottom:20px">
      ${kpiCard('Total aberto', total, total > 20 ? 'alert' : total > 10 ? 'warn' : 'good', 'exceções em aberto')}
      ${kpiCard('Críticas / Altas', criticas, criticas > 0 ? 'alert' : 'good', 'prioridade máxima')}
      ${kpiCard('De hoje', hoje, '', 'criadas ou ocorridas hoje')}
      ${kpiCard('SLA vencido', overdue, overdue > 0 ? 'alert' : 'good', 'ultrapassaram deadline')}
      ${kpiCard('Backlog ≥ 3d', old3, old3 > 5 ? 'warn' : 'good', 'dias sem tratativa')}
      ${kpiCard('Backlog ≥ 7d', old7, old7 > 0 ? 'alert' : 'good', 'crítico — > 1 semana')}
      ${topType ? kpiCard('Tipo mais comum', topType[1], 'good', EXCEPTION_LABELS[topType[0]] || topType[0]) : ''}
    </div>

    <!-- Fila hoje -->
    <section class="block">
      <h3>Fila de hoje <small>${queueToday.length} registro(s)</small></h3>
      ${queueToday.length
        ? `<table>
            <thead><tr>
              <th>Colaborador</th><th>Tipo</th><th>Severidade</th>
              <th>Data ocorrência</th><th>SLA</th><th>Aberta há</th>
            </tr></thead>
            <tbody>
              ${queueToday.map(r => exceptionRow(r)).join('')}
            </tbody>
          </table>`
        : '<div class="empty">Nenhuma exceção da data de hoje.</div>'}
    </section>

    <!-- Aging -->
    <section class="block">
      <h3>Aging do backlog</h3>
      <div style="max-width:500px">
        ${Object.entries(aging).map(([label, count]) => `
          <div class="age-row">
            <div class="age-label">${label}</div>
            <div class="age-track">
              <div class="age-fill" style="width:${Math.round(count/maxAging*100)}%;background:${agingColor(label)}"></div>
            </div>
            <div class="age-count">${count}</div>
          </div>`).join('')}
      </div>
    </section>

    <!-- Fila completa aberta -->
    <section class="block">
      <h3>Todas as exceções em aberto <small>${total} total</small></h3>
      ${rows.length
        ? `<div class="filters" style="margin-bottom:12px">
            <input id="exc-q" type="search" placeholder="Filtrar por colaborador ou tipo…"/>
          </div>
          <table id="exc-table">
            <thead><tr>
              <th>Colaborador</th><th>Tipo</th><th>Sev.</th>
              <th>Ocorrência</th><th>SLA</th><th>Em aberto</th>
            </tr></thead>
            <tbody id="exc-body">
              ${rows.map(r => exceptionRow(r)).join('')}
            </tbody>
          </table>`
        : '<div class="empty">Nenhuma exceção aberta.</div>'}
    </section>`;

  document.getElementById('exc-q')?.addEventListener('input', e => {
    const q = e.target.value.toLowerCase();
    document.querySelectorAll('#exc-body tr').forEach(tr => {
      tr.style.display = tr.textContent.toLowerCase().includes(q) ? '' : 'none';
    });
  });
}

function exceptionRow(r) {
  const sev = r.severity || 'baixa';
  const slaStatus = calcSlaStatus(r.due_for_first_treatment_at);
  const days = calDays(r.available_for_treatment_at || r.created_at);
  return `
    <tr>
      <td>${esc(r.employee_name || r.solides_internal_id || '—')}</td>
      <td>${esc(EXCEPTION_LABELS[r.exception_type] || r.exception_type)}</td>
      <td><span class="pill ${SEV_CLASS[sev] || 'c-gry'}">${esc(sev)}</span></td>
      <td class="muted">${fmtDate(r.work_date || r.analyzed_date)}</td>
      <td>${slaHtml(slaStatus)}</td>
      <td class="muted">${days}d</td>
    </tr>`;
}

function kpiCard(label, value, cls, sub) {
  return `
    <div class="card kpi ${cls}">
      <h3>${esc(label)}</h3>
      <div class="big">${value}</div>
      <div class="s">${esc(sub)}</div>
    </div>`;
}

function calDays(from) {
  if (!from) return 0;
  return Math.max(0, Math.round((Date.now() - new Date(from).getTime()) / 86_400_000));
}

function agingColor(bucket) {
  const map = { '0-1d': '#16a34a', '2-3d': '#2563eb', '4-7d': '#d97706', '8-14d': '#ea580c', '15+d': '#dc2626' };
  return map[bucket] || '#64748b';
}
