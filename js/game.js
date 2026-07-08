// ============================================================
// game.js — ゲーム状態・ターン進行・コマンド・イベント
// ============================================================
"use strict";

// ---- 乱数ユーティリティ ----
const rnd = (n) => Math.floor(Math.random() * n);
const rint = (a, b) => a + Math.floor(Math.random() * (b - a + 1));
const rf = (a, b) => a + Math.random() * (b - a);
const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

// ---- ゲーム状態 ----
let G = null;

const Game = {

  newGame(mode) {
    G = {
      mode,                       // 50 | 17
      year: START_YEAR,
      season: 0,                  // 0春 1夏 2秋 3冬
      turn: 0,
      provinces: {},
      daimyos: {},
      playerId: null,
      nextDaimyoId: 1,
      honnojiDone: false,
      over: null,                 // null | 'win' | 'dead'
    };
    const activeIds = mode === 17 ? MODE17_PROVINCES : PROVINCE_DEFS.map(d => d.id);
    const activeSet = new Set(activeIds);

    for (const def of PROVINCE_DEFS) {
      if (!activeSet.has(def.id)) continue;
      G.provinces[def.id] = {
        id: def.id, name: def.name, short: def.short, x: def.x, y: def.y,
        adj: def.adj.filter(a => activeSet.has(a)),
        owner: VACANT,
        koku: def.koku + rint(-5, 10),
        chisui: rint(20, 50),
        town: def.town + rint(-5, 10),
        minchu: rint(40, 65),
        minzai: rint(35, 60),
        hei: 0,
        kunren: rint(30, 60),
        buso: rint(20, 50),
        heichu: rint(50, 70),
        kin: rint(50, 150),
        kome: rint(80, 200),
        loan: 0,
        policy: "balance",        // military | production | balance
        typhoon: false,
      };
    }
    // 隣接の対称性を保証
    for (const p of Object.values(G.provinces)) {
      for (const a of p.adj) {
        const q = G.provinces[a];
        if (q && !q.adj.includes(p.id)) q.adj.push(p.id);
      }
    }
    // 大名配置
    for (const def of DAIMYO_DEFS) {
      if (!activeSet.has(def.prov)) continue;
      const d = this.createDaimyo(def.name, def.prov, def.age, {
        health: def.stats[0], amb: def.stats[1], luck: def.stats[2],
        charm: def.stats[3], iq: def.stats[4],
      });
      const p = G.provinces[def.prov];
      p.owner = d.id;
      p.hei = rint(300, 600);
      p.kin = rint(150, 300);
      p.kome = rint(150, 300);
    }
    // 空白国は民兵が守る
    for (const p of Object.values(G.provinces)) {
      if (p.owner === VACANT) p.hei = p.minchu * 4;
    }
    return G;
  },

  createDaimyo(name, home, age, stats) {
    const id = G.nextDaimyoId++;
    const d = {
      id, name, home, age,
      health: stats.health, amb: stats.amb, luck: stats.luck,
      charm: stats.charm, iq: stats.iq,
      alive: true, isPlayer: false,
      allies: {},                 // {daimyoId: 残り季節数}
      grudge: 0,                  // 恨みを持つ相手の大名ID
      color: DAIMYO_COLORS[(id - 1) % DAIMYO_COLORS.length],
    };
    G.daimyos[id] = d;
    return d;
  },

  prov(id) { return G.provinces[id]; },
  daimyo(id) { return G.daimyos[id]; },
  player() { return G.daimyos[G.playerId]; },
  provinceList() { return Object.values(G.provinces); },
  aliveDaimyos() { return Object.values(G.daimyos).filter(d => d.alive); },
  ownedBy(did) { return this.provinceList().filter(p => p.owner === did); },

  allied(a, b) {
    const da = G.daimyos[a];
    return !!(da && da.allies[b] > 0);
  },

  makeAlliance(a, b, seasons) {
    G.daimyos[a].allies[b] = seasons;
    G.daimyos[b].allies[a] = seasons;
  },

  breakAlliance(a, b) {
    delete G.daimyos[a].allies[b];
    delete G.daimyos[b].allies[a];
  },

  tickAlliances() {
    for (const d of this.aliveDaimyos()) {
      for (const k of Object.keys(d.allies)) {
        if (d.id >= +k) continue;           // 各ペアは片側からのみ数える
        d.allies[k]--;
        const other = G.daimyos[k];
        if (other) other.allies[d.id] = d.allies[k];
        if (d.allies[k] <= 0) {
          delete d.allies[k];
          if (other) delete other.allies[d.id];
          if ((d.id === G.playerId || +k === G.playerId) && other) {
            const rival = d.id === G.playerId ? other : d;
            UI.log(`${rival.name}との不戦同盟の期限が切れた。`);
          }
        }
      }
    }
  },

  dateStr() { return `${G.year}年 ${SEASONS[G.season]}`; },

  // ---- 国の所有権移動 ----
  transferProvince(pid, newOwner) {
    const p = G.provinces[pid];
    p.owner = newOwner;
    p.minchu = clamp(p.minchu - 10, 0, 100);   // 新支配者への反発
    p.loan = 0;
  },

  vacateProvince(pid) {
    const p = G.provinces[pid];
    p.owner = VACANT;
    p.hei = Math.max(p.hei, p.minchu * 3);      // 民兵化
    p.loan = 0;
  },

  // ---- 大名の死亡処理 ----
  // cause: 'war'(討死→全領土が勝者へ) / 'illness' / 'assassin'(全領土空白化)
  //        'uprising' / 'rebellion'(本国に新大名、他は空白化)
  daimyoDies(d, cause, opt = {}) {
    d.alive = false;
    const lands = this.ownedBy(d.id);
    if (cause === "war" && opt.killerId) {
      const killer = G.daimyos[opt.killerId];
      for (const p of lands) this.transferProvince(p.id, opt.killerId);
      UI.log(`【滅亡】${d.name}は討死。全領土は${killer.name}のものとなった！`);
    } else if (cause === "uprising" || cause === "rebellion") {
      for (const p of lands) {
        if (p.id === d.home && opt.rebelId) {
          this.transferProvince(p.id, opt.rebelId);
        } else {
          this.vacateProvince(p.id);
        }
      }
      UI.log(`【滅亡】${d.name}は${cause === "uprising" ? "一揆" : "謀反"}に倒れた。`);
    } else {
      for (const p of lands) this.vacateProvince(p.id);
      UI.log(`【滅亡】${d.name}は${cause === "assassin" ? "何者かに暗殺された" : "病に倒れ、この世を去った"}。領国は空白地となった。`);
    }
    if (d.id === G.playerId) G.over = "dead";
  },

  spawnNewDaimyo(pid, forcedName) {
    const name = forcedName ||
      NEW_DAIMYO_NAMES[rnd(NEW_DAIMYO_NAMES.length)] + (rnd(2) ? "" : "");
    const d = this.createDaimyo(name, pid, rint(20, 45), {
      health: rint(50, 85), amb: rint(40, 85), luck: rint(40, 80),
      charm: rint(40, 80), iq: rint(40, 85),
    });
    const p = G.provinces[pid];
    p.owner = d.id;
    p.hei = Math.max(p.hei, rint(250, 450));
    p.kin += rint(50, 150);
    p.kome += rint(50, 150);
    return d;
  },

  checkVictory() {
    if (G.over) return;
    const total = this.provinceList().length;
    const mine = this.ownedBy(G.playerId).length;
    if (mine >= total) {
      G.over = "win";
    } else if (mine === 0) {
      this.player().alive = false;
      G.over = "dead";
    }
  },
};

