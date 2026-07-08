// ============================================================
// ai.js — 敵大名の思考ルーチン
// ============================================================
"use strict";

const AI = {

  async run() {
    const daimyos = Game.aliveDaimyos().filter(d => d.id !== G.playerId);
    daimyos.sort(() => Math.random() - 0.5);
    for (const d of daimyos) {
      if (G.over) return;
      if (!d.alive) continue;
      await this.actDaimyo(d);
    }
  },

  async actDaimyo(d) {
    // まれに同盟を持ちかけてくる
    await this.maybeOfferAlliance(d);
    if (G.over || !d.alive) return;

    let attacked = false;   // 侵攻は1季節に1度まで
    const provs = Game.ownedBy(d.id).sort((a, b) => b.hei - a.hei);
    for (const p of provs) {
      if (G.over || !d.alive) return;
      if (p.owner !== d.id) continue;

      // 民心・兵心の立て直しを最優先
      if (p.minchu < 30 && (p.kin >= 30 || p.kome >= 30)) {
        this.aiHodokoshi(p, d);
        continue;
      }
      if (p.heichu < 30 && p.kin >= 30) {
        p.kin -= 30;
        p.heichu = clamp(p.heichu + 6, 0, 100);
        continue;
      }
      if (d.home === p.id && d.health < 40 && Math.random() < 0.6) {
        d.health = clamp(d.health + rint(8, 15), 0, 100);
        continue;
      }

      // 侵攻判断
      if (!attacked) {
        const target = this.pickAttackTarget(d, p);
        if (target) {
          attacked = true;
          await this.aiAttack(d, p, target);
          continue;
        }
      }

      // 徴兵
      if (p.hei < p.koku * 8 && p.kin > 60 && p.kome > 60 && Math.random() < 0.5) {
        const amt = Math.min(300, Math.floor(p.kin / 0.2), Math.floor(p.kome / 0.2), p.koku * 12 - p.hei);
        if (amt > 20) {
          p.kin -= Math.round(amt * 0.2);
          p.kome -= Math.round(amt * 0.2);
          p.hei += amt;
          p.minchu = clamp(p.minchu - 2, 0, 100);
          continue;
        }
      }

      // 内政
      this.aiDevelop(p);
    }
  },

  aiHodokoshi(p, d) {
    if (p.kome >= 30) {
      p.kome -= 30;
      p.minchu = clamp(p.minchu + Math.round(4.5 * (0.8 + d.charm / 250)), 0, 100);
    } else {
      p.kin -= 30;
      p.minchu = clamp(p.minchu + Math.round(3 * (0.8 + d.charm / 250)), 0, 100);
    }
  },

  aiDevelop(p) {
    if (p.chisui < 45 && p.kin >= 20) {
      p.kin -= 20; p.chisui = clamp(p.chisui + rint(4, 8), 0, 100); return;
    }
    if (p.kunren < 55) {
      p.kunren = clamp(p.kunren + rint(4, 9), 0, 100); return;
    }
    const r = rnd(4);
    if (r === 0 && p.kin >= 20) {
      p.kin -= 20; p.koku += rint(2, 5); p.minzai = clamp(p.minzai - 3, 0, 100);
    } else if (r === 1 && p.kin >= 25) {
      p.kin -= 25; p.town += rint(4, 8); p.minzai = clamp(p.minzai - 3, 0, 100);
    } else if (r === 2 && p.kin >= 30 && p.buso < 70) {
      p.kin -= 30; p.buso = clamp(p.buso + rint(5, 10), 0, 100);
    } else {
      p.kunren = clamp(p.kunren + rint(3, 7), 0, 100);
    }
  },

  pickAttackTarget(d, p) {
    if (p.hei < 250) return null;
    const candidates = [];
    for (const a of p.adj) {
      const q = G.provinces[a];
      if (q.owner === d.id) continue;
      if (q.owner !== VACANT && Game.allied(d.id, q.owner)) continue;
      const needRatio = q.owner === VACANT ? 1.2 : 1.5;
      if (p.hei > q.hei * needRatio) {
        let score = p.hei / Math.max(q.hei, 1);
        if (q.owner === VACANT) score *= 1.3;               // 空白地は狙い目
        if (q.owner !== VACANT && G.daimyos[q.owner].id === d.grudge) score *= 2;
        candidates.push({ q, score });
      }
    }
    if (!candidates.length) return null;
    // 野心が高いほど戦を仕掛けやすい
    const aggression = d.amb / 220 + (d.grudge === G.playerId ? 0.1 : 0);
    if (Math.random() > aggression) return null;
    candidates.sort((a, b) => b.score - a.score);
    return candidates[0].q;
  },

  async aiAttack(d, p, q) {
    const hei = Math.round(p.hei * 0.8);
    const kome = Math.min(p.kome, Math.ceil(hei / 150) * 20);
    const leads = d.home === p.id && Math.random() < d.amb / 150;
    p.hei -= hei;
    p.kome -= kome;
    const targetName = q.owner === VACANT ? `空白地${q.name}` :
      q.owner === G.playerId ? `そなたの${q.name}` : `${G.daimyos[q.owner].name}領${q.name}`;
    UI.log(`【侵攻】${d.name}軍 兵${hei}が${targetName}へ攻め込んだ！`);
    if (q.owner === G.playerId) {
      await UI.alert(`一大事！${d.name}軍 兵${hei}が${q.name}へ攻め寄せて参りました！`);
    }
    await Battle.start({
      fromId: p.id, targetId: q.id, attackerDaimyo: d,
      hei, kome, daimyoLeads: leads,
    });
    Game.checkVictory();
  },

  async maybeOfferAlliance(d) {
    if (Math.random() > 0.03) return;
    if (Game.allied(d.id, G.playerId) || d.grudge === G.playerId) return;
    const myProvs = Game.ownedBy(G.playerId);
    const theirProvs = Game.ownedBy(d.id);
    // 隣接しており、かつプレイヤーが優勢なときに申し出てくる
    const adjacent = theirProvs.some(p => p.adj.some(a => G.provinces[a].owner === G.playerId));
    if (!adjacent || theirProvs.length > myProvs.length) return;
    const ok = await UI.confirm(`${d.name}より使者が参りました。\n「向後三年、互いに兵を向けぬと誓おうぞ」\n\n不戦同盟を結びますか？`, { portrait: d });
    if (ok) {
      Game.makeAlliance(G.playerId, d.id, 12);
      UI.log(`${d.name}と不戦同盟を結んだ（3年間）。`);
    } else {
      UI.log(`${d.name}の同盟の申し出を断った。`);
    }
  },
};

