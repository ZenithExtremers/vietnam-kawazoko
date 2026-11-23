// ベトナムの川底で… メインロジック
const MAX_HP = 100;
const MAX_TURNS = 10;

const $ = sel => document.querySelector(sel);
const $$ = sel => Array.from(document.querySelectorAll(sel));
const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

const setup = { topic: '', side: null, persona: localStorage.getItem('vk_persona') || 'aori' };
let game = null;

// ---------- 画面遷移 ----------
function go(name) {
  $$('.screen').forEach(s => s.classList.toggle('active', s.id === 'screen-' + name));
  window.scrollTo(0, 0);
  if (name === 'title') renderModeBadge();
  if (name === 'setup') renderSetup();
  if (name === 'records') renderRecords();
  if (name === 'settings') renderSettings();
}
document.addEventListener('click', e => {
  const t = e.target.closest('[data-go]');
  if (!t) return;
  if (game && !game.over && $('#screen-battle').classList.contains('active')) {
    if (!confirm('バトルを抜けると負け扱いになります。抜けますか？')) return;
    finish('giveup');
  }
  go(t.dataset.go);
});

function toast(msg, ms = 2600) {
  const el = $('#toast');
  el.textContent = msg;
  el.classList.add('show');
  clearTimeout(toast._t);
  toast._t = setTimeout(() => el.classList.remove('show'), ms);
}

function renderModeBadge() {
  $('#mode-badge').textContent = AI.enabled
    ? `AIモード（${AI.model}）`
    : '練習モード（AIなし）— 設定でGeminiのAPIキーを入れると本気のAIと戦えます';
}

// ---------- 準備画面 ----------
function renderSetup() {
  if (!setup.topic) setup.topic = randomTopic();
  $('#topic-text').textContent = setup.topic;
  $('#btn-ai-topic').disabled = !AI.enabled;
  $$('.side').forEach(b => b.classList.toggle('sel', b.dataset.side === setup.side));
  $('#persona-list').innerHTML = Object.entries(PERSONAS).map(([id, p]) => `
    <button class="persona ${id === setup.persona ? 'sel' : ''}" data-persona="${id}">
      <span class="p-emoji">${p.emoji}</span>
      <span class="p-name">${esc(p.name)}</span>
      <span class="p-label">${esc(p.label)}</span>
    </button>`).join('');
  $('#btn-start').disabled = !setup.side;
}
$('#btn-reroll').onclick = () => { setup.topic = randomTopic(setup.topic); renderSetup(); };
$('#btn-custom').onclick = () => {
  const v = $('#custom-topic').value.trim();
  if (!v) return toast('お題を入力してください');
  setup.topic = v; $('#custom-topic').value = ''; renderSetup();
};
$('#btn-ai-topic').onclick = async () => {
  const b = $('#btn-ai-topic');
  b.disabled = true; b.textContent = '🤖 考え中…';
  try { setup.topic = await AI.makeTopic(); renderSetup(); }
  catch (e) { toast(errMsg(e)); }
  finally { b.disabled = !AI.enabled; b.textContent = '🤖 AIに出させる'; }
};
$$('.side').forEach(b => b.onclick = () => { setup.side = b.dataset.side; renderSetup(); });
$('#persona-list').addEventListener('click', e => {
  const b = e.target.closest('[data-persona]');
  if (!b) return;
  setup.persona = b.dataset.persona;
  localStorage.setItem('vk_persona', setup.persona);
  renderSetup();
});
$('#btn-start').onclick = startGame;

// ---------- バトル ----------
function startGame() {
  game = {
    topic: setup.topic,
    side: setup.side,
    aiSide: setup.side === 'yes' ? 'no' : 'yes',
    persona: setup.persona,
    hp: { you: MAX_HP, ai: MAX_HP },
    history: [],
    turn: 1,
    busy: false,
    over: false,
    stats: { maxDamage: 0, bestQuote: null, dealt: 0, taken: 0, crits: 0 },
  };
  const p = PERSONAS[game.persona];
  $('#ai-name').textContent = `${p.emoji} ${p.name}`;
  $('#you-stance').textContent = game.side === 'yes' ? '賛成' : '反対';
  $('#ai-stance').textContent = game.aiSide === 'yes' ? '賛成' : '反対';
  $('#battle-topic').textContent = `お題：${game.topic}`;
  $('#log').innerHTML = '';
  $('#say-input').value = '';
  updateHUD();
  go('battle');
  sysLine(`ファイト！ あなたは「${game.topic}」に<b>${game.side === 'yes' ? '賛成' : '反対'}</b>。先攻はあなた。`);
  sysLine(AI.enabled ? '' : '※練習モード：AIは定型文で反論し、ダメージは簡易計算です。', true);
  setBusy(false);
  setTimeout(() => $('#say-input').focus(), 300);
}