// ============================================================
// 季節イベント（災害・収入・一揆・謀反・新大名）
// ============================================================
const Events = {

  async seasonStart() {
    const s = G.season;
    UI.log(`━━ ${Game.dateStr()} ━━`);
    if (s === 0) await this.newYear();
    if (G.over) return;
    if (s === 0) this.goldIncome();
    if (s === 1 || s === 2) this.typhoonCheck(s === 1 ? 0.08 : 0.05);
    if (s === 2) await this.autumnHarvest();
    if (s === 3) this.plagueCheck();
    if (G.over) return;
    await this.unrestChecks();
    if (G.over) return;
    await this.honnojiCheck();
  },

  async newYear() {
    // 加齢・健康・病死判定
    for (const d of Game.aliveDaimyos()) {
      d.age++;
      const decay = Math.max(0, rint(-3, Math.floor(Math.max(0, d.age - 40) / 4)));
      d.health = clamp(d.health - decay, 0, 100);
      if (d.health <= 0 || (d.age > 60 && rnd(100) < (d.age - 55))) {
        Game.daimyoDies(d, "illness");
        if (G.over) return;
      }
    }
    // 空白国に新大名が勃興
    for (const p of Game.provinceList()) {
      if (p.owner === VACANT && rnd(100) < 12) {
        const d = Game.spawnNewDaimyo(p.id);
        UI.log(`${p.name}に新大名 ${d.name} が旗揚げした。`);
      }
    }
  },

  goldIncome() {
    for (const p of Game.provinceList()) {
      if (p.owner === VACANT) continue;
      const inc = Math.round(p.town * (0.5 + p.minzai / 200) * 1.5);
      p.kin += inc;
      if (p.owner === G.playerId) UI.log(`${p.short}: 町から金${inc}の収入。`);
    }
  },

  typhoonCheck(baseProb) {
    for (const p of Game.provinceList()) {
      const owner = p.owner !== VACANT ? Game.daimyo(p.owner) : null;
      const luckMod = owner ? owner.luck / 800 : 0;
      if (Math.random() < baseProb - luckMod) {
        p.typhoon = true;
        const dmg = Math.round(rint(8, 20) * (1 - p.chisui / 150) * (1 + (60 - p.minzai) / 200));
        p.minzai = clamp(p.minzai - dmg, 0, 100);
        p.town = clamp(p.town - Math.round(dmg / 3), 1, 999);
        UI.log(`【台風】${p.name}を台風が襲った！` + (p.chisui >= 60 ? "治水の甲斐あって被害は軽微。" : ""));
      }
    }
  },

  async autumnHarvest() {
    for (const p of Game.provinceList()) {
      if (p.owner === VACANT) { p.typhoon = false; continue; }
      const factor = rf(0.85, 1.15) * (p.typhoon ? 0.5 : 1);
      const inc = Math.round(p.koku * 2 * (0.7 + p.chisui / 250) * factor);
      p.kome += inc;
      if (p.owner === G.playerId) {
        UI.log(`${p.short}: 収穫 米${inc}。` + (p.typhoon ? "（台風で不作）" : ""));
      }
      if (factor < 0.65) {
        p.minchu = clamp(p.minchu - 10, 0, 100);
        UI.log(`【飢饉】${p.name}は凶作で民が飢えている……`);
      }
      p.typhoon = false;

      // 借金の自動返済（給料より優先）
      if (p.loan > 0) {
        const due = Math.round(p.loan * 1.15);
        const pay = Math.min(p.kin, due);
        p.kin -= pay;
        p.loan = due - pay;
        if (p.owner === G.playerId && pay > 0) UI.log(`${p.short}: 商人へ借金${pay}を返済。残り${p.loan}。`);
      }
      // 兵への給料（米）
      const need = Math.round(p.hei * 0.1);
      if (p.kome >= need) {
        p.kome -= need;
        p.heichu = clamp(p.heichu + 3, 0, 100);
      } else {
        p.kome = 0;
        const desert = Math.round(p.hei * 0.15);
        p.hei -= desert;
        p.heichu = clamp(p.heichu - 15, 0, 100);
        if (p.owner === G.playerId) UI.log(`${p.short}: 兵糧が足りず兵${desert}が逃散！兵忠誠が下がった。`);
      }
    }
  },

  plagueCheck() {
    for (const p of Game.provinceList()) {
      if (Math.random() < 0.04) {
        p.hei = Math.round(p.hei * 0.85);
        p.minchu = clamp(p.minchu - 5, 0, 100);
        UI.log(`【疫病】${p.name}に疫病が流行った……兵と民が倒れた。`);
        if (p.owner !== VACANT) {
          const d = Game.daimyo(p.owner);
          if (d.home === p.id) {
            d.health = clamp(d.health - rint(5, 20), 0, 100);
            if (d.health <= 0) Game.daimyoDies(d, "illness");
          }
        }
      }
    }
  },

  async unrestChecks() {
    for (const p of Game.provinceList()) {
      if (p.owner === VACANT || G.over) continue;
      const owner = Game.daimyo(p.owner);
      // 百姓一揆（民忠が低い / 軍事国は起きやすい / 魅力で軽減）
      const ikkiProb = (p.minchu < 25 ? 0.25 : p.minchu < 35 ? 0.08 : 0)
        + (p.policy === "military" ? 0.06 : 0) - owner.charm / 1000;
      if (Math.random() < ikkiProb) {
        const force = (70 - p.minchu) * 15;
        if (p.hei >= force * 0.4) {
          p.hei = Math.round(p.hei * 0.9);
          p.minchu = clamp(p.minchu + 8, 0, 100);
          UI.log(`【一揆】${p.name}で百姓一揆！${owner.name}軍が鎮圧した。`);
        } else {
          UI.log(`【一揆】${p.name}で大規模な百姓一揆！国を追われた……`);
          this.loseProvinceToUnrest(owner, p, "uprising");
          if (G.over) return;
        }
        continue;
      }
      // 謀反（兵忠が低い / 生産国は起きやすい）
      const muhonProb = (p.heichu < 25 ? 0.25 : p.heichu < 35 ? 0.08 : 0)
        + (p.policy === "production" ? 0.06 : 0) - owner.charm / 1000;
      if (Math.random() < muhonProb) {
        UI.log(`【謀反】${p.name}で家臣が謀反を起こした！`);
        this.loseProvinceToUnrest(owner, p, "rebellion");
        if (G.over) return;
      }
    }
  },

  loseProvinceToUnrest(owner, p, cause) {
    if (p.id === owner.home) {
      // 本国での一揆・謀反は大名の死 → 本国に新大名
      const rebel = Game.spawnNewDaimyo(p.id, cause === "rebellion" ? null : undefined);
      Game.daimyoDies(owner, cause, { rebelId: rebel.id });
      // spawnNewDaimyo が owner を設定済みだが、daimyoDies で本国が rebel へ移る
      p.owner = rebel.id;
      UI.log(`${p.name}に${rebel.name}が立った。`);
    } else {
      if (cause === "rebellion") {
        const rebel = Game.spawnNewDaimyo(p.id);
        UI.log(`${p.name}は${rebel.name}が支配する国となった。`);
      } else {
        Game.vacateProvince(p.id);
      }
    }
  },

  // ---- 本能寺の変（織田信長プレイ時の特殊イベント）----
  async honnojiCheck() {
    if (G.honnojiDone) return;
    const pl = Game.player();
    if (!pl || !pl.alive || pl.name !== "織田信長") return;
    const myProvs = Game.ownedBy(pl.id);
    const need = G.mode === 50 ? 25 : 9;
    const yamashiro = G.provinces[29];
    if (!yamashiro || yamashiro.owner !== pl.id) return;
    if (myProvs.length < need || G.year < 1571) return;
    if (rnd(100) >= 20) return;

    G.honnojiDone = true;
    await UI.alert("「敵は本能寺にあり！」\n\n明智光秀、謀反！\n本能寺に宿す信長の手勢はわずか──");
    const akechi = Game.createDaimyo("明智光秀", 0, 55, { health: 70, amb: 90, luck: 50, charm: 65, iq: 90 });
    const result = await Battle.honnoji(pl, akechi);
    if (result === "win") {
      akechi.alive = false;
      await UI.alert("是非に及ばず──信長は自ら槍を取り、明智軍を退けた！\n光秀は討死。天下布武は続く。");
    } else {
      await this.honnojiSuccession(pl, akechi);
    }
    UI.refresh();
  },

  async honnojiSuccession(nobunaga, akechi) {
    await UI.alert("本能寺は炎に包まれた……信長、四十九年の夢まぼろしの如くなり。\n\nだが物語は終わらぬ。中国大返し──羽柴秀吉が跡目を継ぐ！");
    const lands = Game.ownedBy(nobunaga.id).map(p => p.id);
    nobunaga.alive = false;
    nobunaga.isPlayer = false;
    // 秀吉（プレイヤー継続）・柴田勝家・明智光秀で旧織田領を三分
    const hideyoshi = Game.createDaimyo("羽柴秀吉", 0, G.year - 1537, { health: 80, amb: 90, luck: 85, charm: 85, iq: 95 });
    hideyoshi.isPlayer = true;
    G.playerId = hideyoshi.id;
    const katsuie = Game.createDaimyo("柴田勝家", 0, G.year - 1522, { health: 70, amb: 70, luck: 55, charm: 70, iq: 70 });
    const heirs = [hideyoshi, akechi, katsuie];
    lands.sort(() => Math.random() - 0.5);
    lands.forEach((pid, i) => {
      const heir = heirs[i % 3];
      G.provinces[pid].owner = heir.id;
      if (!heir.home) heir.home = pid;
    });
    for (const h of heirs) if (!h.home) { // 領土が回らなかった場合の保険
      const p = Game.ownedBy(h.id)[0];
      if (p) h.home = p.id; else h.alive = false;
    }
    if (!Game.ownedBy(hideyoshi.id).length) { G.over = "dead"; return; }
    await UI.alert(`そなたは羽柴秀吉として${G.provinces[hideyoshi.home].name}を本拠に再起する。\n旧織田領は明智光秀・柴田勝家と三分された。天下を取り戻せ！`);
  },
};

