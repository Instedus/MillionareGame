/* ============================================================
   ГЛАВНАЯ ЛОГИКА ИГРЫ (всё управление — у ведущего)
   ============================================================ */
'use strict';

let CONFIG = null;
let STATE = null;
let busy = false;
let suspenseActive = false; // идёт «секретный» момент ожидания вердикта по выбранному ответу
let pendingScorePop = null; // {teamId, delta}

const TEAM_COLORS = ['#ffd76a', '#4d9dff', '#2dd16a', '#ff6b9d', '#b96bff', '#ff9d4d', '#4dd8e6', '#e8e84d', '#ff4d5e', '#8affc1'];
const TEAM_EMOJI = ['🦁', '🦅', '🐻', '🐉', '🦊', '🐺', '🦉', '🐝', '🐬', '🦄'];

// Модификаторы счёта на рулетке. Матожидание ~0, поэтому баланс не страдает.
const WHEEL_MODS = {
  plus1: { number: '+1', sign: 'plus' },
  plus2: { number: '+2', sign: 'plus' },
  minus1: { number: '−1', sign: 'minus' },
  minus2: { number: '−2', sign: 'minus' }
};
const WHEEL_MODS_LIST = Object.entries(WHEEL_MODS)
  .map(([kind, m]) => ({ id: 'mod:' + kind, number: m.number, kind: 'mod', sign: m.sign }));

const $ = id => document.getElementById(id);

function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, c =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function wait(ms) { return new Promise(r => setTimeout(r, ms)); }

function plural(n, one, few, many) {
  const m10 = Math.abs(n) % 10, m100 = Math.abs(n) % 100;
  if (m10 === 1 && m100 !== 11) return one;
  if (m10 >= 2 && m10 <= 4 && (m100 < 12 || m100 > 14)) return few;
  return many;
}
const pointsWord = n => plural(n, 'балл', 'балла', 'баллов');
const teamsWord = n => plural(n, 'команда', 'команды', 'команд');

function teamColor(t) { return TEAM_COLORS[(t?.colorIndex ?? 0) % TEAM_COLORS.length]; }
function teamEmoji(t) { return TEAM_EMOJI[(t?.colorIndex ?? 0) % TEAM_EMOJI.length]; }

/* ---------- toasts ---------- */

function toast(msg, type = 'info', ttl = 3800) {
  const box = $('toasts');
  const el = document.createElement('div');
  el.className = `toast ${type}`;
  el.textContent = msg;
  box.appendChild(el);
  setTimeout(() => {
    el.classList.add('out');
    setTimeout(() => el.remove(), 320);
  }, ttl);
}

/* ---------- confirm modal ---------- */

function confirmBox(title, text, yesLabel = 'Да') {
  return new Promise(resolve => {
    const modal = $('modal-confirm');
    $('confirm-title').textContent = title;
    $('confirm-text').textContent = text;
    const yes = $('btn-confirm-yes');
    const no = $('btn-confirm-no');
    yes.textContent = yesLabel;
    modal.classList.remove('hidden');

    function cleanup(result) {
      modal.classList.add('hidden');
      yes.removeEventListener('click', onYes);
      no.removeEventListener('click', onNo);
      resolve(result);
    }
    function onYes() { AudioSfx.click(); cleanup(true); }
    function onNo() { AudioSfx.click(); cleanup(false); }
    yes.addEventListener('click', onYes);
    no.addEventListener('click', onNo);
  });
}

/* ---------- screens ---------- */

function showScreen(name) {
  for (const id of ['screen-setup', 'screen-game', 'screen-results']) {
    $(id).classList.toggle('hidden', id !== name);
  }
}

function closeQuestionOverlay() {
  $('overlay-question').classList.add('hidden');
  stopAnswerTimer();
}

function closeAllOverlays() {
  for (const id of ['overlay-question', 'overlay-roulette', 'overlay-timer', 'overlay-transfer', 'overlay-endbanner']) {
    $(id).classList.add('hidden');
  }
  stopTimer();
  stopAnswerTimer();
}

/* ---------- boot ---------- */

async function boot() {
  try {
    CONFIG = await API.config();
  } catch (e) {
    document.body.innerHTML = `<div style="padding:40px;text-align:center;font-family:sans-serif;color:#fff">
      Не удалось загрузить конфигурацию игры: ${esc(e.message)}</div>`;
    return;
  }
  document.title = CONFIG.title;
  $('setup-title').textContent = CONFIG.title;
  $('game-title').textContent = CONFIG.title;
  $('setup-subtitle').textContent = CONFIG.subtitle || '';
  if (CONFIG.theme) {
    $('setup-theme').textContent = '📜 Тема: ' + CONFIG.theme;
    $('setup-theme').classList.remove('hidden');
    $('results-theme').textContent = CONFIG.theme;
  }
  $('btn-sound').textContent = AudioSfx.isMuted() ? '🔇' : '🔊';

  try {
    STATE = await API.state();
  } catch (e) {
    toast('Не удалось загрузить состояние: ' + e.message, 'error');
    return;
  }

  bindEvents();
  renderAll();

  // если страница обновилась посреди хода — сразу показываем вопрос
  if (STATE.phase === 'playing' && STATE.turn) {
    openQuestionOverlay(STATE.turn);
  }
}

