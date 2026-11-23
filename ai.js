// AI まわり：反論役・審判役・お題生成（Gemini API）と、APIキーなしの練習モード
const PERSONAS = {
  rikutsu: {
    name: 'ロンパ博士',
    label: '冷静な理屈屋',
    emoji: '🧐',
    style: '冷静沈着な理屈屋。「まず前提を整理しましょう」「それは論点のすり替えです」など、もっともらしい論理と架空の統計や研究を持ち出す。丁寧語。',
    canned: [
      'まず前提を整理しましょう。あなたの主張には根拠が一つもありません。',
      'それは論点のすり替えです。私が聞いているのは「{topic}」についてです。',
      '某大学の研究によれば、その意見の人の87%は後で後悔しています。',
      '感情論ですね。では数字で示してください。できませんよね。',
      'あなたの理屈が正しいなら、ペンギンは空を飛べることになります。',
    ],
  },
  aori: {
    name: 'アオリン',
    label: '煽り屋',
    emoji: '😏',
    style: 'ネット掲示板にいそうな煽り屋。「え、それマジで言ってる？」「はい論破ｗ」「それってあなたの感想ですよね」などの煽り口調。タメ口で軽薄。ただし差別や人格否定はしない。',
    canned: [
      'え、それマジで言ってる？ｗ',
      'それってあなたの感想ですよね？はい次。',
      '必死すぎて草。「{topic}」でそこまで熱くなれるの才能だわ',
      'はい論破ｗ 反論あるならどうぞ〜',
      'ソースは？ないよね？知ってた。',
    ],
  },
  oba: {
    name: '川底のおばあ',
    label: '説教おばあちゃん',
    emoji: '👵',
    style: '昔話と説教で押し切るおばあちゃん。「わしの若い頃はな」「あんたはまだ若いのう」など。方言まじりで、話が脱線しがち。最後は妙に深いことを言う。',
    canned: [
      'わしの若い頃はな、そんなこと言うたら川に流されたもんじゃ。',
      'あんたはまだ若いのう。「{topic}」の本当の意味を知らんのじゃ。',
      'ばあちゃんはな、戦後の焼け野原で同じことを考えとった。答えは逆じゃった。',
      'まあ飴ちゃんでも舐めて落ち着きんさい。あんたの負けじゃ。',
      '人生はな、川の流れのようなもんじゃ。あんたは逆流しとる。',
    ],
  },
  nekketsu: {
    name: '熱血コーチ',
    label: '暑苦しい熱血漢',
    emoji: '🔥',
    style: 'とにかく暑苦しい体育会系コーチ。「声が小さい！」「気合いが足りん！」など、根性論と大声（！多め）で押し切る。論理より勢い。',
    canned: [
      '声が小さい！！そんな主張で世界が変わるか！！',
      '気合いが足りん！！「{topic}」に魂を込めろ！！',
      'グラウンド10周してから出直してこい！！',
      'お前の主張には汗が足りない！！汗だ！！',
      '俺は信じてるぞ！お前が間違っていることを！！',
    ],
  },
};