// ============================================================
// プレイヤーコマンド
// ============================================================
const Commands = {

  // 各コマンドは true を返すとその国の行動を消費する
  list(p) {
    const d = Game.player();
    const isHome = d.home === p.id;
    return [
      { key: "kaikon",   icon: "⛏️", label: "開墾",     hint: "石高↑ 金20" },
      { key: "chisui",   icon: "🌊", label: "治水",     hint: "台風に強く 金20" },
      { key: "machi",    icon: "🏘️", label: "町づくり", hint: "金収入↑ 金25" },
      { key: "hodokoshi", icon: "🍚", label: "施し",    hint: "民忠↑" },
      { key: "chohei",   icon: "🪖", label: "徴兵",     hint: "兵を雇う" },
      { key: "kunren",   icon: "🥋", label: "訓練",     hint: "訓練度↑" },
      { key: "buki",     icon: "🏹", label: "武器購入", hint: "武装度↑" },
      { key: "houbi",    icon: "🎁", label: "褒美",     hint: "兵忠誠↑" },
      { key: "merchant", icon: "💰", label: "商人",     hint: "米売買・借金" },
      { key: "move",     icon: "🐴", label: "輸送",     hint: "兵・金・米" + (isHome ? "・本拠" : "") },
      { key: "attack",   icon: "⚔️", label: "出陣",     hint: "隣国へ攻める" },
      { key: "diplomacy", icon: "🤝", label: "外交",    hint: "不戦同盟" },
      { key: "ninja",    icon: "🥷", label: "忍者",     hint: "暗殺・流言" },
      { key: "policyCmd", icon: "📜", label: "方針",    hint: Commands.policyName(p.policy) },
      { key: "rest",     icon: "♨️", label: "休養",     hint: "健康回復", disabled: !isHome },
      { key: "pass",     icon: "💤", label: "何もせぬ", hint: "" },
    ];
  },

  prodBonus(p) { return p.policy === "production" ? 1.25 : 1; },

  async kaikon(p) {
    if (p.kin < 20) { await UI.alert("金が足りませぬ（金20必要）。"); return false; }
    p.kin -= 20;
    const up = Math.round(rint(2, 5) * this.prodBonus(p));
    p.koku += up;
    p.minzai = clamp(p.minzai - 3, 0, 100);
    p.chisui = clamp(p.chisui - 2, 0, 100);
    UI.log(`${p.short}: 開墾を行い石高が${up}上がった。`);
    return true;
  },

  async chisui(p) {
    if (p.kin < 20) { await UI.alert("金が足りませぬ（金20必要）。"); return false; }
    p.kin -= 20;
    const up = Math.round(rint(4, 8) * this.prodBonus(p));
    p.chisui = clamp(p.chisui + up, 0, 100);
    UI.log(`${p.short}: 治水工事を行った（治水度+${up}）。`);
    return true;
  },

  async machi(p) {
    if (p.kin < 25) { await UI.alert("金が足りませぬ（金25必要）。"); return false; }
    p.kin -= 25;
    const up = Math.round(rint(4, 8) * this.prodBonus(p));
    p.town += up;
    p.minzai = clamp(p.minzai - 3, 0, 100);
    UI.log(`${p.short}: 町づくりを進めた（町+${up}）。`);
    return true;
  },

  async hodokoshi(p) {
    const kind = await UI.choose("何を施す？", [
      { label: `金を施す（所持金${p.kin}）`, value: "kin", disabled: p.kin < 10 },
      { label: `米を施す（所持米${p.kome}）※効果大`, value: "kome", disabled: p.kome < 10 },
    ], true);
    if (!kind) return false;
    const max = kind === "kin" ? p.kin : p.kome;
    const amt = await UI.number("施す量", 10, max, Math.min(50, max));
    if (amt == null) return false;
    if (kind === "kin") p.kin -= amt; else p.kome -= amt;
    const d = Game.player();
    const up = Math.round((amt / 10) * (kind === "kome" ? 1.5 : 1) * (0.8 + d.charm / 250));
    p.minchu = clamp(p.minchu + up, 0, 100);
    p.minzai = clamp(p.minzai + Math.round(amt / 20), 0, 100);
    UI.log(`${p.short}: 民に${kind === "kin" ? "金" : "米"}${amt}を施した（民忠+${up}）。`);
    return true;
  },

  async chohei(p) {
    const maxByMoney = Math.floor(Math.min(p.kin / 0.2, p.kome / 0.2));
    const maxByLand = p.koku * 12 - p.hei;
    const max = Math.max(0, Math.min(maxByMoney, maxByLand, 2000));
    if (max < 10) { await UI.alert("これ以上徴兵できませぬ（資金不足か国の限界）。"); return false; }
    const amt = await UI.number(`何人徴兵する？（最大${max}）`, 10, max, Math.min(200, max));
    if (amt == null) return false;
    const mil = p.policy === "military" ? 1.25 : 1;
    const got = Math.round(amt * mil);
    p.kin -= Math.round(amt * 0.2);
    p.kome -= Math.round(amt * 0.2);
    p.hei += got;
    p.minchu = clamp(p.minchu - 2, 0, 100);
    p.kunren = Math.max(10, p.kunren - Math.round(got / p.hei * 30));
    UI.log(`${p.short}: 兵${got}を徴集した（総勢${p.hei}）。`);
    return true;
  },

  async kunren(p) {
    const d = Game.player();
    const bonus = d.home === p.id ? Math.round(d.iq / 25 + d.health / 50) : 0;
    const up = rint(4, 9) + bonus + (p.policy === "military" ? 2 : 0);
    p.kunren = clamp(p.kunren + up, 0, 100);
    UI.log(`${p.short}: 兵を訓練した（訓練度+${up} → ${p.kunren}）。`);
    return true;
  },

  async buki(p) {
    if (p.kin < 10) { await UI.alert("金が足りませぬ。"); return false; }
    const amt = await UI.number(`いくら武器に使う？（所持金${p.kin}）`, 10, p.kin, Math.min(50, p.kin));
    if (amt == null) return false;
    p.kin -= amt;
    const up = Math.round(amt / 2 / (1 + p.buso / 50));
    p.buso = clamp(p.buso + up, 0, 100);
    UI.log(`${p.short}: 鉄砲・武具を購入（武装度+${up} → ${p.buso}）。`);
    return true;
  },

  async houbi(p) {
    if (p.kin < 10) { await UI.alert("金が足りませぬ。"); return false; }
    const amt = await UI.number(`褒美に使う金（所持金${p.kin}）`, 10, p.kin, Math.min(50, p.kin));
    if (amt == null) return false;
    p.kin -= amt;
    const up = Math.round(amt / 5);
    p.heichu = clamp(p.heichu + up, 0, 100);
    UI.log(`${p.short}: 兵に褒美を与えた（兵忠+${up}）。`);
    return true;
  },

  merchantRate() {
    // 米1あたりの金額。秋は安く、春〜夏は高い
    const base = [0.9, 1.0, 0.55, 0.8][G.season];
    return base * rf(0.9, 1.1);
  },

  async merchant(p) {
    const rate = this.merchantRate();
    const buyPrice = (n) => Math.ceil(n * rate);
    const sellGain = (n) => Math.floor(n * rate * 0.7);
    const loanMax = Math.max(0, p.town * 3 - p.loan);
    const act = await UI.choose(`堺の商人（相場: 米100 ⇔ 金${buyPrice(100)}）`, [
      { label: `米を買う（金${p.kin}）`, value: "buy", disabled: p.kin < buyPrice(10) },
      { label: `米を売る（米${p.kome}）`, value: "sell", disabled: p.kome < 10 },
      { label: `借金する（限度${loanMax}）`, value: "loan", disabled: loanMax < 10 },
      { label: `返済する（借金${p.loan}）`, value: "repay", disabled: p.loan <= 0 || p.kin <= 0 },
    ], true);
    if (!act) return false;
    if (act === "buy") {
      const max = Math.floor(p.kin / rate);
      const amt = await UI.number(`米をいくら買う？（最大${max}）`, 10, max, Math.min(100, max));
      if (amt == null) return false;
      p.kin -= buyPrice(amt); p.kome += amt;
      UI.log(`${p.short}: 米${amt}を金${buyPrice(amt)}で購入。`);
    } else if (act === "sell") {
      const amt = await UI.number(`米をいくら売る？（所持${p.kome}）`, 10, p.kome, Math.min(100, p.kome));
      if (amt == null) return false;
      p.kome -= amt; p.kin += sellGain(amt);
      UI.log(`${p.short}: 米${amt}を金${sellGain(amt)}で売却。`);
    } else if (act === "loan") {
      const amt = await UI.number(`いくら借りる？（限度${loanMax}・秋に15%利息で自動返済）`, 10, loanMax, Math.min(100, loanMax));
      if (amt == null) return false;
      p.kin += amt; p.loan += amt;
      UI.log(`${p.short}: 商人から金${amt}を借りた。`);
    } else if (act === "repay") {
      const max = Math.min(p.kin, p.loan);
      const amt = await UI.number(`いくら返す？（借金${p.loan}）`, 1, max, max);
      if (amt == null) return false;
      p.kin -= amt; p.loan -= amt;
      UI.log(`${p.short}: 借金${amt}を返済した。`);
    }
    return true;
  },

  async move(p) {
    const d = Game.player();
    const targets = p.adj.filter(a => G.provinces[a].owner === G.playerId);
    if (!targets.length) { await UI.alert("隣接する自国領がありませぬ。"); return false; }
    const to = await UI.pickProvince(targets, "どこへ送る？（地図で隣接自国領を選択）");
    if (!to) return false;
    const q = G.provinces[to];
    const fields = [
      { key: "hei", label: `兵（${p.hei}）`, min: 0, max: p.hei, def: 0 },
      { key: "kin", label: `金（${p.kin}）`, min: 0, max: p.kin, def: 0 },
      { key: "kome", label: `米（${p.kome}）`, min: 0, max: p.kome, def: 0 },
    ];
    if (d.home === p.id) fields.push({ key: "daimyo", label: "大名も移る（1=移る）", min: 0, max: 1, def: 0 });
    const v = await UI.form(`${p.short} → ${q.short} へ輸送`, fields);
    if (!v) return false;
    if (v.hei + v.kin + v.kome === 0 && !v.daimyo) return false;
    p.hei -= v.hei; q.hei += v.hei;
    p.kin -= v.kin; q.kin += v.kin;
    p.kome -= v.kome; q.kome += v.kome;
    if (v.daimyo) { d.home = to; UI.log(`${d.name}は本拠を${q.name}へ移した。`); }
    UI.log(`${p.short}→${q.short}: 兵${v.hei} 金${v.kin} 米${v.kome}を輸送。`);
    return true;
  },

  async attack(p) {
    const d = Game.player();
    const targets = p.adj.filter(a => G.provinces[a].owner !== G.playerId);
    if (!targets.length) { await UI.alert("隣接する敵国・空白国がありませぬ。"); return false; }
    if (p.hei < 50) { await UI.alert("兵が少なすぎまする（50以上必要）。"); return false; }
    const best = Advisor.bestTarget(p);
    const hint = best ? `　軍師「${best.q.short}（兵${best.q.hei}）が狙い目かと」` : "";
    const to = await UI.pickProvince(targets, "どこへ攻め込む？（地図で選択）" + hint);
    if (!to) return false;
    const q = G.provinces[to];
    if (q.owner !== VACANT && Game.allied(G.playerId, q.owner)) {
      const ok = await UI.confirm(`${Game.daimyo(q.owner).name}とは不戦同盟中！破って攻めるか？（信義を失う）`);
      if (!ok) return false;
      Game.breakAlliance(G.playerId, q.owner);
      d.charm = clamp(d.charm - 10, 1, 100);
      Game.daimyo(q.owner).grudge = G.playerId;
      UI.log(`${d.name}は同盟を破棄した！`);
    }
    const v = await UI.form(`${q.name}へ出陣`, [
      { key: "hei", label: `出陣兵数（${p.hei}）`, min: 50, max: p.hei, def: Math.round(p.hei * 0.8) },
      { key: "kome", label: `兵糧米（${p.kome}）`, min: 0, max: p.kome, def: Math.min(p.kome, Math.round(p.hei * 0.8 / 150) * 15) },
    ]);
    if (!v) return false;
    let lead = false;
    if (d.home === p.id) lead = await UI.confirm("大名自ら出陣するか？（戦力倍増、ただし討死の危険あり）");
    p.hei -= v.hei;
    p.kome -= v.kome;
    UI.log(`${d.name}軍 兵${v.hei}、${q.name}へ出陣！`);
    await Battle.start({
      fromId: p.id, targetId: to, attackerDaimyo: d,
      hei: v.hei, kome: v.kome, daimyoLeads: lead,
    });
    Game.checkVictory();
    return true;
  },

  async diplomacy(p) {
    const others = Game.aliveDaimyos().filter(d => d.id !== G.playerId && !Game.allied(G.playerId, d.id));
    if (!others.length) { await UI.alert("同盟を結べる相手がおりませぬ。"); return false; }
    const pick = await UI.choose("誰と不戦同盟を結ぶ？", others.map(d => ({
      label: `${d.name}（${Game.ownedBy(d.id).length}ヶ国）`, value: d.id, portrait: d,
    })), true);
    if (!pick) return false;
    const target = Game.daimyo(pick);
    const gift = await UI.number(`贈り物の金額（所持金${p.kin}）`, 0, p.kin, Math.min(100, p.kin));
    if (gift == null) return false;
    p.kin -= gift;
    const me = Game.player();
    const myPower = Game.ownedBy(G.playerId).length;
    const theirPower = Game.ownedBy(target.id).length;
    const prob = clamp(0.15 + me.charm / 250 + gift / 400 - target.amb / 300 + (myPower > theirPower ? 0.15 : 0), 0.05, 0.9);
    if (Math.random() < prob) {
      Game.makeAlliance(G.playerId, target.id, 12);
      UI.log(`${target.name}と不戦同盟成立（3年間）！`);
      await UI.alert(`${target.name}「良かろう、盟を結ぼうぞ」\n\n不戦同盟が成立した（3年間）。`, { portrait: target });
    } else {
      UI.log(`${target.name}に同盟を断られた……`);
      await UI.alert(`${target.name}「その儀、お断り申す」\n\n同盟は成らなかった。贈り物は戻らない。`, { portrait: target });
    }
    return true;
  },

  async ninja(p) {
    const act = await UI.choose("忍者に何を命じる？", [
      { label: "暗殺（金80）", value: "assassin", disabled: p.kin < 80 },
      { label: "流言（金40）敵国の民忠を下げる", value: "rumor", disabled: p.kin < 40 },
    ], true);
    if (!act) return false;
    const me = Game.player();
    if (act === "assassin") {
      const others = Game.aliveDaimyos().filter(d => d.id !== G.playerId);
      const pick = await UI.choose("誰を暗殺する？", others.map(d => ({
        label: `${d.name}（🧠${d.iq}）`, value: d.id, portrait: d,
      })), true);
      if (!pick) return false;
      p.kin -= 80;
      const t = Game.daimyo(pick);
      const prob = clamp(0.25 + (me.iq - t.iq) / 150 - t.luck / 500, 0.02, 0.8);
      if (Math.random() < prob) {
        UI.log(`【暗殺】伊賀者の凶刃が${t.name}を襲った……成功！`);
        Game.daimyoDies(t, "assassin");
        await UI.alert(`${t.name}、闇に散る。暗殺は成功した！`);
      } else {
        UI.log(`${t.name}の暗殺は失敗した。`);
        if (Math.random() < 0.4) {
          t.grudge = G.playerId;
          await UI.alert(`暗殺は失敗！しかも企てが露見した。${t.name}は激怒している……`);
        } else {
          await UI.alert("暗殺は失敗した。幸い、企ては露見しなかった。");
        }
      }
      return true;
    } else {
      const targets = Game.provinceList().filter(q => q.owner !== VACANT && q.owner !== G.playerId).map(q => q.id);
      if (!targets.length) { await UI.alert("対象がありませぬ。"); return false; }
      const to = await UI.pickProvince(targets, "どの国に流言を放つ？（地図で選択）");
      if (!to) return false;
      p.kin -= 40;
      const q = G.provinces[to];
      if (Math.random() < 0.4 + me.iq / 200) {
        const down = rint(8, 18);
        q.minchu = clamp(q.minchu - down, 0, 100);
        UI.log(`【流言】${q.name}に流言が広まり民心が乱れた（民忠-${down}）。`);
      } else {
        UI.log(`${q.name}への流言は効果がなかった。`);
      }
      return true;
    }
  },

  async policyCmd(p) {
    const v = await UI.choose(`${p.short}の経営方針（現在: ${this.policyName(p.policy)}）`, [
      { label: "軍事国（徴兵・訓練に強いが一揆が起きやすい）", value: "military" },
      { label: "生産国（内政に強いが謀反が起きやすい）", value: "production" },
      { label: "バランス国", value: "balance" },
    ], true);
    if (!v) return false;
    p.policy = v;
    UI.log(`${p.short}: 経営方針を${this.policyName(v)}とした。`);
    return true;
  },

  policyName(v) { return { military: "軍事国", production: "生産国", balance: "バランス国" }[v]; },

  async rest(p) {
    const d = Game.player();
    const up = rint(8, 15);
    d.health = clamp(d.health + up, 0, 100);
    UI.log(`${d.name}は湯治で英気を養った（健康+${up} → ${d.health}）。`);
    return true;
  },

  async pass(p) { return true; },
};

// ============================================================
// プレイヤーフェイズ
// ============================================================
const PlayerPhase = {
  async run() {
    const provs = Game.ownedBy(G.playerId).sort((a, b) => a.id - b.id);
    for (const p of provs) {
      if (G.over) return;
      if (p.owner !== G.playerId) continue;   // 途中で失った国はスキップ
      UI.refresh();
      UI.focusProvince(p.id);
      let done = false;
      while (!done && !G.over) {
        UI.setPhase(`【${Game.dateStr()}】 ${p.name} の命令`);
        const cmd = await UI.commandMenu(p);
        if (cmd === "skipAll") return;
        done = await Commands[cmd](p);
        UI.refresh();
      }
    }
    UI.setPhase("");
  },
};
