// ヘッドレス動作確認: node test/smoke.js
// ブラウザなしでゲームロジックを数十年分回し、実行時エラーや状態破綻を検出する
"use strict";
const fs = require("fs");
const path = require("path");
const vm = require("vm");

const ctx = {
  console,
  UI: {
    log: () => {},
    refresh: () => {},
    setPhase: () => {},
    focusProvince: () => {},
    showScreen: () => {},
    alert: async () => true,
    confirm: async () => false,
    choose: async () => null,
    number: async () => null,
    form: async () => null,
    pickProvince: async () => null,
    commandMenu: async () => "skipAll",
  },
  BattleUI: {},
};
ctx.globalThis = ctx;
vm.createContext(ctx);

for (const f of ["analytics.js", "data.js", "game.js", "battle.js", "ai.js"]) {
  const src = fs.readFileSync(path.join(__dirname, "..", "js", f), "utf8");
  vm.runInContext(src, ctx, { filename: f });
}

vm.runInContext(`
(async () => {
  // ---- データ健全性 ----
  const assert = (cond, msg) => { if (!cond) throw new Error("ASSERT: " + msg); };

  // ---- 軍師（Advisor）を毎季節のコマンドメニューで検証 ----
  let advisorCalls = 0;
  UI.commandMenu = async (p) => {
    const adv = Advisor.advise(p);
    assert(Array.isArray(adv) && adv.length > 0, "軍師の進言が返る: " + p.name);
    const seen = new Set();
    for (const a of adv) {
      assert(typeof Commands[a.key] === "function", "進言コマンドが実在: " + a.key);
      assert(typeof a.reason === "string" && a.reason.length > 0, "進言に理由がある: " + a.key);
      assert(Number.isFinite(a.score), "進言にスコアがある: " + a.key);
      assert(!seen.has(a.key), "進言に重複がない: " + a.key);
      seen.add(a.key);
    }
    for (let i = 1; i < adv.length; i++) assert(adv[i - 1].score >= adv[i].score, "進言がスコア降順");
    advisorCalls++;
    return "skipAll";
  };
  assert(PROVINCE_DEFS.length === 50, "国数は50 → " + PROVINCE_DEFS.length);
  assert(MODE17_PROVINCES.length === 17, "17ヶ国モードの国数 → " + MODE17_PROVINCES.length);
  const ids = new Set(PROVINCE_DEFS.map(p => p.id));
  for (const d of DAIMYO_DEFS) assert(ids.has(d.prov), "大名の本国が存在: " + d.name);
  const homes = DAIMYO_DEFS.map(d => d.prov);
  assert(new Set(homes).size === homes.length, "本国の重複なし");
  for (const p of PROVINCE_DEFS) for (const a of p.adj) assert(ids.has(a), "隣接先が存在: " + p.id + "->" + a);

  // ---- 両モードで長期シミュレーション ----
  for (const mode of [50, 17]) {
    Game.newGame(mode);
    // 隣接の対称性
    for (const p of Game.provinceList())
      for (const a of p.adj)
        assert(G.provinces[a].adj.includes(p.id), "隣接対称 " + p.id + "<->" + a);
    // 連結性チェック
    const provs = Game.provinceList();
    const seen = new Set([provs[0].id]);
    const stack = [provs[0].id];
    while (stack.length) {
      const cur = G.provinces[stack.pop()];
      for (const a of cur.adj) if (!seen.has(a)) { seen.add(a); stack.push(a); }
    }
    assert(seen.size === provs.length, "地図が連結 mode" + mode + ": " + seen.size + "/" + provs.length);

    // プレイヤーを設定（コマンドは全スキップ）し、60季節=15年回す
    const someDaimyo = Game.aliveDaimyos()[0];
    G.playerId = someDaimyo.id;
    someDaimyo.isPlayer = true;
    for (let i = 0; i < 60 && !G.over; i++) {
      await Events.seasonStart();
      if (G.over) break;
      await PlayerPhase.run();
      if (G.over) break;
      await AI.run();
      if (G.over) break;
      Game.tickAlliances();
      Game.checkVictory();
      if (G.over) break;
      G.season++; if (G.season > 3) { G.season = 0; G.year++; }
      G.turn++;
    }
    // 状態の健全性
    for (const p of Game.provinceList()) {
      assert(Number.isFinite(p.hei) && p.hei >= 0, "兵数が正常: " + p.name + "=" + p.hei);
      assert(Number.isFinite(p.kin) && Number.isFinite(p.kome), "金米が正常: " + p.name);
      assert(p.owner === 0 || (G.daimyos[p.owner] && G.daimyos[p.owner].alive), "領主が生存: " + p.name);
    }
    for (const d of Game.aliveDaimyos()) {
      assert(Game.ownedBy(d.id).length > 0, "生存大名は領土を持つ: " + d.name);
    }
    console.log("mode" + mode + " OK: " + G.year + "年まで進行 / 生存大名 " +
      Game.aliveDaimyos().length + " / 状態=" + (G.over || "継続中"));
  }
  assert(advisorCalls > 0, "軍師が呼ばれた: " + advisorCalls);
  console.log("advisor OK: " + advisorCalls + "季節分の進言を検証");

  // ---- 戦術戦闘ロジック（AI同士で1戦フル実行） ----
  {
    const atkUnits = Battle.makeUnits("A", 800, 60, 60, "攻手");
    const defUnits = Battle.makeUnits("D", 600, 50, 40, "守手");
    assert(atkUnits.length >= 1 && atkUnits.some(u => u.isLeader), "攻撃側部隊編成");
    assert(defUnits.some(u => u.isLeader), "守備側部隊編成");
    const st = {
      terrain: Battle.genTerrain(),
      units: [...atkUnits, ...defUnits],
      day: 1, maxDay: 30, atkKome: 200, defKome: 200,
      weather: "sun", playerSide: "X",
      atkName: "攻手", defName: "守手", atkLeads: true, defLeads: true,
      log: [], result: null,
    };
    const aPos = [[0,3],[0,1],[0,5],[0,2],[0,4]];
    atkUnits.forEach((u,i) => { [u.x,u.y] = aPos[i]; });
    const dPos = [[5,3],[4,2],[4,4],[5,1],[5,5]];
    defUnits.forEach((u,i) => { [u.x,u.y] = dPos[i]; });
    let guard = 0;
    while (!st.result && guard++ < 200) {
      st.weather = Math.random() < 0.25 ? "rain" : "sun";
      st.units.forEach(u => { u.acted = false; });
      Battle.aiTurn(st, "A");
      Battle.checkEnd(st);
      if (st.result) break;
      Battle.aiTurn(st, "D");
      Battle.checkEnd(st);
      if (st.result) break;
      Battle.endDay(st);
    }
    assert(st.result === "A" || st.result === "D", "戦術戦闘が決着する: " + st.result);
    for (const u of st.units) assert(Number.isFinite(u.hei) && u.hei >= 0, "部隊兵数が正常");
    console.log("tactical battle OK: 勝者=" + st.result + " " + st.day + "日目 (" + st.log.length + "手)");
  }

  // ---- セーブ/ロード相当（JSON往復） ----
  const json = JSON.stringify(G);
  G = JSON.parse(json);
  assert(Game.provinceList().length > 0, "JSON復元");
  console.log("save/load OK");
  console.log("ALL TESTS PASSED");
})().catch(e => { console.error(e); process.exitCode = 1; });
`, ctx, { filename: "smoke-main" });
