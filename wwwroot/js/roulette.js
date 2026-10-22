/* ============================================================
   РУЛЕТКА ВОПРОСОВ
   Горизонтальная лента с номерами вопросов: раскручивается,
   замедляется и останавливается на выпавшем вопросе.
   ============================================================ */
const Roulette = (() => {
  const overlay = document.getElementById('overlay-roulette');
  const strip = document.getElementById('reel-strip');
  const subEl = document.getElementById('roulette-sub');
  const resultEl = document.getElementById('roulette-result');

  function esc(s) {
    return String(s).replace(/[&<>"']/g, c =>
      ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }

  function shuffle(arr) {
    const a = arr.slice();
    for (let i = a.length - 1; i > 0; i--) {
      const j = (Math.random() * (i + 1)) | 0;
      [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
  }

  /**
   * @param {object} p
   * @param {string} p.teamName    — имя команды
   * @param {string} p.categoryLabel — «2 балла» / «Резерв»
   * @param {Array}  p.pool        — элементы ленты: вопросы {id, number, kind:'question'}
   *                                 и модификаторы {id, number, kind:'mod', sign:'plus'|'minus'}
   * @param {object} p.chosen      — выпавший элемент (вопрос или модификатор)
   * @returns {Promise<void>}
   */
  function spin(p) {
    return new Promise(resolve => {
      const pool = p.pool && p.pool.length ? p.pool : [{ id: p.chosen.id, number: p.chosen.number }];

      subEl.innerHTML = `Команда <b>«${esc(p.teamName)}»</b> &nbsp;•&nbsp; категория <b>${esc(p.categoryLabel)}</b>`;
      resultEl.classList.add('hidden');
      resultEl.textContent = '';
      strip.classList.remove('blurred');
      strip.innerHTML = '';

      // Собираем ленту: несколько «кругов» из перемешанных номеров, последний элемент — выпавший.
      const loops = Math.max(4, Math.min(8, Math.ceil(46 / pool.length)));
      const items = [];
      for (let l = 0; l < loops; l++) items.push(...shuffle(pool));
      // гарантируем, что финальный элемент — chosen
      if (items.length) items[items.length - 1] = p.chosen;
      else items.push(p.chosen);
      const chosenIdx = items.length - 1;

      for (const it of items) {
        const cell = document.createElement('div');
        const isMod = it.kind === 'mod';
        cell.className = 'reel-cell' + (isMod ? ' mod ' + (it.sign || 'plus') : '');
        cell.dataset.qid = it.id;
        cell.innerHTML = `<span class="rc-q">${isMod ? 'счёт' : 'вопрос'}</span><span class="rc-n">${esc(it.number)}</span>`;
        strip.appendChild(cell);
      }

      overlay.classList.remove('hidden');
      AudioSfx.unlock();
      AudioSfx.whoosh();

      // geometry
      const frame = strip.parentElement;
      const frameW = frame.clientWidth;
      const first = strip.querySelector('.reel-cell');
      const cellW = first.offsetWidth;
      const gap = 14;
      const step = cellW + gap;
      const padLeft = 14;
      const targetX = -(padLeft + chosenIdx * step + cellW / 2 - frameW / 2);

      strip.style.transform = 'translateX(0px)';

      const duration = 4300;
      const t0 = performance.now();
      let lastTickIdx = 0;
      let lastTickAt = 0;

      function ease(t) { return 1 - Math.pow(1 - t, 4); } // easeOutQuart

      function frameStep(now) {
        const t = Math.min(1, (now - t0) / duration);
        const e = ease(t);
        const x = targetX * e;
        strip.style.transform = `translateX(${x}px)`;

        if (t > 0.72) strip.classList.remove('blurred');
        else strip.classList.add('blurred');

        const passedIdx = Math.floor((-x) / step);
        if (passedIdx !== lastTickIdx) {
          lastTickIdx = passedIdx;
          if (now - lastTickAt > 55 && t < 0.97) {
            lastTickAt = now;
            AudioSfx.tick();
          }
        }

        if (t < 1) {
          requestAnimationFrame(frameStep);
        } else {
          // landing
          strip.classList.remove('blurred');
          const winCell = strip.children[chosenIdx];
          if (winCell) winCell.classList.add('win');
          AudioSfx.reelStop();
          const isMod = p.chosen.kind === 'mod';
          resultEl.textContent = isMod
            ? `⭐ Рулетка счёта: ${p.chosen.label || p.chosen.number}! ⭐`
            : `⭐ Выпал вопрос №${p.chosen.number}! ⭐`;
          resultEl.classList.remove('hidden');
          setTimeout(() => {
            overlay.classList.add('hidden');
            strip.innerHTML = '';
            resolve();
          }, 1250);
        }
      }
      requestAnimationFrame(frameStep);
    });
  }

  return { spin };
})();
