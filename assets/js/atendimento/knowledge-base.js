// knowledge-base.js — Base de Conhecimento
// Ajuste 4 (aprovado): artigos aprovados, busca por keyword, linkagem a resposta
import { listArticles, getArticle, upsertArticle, approveArticle } from './api.js';
import { fmtDate } from './sla.js';
import { canManage, isOwner, esc } from './auth.js';

const CAT_LABELS = {
  point: 'Ponto', payment: 'Pagamento', uniform: 'Uniforme',
  epi: 'EPI', faq: 'FAQ', general: 'Geral',
};

let searchQuery = '';

export async function renderKnowledgeBase(container, _state) {
  container.innerHTML = `
    <h2 class="page">Base de Conhecimento</h2>
    <p class="sub">Artigos de resposta automática e consulta interna da DP</p>
    <div class="filters">
      <input id="kb-q" type="search" placeholder="Buscar título, conteúdo ou keyword…" value="${esc(searchQuery)}"/>
      <select id="kb-cat">
        <option value="">Todas as categorias</option>
        ${Object.entries(CAT_LABELS).map(([v, l]) => `<option value="${v}">${l}</option>`).join('')}
      </select>
      <select id="kb-status">
        <option value="approved">Aprovados</option>
        <option value="">Todos</option>
        <option value="draft">Rascunhos</option>
        <option value="archived">Arquivados</option>
      </select>
      <button class="btn" id="kb-search">Buscar</button>
      ${canManage() ? '<button class="btn g" id="kb-new">+ Novo artigo</button>' : ''}
    </div>
    <div id="kb-list"><div class="spinner"></div> Carregando…</div>`;

  document.getElementById('kb-search').onclick = () => {
    searchQuery = document.getElementById('kb-q').value.trim();
    loadArticles();
  };
  document.getElementById('kb-q').addEventListener('keydown', e => e.key === 'Enter' && document.getElementById('kb-search').click());
  document.getElementById('kb-new')?.addEventListener('click', () => openEditor(null));

  loadArticles();
}

async function loadArticles() {
  const list = document.getElementById('kb-list');
  if (!list) return;
  list.innerHTML = '<div class="spinner"></div> Carregando…';

  const cat    = document.getElementById('kb-cat')?.value || '';
  const status = document.getElementById('kb-status')?.value ?? 'approved';

  const { data, error } = await listArticles({
    status: status || undefined,
    category: cat || undefined,
    q: searchQuery || undefined,
  });

  if (error) { list.innerHTML = `<div class="empty">Erro: ${esc(error.message)}</div>`; return; }
  if (!data?.length) { list.innerHTML = '<div class="empty">Nenhum artigo encontrado.</div>'; return; }

  list.innerHTML = data.map(a => articleCard(a)).join('');

  list.querySelectorAll('.article-card').forEach(card => {
    card.onclick = () => openDetail(card.dataset.id);
  });
}

function articleCard(a) {
  const statusBadge = {
    approved: '<span class="pill c-grn">Aprovado</span>',
    draft:    '<span class="pill c-yel">Rascunho</span>',
    archived: '<span class="pill c-gry">Arquivado</span>',
  }[a.status] || '';

  const keywords = (a.keywords || []).slice(0, 5).map(k =>
    `<span class="pill c-blue" style="font-size:10px;margin:2px">${esc(k)}</span>`
  ).join('');

  return `
    <div class="article-card" data-id="${a.id}">
      <div style="display:flex;justify-content:space-between;align-items:flex-start">
        <h4>${esc(a.title)}</h4>
        <div style="display:flex;gap:6px;flex-shrink:0">${statusBadge}
          <span class="pill c-gry">${esc(CAT_LABELS[a.category] || a.category)}</span>
        </div>
      </div>
      <div style="margin-top:4px">${keywords}</div>
      <p>Atualizado ${fmtDate(a.updated_at)}${a.review_due_at ? ` · Revisar em ${fmtDate(a.review_due_at)}` : ''}</p>
    </div>`;
}

