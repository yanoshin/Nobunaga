// ============================================================
// battle.js — 合戦（自動解決 & プレイヤー参加時の戦術マップ戦闘）
// ============================================================
"use strict";

const Battle = {

  // ----------------------------------------------------------
  // エントリポイント
  // opts: {fromId, targetId, attackerDaimyo, hei, kome, daimyoLeads}
  // ----------------------------------------------------------
  async start(opts) {
    const from = G.provinces[opts.fromId];
    const target = G.provinces[opts.targetId];
    const atkOwner = opts.attackerDaimyo;
    const defOwnerId = target.owner;
    const playerInvolved = atkOwner.id === G.playerId || defOwnerId === G.playerId;

    let result;
    if (playerInvolved && defOwnerId !== VACANT && typeof document !== "undefined") {
      result = await this.tactical(opts, from, target);
    } else if (playerInvolved && defOwnerId === VACANT) {
      result = this.auto(opts, from, target);   // 空白国の民兵戦は自動解決
    } else {
      result = this.auto(opts, from, target);
    }
    await this.finish(opts, from, target, result);
    return result;
  },

  // ----------------------------------------------------------
  // 自動解決
  // ----------------------------------------------------------
  auto(opts, from, target) {
    const defOwner = target.owner !== VACANT ? G.daimyos[target.owner] : null;
    const defAtHome = defOwner && defOwner.home === target.id;
    const atkPower = opts.hei * (1 + from.kunren / 100) * (1 + from.buso / 150)
      * (opts.daimyoLeads ? 1.7 : 1) * rf(0.8, 1.2);
    const defPower = target.hei * (1 + target.kunren / 100) * (1 + target.buso / 150)
      * (defOwner ? 1.3 : 1.15)                 // 城郭の守り
      * (defAtHome ? 1.25 : 1) * rf(0.8, 1.2);
    const attackerWon = atkPower > defPower;
    const ratio = Math.min(atkPower, defPower) / Math.max(atkPower, defPower);
    let attLeft, defLeft;
    if (attackerWon) {
      attLeft = Math.round(opts.hei * (1 - ratio * rf(0.3, 0.5)));
      defLeft = Math.round(target.hei * rf(0.0, 0.2));
    } else {
      attLeft = Math.round(opts.hei * rf(0.05, 0.25));
      defLeft = Math.round(target.hei * (1 - ratio * rf(0.3, 0.5)));
    }
    return { attackerWon, attLeft, defLeft, komeLeft: opts.kome, interactive: false };
  },

  // ----------------------------------------------------------
  // 戦術マップ戦闘（プレイヤー参加時）
  // ----------------------------------------------------------
  GRID_W: 7, GRID_H: 7,
  TYPE_NAME: { ashigaru: "足軽", kiba: "騎馬", teppo: "鉄砲" },
  TYPE_MULT: { ashigaru: 1.0, kiba: 1.4, teppo: 1.9 },

  makeUnits(side, totalHei, kunren, buso, leaderName) {
    const units = [];
    const push = (type, hei, isLeader) => {
      if (hei >= 20) units.push({
        side, type, hei, init: hei, isLeader: !!isLeader,
        kunren, buso, x: 0, y: 0, acted: false, name: "",
      });
    };
    if (totalHei < 150) {
      push("ashigaru", totalHei, true);
    } else {
      const teppoShare = buso >= 50 ? 0.25 : buso >= 25 ? 0.15 : 0;
      const teppo = Math.round(totalHei * teppoShare);
      const kiba = Math.round(totalHei * 0.2);
      const leader = Math.round(totalHei * 0.3);
      const rest = totalHei - teppo - kiba - leader;
      push("ashigaru", leader, true);           // 第1部隊: 大将（足軽）
      push("kiba", kiba);                        // 第2部隊: 騎馬
      push("teppo", teppo);                      // 第3部隊: 鉄砲
      push("ashigaru", Math.ceil(rest / 2));     // 第4部隊
      push("ashigaru", Math.floor(rest / 2));    // 第5部隊
    }
    units.forEach((u, i) => { u.name = `${leaderName ? (u.isLeader ? leaderName : `第${i + 1}隊`) : `第${i + 1}隊`}`; });
    return units;
  },

  genTerrain() {
    const t = [];
    for (let y = 0; y < this.GRID_H; y++) {
      t.push(new Array(this.GRID_W).fill("plain"));
    }
    t[3][5] = "castle";
    // 川（中央付近を縦断）
    const riverCol = rint(2, 3);
    for (let y = rint(0, 1); y < this.GRID_H - rnd(2); y++) {
      if (t[y][riverCol] === "plain") t[y][riverCol] = "river";
    }
    // 山
    let m = 0;
    while (m < 5) {
      const x = rnd(this.GRID_W), y = rnd(this.GRID_H);
      if (t[y][x] === "plain" && x > 0) { t[y][x] = "mountain"; m++; }
    }
    return t;
  },

  terrainDef(terrain) {
    return { plain: 1.0, mountain: 0.65, river: 1.25, castle: 0.4 }[terrain];
  },

  unitAt(st, x, y) { return st.units.find(u => u.hei > 0 && u.x === x && u.y === y); },

  async tactical(opts, from, target, special) {
    const defOwner = target.owner !== VACANT ? G.daimyos[target.owner] : null;
    const atkUnits = this.makeUnits("A", opts.hei, from.kunren, from.buso,
      opts.daimyoLeads ? opts.attackerDaimyo.name : null);
    const defLeads = defOwner && defOwner.home === target.id;
    const defUnits = this.makeUnits("D", target.hei, target.kunren, target.buso,
      defLeads ? defOwner.name : null);

    const st = {
      terrain: this.genTerrain(),
      units: [...atkUnits, ...defUnits],
      day: 1, maxDay: 30,
      atkKome: opts.kome,
      defKome: special ? 9999 : target.kome,
      weather: "sun",
      playerSide: opts.attackerDaimyo.id === G.playerId ? "A" : "D",
      atkName: opts.attackerDaimyo.name,
      defName: defOwner ? defOwner.name : `${target.short}の民兵`,
      atkD: opts.attackerDaimyo, defD: defOwner,
      atkLeads: opts.daimyoLeads, defLeads,
      noRetreat: !!(special && special.noRetreat),
      log: [],
      result: null,   // 'A' | 'D' 勝者
    };
    // 初期配置: 攻撃側は左端、防御側は城の周囲
    const aPos = [[0, 3], [0, 1], [0, 5], [0, 2], [0, 4]];
    atkUnits.forEach((u, i) => { [u.x, u.y] = aPos[i]; });
    const dPos = [[5, 3], [4, 2], [4, 4], [5, 1], [5, 5]];
    defUnits.forEach((u, i) => { [u.x, u.y] = dPos[i]; });

    await BattleUI.open(st);
    while (!st.result) {
      st.weather = Math.random() < 0.25 ? "rain" : "sun";
      st.units.forEach(u => { u.acted = false; });
      BattleUI.render(st);
      // 攻撃側→防御側の順で行動
      for (const side of ["A", "D"]) {
        if (st.result) break;
        if (side === st.playerSide) await this.playerTurn(st);
        else this.aiTurn(st, side);
        this.checkEnd(st);
        BattleUI.render(st);
      }
      if (st.result) break;
      this.endDay(st);
      BattleUI.render(st);
    }
    await BattleUI.close(st);

    const attLeft = st.units.filter(u => u.side === "A" && u.hei > 0).reduce((s, u) => s + u.hei, 0);
    const defLeft = st.units.filter(u => u.side === "D" && u.hei > 0).reduce((s, u) => s + u.hei, 0);
    if (!special) target.kome = Math.max(0, st.defKome);
    return { attackerWon: st.result === "A", attLeft, defLeft, komeLeft: Math.max(0, st.atkKome), interactive: true };
  },

  endDay(st) {
    st.atkKome -= Math.ceil(this.sideHei(st, "A") / 150);
    st.defKome -= Math.ceil(this.sideHei(st, "D") / 150);
    if (st.atkKome <= 0) {
      st.log.push("攻撃側の兵糧が尽きた！総退却！");
      st.result = "D";
      return;
    }
    if (st.defKome <= 0) {
      st.log.push("城方の兵糧が尽きた！開城！");
      st.result = "A";
      return;
    }
    st.day++;
    if (st.day > st.maxDay) {
      st.log.push("長陣かなわず、攻撃側は兵を退いた。");
      st.result = "D";
    }
  },

  sideHei(st, side) {
    return st.units.filter(u => u.side === side && u.hei > 0).reduce((s, u) => s + u.hei, 0);
  },

  checkEnd(st) {
    if (st.result) return;
    for (const side of ["A", "D"]) {
      const alive = st.units.filter(u => u.side === side && u.hei > 0);
      const leaderAlive = alive.some(u => u.isLeader);
      if (!alive.length || !leaderAlive) {
        st.result = side === "A" ? "D" : "A";
        st.log.push(`${side === "A" ? "攻撃側" : "守備側"}の本陣が崩れた！`);
        return;
      }
    }
  },

  moveRange(st, u) {
    // 騎馬は2歩（山には入れるが2歩目不可）、他は1歩
    const steps = u.type === "kiba" ? 2 : 1;
    const seen = new Map();
    const queue = [[u.x, u.y, 0]];
    while (queue.length) {
      const [x, y, d] = queue.shift();
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const nx = x + dx, ny = y + dy;
        if (nx < 0 || ny < 0 || nx >= this.GRID_W || ny >= this.GRID_H) continue;
        if (this.unitAt(st, nx, ny)) continue;
        const key = nx + "," + ny;
        if (seen.has(key)) continue;
        seen.set(key, true);
        const terr = st.terrain[ny][nx];
        const nd = d + 1;
        if (nd < steps && terr !== "mountain" && terr !== "river") queue.push([nx, ny, nd]);
      }
    }
    return [...seen.keys()].map(k => k.split(",").map(Number));
  },

  attackTargets(st, u) {
    const range = (u.type === "teppo" && st.weather !== "rain") ? 2 : 1;
    return st.units.filter(t =>
      t.side !== u.side && t.hei > 0 &&
      Math.abs(t.x - u.x) + Math.abs(t.y - u.y) <= range);
  },

  doAttack(st, u, t) {
    const ranged = u.type === "teppo" && (Math.abs(t.x - u.x) + Math.abs(t.y - u.y)) > 1;
    const leads = u.side === "A" ? st.atkLeads : st.defLeads;
    const dmg = this.calcDamage(st, u, t, leads && u.isLeader);
    t.hei = Math.max(0, t.hei - dmg);
    st.log.push(`${this.uLabel(st, u)}が${this.uLabel(st, t)}を攻撃！${dmg}の損害。`);
    if (t.hei <= 0) {
      st.log.push(`${this.uLabel(st, t)}、壊滅！`);
    } else if (t.hei < t.init * 0.25 && Math.random() < 0.4) {
      st.log.push(`${this.uLabel(st, t)}は戦意を失い敗走した！`);
      t.hei = 0;
    } else if (!ranged) {
      // 白兵戦は反撃を受ける
      const tLeads = t.side === "A" ? st.atkLeads : st.defLeads;
      const back = Math.round(this.calcDamage(st, t, u, tLeads && t.isLeader) * 0.6);
      u.hei = Math.max(0, u.hei - back);
      if (back > 0) st.log.push(`反撃で${this.uLabel(st, u)}に${back}の損害。`);
      if (u.hei <= 0) st.log.push(`${this.uLabel(st, u)}、壊滅！`);
    }
    u.acted = true;
    this.checkEnd(st);
  },

  calcDamage(st, u, t, isLeaderBoosted) {
    const terr = st.terrain[t.y][t.x];
    return Math.max(1, Math.round(
      u.hei * this.TYPE_MULT[u.type]
      * (0.5 + u.kunren / 150) * (0.7 + u.buso / 200)
      * (isLeaderBoosted ? 1.8 : 1)
      * rf(0.09, 0.16)
      * this.terrainDef(terr)
    ));
  },

  uLabel(st, u) {
    const side = u.side === "A" ? st.atkName : st.defName;
    return `${side}方${this.TYPE_NAME[u.type]}${u.isLeader ? "(本陣)" : ""}`;
  },

  // ---- プレイヤーの1日 ----
  async playerTurn(st) {
    while (!st.result) {
      const movable = st.units.filter(u => u.side === st.playerSide && u.hei > 0 && !u.acted);
      if (!movable.length) break;
      BattleUI.render(st);
      const action = await BattleUI.pickAction(st, movable);
      if (action.type === "endDay") break;
      if (action.type === "retreat") {
        st.result = st.playerSide === "A" ? "D" : "A";
        st.log.push("総退却！");
        break;
      }
      if (action.type === "auto") {
        this.aiTurn(st, st.playerSide);
        break;
      }
      if (action.type === "move") {
        action.unit.x = action.x; action.unit.y = action.y;
        action.unit.acted = true;
      }
      if (action.type === "attack") {
        this.doAttack(st, action.unit, action.target);
      }
      BattleUI.render(st);
    }
  },

  // ---- AI側の1日 ----
  aiTurn(st, side) {
    const myUnits = st.units.filter(u => u.side === side && u.hei > 0 && !u.acted);
    for (const u of myUnits) {
      if (st.result) return;
      const targets = this.attackTargets(st, u);
      if (targets.length) {
        // 本陣を優先、次に最弱
        targets.sort((a, b) => (b.isLeader - a.isLeader) || (a.hei - b.hei));
        this.doAttack(st, u, targets[0]);
        continue;
      }
      // 防御側は敵が近づくまで城を守る
      const enemies = st.units.filter(t => t.side !== side && t.hei > 0);
      if (!enemies.length) return;
      const nearest = enemies.reduce((best, e) => {
        const d = Math.abs(e.x - u.x) + Math.abs(e.y - u.y);
        return d < best.d ? { e, d } : best;
      }, { e: null, d: 99 });
      if (side === "D" && nearest.d > 3) { u.acted = true; continue; }
      // 最寄りの敵へ1歩近づく
      const moves = this.moveRange(st, u);
      let bestMove = null, bestDist = nearest.d;
      for (const [mx, my] of moves) {
        const d = Math.abs(nearest.e.x - mx) + Math.abs(nearest.e.y - my);
        if (d < bestDist) { bestDist = d; bestMove = [mx, my]; }
      }
      if (bestMove) { [u.x, u.y] = bestMove; }
      u.acted = true;
      // 移動後に射程内なら攻撃（騎馬の突撃など）
      const after = this.attackTargets(st, u);
      if (after.length && u.type !== "teppo") {
        after.sort((a, b) => (b.isLeader - a.isLeader) || (a.hei - b.hei));
        u.acted = false;
        this.doAttack(st, u, after[0]);
      }
    }
  },

  // ----------------------------------------------------------
  // 戦後処理
  // ----------------------------------------------------------
  async finish(opts, from, target, result) {
    const atk = opts.attackerDaimyo;
    const defOwnerId = target.owner;
    const defOwner = defOwnerId !== VACANT ? G.daimyos[defOwnerId] : null;

    if (result.attackerWon) {
      UI.log(`【合戦】${atk.name}軍、${target.name}を攻略！`);
      const defWasHome = defOwner && defOwner.home === target.id;
      Game.transferProvince(target.id, atk.id);
      target.hei = result.attLeft;
      target.kome += result.komeLeft;
      target.heichu = 60;
      target.kunren = from.kunren;
      target.buso = from.buso;
      if (defOwnerId === G.playerId) {
        await UI.alert(`${target.name}を${atk.name}に奪われた！`);
      }
      if (defOwner) {
        const remaining = Game.ownedBy(defOwner.id);
        if (defWasHome || !remaining.length) {
          // 大将の生死判定: 討死なら全領土が勝者のものに（全国版の掟）
          if (!remaining.length || Math.random() < 0.25) {
            Game.daimyoDies(defOwner, "war", { killerId: atk.id });
          } else {
            const refuge = remaining[0];
            defOwner.home = refuge.id;
            UI.log(`${defOwner.name}は命からがら${refuge.name}へ落ち延びた。`);
          }
        }
      }
      if (atk.id === G.playerId) {
        await UI.alert(`${target.name}を攻め落とした！\n残兵${result.attLeft}が入城した。`);
      }
    } else {
      UI.log(`【合戦】${atk.name}軍、${target.name}攻めに失敗……`);
      target.hei = Math.max(result.defLeft, 10);
      // 生き残りは帰国
      from.hei += result.attLeft;
      from.kome += result.komeLeft;
      if (opts.daimyoLeads) {
        if (Math.random() < 0.25) {
          const killerId = defOwnerId !== VACANT ? defOwnerId : null;
          if (killerId) Game.daimyoDies(atk, "war", { killerId });
          else Game.daimyoDies(atk, "illness");   // 民兵に討たれ領国は空白化
        } else if (atk.id === G.playerId) {
          await UI.alert(`敗戦……${atk.name}は残兵${result.attLeft}を率いて${from.name}へ退却した。`);
        }
      } else if (atk.id === G.playerId) {
        await UI.alert(`敗戦……残兵${result.attLeft}が${from.name}へ退却した。`);
      }
      if (defOwnerId === G.playerId) {
        await UI.alert(`${target.name}を守り抜いた！`);
      }
    }
    UI.refresh();
  },

  // ----------------------------------------------------------
  // 本能寺の変（特殊戦闘: 信長500 vs 明智1500、退却不可）
  // ----------------------------------------------------------
  async honnoji(nobunaga, akechi) {
    const dummyFrom = { kunren: 90, buso: 80 };
    const yamashiro = G.provinces[29];
    const opts = {
      fromId: 29, targetId: 29,
      attackerDaimyo: akechi, hei: 1500, kome: 999, daimyoLeads: true,
    };
    // 山城の状態を退避し、信長の手勢で守る特殊戦闘を組む
    const saved = { owner: yamashiro.owner, hei: yamashiro.hei, kome: yamashiro.kome, kunren: yamashiro.kunren, buso: yamashiro.buso };
    yamashiro.hei = 500;
    yamashiro.kunren = 90;
    yamashiro.buso = 70;
    const result = await this.tactical(opts, dummyFrom, yamashiro, { noRetreat: true });
    Object.assign(yamashiro, saved);
    return result.attackerWon ? "lose" : "win";
  },
};