// ============================================================
// 軍師 — プレイヤーへの進言（最適コマンドの推薦と理由）
// ============================================================
const Advisor = {

  // 出陣の狙い目（勝算の高い隣国）を返す。なければ null
  bestTarget(p) {
    const send = Math.round(p.hei * 0.8);
    if (send < 50) return null;
    let best = null;
    for (const a of p.adj) {
      const q = G.provinces[a];
      if (q.owner === G.playerId) continue;
      if (q.owner !== VACANT && Game.allied(G.playerId, q.owner)) continue;
      const needRatio = q.owner === VACANT ? 1.3 : 1.6;   // 城の防御補正を見込んだ安全圏
      if (send <= q.hei * needRatio) continue;
      let score = send / Math.max(q.hei, 1);
      if (q.owner === VACANT) score *= 1.3;
      if (!best || score > best.score) best = { q, score, send };
    }
    return best;
  },

  canChohei(p) {
    const maxByMoney = Math.floor(Math.min(p.kin / 0.2, p.kome / 0.2));
    const maxByLand = p.koku * 12 - p.hei;
    return Math.min(maxByMoney, maxByLand, 2000) >= 10;
  },

  // p で今取るべき行動をスコア順に返す [{key, icon, label, score, reason}]
  advise(p) {
    const d = Game.player();
    const meta = {};
    for (const c of Commands.list(p)) meta[c.key] = c;
    const list = [];
    const add = (key, score, reason) => {
      const m = meta[key];
      if (m && !m.disabled) list.push({ key, icon: m.icon, label: m.label, score, reason });
    };

    // --- 周辺の脅威（同盟外の隣接敵国で最大兵力の国） ---
    const hostiles = p.adj.map(a => G.provinces[a])
      .filter(q => q.owner !== G.playerId && q.owner !== VACANT && !Game.allied(G.playerId, q.owner));
    const biggest = hostiles.reduce((m, q) => (!m || q.hei > m.hei ? q : m), null);
    const threat = !!biggest && Math.round(biggest.hei * 0.8) > p.hei;

    // --- 内憂：一揆・謀反の芽 ---
    if (p.minchu < 35) {
      const sev = p.minchu < 25;
      if (p.kin >= 10 || p.kome >= 10) {
        add("hodokoshi", sev ? 100 : 78,
          `民忠${p.minchu}${sev ? "は危険水域。放置すれば一揆で国を失いかねませぬ" : "と低め。一揆が起きる前に手を打つべし"}。米を施せば効果は大`);
      } else {
        add("merchant", sev ? 96 : 70,
          `民忠${p.minchu}なのに施す金も米もありませぬ。借金してでも民心を宥めるべきかと`);
      }
    }
    if (p.heichu < 35 && p.kin >= 10) {
      add("houbi", p.heichu < 25 ? 98 : 74,
        `兵忠${p.heichu}${p.heichu < 25 ? "。今夜にも謀反が起きかねませぬ" : "と低め。謀反の芽は早めに摘むべし"}。褒美で兵の心を繋ぎ止めなされ`);
    }

    // --- お屋形様の健康（本国のみ） ---
    if (d.home === p.id) {
      if (d.health < 40) add("rest", 94, `お屋形様の健康は${d.health}。倒れられては元も子もありませぬ。湯治をお勧めいたす`);
      else if (d.health < 60) add("rest", 52, `健康${d.health}とやや優れませぬ。手すきの折に休養を`);
    }

    // --- 秋の兵糧払いへの備え ---
    const need = Math.round(p.hei * 0.1);
    if (G.season <= 1 && p.hei > 0 && p.kome < need) {
      add("merchant", 82, `秋には兵糧米${need}が要るのに蔵には米${p.kome}のみ。今のうちに米を買わねば兵が逃散しまする`);
    }

    // --- 防備 ---
    if (threat) {
      const eName = G.daimyos[biggest.owner].name;
      if (this.canChohei(p)) add("chohei", 88, `隣国${biggest.short}の${eName}は兵${biggest.hei}。当方の兵${p.hei}では守り切れませぬ。徴兵を急がれよ`);
      if (p.kunren < 60) add("kunren", 72, `${eName}の脅威が迫る中、訓練度${p.kunren}では心許ない。兵を鍛えなされ`);
      if (p.buso < 50 && p.kin >= 20) add("buki", 62, `武装度${p.buso}。鉄砲を備えれば寡兵でも守りやすくなりまする`);
    }

    // --- 攻め時（内憂がないときのみ勧める） ---
    const target = this.bestTarget(p);
    if (target && p.minchu >= 35 && p.heichu >= 35) {
      const q = target.q;
      const tName = q.owner === VACANT ? "空白地" : `${G.daimyos[q.owner].name}領`;
      add("attack", q.owner === VACANT ? 86 : 84,
        `${tName}${q.name}の守りは兵${q.hei}。当方から兵${target.send}を出せば勝てる公算大。攻め時にございますぞ`);
    }

    // --- 台風への備え ---
    if (G.season <= 1 && p.chisui < 45 && p.kin >= 20) {
      add("chisui", 58, `治水度${p.chisui}。夏から秋の台風で田畑が流されては収穫が半減しまする`);
    }

    // --- 借金の返済 ---
    if (p.loan > 0 && p.kin >= p.loan) {
      add("merchant", 60, `借金${p.loan}が利息を生んでおります。金に余裕がある今こそ返済を`);
    }

    // --- 平時の富国強兵 ---
    if (p.kunren < 50) add("kunren", 42, `訓練度${p.kunren}と低め。訓練は金がかからず、戦の強さに直結いたします`);
    if (!threat && this.canChohei(p) && p.hei < p.koku * 6) add("chohei", 38, `国力に対して兵${p.hei}は少なめ。徴兵の余地がありまする`);
    if (p.kin >= 25) add("machi", 34, `金に余裕あり。町を広げれば春の金収入が増えまする`);
    if (p.kin >= 20) add("kaikon", 32, `開墾で石高を上げれば秋の実りが増えまする`);
    if (p.kin >= 20 && p.buso < 40) add("buki", 30, `武装度${p.buso}は物足りませぬ。武具を揃えなされ`);

    // --- 何もすることがない時 ---
    add("pass", 5, `この国に急ぎの手当てはありませぬ。他国に力を注ぎましょう`);

    list.sort((a, b) => b.score - a.score);
    // 同じコマンドが複数の理由で挙がった場合は最高スコアのみ残す
    const seen = new Set();
    return list.filter(e => !seen.has(e.key) && seen.add(e.key));
  },
};