function renderAll() {
  if (STATE.phase === 'setup') { showScreen('screen-setup'); renderSetup(); }
  else if (STATE.phase === 'playing') { showScreen('screen-game'); renderGame(); }
  else { showScreen('screen-results'); renderGame(); showResults(); }
}

/* ---------- SETUP ---------- */

function renderSetup() {
  const list = $('setup-teams');
  list.innerHTML = '';
  STATE.teams.forEach((t, i) => {
    const li = document.createElement('li');
    li.className = 'setup-team-item';
    li.style.animationDelay = (i * 0.04) + 's';
    li.innerHTML = `
      <span class="team-dot" style="background:${teamColor(t)};color:${teamColor(t)}"></span>
      <span class="team-emoji">${teamEmoji(t)}</span>
      <span class="team-name">${esc(t.name)}</span>
      <span class="team-num">№${i + 1}</span>
      <button class="btn-remove" title="Удалить команду">✕</button>`;
    li.querySelector('.btn-remove').addEventListener('click', async () => {
      AudioSfx.click();
      try {
        STATE = await API.removeTeam(t.id);
        renderSetup();
      } catch (e) { toast(e.message, 'error'); }
    });
    list.appendChild(li);
  });

  const catsInfo = CONFIG.categories
    .map(c => c.isBackup ? `${c.count} резервных` : `${c.count}×${c.label}`)
    .join(' • ');
  // $('setup-stats').innerHTML =
  //   `<b>${STATE.teams.length}</b> ${teamsWord(STATE.teams.length)} &nbsp;•&nbsp; ${CONFIG.totalQuestions} ${pointsWord(CONFIG.totalQuestions)}: ${catsInfo}` +
  //   `<br>Подсказки у каждой команды: 50:50 · 📞 звонок учителю (${CONFIG.phoneSeconds} с) · 👥 помощь зала (${CONFIG.audienceSeconds} с)`;

  const start = $('btn-start');
  start.disabled = STATE.teams.length === 0;
  start.classList.toggle('ready', !start.disabled);
}

/* ---------- GAME ---------- */

function renderGame() {
  const active = STATE.teams.find(t => t.id === STATE.activeTeamId);

  $('header-turn').textContent = active ? `Ход: «${active.name}»` : 'Ход: выберите команду';
  $('header-turn').classList.toggle('active', !!active);
  $('header-left').textContent = `Осталось вопросов: ${STATE.questionsLeft} из ${STATE.questionsTotal}`;

  renderTeamsPanel();
  renderBoard();

  const hint = $('board-hint');
  if (!active) hint.textContent = '👈 Выберите команду — кликните по её карточке, затем кликните по колонке со стоимостью вопроса';
  else hint.innerHTML = `Ход команды <b style="color:var(--gold)">«${esc(active.name)}»</b> — выберите стоимость вопроса (клик по колонке)`;
}

function renderTeamsPanel() {
  const panel = $('teams-panel');
  panel.innerHTML = '';
  STATE.teams.forEach((t, i) => {
    const card = document.createElement('div');
    card.className = 'team-card' + (t.id === STATE.activeTeamId ? ' active' : '');
    card.style.setProperty('--tc', teamColor(t));
    card.style.animationDelay = (i * 0.04) + 's';
    card.dataset.team = t.id;
    card.title = 'Сделать ход этой команды';
    card.innerHTML = `
      <span class="turn-flag">▶ ХОД</span>
      <div class="team-top">
        <span class="team-emoji">${teamEmoji(t)}</span>
        <span class="team-name-line">${esc(t.name)}</span>
      </div>
      <div class="team-score-row">
        <span class="team-score ${t.score < 0 ? 'negative' : ''}">${t.score}</span>
        <span class="team-score-label">${pointsWord(t.score)}</span>
      </div>
      <div class="ll-icons">
        <span class="ll-chip ${t.fiftyUsed ? 'used' : ''}" title="50:50">½</span>
        <span class="ll-chip ${t.phoneUsed ? 'used' : ''}" title="Звонок учителю">📞</span>
        <span class="ll-chip ${t.audienceUsed ? 'used' : ''}" title="Помощь зала">👥</span>
        <span class="ll-chip ${t.transferUsed ? 'used' : ''}" title="Передача вопроса">🔄</span>
        <span class="ll-chip ${t.insuranceUsed ? 'used' : ''}" title="Страховка">🛡</span>
        <span class="ll-chip ${t.doubleUsed ? 'used' : ''}" title="Удвоение">✖2</span>
      </div>`;
    card.addEventListener('click', () => setActiveTeamFlow(t.id));
    panel.appendChild(card);

    if (pendingScorePop && pendingScorePop.teamId === t.id && pendingScorePop.delta !== 0) {
      const pop = document.createElement('span');
      pop.className = 'score-pop ' + (pendingScorePop.delta > 0 ? 'plus' : 'minus');
      pop.textContent = (pendingScorePop.delta > 0 ? '+' : '−') + Math.abs(pendingScorePop.delta);
      card.appendChild(pop);
    }
  });
  pendingScorePop = null;
}

