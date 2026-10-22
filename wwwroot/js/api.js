/* ============================================================
   Обёртка над REST API игры.
   ============================================================ */
async function apiCall(path, opts = {}) {
  const res = await fetch('/api' + path, {
    headers: { 'Content-Type': 'application/json' },
    ...opts
  });
  let data = null;
  try { data = await res.json(); } catch (e) { /* no body */ }
  if (!res.ok) {
    const msg = data && data.error ? data.error : `Ошибка сервера (${res.status})`;
    throw new Error(msg);
  }
  return data;
}

const API = {
  config: () => apiCall('/config'),
  state: () => apiCall('/state'),
  addTeam: name => apiCall('/teams', { method: 'POST', body: JSON.stringify({ name }) }),
  removeTeam: id => apiCall(`/teams/${id}`, { method: 'DELETE' }),
  start: () => apiCall('/start', { method: 'POST' }),
  setActiveTeam: teamId => apiCall('/active-team', { method: 'POST', body: JSON.stringify({ teamId }) }),
  spin: (teamId, categoryId) => apiCall('/spin', { method: 'POST', body: JSON.stringify({ teamId, categoryId }) }),
  lifeline: type => apiCall('/lifeline', { method: 'POST', body: JSON.stringify({ type }) }),
  transfer: teamId => apiCall('/transfer', { method: 'POST', body: JSON.stringify({ teamId }) }),
  timeout: () => apiCall('/timeout', { method: 'POST' }),
  answer: letter => apiCall('/answer', { method: 'POST', body: JSON.stringify({ letter }) }),
  pass: () => apiCall('/pass', { method: 'POST' }),
  closeTurn: () => apiCall('/close-turn', { method: 'POST' }),
  finish: () => apiCall('/finish', { method: 'POST' }),
  reset: keepTeams => apiCall('/reset', { method: 'POST', body: JSON.stringify({ keepTeams }) })
};
