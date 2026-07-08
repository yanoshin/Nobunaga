// ============================================================
// ui.js — 画面描画・ダイアログ・地図・合戦UI
// ============================================================
"use strict";

const $ = (sel) => document.querySelector(sel);

const UI = {
  selectedProv: null,
  picking: null,        // {ids:Set, resolve, bar}

  // ---------------- ログ ----------------
  log(text) {
    const area = $("#log-area");
    if (!area) { console.log(text); return; }
    const div = document.createElement("div");
    div.className = "log-line";
    div.textContent = text;
    area.appendChild(div);
    while (area.children.length > 300) area.removeChild(area.firstChild);
    area.scrollTop = area.scrollHeight;
  },

  setPhase(text) {
    const el = $("#phase-banner");
    if (el) el.textContent = text;
  },

  // ---------------- 画面切替 ----------------
  showScreen(id) {
    for (const s of document.querySelectorAll(".screen")) s.classList.add("hidden");
    $("#" + id).classList.remove("hidden");
  },

  // ---------------- 地図 ----------------
  buildMap(container, onClick) {
    const provs = Game.provinceList();
    const CW = 66, CH = 52, W = 62, H = 48;
    const minX = Math.min(...provs.map(p => p.x));
    const minY = Math.min(...provs.map(p => p.y));
    const maxX = Math.max(...provs.map(p => p.x));
    const maxY = Math.max(...provs.map(p => p.y));
    const vw = (maxX - minX) * CW + W + 20;
    const vh = (maxY - minY) * CH + H + 20;
    const NS = "http://www.w3.org/2000/svg";
    const svg = document.createElementNS(NS, "svg");
    svg.setAttribute("viewBox", `0 0 ${vw} ${vh}`);
    svg.classList.add("map-svg");

    // 隣接線
    const drawn = new Set();
    for (const p of provs) {
      for (const a of p.adj) {
        const key = Math.min(p.id, a) + "-" + Math.max(p.id, a);
        if (drawn.has(key)) continue;
        drawn.add(key);
        const q = G.provinces[a];
        if (!q) continue;
        const line = document.createElementNS(NS, "line");
        line.setAttribute("x1", (p.x - minX) * CW + 10 + W / 2);
        line.setAttribute("y1", (p.y - minY) * CH + 10 + H / 2);
        line.setAttribute("x2", (q.x - minX) * CW + 10 + W / 2);
        line.setAttribute("y2", (q.y - minY) * CH + 10 + H / 2);
        line.setAttribute("class", "adj-line");
        svg.appendChild(line);
      }
    }
    for (const p of provs) {
      const g = document.createElementNS(NS, "g");
      g.setAttribute("class", "prov-tile");
      g.dataset.pid = p.id;
      const x = (p.x - minX) * CW + 10, y = (p.y - minY) * CH + 10;
      const rect = document.createElementNS(NS, "rect");
      rect.setAttribute("x", x); rect.setAttribute("y", y);
      rect.setAttribute("width", W); rect.setAttribute("height", H);
      rect.setAttribute("rx", 5);
      g.appendChild(rect);
      const t1 = document.createElementNS(NS, "text");
      t1.setAttribute("x", x + W / 2); t1.setAttribute("y", y + 19);
      t1.setAttribute("class", "prov-name");
      t1.textContent = p.short;
      g.appendChild(t1);
      const t2 = document.createElementNS(NS, "text");
      t2.setAttribute("x", x + W / 2); t2.setAttribute("y", y + 36);
      t2.setAttribute("class", "prov-sub");
      g.appendChild(t2);
      g.addEventListener("click", () => onClick(p.id));
      svg.appendChild(g);
    }
    container.innerHTML = "";
    container.appendChild(svg);
    container._svg = svg;
  },

  updateMap(container) {
    const svg = container._svg;
    if (!svg) return;
    for (const g of svg.querySelectorAll(".prov-tile")) {
      const p = G.provinces[+g.dataset.pid];
      const rect = g.querySelector("rect");
      const owner = p.owner !== VACANT ? G.daimyos[p.owner] : null;
      rect.setAttribute("fill", owner ? owner.color : "#3a3f44");
      g.classList.toggle("mine", p.owner === G.playerId);
      g.classList.toggle("selected", this.selectedProv === p.id);
      g.classList.toggle("pickable", !!(this.picking && this.picking.ids.has(p.id)));
      const sub = g.querySelector(".prov-sub");
      const isHome = owner && owner.home === p.id;
      sub.textContent = (isHome ? "🏯" : "") + "🪖" + p.hei;
    }
  },

  refresh() {
    if (!G || !$("#map-container")) return;
    const tb = (id, txt) => { const el = $(id); if (el) el.textContent = txt; };
    tb("#tb-date", ["🌸", "☀️", "🍁", "⛄"][G.season] + " " + Game.dateStr());
    const pl = Game.player();
    if (pl) {
      const el = $("#tb-player");
      if (el) el.innerHTML =
        `<span class="tb-portrait">${Portrait.svg(pl, 34)}</span><b>${pl.name}</b>` +
        `<span class="tb-stats">❤️${pl.health} 🔥${pl.amb} 🎲${pl.luck} ✨${pl.charm} 🧠${pl.iq}</span>`;
    }
    tb("#tb-provs", `🏯 ${Game.ownedBy(G.playerId).length}/${Game.provinceList().length}ヶ国`);
    const mc = $("#map-container");
    if (!mc._svg) this.buildMap(mc, (pid) => this.onMapClick(pid));
    this.updateMap(mc);
    this.renderProvInfo();
  },

  onMapClick(pid) {
    if (this.picking) {
      if (this.picking.ids.has(pid)) {
        const resolve = this.picking.resolve;
        this.endPicking();
        resolve(pid);
      }
      return;
    }
    this.selectedProv = pid;
    this.refresh();
  },

  focusProvince(pid) {
    this.selectedProv = pid;
    this.refresh();
  },

  statBar(icon, label, v) {
    const c = v < 30 ? "#ff6b6b" : v < 60 ? "#ffc94d" : "#6fd67f";
    return `<div class="stat"><span class="s-ico">${icon}</span><span class="s-label">${label}</span>` +
      `<div class="s-bar"><div style="width:${clamp(v, 0, 100)}%;background:${c}"></div></div>` +
      `<span class="s-val">${v}</span></div>`;
  },

  renderProvInfo() {
    const el = $("#prov-info");
    if (!el) return;
    const pid = this.selectedProv;
    if (!pid || !G.provinces[pid]) { el.innerHTML = "<p class='dim'>地図の国を選ぶと情報を表示</p>"; return; }
    const p = G.provinces[pid];
    const owner = p.owner !== VACANT ? G.daimyos[p.owner] : null;
    const allied = owner && owner.id !== G.playerId && Game.allied(G.playerId, owner.id);
    const ownerBadge = owner
      ? `${owner.name}${owner.home === p.id ? " 🏯本国" : ""}${owner.id === G.playerId ? "（当家）" : ""}`
      : "空白地・民兵が守る";
    el.innerHTML = `
      <h3>${p.name}</h3>
      <div class="owner-card" style="border-color:${owner ? owner.color : "#666"}">
        ${owner ? Portrait.svg(owner, 58) : Portrait.generic(58)}
        <div class="oc-text"><b>${ownerBadge}</b>${allied ? "<span class='ally-tag'>🤝 同盟中</span>" : ""}
        <span class="oc-policy">📜 ${Commands.policyName(p.policy)}</span></div>
      </div>
      <div class="res-row">
        <span class="res" title="石高">🌾${p.koku}</span><span class="res" title="町">🏘️${p.town}</span>
        <span class="res" title="兵数">🪖${p.hei}</span><span class="res" title="金">💰${p.kin}</span>
        <span class="res" title="米">🍚${p.kome}</span>${p.loan ? `<span class="res res-debt" title="借金">📉${p.loan}</span>` : ""}
      </div>
      ${this.statBar("😊", "民忠", p.minchu)}
      ${this.statBar("🌊", "治水", p.chisui)}
      ${this.statBar("💎", "民財", p.minzai)}
      ${this.statBar("🥋", "訓練", p.kunren)}
      ${this.statBar("🏹", "武装", p.buso)}
      ${this.statBar("🚩", "兵忠", p.heichu)}`;
  },

  // ---------------- コマンドメニュー ----------------
  commandMenu(p) {
    return new Promise((resolve) => {
      const area = $("#command-area");
      area.innerHTML = "";
      const done = (v) => { area.innerHTML = ""; resolve(v); };

      // 軍師の進言（最適コマンドの推薦＋理由）
      const advice = Advisor.advise(p);
      const top = advice[0];
      if (top) {
        const bar = document.createElement("div");
        bar.className = "advisor-bar";
        bar.innerHTML = `<span class="adv-ico">🧙</span>` +
          `<div class="adv-text"><b>軍師の進言 — ${top.icon}${top.label}</b>` +
          `<span>${top.reason}。</span></div>`;
        if (advice.length > 1) {
          const more = document.createElement("button");
          more.className = "sub-btn adv-more";
          more.textContent = "他の策";
          more.addEventListener("click", async () => {
            const pick = await this.choose("軍師の献策（選ぶとそのまま実行）", advice.slice(0, 5).map(a => ({
              label: `${a.icon} ${a.label} ─ ${a.reason}。`, value: a.key,
            })), true);
            if (pick) done(pick);
          });
          bar.appendChild(more);
        }
        area.appendChild(bar);
      }

      const grid = document.createElement("div");
      grid.className = "cmd-grid";
      for (const c of Commands.list(p)) {
        const btn = document.createElement("button");
        btn.className = "cmd-btn";
        btn.disabled = !!c.disabled;
        btn.innerHTML = `<span class="cmd-ico">${c.icon || ""}</span>` +
          `<span class="cmd-text"><span class="cmd-name">${c.label}</span><span class="cmd-hint">${c.hint}</span></span>`;
        if (top && c.key === top.key) {
          btn.classList.add("recommended");
          btn.innerHTML += `<span class="rec-star">⭐推薦</span>`;
        }
        btn.addEventListener("click", () => done(c.key));
        grid.appendChild(btn);
      }
      area.appendChild(grid);
      const skip = document.createElement("button");
      skip.className = "sub-btn skip-btn";
      skip.textContent = "▶ 残りの国はすべて何もせず季節を送る";
      skip.addEventListener("click", () => done("skipAll"));
      area.appendChild(skip);
    });
  },

  // ---------------- 地図から国を選ぶ ----------------
  pickProvince(ids, title) {
    return new Promise((resolve) => {
      this.picking = { ids: new Set(ids), resolve };
      this.setPhase(title);
      const area = $("#command-area");
      area.innerHTML = "";
      const bar = document.createElement("div");
      bar.className = "pick-bar";
      bar.innerHTML = `<p>${title}</p>`;
      const cancel = document.createElement("button");
      cancel.className = "sub-btn";
      cancel.textContent = "やめる";
      cancel.addEventListener("click", () => {
        this.endPicking();
        resolve(null);
      });
      bar.appendChild(cancel);
      area.appendChild(bar);
      this.updateMap($("#map-container"));
    });
  },

  endPicking() {
    this.picking = null;
    const area = $("#command-area");
    if (area) area.innerHTML = "";
    this.updateMap($("#map-container"));
  },

  // ---------------- モーダル ----------------
  _modal(title, bodyBuilder, buttons) {
    return new Promise((resolve) => {
      const overlay = $("#modal-overlay");
      $("#modal-title").textContent = title;
      const body = $("#modal-body");
      body.innerHTML = "";
      const btnArea = $("#modal-buttons");
      btnArea.innerHTML = "";
      const close = (v) => { overlay.classList.add("hidden"); resolve(v); };
      bodyBuilder(body, close);
      for (const b of buttons) {
        const btn = document.createElement("button");
        btn.textContent = b.label;
        btn.className = b.cls || "";
        btn.addEventListener("click", () => close(b.value(body)));
        btnArea.appendChild(btn);
      }
      overlay.classList.remove("hidden");
    });
  },

  alert(text, opts = {}) {
    return this._modal("", (body) => {
      body.appendChild(this._textBlock(text, opts.portrait));
    }, [{ label: "承知", value: () => true }]);
  },

  confirm(text, opts = {}) {
    return this._modal("", (body) => {
      body.appendChild(this._textBlock(text, opts.portrait));
    }, [
      { label: "はい", value: () => true },
      { label: "いいえ", value: () => false, cls: "btn-no" },
    ]);
  },

  _textBlock(text, portrait) {
    const wrap = document.createElement("div");
    if (portrait) {
      wrap.className = "modal-portrait-row";
      const pv = document.createElement("div");
      pv.className = "mp-portrait";
      pv.innerHTML = Portrait.svg(portrait, 92);
      wrap.appendChild(pv);
    }
    const div = document.createElement("div");
    div.className = "mp-text";
    for (const line of String(text).split("\n")) {
      const pEl = document.createElement("p");
      pEl.textContent = line;
      div.appendChild(pEl);
    }
    wrap.appendChild(div);
    return wrap;
  },

  _multiline(text) { return this._textBlock(text); },

  choose(title, options, cancellable) {
    const buttons = cancellable ? [{ label: "やめる", value: () => null, cls: "btn-no" }] : [];
    return this._modal(title, (body, close) => {
      const list = document.createElement("div");
      list.className = "choose-list";
      for (const o of options) {
        const btn = document.createElement("button");
        btn.className = "choose-btn" + (o.portrait ? " has-portrait" : "");
        if (o.portrait) {
          btn.innerHTML = `<span class="cp-portrait">${Portrait.svg(o.portrait, 40)}</span><span>${o.label}</span>`;
        } else {
          btn.textContent = o.label;
        }
        btn.disabled = !!o.disabled;
        btn.addEventListener("click", () => close(o.value));
        list.appendChild(btn);
      }
      body.appendChild(list);
    }, buttons);
  },

  number(title, min, max, def) {
    return this._modal(title, (body) => {
      body.innerHTML = `
        <div class="num-row">
          <input type="range" id="num-slider" min="${min}" max="${max}" value="${clamp(def, min, max)}">
          <input type="number" id="num-input" min="${min}" max="${max}" value="${clamp(def, min, max)}">
        </div>
        <div class="num-quick">
          <button data-v="${min}">最小</button>
          <button data-v="${Math.floor((min + max) / 2)}">半分</button>
          <button data-v="${max}">最大</button>
        </div>`;
      const slider = body.querySelector("#num-slider");
      const input = body.querySelector("#num-input");
      slider.addEventListener("input", () => { input.value = slider.value; });
      input.addEventListener("input", () => { slider.value = input.value; });
      for (const b of body.querySelectorAll(".num-quick button")) {
        b.addEventListener("click", () => { input.value = b.dataset.v; slider.value = b.dataset.v; });
      }
    }, [
      { label: "決定", value: (body) => clamp(parseInt(body.querySelector("#num-input").value || "0", 10), min, max) },
      { label: "やめる", value: () => null, cls: "btn-no" },
    ]);
  },

  form(title, fields) {
    return this._modal(title, (body) => {
      for (const f of fields) {
        const row = document.createElement("div");
        row.className = "form-row";
        row.innerHTML = `<label>${f.label}</label>
          <input type="number" data-key="${f.key}" min="${f.min}" max="${f.max}" value="${clamp(f.def, f.min, f.max)}">`;
        body.appendChild(row);
      }
    }, [
      {
        label: "決定", value: (body) => {
          const v = {};
          for (const inp of body.querySelectorAll("input[data-key]")) {
            const f = fields.find(x => x.key === inp.dataset.key);
            v[inp.dataset.key] = clamp(parseInt(inp.value || "0", 10), f.min, f.max);
          }
          return v;
        },
      },
      { label: "やめる", value: () => null, cls: "btn-no" },
    ]);
  },
};