function renderBoard() {
  const board = $('board');
  board.innerHTML = '';
  for (const cat of STATE.board) {
    const col = document.createElement('div');
    col.className = 'board-col' + (cat.isBackup ? ' backup' : '') + (cat.left <= 0 ? ' exhausted' : '');
    col.dataset.cat = cat.id;

    const cells = cat.cells.map(c => {
      let cls = 'cell';
      let mark = '';
      if (c.used) {
        cls += ' used';
        if (c.correct === true) { cls += ' used-correct'; mark = '<span class="cell-mark">✔</span>'; }
        else if (c.correct === false) { cls += ' used-wrong'; mark = '<span class="cell-mark">✘</span>'; }
        else mark = '<span class="cell-mark">–</span>';
      }
      if (c.current) cls += ' current';
      const tip = c.used
        ? `Вопрос сыгран${c.teamName ? ' — «' + c.teamName + '»' : ''}${c.correct === true ? ', верно' : c.correct === false ? ', неверно' : ', без ответа'}`
        : 'В пуле рулетки';
      return `<div class="${cls}" title="${esc(tip)}">${mark}<span>${esc(c.number)}</span></div>`;
    }).join('');

    col.innerHTML = `
      <div class="col-head">
        <div class="col-title">${cat.isBackup ? '🎲 ' : ''}${esc(cat.label)}</div>
        <div class="col-left">осталось ${cat.left} из ${cat.total}</div>
        <div class="col-spin-hint">🎰 КРУТИТЬ РУЛЕТКУ</div>
      </div>
      <div class="cells-grid">${cells}</div>`;

    col.addEventListener('click', () => spinFlow(cat.id));
    board.appendChild(col);
  }
}

/* ---------- flows ---------- */

async function setActiveTeamFlow(teamId) {
  if (busy) return;
  if (STATE.turn) { toast('Сначала завершите текущий ход', 'error'); return; }
  AudioSfx.unlock();
  AudioSfx.click();
  try {
    STATE = await API.setActiveTeam(teamId);
    renderGame();
  } catch (e) { toast(e.message, 'error'); }
}

async function spinFlow(catId) {
  if (busy) return;
  const cat = STATE.board.find(c => c.id === catId);
  if (!cat) return;
  if (cat.left <= 0) { toast('В этой категории не осталось вопросов', 'error'); return; }
  if (STATE.turn) { toast('Сначала завершите текущий ход', 'error'); return; }
  if (!STATE.activeTeamId) {
    toast('Сначала выберите команду — кликните по её карточке', 'error');
    const p = $('teams-panel');
    p.classList.remove('pulse-hint');
    void p.offsetWidth;
    p.classList.add('pulse-hint');
    return;
  }

  busy = true;
  AudioSfx.unlock();
  AudioSfx.click();
  try {
    const poolBefore = cat.cells.filter(c => !c.used)
      .map(c => ({ id: c.questionId, number: c.number, kind: 'question' }));
    const response = await API.spin(STATE.activeTeamId, catId);
    // Поддержка и нового ответа {state, outcome}, и старого (просто StateDto),
    // чтобы игра не ломалась, если вкладка держит закешированный JS.
    const resultState = response.state || response;
    const outcome = response.outcome || (resultState.turn ? {
      kind: 'question',
      questionId: resultState.turn.question.id,
      questionNumber: resultState.turn.question.number,
      teamName: resultState.turn.teamName
    } : null);
    if (!outcome) throw new Error('Рулетка не вернула результат — обновите страницу');
    const isQuestion = outcome.kind === 'question';

    const chosen = isQuestion
      ? { id: outcome.questionId, number: outcome.questionNumber, kind: 'question' }
      : {
          id: 'mod:' + outcome.kind,
          number: WHEEL_MODS[outcome.kind].number,
          kind: 'mod',
          sign: WHEEL_MODS[outcome.kind].sign,
          label: outcome.label
        };

    await Roulette.spin({
      teamName: outcome.teamName,
      categoryLabel: cat.label,
      pool: poolBefore.concat(WHEEL_MODS_LIST),
      chosen
    });

    STATE = resultState;
    if (isQuestion) {
      renderGame();
      openQuestionOverlay(STATE.turn);
    } else {
      pendingScorePop = { teamId: outcome.teamId, delta: outcome.delta };
      renderGame();
      toast(`🎰 Рулетка: ${outcome.label} команде «${outcome.teamName}»`, outcome.delta > 0 ? 'info' : 'error');
      if (outcome.delta > 0) { AudioSfx.correct(); Confetti.celebrate(); }
      else { AudioSfx.wrong(); }
    }
  } catch (e) {
    toast(e.message, 'error');
  }
  busy = false;
}

/* ---------- question overlay ---------- */

let optionEls = {};