function updateHUD() {
  for (const who of ['you', 'ai']) {
    const v = Math.max(0, game.hp[who]);
    const fill = $(`#${who}-hp`);
    fill.style.width = (v / MAX_HP * 100) + '%';
    fill.classList.toggle('low', v <= 30);
    $(`#${who}-hp-num`).textContent = v;
  }
  $('#turn-info').textContent = `ターン ${Math.min(game.turn, MAX_TURNS)} / ${MAX_TURNS}`;
}

function setBusy(b) {
  game.busy = b;
  $('#btn-say').disabled = b;
  $('#say-input').disabled = b;
}

function scrollLog() { const l = $('#log'); l.scrollTop = l.scrollHeight; }

function sysLine(html, skipIfEmpty) {
  if (skipIfEmpty && !html) return;
  const d = document.createElement('div');
  d.className = 'sys';
  d.innerHTML = html;
  $('#log').appendChild(d);
  scrollLog();
}

function bubble(who, text) {
  const d = document.createElement('div');
  d.className = `bubble ${who}`;
  d.innerHTML = `<div class="b-text">${esc(text)}</div>`;
  $('#log').appendChild(d);
  scrollLog();
  return d;
}

function typing() {
  const d = document.createElement('div');
  d.className = 'bubble ai typing';
  d.innerHTML = '<div class="b-text"><span></span><span></span><span></span></div>';
  $('#log').appendChild(d);
  scrollLog();
  return d;
}

function judgeLine(target, j, el) {
  const d = document.createElement('div');
  d.className = 'judge' + (j.critical ? ' crit' : '');
  d.innerHTML = `
    <div class="j-head">⚖️ 審判 <span class="j-dmg">${j.critical ? '会心！ ' : ''}-${j.damage}</span></div>
    <div class="j-comment">${esc(j.comment)}</div>
    <div class="j-scores">論理 ${j.logic} ／ 勢い ${j.momentum} ／ 笑い ${j.humor}</div>`;
  el.after(d);
  scrollLog();
}

function hitFx(target, j) {
  const fighter = $(`.fighter.${target}`);
  fighter.classList.remove('hit'); void fighter.offsetWidth; fighter.classList.add('hit');
  const pop = document.createElement('div');
  pop.className = 'dmg-pop' + (j.critical ? ' crit' : '');
  pop.textContent = (j.critical ? '会心！\n' : '') + '-' + j.damage;
  fighter.appendChild(pop);
  setTimeout(() => pop.remove(), 1200);
  if (j.critical || j.damage >= 25) {
    document.body.classList.remove('shake'); void document.body.offsetWidth; document.body.classList.add('shake');
  }
  if (navigator.vibrate) navigator.vibrate(j.critical ? [60, 40, 120] : 40);
}

function applyDamage(target, j) {
  game.hp[target] = Math.max(0, game.hp[target] - j.damage);
  hitFx(target, j);
  updateHUD();
}

$('#say-form').addEventListener('submit', async e => {
  e.preventDefault();
  if (!game || game.busy || game.over) return;
  const text = $('#say-input').value.trim();
  if (!text) return;
  $('#say-input').value = '';
  setBusy(true);

  const prevAi = [...game.history].reverse().find(h => h.who === 'ai');
  const youEl = bubble('you', text);
  game.history.push({ who: 'you', text });

  let typingEl = null;
  try {
    // 審判（あなたの発言）と AI の反論を並行で走らせる
    const judgeP = AI.judge({ topic: game.topic, speakerSide: game.side, speaker: 'you', text, prevText: prevAi && prevAi.text });
    const rebutP = AI.rebut({ topic: game.topic, aiSide: game.aiSide, persona: game.persona, history: game.history });
    rebutP.catch(() => {}); // 先に KO した場合の未処理エラー防止

    const j1 = await judgeP;
    judgeLine('ai', j1, youEl);
    applyDamage('ai', j1);
    recordHit(text, j1);
    if (game.hp.ai <= 0) return await finish('win');

    await wait(500);
    typingEl = typing();
    const reply = await rebutP;
    typingEl.remove(); typingEl = null;
    const aiEl = bubble('ai', reply);
    game.history.push({ who: 'ai', text: reply });

    const j2 = await AI.judge({ topic: game.topic, speakerSide: game.aiSide, speaker: 'ai', text: reply, prevText: text });
    await wait(300);
    judgeLine('you', j2, aiEl);
    applyDamage('you', j2);
    game.stats.taken += j2.damage;
    if (game.hp.you <= 0) return await finish('lose');

    game.turn++;
    if (game.turn > MAX_TURNS) return await finish(game.hp.you > game.hp.ai ? 'win' : game.hp.you < game.hp.ai ? 'lose' : 'draw', true);
    updateHUD();
  } catch (err) {
    if (typingEl) typingEl.remove();
    console.error(err);
    sysLine(`⚠️ ${esc(errMsg(err))}`);
    // あなたの発言が未採点なら取り消して入力欄に戻す
    if (!youEl.nextElementSibling || !youEl.nextElementSibling.classList.contains('judge')) {
      youEl.remove();
      game.history.pop();
      $('#say-input').value = text;
    }
  } finally {
    if (!game.over) { setBusy(false); $('#say-input').focus(); }
  }
});

