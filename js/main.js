// ============================================================
// main.js — タイトル・大名選択・能力スロット・ゲームループ
// ============================================================
"use strict";

const SAVE_KEY = "nobunaga_zenkoku_save";

const Main = {
  snapshot: null,     // 季節初めの状態(JSON)。セーブはこれを書き出す

  init() {
    $("#btn-new-50").addEventListener("click", () => this.startNew(50));
    $("#btn-new-17").addEventListener("click", () => this.startNew(17));
    $("#btn-load").addEventListener("click", () => this.loadGame());
    $("#btn-back-title").addEventListener("click", () => UI.showScreen("title-screen"));
    $("#btn-save").addEventListener("click", () => this.saveGame());
    $("#btn-quit").addEventListener("click", async () => {
      if (await UI.confirm("タイトルへ戻りますか？（セーブしていない進行は失われます）")) location.reload();
    });
    UI.showScreen("title-screen");
  },

  // ---------------- 新規ゲーム ----------------
  startNew(mode) {
    Game.newGame(mode);
    this.showSelectScreen();
  },

  showSelectScreen() {
    UI.showScreen("select-screen");
    const mapEl = $("#select-map");
    UI.buildMap(mapEl, (pid) => {
      const p = G.provinces[pid];
      if (p.owner !== VACANT) this.pickDaimyo(G.daimyos[p.owner]);
    });
    UI.updateMap(mapEl);
    const list = $("#select-list");
    list.innerHTML = "<h3>大名一覧</h3>";
    const grid = document.createElement("div");
    grid.className = "daimyo-grid";
    const ds = Game.aliveDaimyos().sort((a, b) => a.home - b.home);
    for (const d of ds) {
      const btn = document.createElement("button");
      btn.className = "daimyo-card";
      btn.style.setProperty("--dc", d.color);
      btn.innerHTML = `<span class="dc-portrait">${Portrait.svg(d, 64)}</span>` +
        `<span class="dc-name">${d.name}</span>` +
        `<span class="dc-prov">${G.provinces[d.home].short}</span>`;
      btn.addEventListener("click", () => this.pickDaimyo(d));
      grid.appendChild(btn);
    }
    list.appendChild(grid);
  },

  async pickDaimyo(d) {
    const p = G.provinces[d.home];
    const ok = await UI.confirm(
      `${d.name}（${p.name}・${d.age}歳）でよろしいか？\n` +
      `❤️健康${d.health} 🔥野心${d.amb} 🎲運${d.luck} ✨魅力${d.charm} 🧠知力${d.iq}\n` +
      `※能力は次の画面で運命の賽により決まり直す`, { portrait: d });
    if (!ok) return;
    G.playerId = d.id;
    d.isPlayer = true;
    this.showSlotScreen(d);
  },

  // ---------------- 能力スロット ----------------
  showSlotScreen(d) {
    UI.showScreen("slot-screen");
    $("#slot-daimyo-name").textContent = `${d.name} ─ 器量定め`;
    $("#slot-portrait").innerHTML = Portrait.svg(d, 130);
    let spins = 3;
    let rolled = false;
    const okBtn = $("#btn-slot-ok");
    const spinBtn = $("#btn-slot-spin");
    okBtn.disabled = true;
    $("#slot-remain").textContent = `残り ${spins} 回`;

    const cells = {
      health: $("#slot-health"), amb: $("#slot-amb"), luck: $("#slot-luck"),
      charm: $("#slot-charm"), iq: $("#slot-iq"),
    };
    for (const c of Object.values(cells)) c.textContent = "--";

    const doSpin = () => {
      if (spins <= 0) return;
      spins--;
      spinBtn.disabled = true;
      let count = 0;
      const timer = setInterval(() => {
        count++;
        for (const key of Object.keys(cells)) cells[key].textContent = rint(50, 100);
        if (count >= 14) {
          clearInterval(timer);
          d.health = rint(50, 100);
          d.amb = rint(50, 100);
          d.luck = rint(50, 100);
          d.charm = rint(50, 100);
          d.iq = rint(50, 100);
          cells.health.textContent = d.health;
          cells.amb.textContent = d.amb;
          cells.luck.textContent = d.luck;
          cells.charm.textContent = d.charm;
          cells.iq.textContent = d.iq;
          rolled = true;
          okBtn.disabled = false;
          spinBtn.disabled = spins <= 0;
          $("#slot-remain").textContent = spins > 0 ? `残り ${spins} 回` : "これが天命なり";
        }
      }, 60);
    };

    spinBtn.onclick = doSpin;
    okBtn.onclick = () => {
      if (!rolled) return;
      this.startGame();
    };
  },

  // ---------------- セーブ / ロード ----------------
  saveGame() {
    if (!this.snapshot) { UI.alert("まだセーブできませぬ。"); return; }
    localStorage.setItem(SAVE_KEY, this.snapshot);
    UI.alert(`セーブしました（${Game.dateStr()}の初めから再開されます）。`);
  },

  loadGame() {
    const data = localStorage.getItem(SAVE_KEY);
    if (!data) { UI.alert("セーブデータがありませぬ。"); return; }
    G = JSON.parse(data);
    const mc = $("#map-container");
    mc.innerHTML = ""; mc._svg = null;
    this.gameLoop();
  },

  // ---------------- メインループ ----------------
  startGame() {
    const d = Game.player();
    UI.log(`${d.name}、${G.provinces[d.home].name}より天下統一への道を歩み始める。`);
    this.gameLoop();
  },

  async gameLoop() {
    UI.showScreen("game-screen");
    UI.selectedProv = Game.player().home;
    UI.refresh();
    while (!G.over) {
      this.snapshot = JSON.stringify(G);
      await this.runSeason();
      UI.refresh();
    }
    await this.gameOver();
  },

  async runSeason() {
    await Events.seasonStart();
    UI.refresh();
    if (G.over) return;
    await PlayerPhase.run();
    if (G.over) return;
    await AI.run();
    if (G.over) return;
    Game.tickAlliances();
    Game.checkVictory();
    if (G.over) return;
    G.season++;
    if (G.season > 3) { G.season = 0; G.year++; }
    G.turn++;
  },

  async gameOver() {
    UI.refresh();
    if (G.over === "win") {
      const d = Game.player();
      await UI.alert(
        `═══ 天下統一 ═══\n\n${G.year}年、${d.name}はついに全${Game.provinceList().length}ヶ国を平定した！\n` +
        `乱世は終わり、新しき世が始まる──\n\n見事なり！`);
    } else {
      await UI.alert(`═══ 夢のまた夢 ═══\n\nそなたの野望はここで潰えた……\n${G.year}年 ${SEASONS[G.season]}のことであった。`);
    }
    location.reload();
  },
};

window.addEventListener("DOMContentLoaded", () => Main.init());