const AI = {
  get key() { return (localStorage.getItem('vk_api_key') || '').trim(); },
  // 手動指定 > 自動で見つけたモデル > 既定のエイリアス
  get manualModel() { return (localStorage.getItem('vk_api_model') || '').trim(); },
  get model() { return this.manualModel || localStorage.getItem('vk_auto_model') || 'gemini-flash-latest'; },
  get enabled() { return !!this.key; },

  // このキーで使えるモデル一覧（generateContent 対応のみ）
  async listModels() {
    const out = [];
    let pageToken = '';
    do {
      const res = await fetch('https://generativelanguage.googleapis.com/v1beta/models?pageSize=1000' + (pageToken ? '&pageToken=' + encodeURIComponent(pageToken) : ''),
        { headers: { 'x-goog-api-key': this.key } });
      if (!res.ok) {
        let msg = `HTTP ${res.status}`;
        try { const e = await res.json(); if (e.error && e.error.message) msg += `: ${e.error.message}`; } catch (_) {}
        const err = new Error(msg); err.status = res.status; throw err;
      }
      const data = await res.json();
      for (const m of data.models || []) {
        if ((m.supportedGenerationMethods || []).includes('generateContent')) out.push(m.name.replace(/^models\//, ''));
      }
      pageToken = data.nextPageToken || '';
    } while (pageToken);
    return out;
  },

  // 一覧を口喧嘩向き（速い・テキスト用）の順に並べる
  rankModels(names) {
    const ok = names.filter(n => /gemini/.test(n) && !/image|tts|audio|live|embed|vision|robotics|computer|native|learnlm|aqa/.test(n));
    const ver = n => { const m = n.match(/gemini-(\d+(?:\.\d+)?)/); return m ? parseFloat(m[1]) : 0; };
    const score = n => (n === 'gemini-flash-latest' ? 100000 : 0) + (n === 'gemini-flash-lite-latest' ? 50000 : 0)
      + ver(n) * 100 + (/flash/.test(n) ? 50 : 0) + (/lite/.test(n) ? -20 : 0) + (/pro/.test(n) ? -30 : 0)
      + (/preview|exp/.test(n) ? -10 : 0) + (/\d{3}$|-\d{2}-\d{2}$/.test(n) ? -1 : 0);
    return ok.sort((a, b) => score(b) - score(a));
  },
  pickModel(names) { return this.rankModels(names)[0] || null; },

  async loadCandidates() {
    const ranked = this.rankModels(await this.listModels());
    localStorage.setItem('vk_model_candidates', JSON.stringify(ranked));
    return ranked;
  },

  async autoDetectModel() {
    const picked = (await this.loadCandidates())[0];
    if (!picked) throw new Error('このキーで使えるGeminiモデルが見つかりませんでした');
    localStorage.setItem('vk_auto_model', picked);
    return picked;
  },

  candidates() {
    if (this.manualModel) return [this.manualModel];
    let list = [];
    try { list = JSON.parse(localStorage.getItem('vk_model_candidates') || '[]'); } catch (_) {}
    const all = [this.model, ...list.filter(m => m !== this.model)];
    const now = Date.now();
    const busy = m => (this.busyUntil[m] || 0) > now;
    return [...all.filter(m => !busy(m)), ...all.filter(busy)];
  },
  busyUntil: {},

  // 混雑(503)・回数制限(429)・モデルなし(404)なら、待って再試行→別モデルへ切り替え
  async call(opts) {
    const retryable = e => [404, 429, 500, 503].includes(e.status);
    let models = this.candidates();
    let listed = false;
    let lastErr;
    for (let i = 0; i < models.length && i < 4; i++) {
      for (let attempt = 0; attempt < 2; attempt++) {
        try {
          return await this.callOnce(opts, models[i]);
        } catch (e) {
          lastErr = e;
          if (!retryable(e)) throw e;
          if (e.status !== 404) this.busyUntil[models[i]] = Date.now() + 3 * 60 * 1000;
          if ((e.status === 503 || e.status === 500) && attempt === 0) { await new Promise(r => setTimeout(r, 1200)); continue; }
          break;
        }
      }
      if (this.manualModel) break;
      if (!listed && (models.length < 2 || lastErr.status === 404)) {
        listed = true;
        try {
          if (lastErr.status === 404 && i === 0) await this.autoDetectModel(); else await this.loadCandidates();
          const tried = models.slice(0, i + 1);
          models = [...tried, ...this.candidates().filter(m => !tried.includes(m))];
        } catch (_) {}
      }
    }
    throw lastErr;
  },

  async callOnce({ system, contents, json = false, temperature = 1.0 }, model = this.model) {
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`;
    const body = {
      systemInstruction: { parts: [{ text: system }] },
      contents,
      generationConfig: { temperature },
      safetySettings: [
        { category: 'HARM_CATEGORY_HARASSMENT', threshold: 'BLOCK_ONLY_HIGH' },
      ],
    };
    if (json) body.generationConfig.responseMimeType = 'application/json';
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-goog-api-key': this.key },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      let msg = `HTTP ${res.status}`;
      try { const e = await res.json(); if (e.error && e.error.message) msg += `: ${e.error.message}`; } catch (_) {}
      const err = new Error(msg); err.status = res.status; throw err;
    }
    const data = await res.json();
    const parts = data.candidates && data.candidates[0] && data.candidates[0].content && data.candidates[0].content.parts;
    const text = parts ? parts.filter(p => !p.thought).map(p => p.text || '').join('').trim() : '';
    if (!text) throw new Error('AIの返答が空でした（ブロックされた可能性があります）');
    this.lastModel = model;
    return text;
  },

  // 反論役
  async rebut({ topic, aiSide, persona, history }) {
    if (!this.enabled) return demoRebut(topic, persona);
    const p = PERSONAS[persona];
    const stance = aiSide === 'yes' ? '賛成' : '反対';
    const system = [
      `あなたは口喧嘩ゲーム「ベトナムの川底で…」の対戦相手AI「${p.name}」です。`,
      `お題：「${topic}」`,
      `あなたの立場：このお題に【${stance}】。相手は逆の立場です。立場は絶対に変えないこと。`,
      `キャラクター：${p.style}`,
      'ルール：',
      '- 相手の直前の発言に具体的に噛みついて反論し、自分の立場を主張する。',
      '- 日本語で、1〜3文、最大120文字。短く鋭く。',
      '- バカバカしいお題を本気で論じるギャップで笑わせる。屁理屈・大げさな比喩・謎の具体例は大歓迎。',
      '- 差別・下ネタ・実在の個人への攻撃・相手の人格や容姿への悪口は禁止。',
      '- セリフ本文だけを出力する（名前やカギカッコは付けない）。',
    ].join('\n');
    // 同じ役が連続した場合（エラー後の再送など）は1つにまとめる
    const contents = [];
    for (const h of history) {
      const role = h.who === 'ai' ? 'model' : 'user';
      const last = contents[contents.length - 1];
      if (last && last.role === role) last.parts[0].text += '\n' + h.text;
      else contents.push({ role, parts: [{ text: h.text }] });
    }
    const text = await this.call({ system, contents, temperature: 1.1 });
    return text.replace(/^["「『]|["」』]$/g, '').slice(0, 200);
  },

  // 審判役：発言を採点して JSON を返す
  async judge({ topic, speakerSide, speaker, text, prevText }) {
    if (!this.enabled) return demoJudge(text);
    const stance = speakerSide === 'yes' ? '賛成' : '反対';
    const system = [
      'あなたは口喧嘩格闘ゲーム「ベトナムの川底で…」の辛口かつノリのいい審判です。',
      '1つの発言を採点し、相手に与えるダメージを決めます。',
      '採点基準（各0〜10）：',
      '- logic：論理・屁理屈の巧みさ。相手の直前の発言への反論として成立しているか。',
      '- momentum：勢い・気迫・言い切りの強さ。',
      '- humor：笑い・ワードセンス・意外性。',
      'damage は 0〜35 の整数。目安は (logic+momentum+humor) に近い値。',
      '本当に見事な一撃だけ critical を true にし、damage を 30〜35 にする。',
      'お題と無関係な発言、立場が逆の発言、単なる悪口、意味不明な文字列は damage 0〜3。',
      'comment は審判の一言実況（日本語20〜40文字、ノリよく）。',
      '発言者が「AI」でも「プレイヤー」でも同じ基準で公平に採点すること。',
      '出力は JSON のみ：{"logic":n,"momentum":n,"humor":n,"damage":n,"critical":bool,"comment":"..."}',
    ].join('\n');
    const prompt = [
      `お題：「${topic}」`,
      `発言者：${speaker === 'ai' ? 'AI' : 'プレイヤー'}（立場：${stance}）`,
      prevText ? `相手の直前の発言：「${prevText}」` : '（これが最初の発言）',
      `採点する発言：「${text}」`,
    ].join('\n');
    const raw = await this.call({ system, contents: [{ role: 'user', parts: [{ text: prompt }] }], json: true, temperature: 0.4 });
    return normalizeJudge(parseJSON(raw));
  },

  async makeTopic() {
    const system = 'あなたはバカバカしいディベートのお題を考える名人です。';
    const prompt = '賛成派と反対派で口喧嘩できる、くだらなくて笑えるお題を1つだけ考えてください。「〜は〜べき」「〜は〜である」のような断定文で、25文字以内。お題の文だけを出力。例：' + randomTopic();
    const t = await this.call({ system, contents: [{ role: 'user', parts: [{ text: prompt }] }], temperature: 1.3 });
    return t.split('\n')[0].replace(/^["「『]|["」』。]$/g, '').slice(0, 60);
  },
};

function parseJSON(raw) {
  try { return JSON.parse(raw); } catch (_) {}
  const m = raw.match(/\{[\s\S]*\}/);
  if (m) { try { return JSON.parse(m[0]); } catch (_) {} }
  return {};
}

function clampInt(v, lo, hi, d) {
  const n = Math.round(Number(v));
  return Number.isFinite(n) ? Math.min(hi, Math.max(lo, n)) : d;
}

function normalizeJudge(j) {
  const logic = clampInt(j.logic, 0, 10, 3);
  const momentum = clampInt(j.momentum, 0, 10, 3);
  const humor = clampInt(j.humor, 0, 10, 3);
  const critical = !!j.critical;
  let damage = clampInt(j.damage, 0, 35, logic + momentum + humor);
  if (critical) damage = Math.max(damage, 30);
  return { logic, momentum, humor, damage, critical, comment: String(j.comment || '').slice(0, 60) || '審判は無言でうなずいた' };
}

// ---- 練習モード（APIキーなし） ----
function demoRebut(topic, persona) {
  const lines = PERSONAS[persona].canned;
  const line = lines[Math.floor(Math.random() * lines.length)];
  return new Promise(r => setTimeout(() => r(line.replace('{topic}', topic)), 600));
}

function demoJudge(text) {
  const len = [...text].length;
  const bang = (text.match(/[!！]/g) || []).length;
  const laugh = (text.match(/[wｗ草笑]/g) || []).length;
  const logicWords = (text.match(/なぜなら|つまり|だから|証拠|データ|研究|そもそも|逆に/g) || []).length;
  const logic = Math.min(10, Math.floor(len / 12) + logicWords * 2 + rnd(0, 2));
  const momentum = Math.min(10, 2 + bang * 2 + rnd(0, 3));
  const humor = Math.min(10, laugh * 2 + rnd(1, 5));
  const critical = Math.random() < 0.08 && len > 15;
  const damage = len < 3 ? 1 : Math.min(35, critical ? 32 : logic + momentum + humor);
  const comments = critical
    ? ['会心の一撃！会場がどよめいた！', 'これは効いた！完全に入った！']
    : damage > 18
      ? ['いい切り返し！相手がぐらついた！', '勢いがある！押してるぞ！', 'なかなかの屁理屈だ！']
      : ['まだ浅い！もっと踏み込め！', 'うーん、ちょっと弱いか？', '審判、首をかしげている…'];
  return new Promise(r => setTimeout(() => r({ logic, momentum, humor, damage, critical, comment: comments[rnd(0, comments.length - 1)] }), 400));
}

function rnd(a, b) { return a + Math.floor(Math.random() * (b - a + 1)); }