$('#say-input').addEventListener('keydown', e => {
  if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); $('#say-form').requestSubmit(); }
});

$('#btn-giveup').onclick = () => {
  if (!game || game.over) return;
  if (confirm('降参しますか？（負けとして記録されます）')) finish('giveup');
};

function recordHit(text, j) {
  const s = game.stats;
  s.dealt += j.damage;
  if (j.critical) s.crits++;
  if (j.damage > s.maxDamage) s.maxDamage = j.damage;
  if (!s.bestQuote || j.damage > s.bestQuote.damage) s.bestQuote = { text, damage: j.damage, comment: j.comment };
}

function wait(ms) { return new Promise(r => setTimeout(r, ms)); }

function errMsg(e) {
  if (e && e.status === 429) return 'AIが息切れ中（無料枠の回数制限）。少し待ってからもう一度どうぞ。';
  if (e && (e.status === 400 || e.status === 403)) return 'APIキーかモデル名が正しくないようです。設定を確認してください。（' + e.message + '）';
  if (e && e.status === 404) return 'モデルが見つかりません。設定のモデル欄を空にして（自動）、接続テストを押してください。';
  if (e instanceof TypeError) return '通信できませんでした。電波を確認してください。';
  return 'エラー：' + (e && e.message || e);
}

// ---------- 決着 ----------
async function finish(result, byDecision) {
  if (game.over) return;
  game.over = true;
  setBusy(true);
  if (result === 'win' || result === 'lose') {
    const big = document.createElement('div');
    big.className = 'ko ' + result;
    big.textContent = byDecision ? '判定！' : (result === 'win' ? '論破！' : '論破された…');
    document.body.appendChild(big);
    await wait(1600);
    big.remove();
  }
  saveRecord(result);
  showResult(result, byDecision);
}

function showResult(result, byDecision) {
  const p = PERSONAS[game.persona];
  const banner = $('#result-banner');
  banner.className = 'result-banner ' + result;
  banner.textContent = { win: '論破！', lose: '論破された…', draw: '引き分け', giveup: '降参' }[result];
  $('#result-sub').textContent = {
    win: `${p.name}は川底へ沈んでいった…`,
    lose: `あなたは川底へ沈んでいった…`,
    draw: '両者、川底で握手した。',
    giveup: `${p.name}「ふっ、口ほどにもない」`,
  }[result] + (byDecision ? '（10ターン経過・HP判定）' : '');
  const s = game.stats;
  $('#result-stats').innerHTML = `
    <div><b>${Math.min(game.turn, MAX_TURNS)}</b><span>ターン</span></div>
    <div><b>${s.dealt}</b><span>与ダメージ</span></div>
    <div><b>${s.maxDamage}</b><span>最大ダメージ</span></div>
    <div><b>${s.crits}</b><span>会心</span></div>`;
  $('#result-quote').innerHTML = s.bestQuote
    ? `<div class="label">本日の名言（${s.bestQuote.damage}ダメージ）</div><blockquote>${esc(s.bestQuote.text)}</blockquote><div class="q-comment">審判：${esc(s.bestQuote.comment)}</div>`
    : '';
  $('#result-quote').style.display = s.bestQuote ? '' : 'none';
  go('result');
}

$('#btn-share').onclick = async () => {
  if (!game) return;
  const p = PERSONAS[game.persona];
  const verb = { win: `${Math.min(game.turn, MAX_TURNS)}ターンで論破した！`, lose: 'に論破された…', draw: 'と引き分けた', giveup: 'に降参した…' }[game.result];
  let text = `お題「${game.topic}」で${p.name}${game.result === 'win' ? 'を' : ''}${verb}\n最大ダメージ ${game.stats.maxDamage}`;
  if (game.stats.bestQuote) text += `\n名言「${game.stats.bestQuote.text.slice(0, 60)}」`;
  text += '\n#ベトナムの川底で';
  const url = location.href.split('#')[0];
  try {
    if (navigator.share) await navigator.share({ text, url });
    else { await navigator.clipboard.writeText(text + '\n' + url); toast('コピーしました'); }
  } catch (_) {}
};

