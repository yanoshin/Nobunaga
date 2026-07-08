# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project

「吉法師の野望」— 1986年の歴史シミュレーションゲームにインスパイアされた戦国シミュレーション。ゲーム内の表示タイトルに他社商標（元ネタのゲーム名）を使わないこと。ビルド不要の素の HTML/CSS/JavaScript（ES2020、モジュールなし・全て classic script）で実装されたブラウザゲーム。UI テキストはすべて日本語。

## Commands

- **Run**: `open index.html`（file:// で動作。fetch 等は不使用）または `python3 -m http.server 8000`
- **Test**: `node test/smoke.js` — ヘッドレスのスモークテスト。データ整合性（50国・隣接対称性・地図連結性）、両モード15年分のシミュレーション、戦術戦闘のフル実行、セーブJSON往復を検証する。テストランナーは不使用（assert 失敗で throw、exit code 1）。
- Lint/build は存在しない。構文チェックは `node --check js/*.js`。

## Architecture

`index.html` が `js/` を **data.js → game.js → battle.js → ai.js → portrait.js → ui.js → main.js の順で読み込む**。全ファイルがグローバル名前空間を共有し、後のファイルが前のファイルのシンボルに依存する（順序変更・モジュール化は全体の書き換えになるので注意）。

- **`js/data.js`** — 静的データのみ。50ヶ国の定義（座標・隣接・石高/町の基準値）、17ヶ国モードの対象国リスト `MODE17_PROVINCES`、1560年の大名44家、新大名名プール、大名カラー。
- **`js/game.js`** — 中核。可変ゲーム状態はグローバル `let G` 1個（純粋なJSONデータ。関数を含まないため `JSON.stringify` がそのままセーブデータになる）。`Game`（状態操作・所有権移動・大名死亡規則）、`Events`（季節イベント: 加齢/収入/台風/収穫/疫病/一揆/謀反/本能寺の変）、`Commands`（プレイヤーの各国コマンド）、`PlayerPhase`。
- **`js/battle.js`** — `Battle.start()` が自動解決（AI同士・空白地攻め）と戦術マップ戦闘（プレイヤー関与時、7x7グリッド・最大5部隊・兵糧と30日制限）を振り分け、`finish()` で戦後処理（討死→全領土移転、逃亡、本国陥落）を行う。
- **`js/ai.js`** — 敵大名の思考（民心回復→侵攻判断→徴兵→内政の優先順位）と、プレイヤー向け軍師 `Advisor`。`Advisor.advise(p)` が国の状況（一揆/謀反の危険・隣国の脅威・攻め時・兵糧・台風・経済）をスコアリングし、推奨コマンドを理由付き降順で返す。ui.js のコマンドメニューが先頭候補を「軍師の進言」バーと⭐バッジで表示する。
- **`js/portrait.js`** — 大名似顔絵のSVG自動生成。外部画像アセットは一切使わず、大名名のハッシュを乱数シードにして兜・髷・烏帽子・鉢巻や表情を決定論的に描き分ける（同じ大名は常に同じ顔）。`Portrait.svg(daimyo, size)` がSVG文字列を返し、UI側が innerHTML で埋め込む。
- **`js/ui.js`** — DOM 全般。`UI`（SVG地図、Promise ベースのモーダル `alert/confirm/choose/number/form`、地図クリックで国を選ぶ `pickProvince`）と `BattleUI`。
- **`js/main.js`** — 画面遷移（タイトル→大名選択→能力スロット→ゲームループ）とセーブ/ロード。

### 押さえるべき設計

- **非同期駆動**: ターン進行は async/await の一本道（`Main.runSeason` → `Events` → `PlayerPhase` → `AI`）。ユーザー入力はすべて Promise を返す UI 関数で受ける。ループ内では `G.over`（`'win'|'dead'`）を随所でチェックして早期 return する規約。
- **ヘッドレステスト方式**: `test/smoke.js` は node の `vm` で js ファイルを順に eval し、`UI`/`BattleUI` をスタブに差し替えてロジックだけを回す。ゲームロジックに DOM 依存を持ち込む場合は battle.js の `typeof document !== "undefined"` ガードのように分岐させ、テストが通る形を保つこと。
- **セーブの仕様**: 各季節の開始時に `Main.snapshot = JSON.stringify(G)` を取り、セーブボタンはそのスナップショットを localStorage に書く（＝ロードすると当該季節の頭から再開）。`G` に関数や DOM 参照を入れると壊れる。
- **原作準拠の死亡規則**（game.js `daimyoDies` / battle.js `finish`）: 討死→全領土が勝者へ、病死・暗殺→全領土空白化、本国での一揆・謀反→本国に新大名・他は空白化。空白国は民兵が防衛し、春に新大名が勃興しうる。
- 隣接リストは `Game.newGame` 内で自動的に対称化される。国を追加・変更する際も片方向だけ書けばよい。