function openQuestionOverlay(turn, resumeLeft) {
  const q = turn.question;
  const team = STATE.teams.find(t => t.id === turn.teamId);
  const answered = !!turn.answered;

  const badge = $('q-team-badge');
  badge.style.setProperty('--tc', teamColor(team));
  badge.innerHTML = `<span class="dot"></span> Команда «${esc(turn.teamName)}»`;

  $('q-number').textContent = `Вопрос №${q.number} · ${q.categoryLabel}`;
  const stake = turn.doubled ? q.points * 2 : q.points;
  $('q-points').innerHTML = q.points > 0
    ? `${stake} ${pointsWord(stake)} <span style="font-size:.8rem;color:var(--muted)">${turn.insured ? '(ошибка = 0)' : '(±)'}</span>`
    : `Резервный вопрос <span style="font-size:.8rem;color:var(--muted)">(0 очков)</span>`;

  $('q-text').textContent = q.text;
  renderTurnEffects(turn);

  // options
  const box = $('q-options');
  box.innerHTML = '';
  optionEls = {};
  for (const o of q.options) {
    const btn = document.createElement('button');
    btn.className = 'answer';
    btn.dataset.letter = o.letter;
    btn.innerHTML = `<span class="letter-badge">${esc(o.letter)}</span><span class="answer-text">${esc(o.text)}</span>`;
    btn.addEventListener('click', () => answerFlow(o.letter));
    box.appendChild(btn);
    optionEls[o.letter] = btn;
    if (q.hidden.includes(o.letter)) { btn.classList.add('eliminated', 'disabled'); }
  }

  // lifelines
  updateLifelineButtons(team, answered);

  // explain / banner / actions
  const explain = $('q-explain');
  explain.classList.add('hidden');
  explain.innerHTML = '';
  const oldBanner = document.querySelector('.result-banner');
  if (oldBanner) oldBanner.remove();
  $('btn-pass').classList.toggle('hidden', answered);
  $('btn-pass').disabled = false;
  $('btn-next-turn').classList.add('hidden');

  if (answered) {
    applyAnsweredVisual(turn.answered, q, /*instant*/ true);
    stopAnswerTimer();
  } else {
    startAnswerTimer(resumeLeft);
  }

  $('overlay-question').classList.remove('hidden');
}

function renderTurnEffects(turn) {
  const box = $('q-effects');
  if (!turn) { box.classList.add('hidden'); box.innerHTML = ''; return; }
  const chips = [];
  if (turn.transferred) chips.push('<span class="q-effect">🔄 Вопрос передан другой команде</span>');
  if (turn.insured) chips.push('<span class="q-effect insured">🛡 Страховка: ошибка без штрафа</span>');
  if (turn.doubled) chips.push('<span class="q-effect doubled">✖2 Удвоение: очки ×2</span>');
  box.innerHTML = chips.join('');
  box.classList.toggle('hidden', chips.length === 0);
}

function updateLifelineButtons(team, forceDisable) {
  const turn = STATE.turn;
  document.querySelectorAll('#q-lifelines .lifeline-btn').forEach(btn => {
    const type = btn.dataset.ll;
    let used = !team;
    if (team) {
      if (type === 'fifty') used = team.fiftyUsed;
      else if (type === 'phone') used = team.phoneUsed;
      else if (type === 'audience') used = team.audienceUsed;
      else if (type === 'transfer') used = team.transferUsed || !!turn?.transferred;
      else if (type === 'insurance') used = team.insuranceUsed || !!turn?.insured || !!turn?.doubled;
      else if (type === 'double') used = team.doubleUsed || !!turn?.doubled || !!turn?.insured;
      else used = true;
    }
    btn.disabled = used || forceDisable;
    btn.classList.toggle('used-flag', used);
  });
}

function applyAnsweredVisual(ans, q, instant) {
  stopAnswerTimer();
  const timedOut = !!ans.timedOut;
  const chosen = ans.chosen ? optionEls[ans.chosen] : null;
  const correctEl = optionEls[ans.correctLetter];
  Object.values(optionEls).forEach(el => el.classList.add('disabled'));

  if (ans.correct) {
    if (chosen) chosen.classList.add('correct');
  } else {
    if (chosen) chosen.classList.add('wrong');
    if (correctEl) correctEl.classList.add('reveal-correct');
  }

  // banner
  const banner = document.createElement('div');
  const deltaAbs = Math.abs(ans.delta);
  const deltaText = ans.delta === 0
    ? '0 очков'
    : (ans.delta > 0 ? `+${deltaAbs}` : `−${deltaAbs}`) + ' ' + pointsWord(deltaAbs);
  banner.className = 'result-banner ' + (ans.correct ? 'good' : 'bad');
  banner.textContent = timedOut
    ? `⏰ ВРЕМЯ ВЫШЛО!  ${deltaText}`
    : ans.correct ? `✅ ВЕРНО!  ${deltaText}` : `❌ НЕВЕРНО!  ${deltaText}`;
  $('q-options').after(banner);

  // explanation
  const explain = $('q-explain');
  explain.innerHTML =
    `<span class="explain-caption">💡 ПРАВИЛЬНЫЙ ОТВЕТ: ${esc(ans.correctLetter)}${ans.explanation ? ' · КОММЕНТАРИЙ' : ''}</span>` +
    (ans.explanation ? esc(ans.explanation) : '');
  explain.classList.remove('hidden');

  updateLifelineButtons(STATE.teams.find(t => t.id === STATE.turn?.teamId), true);
  $('btn-pass').classList.add('hidden');
  $('btn-next-turn').classList.remove('hidden');
  if (!instant) $('q-stage')?.scrollIntoView?.({ behavior: 'smooth', block: 'center' });
}