// ---------- 戦績 ----------
function loadRecords() {
  try {
    return Object.assign({ wins: 0, losses: 0, draws: 0, maxDamage: 0, bestQuote: null, history: [] },
      JSON.parse(localStorage.getItem('vk_records') || '{}'));
  } catch (_) { return { wins: 0, losses: 0, draws: 0, maxDamage: 0, bestQuote: null, history: [] }; }
}

function saveRecord(result) {
  game.result = result;
  const r = loadRecords();
  if (result === 'win') r.wins++;
  else if (result === 'draw') r.draws++;
  else r.losses++;
  const s = game.stats;
  if (s.maxDamage > r.maxDamage) r.maxDamage = s.maxDamage;
  if (s.bestQuote && (!r.bestQuote || s.bestQuote.damage > r.bestQuote.damage)) {
    r.bestQuote = { text: s.bestQuote.text, damage: s.bestQuote.damage, topic: game.topic };
  }
  r.history.unshift({
    date: new Date().toISOString(), topic: game.topic, side: game.side, persona: game.persona,
    result, turns: Math.min(game.turn, MAX_TURNS), maxDamage: s.maxDamage,
    quote: s.bestQuote ? s.bestQuote.text : '',
  });
  r.history = r.history.slice(0, 30);
  localStorage.setItem('vk_records', JSON.stringify(r));
}

function renderRecords() {
  const r = loadRecords();
  const total = r.wins + r.losses + r.draws;
  const rate = total ? Math.round(r.wins / total * 100) : 0;
  const mark = { win: '◯', lose: '×', giveup: '×', draw: '△' };
  $('#records-body').innerHTML = `
    <div class="result-stats">
      <div><b>${r.wins}</b><span>勝ち</span></div>
      <div><b>${r.losses}</b><span>負け</span></div>
      <div><b>${rate}%</b><span>勝率</span></div>
      <div><b>${r.maxDamage}</b><span>最大ダメージ</span></div>
    </div>
    ${r.bestQuote ? `<div class="quote-card"><div class="label">殿堂入りの名言（${r.bestQuote.damage}ダメージ）</div>
      <blockquote>${esc(r.bestQuote.text)}</blockquote><div class="q-comment">お題：${esc(r.bestQuote.topic)}</div></div>` : ''}
    <div class="label">最近の対戦</div>
    ${r.history.length ? '<ul class="hist">' + r.history.map(h => `
      <li class="${h.result}">
        <span class="h-mark">${mark[h.result] || '?'}</span>
        <span class="h-body"><span class="h-topic">${esc(h.topic)}</span>
        <span class="h-meta">vs ${esc((PERSONAS[h.persona] || {}).name || '?')} ・ ${h.side === 'yes' ? '賛成' : '反対'} ・ ${h.turns}T ・ 最大${h.maxDamage}</span></span>
      </li>`).join('') + '</ul>' : '<p class="note">まだ対戦していません。</p>'}`;
}

// ---------- 設定 ----------
function renderSettings() {
  $('#api-key').value = AI.key;
  $('#api-model').value = localStorage.getItem('vk_api_model') || '';
  $('#settings-msg').textContent = '';
}
$('#btn-save-settings').onclick = () => {
  localStorage.setItem('vk_api_key', $('#api-key').value.trim());
  localStorage.setItem('vk_api_model', $('#api-model').value.trim());
  $('#settings-msg').textContent = AI.enabled ? '保存しました（AIモード）' : '保存しました（練習モード）';
};
$('#btn-test-key').onclick = async () => {
  $('#btn-save-settings').click();
  if (!AI.enabled) return;
  const msg = $('#settings-msg');
  msg.textContent = '使えるモデルを探しています…';
  try {
    const names = await AI.listModels();
    $('#model-list').innerHTML = names.map(n => `<option value="${esc(n)}">`).join('');
    if (!AI.manualModel) {
      const picked = AI.pickModel(names);
      if (!picked) throw new Error('このキーで使えるGeminiモデルが見つかりませんでした');
      localStorage.setItem('vk_auto_model', picked);
    }
    msg.textContent = `接続中…（${AI.model}）`;
    const t = await AI.call({ system: '一言で返事して。', contents: [{ role: 'user', parts: [{ text: 'やあ' }] }] });
    msg.textContent = `✅ つながりました（${AI.model}）：「${t.slice(0, 40)}」`;
  } catch (e) { msg.textContent = '❌ ' + errMsg(e); }
};
$('#btn-reset-records').onclick = () => {
  if (confirm('戦績をすべて消しますか？')) { localStorage.removeItem('vk_records'); toast('戦績をリセットしました'); }
};

// ---------- 起動 ----------
renderModeBadge();
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => navigator.serviceWorker.register('sw.js').catch(() => {}));
}