// ── Detalhe do artigo ─────────────────────────────────────────────────────────
async function openDetail(id) {
  const { data: a, error } = await getArticle(id);
  if (error || !a) { alert('Erro ao carregar artigo.'); return; }

  const existing = document.getElementById('ov');
  if (existing) existing.remove();

  const ov = document.createElement('div');
  ov.id = 'ov';
  ov.innerHTML = `
    <div id="dr">
      <div style="display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:16px">
        <div>
          <h3 style="margin:0 0 4px">${esc(a.title)}</h3>
          <span class="pill c-gry">${esc(CAT_LABELS[a.category] || a.category)}</span>
          ${{ approved:'<span class="pill c-grn" style="margin-left:6px">Aprovado</span>',
              draft:   '<span class="pill c-yel" style="margin-left:6px">Rascunho</span>',
              archived:'<span class="pill c-gry" style="margin-left:6px">Arquivado</span>' }[a.status] || ''}
        </div>
        <button class="btn g sm" id="ov-close">Fechar</button>
      </div>

      ${a.keywords?.length
        ? `<div style="margin-bottom:12px">${a.keywords.map(k => `<span class="pill c-blue" style="margin:2px">${esc(k)}</span>`).join('')}</div>`
        : ''}

      <div class="expl" style="white-space:pre-wrap">${esc(a.answer_text)}</div>

      <div class="kv"><span>Válido a partir de</span> ${fmtDate(a.effective_from)}</div>
      <div class="kv"><span>Revisão em</span> ${fmtDate(a.review_due_at)}</div>
      <div class="kv"><span>Versão</span> v${a.version}</div>
      <div class="kv"><span>Atualizado</span> ${fmtDate(a.updated_at)}</div>

      ${canManage() ? `
        <div style="display:flex;gap:8px;margin-top:18px;flex-wrap:wrap">
          <button class="btn g sm" id="btn-edit">Editar</button>
          ${a.status === 'draft'    ? '<button class="btn grn sm" id="btn-approve">Aprovar</button>' : ''}
          ${a.status === 'approved' ? '<button class="btn red sm" id="btn-archive">Arquivar</button>' : ''}
        </div>` : ''}
    </div>`;

  document.body.appendChild(ov);
  ov.addEventListener('click', e => { if (e.target === ov) ov.remove(); });
  document.getElementById('ov-close').onclick = () => ov.remove();

  document.getElementById('btn-edit')?.addEventListener('click', () => { ov.remove(); openEditor(a); });
  document.getElementById('btn-approve')?.addEventListener('click', async () => {
    await approveArticle(a.id);
    ov.remove();
    loadArticles();
  });
  document.getElementById('btn-archive')?.addEventListener('click', async () => {
    const { error } = await upsertArticle({ id: a.id, status: 'archived' });
    if (!error) { ov.remove(); loadArticles(); }
  });
}

// ── Editor de artigo ──────────────────────────────────────────────────────────
function openEditor(article) {
  const existing = document.getElementById('ov');
  if (existing) existing.remove();

  const ov = document.createElement('div');
  ov.id = 'ov';
  const isNew = !article?.id;

  ov.innerHTML = `
    <div id="dr">
      <h3 style="margin:0 0 16px">${isNew ? 'Novo artigo' : 'Editar artigo'}</h3>

      <label style="font-size:12px;color:var(--muted);font-weight:600">Título *</label>
      <input id="ed-title" type="text" style="width:100%;padding:9px;border:1px solid var(--linha);border-radius:8px;margin:4px 0 12px;font-size:14px"
        value="${esc(article?.title || '')}"/>

      <label style="font-size:12px;color:var(--muted);font-weight:600">Categoria *</label>
      <select id="ed-cat" style="width:100%;padding:9px;border:1px solid var(--linha);border-radius:8px;margin:4px 0 12px;font-size:14px">
        ${Object.entries(CAT_LABELS).map(([v, l]) =>
          `<option value="${v}"${article?.category === v ? ' selected' : ''}>${l}</option>`
        ).join('')}
      </select>

      <label style="font-size:12px;color:var(--muted);font-weight:600">Keywords (separadas por vírgula)</label>
      <input id="ed-kw" type="text" style="width:100%;padding:9px;border:1px solid var(--linha);border-radius:8px;margin:4px 0 12px;font-size:13px"
        value="${esc((article?.keywords || []).join(', '))}"/>

      <label style="font-size:12px;color:var(--muted);font-weight:600">Resposta / Conteúdo *</label>
      <textarea id="ed-ans" style="min-height:180px;margin:4px 0 12px">${esc(article?.answer_text || '')}</textarea>

      <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-bottom:12px">
        <div>
          <label style="font-size:12px;color:var(--muted);font-weight:600">Válido a partir de</label>
          <input id="ed-from" type="date" style="width:100%;padding:9px;border:1px solid var(--linha);border-radius:8px;margin-top:4px"
            value="${article?.effective_from || ''}"/>
        </div>
        <div>
          <label style="font-size:12px;color:var(--muted);font-weight:600">Revisar em</label>
          <input id="ed-rev" type="date" style="width:100%;padding:9px;border:1px solid var(--linha);border-radius:8px;margin-top:4px"
            value="${article?.review_due_at || ''}"/>
        </div>
      </div>

      <div class="erro" id="ed-err"></div>
      <div style="display:flex;gap:8px;margin-top:4px">
        <button class="btn" id="ed-save">Salvar${isNew ? ' como rascunho' : ''}</button>
        <button class="btn g" id="ed-cancel">Cancelar</button>
      </div>
    </div>`;

  document.body.appendChild(ov);
  ov.addEventListener('click', e => { if (e.target === ov) ov.remove(); });
  document.getElementById('ed-cancel').onclick = () => ov.remove();

  document.getElementById('ed-save').onclick = async () => {
    const title   = document.getElementById('ed-title').value.trim();
    const answer  = document.getElementById('ed-ans').value.trim();
    const errEl   = document.getElementById('ed-err');

    if (!title)  { errEl.textContent = 'Título obrigatório.'; return; }
    if (!answer) { errEl.textContent = 'Conteúdo obrigatório.'; return; }

    const keywords = document.getElementById('ed-kw').value
      .split(',').map(k => k.trim()).filter(Boolean);

    const payload = {
      ...(article?.id ? { id: article.id } : {}),
      title,
      category:       document.getElementById('ed-cat').value,
      keywords,
      answer_text:    answer,
      status:         article?.status || 'draft',
      effective_from: document.getElementById('ed-from').value || null,
      review_due_at:  document.getElementById('ed-rev').value  || null,
    };

    const { error } = await upsertArticle(payload);
    if (error) { errEl.textContent = 'Erro: ' + error.message; return; }
    ov.remove();
    loadArticles();
  };
}