async function answerFlow(letter) {
  if (busy || !STATE.turn || STATE.turn.answered) return;
  const el = optionEls[letter];
  if (!el || el.classList.contains('eliminated') || el.classList.contains('disabled')) return;

  busy = true;
  const timerLeft = answerTimer ? answerTimer.left : undefined;
  stopAnswerTimer();
  Object.values(optionEls).forEach(o => { if (o !== el) o.classList.add('disabled'); });
  el.classList.add('suspense');
  suspenseActive = true;
  $('btn-pass').disabled = true;
  updateLifelineButtons(STATE.teams.find(t => t.id === STATE.turn.teamId), true);
  AudioSfx.unlock();
  AudioSfx.suspenseStart();

  const t0 = performance.now();
  let st;
  try {
    st = await API.answer(letter);
  } catch (e) {
    AudioSfx.suspenseStop();
    el.classList.remove('suspense');
    suspenseActive = false;
    $('btn-pass').disabled = false;
    updateLifelineButtons(STATE.teams.find(t => t.id === STATE.turn.teamId), false);
    Object.values(optionEls).forEach(o => o.classList.remove('disabled'));
    startAnswerTimer(timerLeft);
    toast(e.message, 'error');
    busy = false;
    return;
  }
  STATE = st;

  const elapsed = performance.now() - t0;
  await wait(Math.max(0, 2600 - elapsed));
  AudioSfx.suspenseStop();
  el.classList.remove('suspense');
  suspenseActive = false;

  const ans = STATE.turn.answered;
  applyAnsweredVisual(ans, STATE.turn.question, false);

  if (ans.correct) {
    AudioSfx.correct();
    Confetti.celebrate();
    const r = el.getBoundingClientRect();
    Confetti.burst(r.left + r.width / 2, r.top + r.height / 2, 60, ['#2dd16a', '#ffd76a', '#ffffff']);
  } else {
    AudioSfx.wrong();
    document.body.classList.add('shake-it');
    setTimeout(() => document.body.classList.remove('shake-it'), 600);
  }

  pendingScorePop = { teamId: STATE.turn.teamId, delta: ans.delta };
  renderGame();
  busy = false;
}

async function useLifeline(type) {
  if (busy || suspenseActive || !STATE.turn || STATE.turn.answered) return;
  if (type === 'transfer') { await transferFlow(); return; }

  busy = true;
  AudioSfx.unlock();
  AudioSfx.click();
  const timerLeft = answerTimer ? answerTimer.left : undefined;
  try {
    STATE = await API.lifeline(type);
    const team = STATE.teams.find(t => t.id === STATE.turn.teamId);

    if (type === 'fifty') {
      updateLifelineButtons(team, false);
      const btn = document.querySelector(`#q-lifelines .lifeline-btn[data-ll="fifty"]`);
      if (btn) { btn.classList.add('flash50'); setTimeout(() => btn.classList.remove('flash50'), 850); }
      AudioSfx.eliminate();
      for (const letter of STATE.turn.question.hidden) {
        const el = optionEls[letter];
        if (el) el.classList.add('eliminated', 'disabled');
      }
      renderGame();
    } else if (type === 'insurance' || type === 'double') {
      openQuestionOverlay(STATE.turn, timerLeft);
      toast(type === 'insurance'
        ? '🛡 Страховка активна: ошибка не отнимет очки'
        : '✖2 Удвоение активно: очки вопроса удвоены', 'info');
      renderGame();
    } else {
      const isPhone = type === 'phone';
      pauseAnswerTimer();
      openTimer(
        isPhone ? 'ЗВОНОК УЧИТЕЛЮ' : 'ПОМОЩЬ ЗАЛА',
        isPhone
          ? `Команда «${STATE.turn.teamName}» советуется с учителем…`
          : `Другие команды могут подсказать команде «${STATE.turn.teamName}»…`,
        isPhone ? '📞' : '👥',
        isPhone ? CONFIG.phoneSeconds : CONFIG.audienceSeconds
      );
      renderGame();
    }
  } catch (e) {
    toast(e.message, 'error');
  }
  busy = false;
}

/* ---------- transfer question ---------- */

async function transferFlow() {
  if (busy || suspenseActive || !STATE.turn || STATE.turn.answered) return;
  if (STATE.turn.transferred) { toast('За этот ход вопрос уже передавали — второй раз нельзя', 'error'); return; }
  const team = STATE.teams.find(t => t.id === STATE.turn.teamId);
  if (team && team.transferUsed) { toast('Передача вопроса этой командой уже использована', 'error'); return; }

  const targetId = await pickTransferTarget();
  if (!targetId) return;

  busy = true;
  const timerLeft = answerTimer ? answerTimer.left : undefined;
  try {
    STATE = await API.transfer(targetId);
    AudioSfx.click();
    renderGame();
    openQuestionOverlay(STATE.turn, timerLeft);
    toast(`🔄 Вопрос передан команде «${STATE.turn.teamName}»`, 'info');
  } catch (e) {
    resumeAnswerTimer();
    toast(e.message, 'error');
  }
  busy = false;
}

