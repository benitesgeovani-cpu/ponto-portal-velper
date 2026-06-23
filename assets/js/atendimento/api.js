// api.js — cliente Supabase e helpers de API para o módulo Atendimento
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const CFG = window.ATENDIMENTO_CONFIG;
export const sb = createClient(CFG.SUPABASE_URL, CFG.SUPABASE_ANON_KEY);

// ── Flags de feature (env vars via window.ATENDIMENTO_CONFIG) ─────────────────
export const FLAGS = {
  serviceDesk:         !!CFG.SERVICE_DESK_ENABLED,
  whatsappTest:        !!CFG.WHATSAPP_TEST_ENABLED,
  whatsappProduction:  !!CFG.WHATSAPP_PRODUCTION_ENABLED,
  knowledgeBase:       !!CFG.KNOWLEDGE_BASE_ENABLED,
  autoReply:           !!CFG.AUTO_REPLY_ENABLED,
  silentMode:          !!CFG.PILOT_SILENT_MODE,
};

// ── service_requests ──────────────────────────────────────────────────────────

export async function listRequests({ status, category, plant, q, page = 0, pageSize = 30 } = {}) {
  let query = sb.from('service_requests')
    .select(`
      id, protocol_code, status, category, subcategory, priority,
      title, employee_name_snapshot, plant, department, source,
      created_at, updated_at, due_at, first_response_at, resolved_at,
      sla_first_response_status, sla_resolution_status,
      assigned_user_id, assigned_team
    `, { count: 'exact' })
    .order('created_at', { ascending: false })
    .range(page * pageSize, (page + 1) * pageSize - 1);

  if (status)   query = query.eq('status', status);
  if (category) query = query.eq('category', category);
  if (plant)    query = query.eq('plant', plant);
  if (q)        query = query.ilike('title', `%${q}%`);

  return query;
}

export async function getRequest(id) {
  return sb.from('service_requests')
    .select('*, service_events(*), service_messages(*)')
    .eq('id', id)
    .single();
}

export async function createRequest(payload) {
  const { data, error } = await sb.rpc('create_service_request', { p: payload });
  if (error) throw error;
  return data;
}

export async function changeStatus(id, newStatus, note = '', actorId = null) {
  const { data, error } = await sb.rpc('update_service_request_status', {
    p_id: id,
    p_new_status: newStatus,
    p_actor_id: actorId,
    p_actor_type: 'agent',
    p_note: note,
  });
  if (error) throw error;
  return data;
}

export async function addMessage(serviceRequestId, text, direction = 'internal_note', createdBy = null) {
  return sb.from('service_messages').insert({
    service_request_id: serviceRequestId,
    direction,
    channel: 'portal',
    sender_type: direction === 'internal_note' ? 'agent' : 'system',
    message_text: text,
    created_by: createdBy,
  });
}

// ── knowledge_articles ────────────────────────────────────────────────────────

export async function listArticles({ status, category, q } = {}) {
  let query = sb.from('knowledge_articles')
    .select('id, title, category, keywords, status, effective_from, review_due_at, updated_at')
    .order('updated_at', { ascending: false });

  if (status)   query = query.eq('status', status);
  if (category) query = query.eq('category', category);
  if (q) {
    query = query.or(`title.ilike.%${q}%,answer_text.ilike.%${q}%`);
  }
  return query;
}

export async function getArticle(id) {
  return sb.from('knowledge_articles').select('*').eq('id', id).single();
}

export async function upsertArticle(article) {
  if (article.id) {
    return sb.from('knowledge_articles').update(article).eq('id', article.id).select().single();
  }
  return sb.from('knowledge_articles').insert(article).select().single();
}

export async function approveArticle(id) {
  return sb.from('knowledge_articles').update({ status: 'approved' }).eq('id', id);
}

// ── timekeeping_exceptions (SLA B) ────────────────────────────────────────────

export async function listOpenExceptions({ page = 0, pageSize = 50 } = {}) {
  return sb.from('timekeeping_exceptions')
    .select(`
      id, exception_type, severity, status, operational_status,
      solides_internal_id, employee_name, analyzed_date, work_date,
      available_for_treatment_at, due_for_first_treatment_at,
      sla_first_treatment_status, sla_closure_status,
      total_open_calendar_days, current_owner_team, plant,
      created_at
    `, { count: 'exact' })
    .in('status', ['aberta', 'aguardando_revisao', 'confirmada'])
    .order('available_for_treatment_at', { ascending: true })
    .range(page * pageSize, (page + 1) * pageSize - 1);
}

export async function getExceptionAging(id) {
  const { data } = await sb.rpc('get_exception_aging', { p_id: id });
  return data;
}

// ── user_roles ────────────────────────────────────────────────────────────────

export async function getMyRoles() {
  const { data } = await sb.rpc('get_my_roles');
  return Array.isArray(data) ? data : (data ? [data] : []);
}
