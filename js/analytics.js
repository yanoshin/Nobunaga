// ============================================================
// analytics.js — Google Tag Manager / GA4 アクセス解析
// 下の GTM_ID / GA4_ID に自分のIDを設定すると計測が有効になる。
// 未設定（空文字）の間は一切外部通信しない。
// ============================================================
"use strict";

const Analytics = {
  GTM_ID: "GTM-P5R4Z852",   // Google Tag Manager コンテナID
  GA4_ID: "G-5W11CSM2YC",   // GA4 測定ID

  init() {
    if (typeof document === "undefined") return;   // ヘッドレステスト時は無効
    window.dataLayer = window.dataLayer || [];
    if (this.GA4_ID) {
      window.gtag = function () { window.dataLayer.push(arguments); };
      window.gtag("js", new Date());
      window.gtag("config", this.GA4_ID);
      this.loadScript("https://www.googletagmanager.com/gtag/js?id=" + this.GA4_ID);
    }
    if (this.GTM_ID) {
      window.dataLayer.push({ "gtm.start": Date.now(), event: "gtm.js" });
      this.loadScript("https://www.googletagmanager.com/gtm.js?id=" + this.GTM_ID);
    }
  },

  loadScript(src) {
    const s = document.createElement("script");
    s.async = true;
    s.src = src;
    document.head.appendChild(s);
  },

  // カスタムイベント送信。GA4 直接計測があればそちらへ、
  // なければ GTM の dataLayer へ流す（GTM側でトリガー設定して利用）。
  track(name, params) {
    if (typeof document === "undefined") return;
    if (this.GA4_ID && typeof window.gtag === "function") {
      window.gtag("event", name, params || {});
    } else if (this.GTM_ID && window.dataLayer) {
      window.dataLayer.push(Object.assign({ event: name }, params || {}));
    }
  },
};

Analytics.init();