function pickTransferTarget() {
  return new Promise(resolve => {
    const modal = $('overlay-transfer');
    const list = $('transfer-list');
    const cancel = $('btn-transfer-cancel');
    list.innerHTML = '';

    const others = STATE.teams.filter(t => t.id !== STATE.turn.teamId);
    if (others.length === 0) {
      toast('Нет другой команды, которой можно передать вопрос', 'error');
      resolve(null);
      return;
    }
    for (const t of others) {
      const btn = document.createElement('button');
      btn.className = 'transfer-team';
      btn.innerHTML = `<span class="tt-emoji">${teamEmoji(t)}</span>
        <span class="tt-dot" style="color:${teamColor(t)}">●</span>
        <span class="tt-name">${esc(t.name)}</span>`;
      btn.addEventListener('click', () => cleanup(t.id));
      list.appendChild(btn);
    }

    function cleanup(result) {
      modal.classList.add('hidden');
      cancel.removeEventListener('click', onCancel);
      resolve(result);
      if (result === null) resumeAnswerTimer(); // при передаче таймер перезапустит openQuestionOverlay
    }
    function onCancel() { AudioSfx.click(); cleanup(null); }

    cancel.addEventListener('click', onCancel);
    pauseAnswerTimer();
    modal.classList.remove('hidden');
  });
}

async function passFlow() {
  if (busy || suspenseActive || !STATE.turn || STATE.turn.answered) return;
  const ok = await confirmBox(
    'Сдать ход?',
    `Команда «${STATE.turn.teamName}» отказывается отвечать: очки не меняются, но вопрос остаётся сыгранным.`,
    'Сдать ход');
  if (!ok) return;
  busy = true;
  try {
    STATE = await API.pass();
    closeQuestionOverlay();
    renderGame();
    await afterTurnClosed();
  } catch (e) { toast(e.message, 'error'); }
  busy = false;
}

async function nextTurnFlow() {
  if (busy) return;
  busy = true;
  AudioSfx.click();
  try {
    STATE = await API.closeTurn();
    closeQuestionOverlay();
    renderGame();
    await afterTurnClosed();
  } catch (e) { toast(e.message, 'error'); }
  busy = false;
}

async function afterTurnClosed() {
  if (STATE.questionsLeft <= 0) {
    $('endbanner-text').textContent = '🎉 Все вопросы разыграны!';
    $('overlay-endbanner').classList.remove('hidden');
    AudioSfx.fanfareShort();
    await wait(2400);
    $('overlay-endbanner').classList.add('hidden');
    await doFinish();
  }
}

async function doFinish() {
  try {
    STATE = await API.finish();
    closeAllOverlays();
    showResults();
  } catch (e) { toast(e.message, 'error'); }
}

async function finishFlow() {
  if (busy) return;
  const ok = await confirmBox(
    'Подвести итоги?',
    'Игра завершится и будет объявлена команда-победитель. Незакрытый ход (если есть) отменится без изменения очков.',
    '🏁 Подвести итоги');
  if (!ok) return;
  busy = true;
  AudioSfx.click();
  await doFinish();
  busy = false;
}

/* ---------- answer timer (30 sec) ---------- */

let answerTimer = null;

function startAnswerTimer(resumeLeft) {
  stopAnswerTimer();
  const total = Math.max(5, Number(CONFIG?.answerSeconds) || 30);
  const left = Number.isFinite(resumeLeft)
    ? Math.min(total, Math.max(1, resumeLeft))
    : total;

  const box = $('q-timer');
  const secEl = $('q-timer-sec');
  const fill = $('q-timer-fill');
  box.classList.remove('hidden', 'warn', 'danger');
  secEl.classList.remove('tick');
  secEl.textContent = String(left);
  fill.style.width = ((left / total) * 100) + '%';

  answerTimer = {
    total, left, paused: false, done: false,
    interval: setInterval(() => {
      if (!answerTimer || answerTimer.paused || answerTimer.done || busy) return;
      answerTimer.left--;
      renderAnswerTimer();
      if (answerTimer.left <= 0) answerTimerDone();
    }, 1000)
  };
  renderAnswerTimer();
}

function renderAnswerTimer() {
  if (!answerTimer) return;
  const t = answerTimer;
  const secEl = $('q-timer-sec');
  const box = $('q-timer');
  secEl.textContent = String(Math.max(0, t.left));
  secEl.classList.remove('tick');
  void secEl.offsetWidth;
  secEl.classList.add('tick');
  $('q-timer-fill').style.width = ((Math.max(0, t.left) / t.total) * 100) + '%';
  box.classList.toggle('warn', t.left <= Math.min(10, Math.round(t.total / 3)) && t.left > 5);
  box.classList.toggle('danger', t.left <= 5);
  if (t.left <= 5 && t.left > 0) AudioSfx.timerTick(false);
}