// ============================================================
// 合戦画面UI
// ============================================================
const BattleUI = {
  sel: null,          // 選択中の自部隊

  async open(st) {
    UI.showScreen("battle-screen");
    st.log.push(`${st.atkName}軍と${st.defName}軍が激突！`);
    this.render(st);
  },

  async close(st) {
    this.render(st);
    const winner = st.result === "A" ? st.atkName : st.defName;
    await UI.alert(`合戦終了！ ${winner}方の勝利！`);
    UI.showScreen("game-screen");
  },

  render(st) {
    $("#battle-header").innerHTML =
      `<div class="bh-side bh-atk">${st.atkD ? Portrait.svg(st.atkD, 46) : Portrait.generic(46)}` +
      `<div class="bh-info"><b>${st.atkName}軍</b><span>🪖${Battle.sideHei(st, "A")} 🍚${Math.max(0, st.atkKome)}</span></div></div>` +
      `<div class="bh-day"><b>${st.day}日目</b><span>${st.weather === "rain" ? "☔ 雨・鉄砲不可" : "☀️ 晴"}</span></div>` +
      `<div class="bh-side bh-def"><div class="bh-info bh-right"><b>${st.defName}軍</b><span>🪖${Battle.sideHei(st, "D")} 🍚${Math.max(0, st.defKome)}</span></div>` +
      `${st.defD ? Portrait.svg(st.defD, 46) : Portrait.generic(46)}</div>`;

    // グリッド
    const grid = $("#battle-grid");
    grid.innerHTML = "";
    grid.style.gridTemplateColumns = `repeat(${Battle.GRID_W}, 1fr)`;
    for (let y = 0; y < Battle.GRID_H; y++) {
      for (let x = 0; x < Battle.GRID_W; x++) {
        const cell = document.createElement("div");
        cell.className = "bcell terr-" + st.terrain[y][x];
        cell.dataset.x = x; cell.dataset.y = y;
        const u = Battle.unitAt(st, x, y);
        if (u) {
          const chip = document.createElement("div");
          chip.className = `bunit side-${u.side}` +
            (u.isLeader ? " leader" : "") +
            (this.sel === u ? " selected" : "") +
            (u.acted ? " acted" : "");
          chip.innerHTML = `<span>${Battle.TYPE_NAME[u.type]}${u.isLeader ? "★" : ""}</span><span>${u.hei}</span>`;
          cell.appendChild(chip);
        }
        grid.appendChild(cell);
      }
    }
    // 部隊一覧
    const ul = $("#battle-units");
    ul.innerHTML = "";
    for (const side of ["A", "D"]) {
      for (const u of st.units.filter(u => u.side === side)) {
        const row = document.createElement("div");
        row.className = `bu-row side-${side}` + (u.hei <= 0 ? " dead" : "");
        row.textContent = `${side === "A" ? "攻" : "守"} ${Battle.TYPE_NAME[u.type]}${u.isLeader ? "★" : ""} ${u.hei}`;
        ul.appendChild(row);
      }
    }
    // ログ
    const bl = $("#battle-log");
    bl.innerHTML = st.log.slice(-6).map(l => `<div>${l}</div>`).join("");
    bl.scrollTop = bl.scrollHeight;
  },

  // プレイヤーの行動を1つ取得
  pickAction(st, movable) {
    return new Promise((resolve) => {
      this.sel = null;
      const grid = $("#battle-grid");
      const controls = $("#battle-controls");
      controls.innerHTML = "";
      const info = $("#battle-info");
      info.textContent = "自部隊をクリック→移動先か攻撃対象をクリック";

      const cleanup = (v) => {
        grid.onclick = null;
        controls.innerHTML = "";
        this.sel = null;
        resolve(v);
      };

      const mkBtn = (label, val, cls) => {
        const b = document.createElement("button");
        b.textContent = label;
        b.className = cls || "";
        b.addEventListener("click", () => cleanup(val));
        controls.appendChild(b);
      };
      mkBtn("この日の行動を終える", { type: "endDay" });
      mkBtn("委任（AIに任せる）", { type: "auto" });
      if (!st.noRetreat) mkBtn("総退却", { type: "retreat" }, "btn-no");

      grid.onclick = (e) => {
        const cell = e.target.closest(".bcell");
        if (!cell) return;
        const x = +cell.dataset.x, y = +cell.dataset.y;
        const u = Battle.unitAt(st, x, y);
        if (u && u.side === st.playerSide && !u.acted && u.hei > 0) {
          this.sel = u;
          this.highlight(st);
          return;
        }
        if (!this.sel) return;
        // 攻撃
        if (u && u.side !== st.playerSide) {
          const targets = Battle.attackTargets(st, this.sel);
          if (targets.includes(u)) { cleanup({ type: "attack", unit: this.sel, target: u }); return; }
        }
        // 移動
        if (!u) {
          const moves = Battle.moveRange(st, this.sel);
          if (moves.some(([mx, my]) => mx === x && my === y)) {
            cleanup({ type: "move", unit: this.sel, x, y });
            return;
          }
        }
      };
      this.render(st);
    });
  },

  highlight(st) {
    this.render(st);
    if (!this.sel) return;
    const grid = $("#battle-grid");
    const moves = Battle.moveRange(st, this.sel);
    const targets = Battle.attackTargets(st, this.sel);
    for (const cell of grid.querySelectorAll(".bcell")) {
      const x = +cell.dataset.x, y = +cell.dataset.y;
      if (moves.some(([mx, my]) => mx === x && my === y)) cell.classList.add("can-move");
      const t = Battle.unitAt(st, x, y);
      if (t && targets.includes(t)) cell.classList.add("can-attack");
    }
  },
};
