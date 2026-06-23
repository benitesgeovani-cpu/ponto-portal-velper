// sla.js — Utilitários de cálculo e exibição de SLA
// Timezone sempre America/Sao_Paulo (Ajuste 9)

const BRT = 'America/Sao_Paulo';

// Formata data ISO para dd/mm/yyyy hh:mm BRT
export function fmtDT(iso) {
  if (!iso) return '—';
  return new Date(iso).toLocaleString('pt-BR', { timeZone: BRT,
    day:'2-digit', month:'2-digit', year:'numeric', hour:'2-digit', minute:'2-digit' });
}

// Formata só a data
export function fmtDate(iso) {
  if (!iso) return '—';
  return new Date(iso).toLocaleDateString('pt-BR', { timeZone: BRT,
    day:'2-digit', month:'2-digit', year:'numeric' });
}

// "há 2h" / "há 3 dias" / "em 2h"
export function timeAgo(iso) {
  if (!iso) return '—';
  const diff = Date.now() - new Date(iso).getTime();
  const abs  = Math.abs(diff);
  const prefix = diff >= 0 ? 'há ' : 'em ';
  if (abs < 60_000)              return prefix + 'agora';
  if (abs < 3_600_000)           return prefix + Math.round(abs / 60_000) + 'min';
  if (abs < 86_400_000)          return prefix + Math.round(abs / 3_600_000) + 'h';
  return prefix + Math.round(abs / 86_400_000) + 'd';
}

// Status SLA → classe CSS e rótulo
export function slaBadge(status) {
  const map = {
    ON_TRACK:          { cls: 'c-grn', label: 'No prazo' },
    DUE_SOON:          { cls: 'c-yel', label: 'Vence logo' },
    OVERDUE:           { cls: 'c-red', label: 'Atrasado' },
    PAUSED:            { cls: 'c-gry', label: 'Pausado' },
    NOT_APPLICABLE:    { cls: 'c-gry', label: '—' },
    COMPLETED_ON_TIME: { cls: 'c-grn', label: 'Cumprido' },
    COMPLETED_LATE:    { cls: 'c-red', label: 'Atrasado' },
  };
  return map[status] || { cls: 'c-gry', label: status || '—' };
}

// Calcula status SLA em tempo real (para exibição, não persistência)
export function calcSlaStatus(dueAt, resolvedAt) {
  if (!dueAt) return 'NOT_APPLICABLE';
  const due  = new Date(dueAt).getTime();
  const ref  = resolvedAt ? new Date(resolvedAt).getTime() : Date.now();
  if (resolvedAt) return ref <= due ? 'COMPLETED_ON_TIME' : 'COMPLETED_LATE';
  const diff = due - Date.now();
  if (diff < 0)          return 'OVERDUE';
  if (diff < 60 * 60_000) return 'DUE_SOON';   // < 1h
  return 'ON_TRACK';
}

// Minutos → "2h30" ou "—"
export function fmtMin(m) {
  if (!m && m !== 0) return '—';
  const h  = Math.floor(Math.abs(m) / 60);
  const mm = String(Math.abs(m) % 60).padStart(2, '0');
  return `${h}h${mm}`;
}

// Dias corridos entre duas datas (ou hoje)
export function calendarDays(from, to) {
  const f = new Date(from).getTime();
  const t = to ? new Date(to).getTime() : Date.now();
  return Math.round((t - f) / 86_400_000);
}

// HTML de badge SLA pronto para inserir
export function slaHtml(status) {
  const { cls, label } = slaBadge(status);
  if (label === '—') return '<span class="muted">—</span>';
  return `<span class="pill ${cls}">${label}</span>`;
}

// Status operacional SR → rótulo e cor
export function srStatusBadge(status) {
  const map = {
    RECEIVED:               { cls: 'c-blue', label: 'Recebida' },
    AUTO_HANDLING:          { cls: 'c-blue', label: 'Bot' },
    WAITING_EMPLOYEE:       { cls: 'c-yel',  label: 'Ag. colaborador' },
    TRIAGED:                { cls: 'c-blue', label: 'Triada' },
    WAITING_DP:             { cls: 'c-yel',  label: 'Ag. DP' },
    WAITING_OTHER_TEAM:     { cls: 'c-yel',  label: 'Ag. outra equipe' },
    IN_PROGRESS:            { cls: 'c-blue', label: 'Em andamento' },
    WAITING_APPROVAL:       { cls: 'c-yel',  label: 'Ag. aprovação' },
    RESOLVED_AUTOMATICALLY: { cls: 'c-grn',  label: 'Resolvida (auto)' },
    RESOLVED_MANUALLY:      { cls: 'c-grn',  label: 'Resolvida' },
    FORWARDED:              { cls: 'c-gry',  label: 'Encaminhada' },
    CLOSED:                 { cls: 'c-gry',  label: 'Fechada' },
    CANCELED:               { cls: 'c-gry',  label: 'Cancelada' },
    SLA_OVERDUE:            { cls: 'c-red',  label: 'SLA vencido' },
  };
  return map[status] || { cls: 'c-gry', label: status || '?' };
}

export function srCategoryLabel(cat) {
  return { point:'Ponto', payment:'Pagamento', uniform:'Uniforme', epi:'EPI',
    faq:'FAQ', general:'Geral' }[cat] || cat;
}

export function srPriorityBadge(p) {
  return { low:'c-gry', normal:'c-blue', high:'c-yel', critical:'c-red' }[p] || 'c-gry';
}