function answerTimerDone() {
  if (!answerTimer || answerTimer.done) return;
  answerTimer.done = true;
  clearInterval(answerTimer.interval);
  const box = $('q-timer');
  box.classList.add('danger');
  $('q-timer-sec').textContent = '⏰';
  $('q-timer-fill').style.width = '0%';
  AudioSfx.bell();
  timeoutFlow();
}

async function timeoutFlow() {
  if (busy || !STATE?.turn || STATE.turn.answered) return;
  busy = true;
  try {
    STATE = await API.timeout();
    pendingScorePop = { teamId: STATE.turn.teamId, delta: 0 };
    renderGame();
    applyAnsweredVisual(STATE.turn.answered, STATE.turn.question, false);
    AudioSfx.wrong();
    toast('⏰ Время вышло! Очки не начислены — вопрос остался сыгранным', 'error');
  } catch (e) {
    toast(e.message, 'error');
  }
  busy = false;
}

function pauseAnswerTimer() { if (answerTimer && !answerTimer.done) answerTimer.paused = true; }
function resumeAnswerTimer() { if (answerTimer && !answerTimer.done) answerTimer.paused = false; }

function stopAnswerTimer() {
  if (answerTimer) { clearInterval(answerTimer.interval); answerTimer = null; }
  $('q-timer')?.classList.add('hidden');
}

/* ---------- timer overlay ---------- */

let timer = null;

function openTimer(label, sub, icon, seconds) {
  stopTimer();
  $('timer-icon').textContent = icon;
  $('timer-label').textContent = label;
  $('timer-sub').textContent = sub;
  $('btn-timer-pause').textContent = '⏸ Пауза';
  $('btn-timer-close').textContent = '✔ Завершить';

  const circle = $('timer-circle');
  const R = 98;
  const C = 2 * Math.PI * R;
  circle.style.strokeDasharray = String(C);
  circle.style.strokeDashoffset = '0';
  circle.classList.remove('warn', 'danger');

  const secEl = $('timer-seconds');
  secEl.classList.remove('done');
  secEl.textContent = String(seconds);

  $('overlay-timer').classList.remove('hidden');
  AudioSfx.unlock();

  timer = {
    total: seconds, left: seconds, paused: false, done: false, C,
    interval: setInterval(() => {
      if (timer.paused || timer.done) return;
      timer.left--;
      renderTimerSecond();
      if (timer.left <= 0) timerDone();
    }, 1000)
  };
}

function renderTimerSecond() {
  if (!timer) return;
  const secEl = $('timer-seconds');
  const circle = $('timer-circle');
  secEl.textContent = String(Math.max(0, timer.left));
  secEl.classList.remove('tick');
  void secEl.offsetWidth;
  secEl.classList.add('tick');
  const frac = timer.left / timer.total;
  circle.style.strokeDashoffset = String(timer.C * (1 - frac));
  circle.classList.toggle('warn', timer.left <= Math.min(15, timer.total * 0.3) && timer.left > 5);
  circle.classList.toggle('danger', timer.left <= 5);
  if (timer.left <= 5 && timer.left > 0) AudioSfx.timerTick(false);
}

function timerDone() {
  if (!timer) return;
  timer.done = true;
  const secEl = $('timer-seconds');
  secEl.classList.add('done');
  secEl.textContent = '⏰';
  $('timer-label').textContent = 'ВРЕМЯ ВЫШЛО!';
  $('btn-timer-pause').classList.add('hidden');
  AudioSfx.bell();
}

function stopTimer() {
  if (timer) { clearInterval(timer.interval); timer = null; }
  $('overlay-timer').classList.add('hidden');
  $('btn-timer-pause').classList.remove('hidden');
}

function toggleTimerPause() {
  if (!timer || timer.done) return;
  timer.paused = !timer.paused;
  $('btn-timer-pause').textContent = timer.paused ? '▶ Продолжить' : '⏸ Пауза';
  AudioSfx.click();
}

/* ---------- results ---------- */

