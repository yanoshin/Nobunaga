// ============================================================
// portrait.js — 大名似顔絵のSVG自動生成（名前から決定論的に描画）
// ============================================================
"use strict";

const Portrait = {

  hash(str) {
    let h = 5381;
    for (const c of String(str)) h = ((h * 33) ^ c.codePointAt(0)) >>> 0;
    return h;
  },

  // mulberry32
  rng(seed) {
    return function () {
      seed |= 0; seed = (seed + 0x6D2B79F5) | 0;
      let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  },

  shade(hex, f) {
    const n = parseInt(hex.slice(1), 16);
    const ch = (v) => Math.round(clamp(v * f, 0, 255));
    const r = ch(n >> 16), g = ch((n >> 8) & 255, f), b = ch(n & 255, f);
    return `rgb(${r},${g},${b})`;
  },

  // d: {name, color} を持つ大名オブジェクト
  svg(d, size = 80) {
    const r = this.rng(this.hash(d.name));
    const pick = (arr) => arr[Math.floor(r() * arr.length)];
    const color = d.color || "#8a8577";
    const dark = this.shade(color, 0.55);
    const skin = pick(["#ffd9b3", "#f5c89b", "#eab184", "#ffe3c4"]);
    const hairC = pick(["#2c2620", "#1d1a16", "#3d332a", "#4a3626"]);
    const fw = 26 + Math.floor(r() * 7);       // 顔の幅
    const fh = 30 + Math.floor(r() * 6);       // 顔の高さ
    const cy = 58;

    let s = `<svg viewBox="0 0 100 100" width="${size}" height="${size}" class="portrait-svg" role="img">`;
    // 背景（大名色の淡い円）
    s += `<defs><radialGradient id="bg${this.hash(d.name)}" cx="50%" cy="38%" r="75%">
      <stop offset="0%" stop-color="${color}" stop-opacity="0.55"/>
      <stop offset="100%" stop-color="${dark}" stop-opacity="0.9"/></radialGradient></defs>`;
    s += `<rect x="1.5" y="1.5" width="97" height="97" rx="20" fill="url(#bg${this.hash(d.name)})" stroke="${dark}" stroke-width="2"/>`;

    // 肩・鎧
    s += `<path d="M14 100 Q16 74 50 74 Q84 74 86 100 Z" fill="${color}" stroke="${dark}" stroke-width="2.5"/>`;
    s += `<path d="M30 84 L70 84 M25 92 L75 92" stroke="${dark}" stroke-width="2.5" fill="none"/>`;
    s += `<rect x="44" y="72" width="12" height="10" fill="${skin}"/>`;   // 首

    // 顔
    s += `<ellipse cx="50" cy="${cy}" rx="${fw}" ry="${fh}" fill="${skin}" stroke="#7a5b3a" stroke-width="1.6"/>`;
    // 耳
    s += `<circle cx="${50 - fw}" cy="${cy + 2}" r="4.5" fill="${skin}" stroke="#7a5b3a" stroke-width="1.4"/>`;
    s += `<circle cx="${50 + fw}" cy="${cy + 2}" r="4.5" fill="${skin}" stroke="#7a5b3a" stroke-width="1.4"/>`;
    // ほんのり頬紅（ポップ感）
    s += `<circle cx="${50 - fw * 0.55}" cy="${cy + 10}" r="4.5" fill="#ff9d9d" opacity="0.45"/>`;
    s += `<circle cx="${50 + fw * 0.55}" cy="${cy + 10}" r="4.5" fill="#ff9d9d" opacity="0.45"/>`;

    // 眉と目
    const browAngle = pick([-6, -3, 0, 4]);
    const browY = cy - 9;
    s += `<path d="M${34} ${browY + browAngle} q7 -4 13 -1" stroke="${hairC}" stroke-width="3.2" fill="none" stroke-linecap="round"/>`;
    s += `<path d="M${53} ${browY - 1} q7 -3 13 ${1 + browAngle}" stroke="${hairC}" stroke-width="3.2" fill="none" stroke-linecap="round"/>`;
    const eyeType = pick(["dot", "dot", "line", "sharp"]);
    const eyeY = cy - 1;
    if (eyeType === "dot") {
      s += `<circle cx="40" cy="${eyeY}" r="2.8" fill="#222"/><circle cx="60" cy="${eyeY}" r="2.8" fill="#222"/>`;
    } else if (eyeType === "line") {
      s += `<path d="M36 ${eyeY} h8 M56 ${eyeY} h8" stroke="#222" stroke-width="2.6" stroke-linecap="round"/>`;
    } else {
      s += `<path d="M36 ${eyeY + 1} l8 -2 M64 ${eyeY - 1} l-8 0" stroke="#222" stroke-width="2.8" stroke-linecap="round"/>`;
    }
    // 鼻
    s += `<path d="M50 ${cy + 2} q2 5 0 8" stroke="#c08a5a" stroke-width="1.8" fill="none" stroke-linecap="round"/>`;
    // 口
    const mouth = pick(["smile", "smile", "flat", "grim"]);
    const my = cy + 17;
    if (mouth === "smile") s += `<path d="M43 ${my} q7 5 14 0" stroke="#8a4a3a" stroke-width="2.4" fill="none" stroke-linecap="round"/>`;
    else if (mouth === "flat") s += `<path d="M44 ${my + 1} h12" stroke="#8a4a3a" stroke-width="2.4" stroke-linecap="round"/>`;
    else s += `<path d="M44 ${my + 2} q6 -4 12 0" stroke="#8a4a3a" stroke-width="2.4" fill="none" stroke-linecap="round"/>`;

    // ひげ
    const beard = pick(["none", "none", "mustache", "goatee", "full"]);
    if (beard === "mustache" || beard === "full") {
      s += `<path d="M40 ${my - 5} q4 -3 9 -1 M60 ${my - 5} q-4 -3 -9 -1" stroke="${hairC}" stroke-width="3" fill="none" stroke-linecap="round"/>`;
    }
    if (beard === "goatee" || beard === "full") {
      s += `<ellipse cx="50" cy="${cy + fh - 4}" rx="7" ry="5" fill="${hairC}"/>`;
    }

    // かぶりもの
    const head = pick(["kabuto", "kabuto", "eboshi", "mage", "hachimaki"]);
    const topY = cy - fh;
    if (head === "kabuto") {
      s += `<path d="M${50 - fw - 5} ${topY + 16} Q50 ${topY - 18} ${50 + fw + 5} ${topY + 16} L${50 + fw + 2} ${topY + 20} L${50 - fw - 2} ${topY + 20} Z" fill="${dark}" stroke="#141018" stroke-width="2"/>`;
      // 吹返
      s += `<path d="M${50 - fw - 6} ${topY + 14} q-6 6 -3 12 l8 -4 Z" fill="${color}" stroke="#141018" stroke-width="1.6"/>`;
      s += `<path d="M${50 + fw + 6} ${topY + 14} q6 6 3 12 l-8 -4 Z" fill="${color}" stroke="#141018" stroke-width="1.6"/>`;
      const crest = pick(["moon", "sun", "horns"]);
      if (crest === "moon") s += `<path d="M42 ${topY + 2} a9 9 0 1 0 16 0 a11 7 0 1 1 -16 0" fill="#f5c33b" stroke="#b8860b" stroke-width="1"/>`;
      else if (crest === "sun") s += `<circle cx="50" cy="${topY + 1}" r="6" fill="#f5c33b" stroke="#b8860b" stroke-width="1.4"/>`;
      else s += `<path d="M44 ${topY + 8} l-5 -13 M56 ${topY + 8} l5 -13" stroke="#f5c33b" stroke-width="3.4" stroke-linecap="round"/>`;
    } else if (head === "eboshi") {
      s += `<path d="M${50 - fw + 2} ${topY + 14} Q46 ${topY - 20} 62 ${topY - 16} Q${50 + fw} ${topY - 2} ${50 + fw - 2} ${topY + 14} Z" fill="#1c1a22" stroke="#000" stroke-width="1.6"/>`;
    } else if (head === "mage") {
      s += `<path d="M${50 - fw} ${topY + 20} Q${50 - fw} ${topY + 2} 50 ${topY + 4} Q${50 + fw} ${topY + 2} ${50 + fw} ${topY + 20} L${50 + fw - 6} ${topY + 24} Q50 ${topY + 12} ${50 - fw + 6} ${topY + 24} Z" fill="${hairC}"/>`;
      s += `<rect x="43" y="${topY - 6}" width="14" height="7" rx="3.5" fill="${hairC}" transform="rotate(${pick([-10, 8])} 50 ${topY})"/>`;
    } else {
      s += `<path d="M${50 - fw} ${topY + 18} Q50 ${topY - 4} ${50 + fw} ${topY + 18} L${50 + fw} ${topY + 12} Q50 ${topY - 10} ${50 - fw} ${topY + 12} Z" fill="${hairC}"/>`;
      s += `<rect x="${50 - fw - 3}" y="${topY + 12}" width="${fw * 2 + 6}" height="7" rx="3.5" fill="#f4f0e6" stroke="#c9c2b0" stroke-width="1.2"/>`;
      s += `<circle cx="${50 + fw + 1}" cy="${topY + 15}" r="3" fill="#e05d5d"/>`;
    }
    s += `</svg>`;
    return s;
  },

  // 民兵・不明用の汎用アイコン
  generic(size = 64) {
    return `<svg viewBox="0 0 100 100" width="${size}" height="${size}" class="portrait-svg">
      <rect x="1.5" y="1.5" width="97" height="97" rx="20" fill="#3a3f44" stroke="#24272b" stroke-width="2"/>
      <path d="M14 100 Q16 76 50 76 Q84 76 86 100 Z" fill="#5a6068"/>
      <circle cx="50" cy="52" r="24" fill="#8a9099"/>
      <text x="50" y="62" text-anchor="middle" font-size="30">👥</text></svg>`;
  },
};
