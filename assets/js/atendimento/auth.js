// auth.js — Entrada principal do módulo Atendimento
// Gerencia autenticação, app shell e roteamento por hash
import { sb, getMyRoles, FLAGS } from './api.js';
import { renderRequests } from './requests.js';
import { renderLaboratory } from './laboratory.js';
import { renderPointDiscipline } from './point-discipline.js';
import { renderKnowledgeBase } from './knowledge-base.js';

const ROOT = document.getElementById('root');

// Estado global compartilhado
export const state = {
  user: null,
  roles: [],
  email: '',
};

export function hasRole(...roles) {
  return roles.some(r => state.roles.includes(r));
}
export function canManage() {
  return hasRole('owner', 'supervisor_dp', 'analyst_dp');
}
export function isOwner() {
  return hasRole('owner');
}

// ── Boot ──────────────────────────────────────────────────────────────────────
async function boot() {
  if (!FLAGS.serviceDesk) {
    ROOT.innerHTML = `<div style="text-align:center;padding:60px;color:#64748b">
      <h2>Módulo não disponível</h2>
      <p>O módulo Atendimento do Colaborador ainda não foi habilitado neste ambiente.</p>
      <a href="./index.html">← Ponto Inteligente</a>
    </div>`;
    return;
  }

  // Link de recuperação de senha
  const hash  = Object.fromEntries(new URLSearchParams(location.hash.slice(1)));
  const query = Object.fromEntries(new URLSearchParams(location.search.slice(1)));
  if ((hash.type || query.type) === 'recovery') {
    await new Promise(r => setTimeout(r, 800));
    const { data: { session } } = await sb.auth.getSession();
    if (session) { state.user = session.user; return renderNovaSenha(); }
  }

  const { data: { session } } = await sb.auth.getSession();
  if (session) { state.user = session.user; await afterLogin(); }
  else renderLogin();
}

// ── Login / Nova senha ────────────────────────────────────────────────────────
function renderLogin(msg) {
  ROOT.innerHTML = `
    <div class="login">
      <h2>Atendimento DP</h2>
      <p>Módulo interno — acesso restrito</p>
      <label>E-mail</label>
      <input id="e" type="email" placeholder="seu.email@velper.com.br" autocomplete="username"/>
      <label>Senha</label>
      <input id="s" type="password" placeholder="sua senha" autocomplete="current-password"/>
      <button id="b">Entrar</button>
      <div class="erro">${msg || ''}</div>
    </div>`;

  const go = async () => {
    document.getElementById('b').disabled = true;
    const { data, error } = await sb.auth.signInWithPassword({
      email:    document.getElementById('e').value.trim(),
      password: document.getElementById('s').value,
    });
    if (error) { renderLogin('E-mail ou senha inválidos.'); return; }
    state.user = data.user;
    await afterLogin();
  };
  document.getElementById('b').onclick = go;
  document.getElementById('s').addEventListener('keydown', e => e.key === 'Enter' && go());
}

function renderNovaSenha(msg) {
  ROOT.innerHTML = `
    <div class="login">
      <h2>Redefinir senha</h2>
      <p>Digite sua nova senha.</p>
      <label>Nova senha</label><input id="p1" type="password" placeholder="Mínimo 6 caracteres"/>
      <label>Confirmar</label><input id="p2" type="password" placeholder="Repita"/>
      <button id="b">Salvar</button>
      <div class="erro">${msg || ''}</div>
    </div>`;
  document.getElementById('b').onclick = async () => {
    const p1 = document.getElementById('p1').value;
    const p2 = document.getElementById('p2').value;
    if (p1.length < 6) return renderNovaSenha('Mínimo 6 caracteres.');
    if (p1 !== p2)     return renderNovaSenha('As senhas não coincidem.');
    const { error } = await sb.auth.updateUser({ password: p1 });
    if (error) return renderNovaSenha('Erro: ' + error.message);
    history.replaceState(null, '', location.pathname);
    await afterLogin();
  };
}

// ── Pós-login ─────────────────────────────────────────────────────────────────
async function afterLogin() {
  state.email = state.user.email || '';
  state.roles = await getMyRoles();

  if (!state.roles.length) {
    ROOT.innerHTML = `<div class="login">
      <h2>Sem permissão</h2>
      <p>Seu usuário (${state.email}) não tem acesso ao Atendimento DP.</p>
      <p><a href="./index.html">← Ponto Inteligente</a></p>
      <button onclick="(async()=>{await import('./api.js').then(m=>m.sb.auth.signOut());location.reload()})()">Sair</button>
    </div>`;
    return;
  }

  renderShell();
  navigate();
  window.addEventListener('hashchange', navigate);
}

// ── App Shell ─────────────────────────────────────────────────────────────────
function renderShell() {
  const rolesLabel = state.roles.join(', ');
  ROOT.innerHTML = `
    <div id="app">
      <aside>
        <div class="brand">Atendimento DP<small>Módulo interno</small></div>
        <nav>
          <a class="back-link" href="./index.html">← Ponto Inteligente</a>
          <div class="sep"></div>
          <a href="#requests"   data-tab="requests">Solicitações</a>
          <a href="#laboratory" data-tab="laboratory">Laboratório</a>
          <a href="#discipline" data-tab="discipline">Exceções de Ponto</a>
          ${FLAGS.knowledgeBase ? '<a href="#kb" data-tab="kb">Base de Conhecimento</a>' : ''}
        </nav>
      </aside>
      <div class="main-area">
        <div class="topbar">
          <div>
            <span class="seal">BETA</span>
          </div>
          <div class="u">
            <b>${esc(state.email)}</b>
            <span style="color:var(--muted);font-size:11px;margin-left:6px">${esc(rolesLabel)}</span>
            <span class="sair" id="sair">Sair</span>
          </div>
        </div>
        <div class="content" id="content"></div>
      </div>
    </div>`;

  document.getElementById('sair').onclick = async () => {
    await sb.auth.signOut();
    location.reload();
  };
}

function setActiveTab(tab) {
  document.querySelectorAll('aside nav a[data-tab]').forEach(a => {
    a.classList.toggle('on', a.dataset.tab === tab);
  });
}

function navigate() {
  const hash = location.hash.replace('#', '') || 'requests';
  const content = document.getElementById('content');
  if (!content) return;

  const map = { requests: 'requests', laboratory: 'laboratory', discipline: 'discipline', kb: 'kb' };
  const tab = map[hash] || 'requests';
  setActiveTab(tab);

  if (tab === 'requests')   renderRequests(content, state);
  else if (tab === 'laboratory') renderLaboratory(content, state);
  else if (tab === 'discipline') renderPointDiscipline(content, state);
  else if (tab === 'kb')    renderKnowledgeBase(content, state);
}

// ── Utilitário de escape para uso externo ─────────────────────────────────────
export function esc(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

boot();