function showResults() {
  showScreen('screen-results');

  const sorted = STATE.teams.slice().sort((a, b) => b.score - a.score || b.correctCount - a.correctCount);
  const winnerIds = new Set(STATE.winners || []);
  const winners = sorted.filter(t => winnerIds.has(t.id));

  // winner line
  const w = $('results-winner');
  if (winners.length === 1) {
    w.innerHTML = `<span class="win-crown">👑</span> Победитель — команда <span class="win-name">«${esc(winners[0].name)}»</span>! <span class="win-crown">🏆</span>`;
  } else if (winners.length > 1) {
    w.innerHTML = `<span class="win-crown">🤝</span> Ничья! Побеждают команды: <span class="win-name">${winners.map(t => '«' + esc(t.name) + '»').join(', ')}</span>`;
  } else {
    w.innerHTML = '';
  }

  // podium (top-3, order: 2, 1, 3)
  const podium = $('results-podium');
  podium.innerHTML = '';
  const top = sorted.slice(0, 3);
  const medals = ['🥇', '🥈', '🥉'];
  const order = top.length >= 3 ? [1, 0, 2] : top.length === 2 ? [1, 0] : [0];
  for (const idx of order) {
    const t = top[idx];
    if (!t) continue;
    const div = document.createElement('div');
    div.className = `podium-place p${idx + 1}`;
    div.style.setProperty('--tc', teamColor(t));
    div.innerHTML = `
      ${idx === 0 ? '<div class="p-trophy">🏆</div>' : ''}
      <div class="p-medal">${medals[idx]}</div>
      <div class="p-name">${teamEmoji(t)} «${esc(t.name)}»</div>
      <div class="p-score">${t.score} ${pointsWord(t.score)}</div>
      <div class="p-block">${idx + 1}</div>`;
    podium.appendChild(div);
  }
  if (top.length === 0) podium.classList.add('hidden'); else podium.classList.remove('hidden');

  // ranking
  const rank = $('results-ranking');
  rank.innerHTML = '';
  sorted.forEach((t, i) => {
    const place = 1 + sorted.filter(x => x.score > t.score).length;
    const row = document.createElement('div');
    row.className = 'ranking-row' + (winnerIds.has(t.id) ? ' winner-row' : '');
    row.style.animationDelay = (i * 0.07) + 's';
    row.innerHTML = `
      <span class="r-place">${place}${winnerIds.has(t.id) ? ' 👑' : ''}</span>
      <span class="r-dot" style="background:${teamColor(t)};color:${teamColor(t)}"></span>
      <span class="r-name">${teamEmoji(t)} ${esc(t.name)}</span>
      <span class="r-stats">✔ ${t.correctCount} · ✘ ${t.wrongCount}</span>
      <span class="r-score">${t.score}</span>`;
    rank.appendChild(row);
  });

  Confetti.rain(4200, 10);
  AudioSfx.unlock();
  AudioSfx.win();
}

async function resetFlow(keepTeams) {
  const ok = await confirmBox(
    keepTeams ? 'Новая игра?' : 'Полный сброс?',
    keepTeams
      ? 'Команды останутся, но очки, подсказки и сыгранные вопросы будут сброшены.'
      : 'Будут удалены ВСЕ команды, очки и история вопросов. Игра вернётся к начальному экрану.',
    keepTeams ? '🔄 Начать заново' : '🧹 Сбросить всё');
  if (!ok) return;
  busy = true;
  try {
    STATE = await API.reset(keepTeams);
    closeAllOverlays();
    renderAll();
    toast(keepTeams ? 'Новая игра! Команды на месте — жмите «Начать игру»' : 'Полный сброс выполнен', 'info');
  } catch (e) { toast(e.message, 'error'); }
  busy = false;
}

/* ---------- events ---------- */

function bindEvents() {
  // unlock audio on first interaction
  document.addEventListener('pointerdown', () => AudioSfx.unlock(), { passive: true });

  // setup
  const input = $('team-name-input');
  async function addTeam() {
    const name = input.value.trim();
    if (!name) { toast('Введите название команды', 'error'); input.focus(); return; }
    input.value = ''; // очищаем сразу, чтобы быстрый ввод следующей команды не потерялся
    AudioSfx.unlock();
    try {
      STATE = await API.addTeam(name);
      AudioSfx.click();
      renderSetup();
    } catch (e) {
      input.value = name; // возвращаем имя при ошибке (например, дубликат)
      toast(e.message, 'error');
    }
    input.focus();
  }
  $('btn-add-team').addEventListener('click', addTeam);
  input.addEventListener('keydown', e => { if (e.key === 'Enter') addTeam(); });

  $('btn-start').addEventListener('click', async () => {
    if (busy) return;
    busy = true;
    AudioSfx.unlock();
    AudioSfx.fanfareShort();
    try {
      STATE = await API.start();
      showScreen('screen-game');
      renderGame();
    } catch (e) { toast(e.message, 'error'); }
    busy = false;
  });

  // game header
  $('btn-sound').addEventListener('click', () => {
    const m = !AudioSfx.isMuted();
    AudioSfx.setMuted(m);
    $('btn-sound').textContent = m ? '🔇' : '🔊';
    if (!m) AudioSfx.click();
  });
  $('btn-finish').addEventListener('click', finishFlow);

  // question overlay
  document.querySelectorAll('#q-lifelines .lifeline-btn').forEach(btn => {
    btn.addEventListener('click', () => useLifeline(btn.dataset.ll));
  });
  $('btn-pass').addEventListener('click', passFlow);
  $('btn-next-turn').addEventListener('click', nextTurnFlow);

  // timer
  $('btn-timer-pause').addEventListener('click', toggleTimerPause);
  $('btn-timer-close').addEventListener('click', () => { AudioSfx.click(); stopTimer(); resumeAnswerTimer(); });

  // results
  $('btn-new-game').addEventListener('click', () => resetFlow(true));
  $('btn-full-reset').addEventListener('click', () => resetFlow(false));
}

document.addEventListener('DOMContentLoaded', boot);
