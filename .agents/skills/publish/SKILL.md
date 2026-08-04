---
name: publish
description: >-
  記事を push / 公開するまでの全工程を指揮する。/review を呼び、機械検査ゲートを通し、
  対応台帳をコミットに埋め込み、published を切り替えて push する。
  `/publish` または `/publish <ファイル>` で起動。
  「記事を出す」「公開する」「push する」「published にして」でも起動。
  執筆中の推敲やレビューだけをしたい場合には反応しない（review / writing-check に委譲）。
---

# publish

記事を世に出すまでの指揮者。工程を順番に通し、**承認ポイントを2回に絞る**。

**出力言語: 日本語**

## 前提: このリポジトリで「公開」が意味すること

| 操作 | 起きること |
|---|---|
| `git push`（`published: false`） | **GitHub 上で誰でも読める**（PUBLIC リポジトリ）。Zenn には下書きとして同期される |
| `git push`（`published: true`） | 上に加えて Zenn で公開される |

**`published: false` は隠蔽にならない。** したがって disclosure（社外秘）のチェックは
「公開前」ではなく **push 前**に必ず通す。これが本スキルの設計の起点。

## ワークフロー

```
1. 対象確認 → 2. /review → 3. 機械検査ゲート → 4. published 判断 → 5. コミット → 6. push
```

**承認ポイントは原則2回だけ**: (1) Step 2 の指摘取捨選択、(2) Step 6 の push 実行。
それ以外でチャット上の y/n 確認は出さない。

### 0. スキル使用の明示

「**publish** skill を使います。」と発言してから作業開始。

### 1. 対象と目的の確認

対象記事を特定する（引数 → 未コミットの `articles/*.md` → 最終更新が最新）。

frontmatter の `published` を読み、**どちらのモードか**を判定する。判定できない場合だけ確認する。

| モード | 条件 | ゲートの厳しさ |
|---|---|---|
| **下書き push** | `published: false` のまま出す | disclosure と秘匿値は必須。文章品質は警告のみ |
| **公開** | `published: true` にする / 既に `true` | 全項目 |

> **初回だけの確認**: このリポジトリの記事は全件 `published: false` になっている。
> これが意図的な運用（Zenn 側で個別に公開している / 下書き置き場）なのか、単に切り替え忘れなのかを
> 一度だけ確認し、意図的なら以降 Step 4 を飛ばす。

ブランチも確認する。`main` にいる場合はそのまま進める（このリポジトリは main 直 push が慣習）。
ただし**人にレビューしてもらいたい記事**の場合は、ブランチを切って PR を出す選択肢を提示する。

### 2. /review（提出前レビュー）

`/review` を実行し、指摘を著者と消化してから先へ進む。**著者が1次レビュワー**という設計の核。

**スキップ条件**（すべて満たす場合のみ自動スキップ）:

- 変更が記事本文に及ばない（画像の追加・差し替えのみ、typo 1箇所のみ）
- または直前の `/review` から記事本文を変更していない

上記以外は実行する。著者が明示的にスキップを指示した場合のみ省略する。

**対応台帳の受け取り**: `/review` が返す `## 記事レビュー対応状況` ブロックをそのまま受け取り、
Step 5 のコミットメッセージ本文に埋め込む。台帳が空、または `/review` をスキップした場合は埋め込まない。

**CRITICAL が `wontfix` で残っている場合は、ここで止めて著者に確認する**（Step 3 のゲートとは別に、
人間の明示的な判断を取る）。

### 3. 機械検査ゲート

`pre-push` と同じロジックを事前に走らせる。ここで落ちるものは push でも落ちる。

```bash
node scripts/validate-articles.mjs articles/<file>.md
pnpm exec textlint articles/<file>.md
uv run .agents/skills/natural-japanese/scripts/lint.py articles/<file>.md
```

| 結果 | 対応 |
|---|---|
| `secret` ルールのヒット | **即座に停止**。値の除去とキーのローテーションを促す。既に push 済みなら履歴からの除去も必要 |
| その他の error | 修正してから再実行。修正案を提示する |
| warn | 一覧を提示し、対応するか見送るかを Step 2 の取捨選択に合流させる |

textlint の自動修正可能な指摘は `pnpm exec textlint --fix` を実行してよい（承認不要）。

### 4. published の切り替え

**公開モードのときだけ**実行する。

切り替え前に、以下がすべて満たされているかを確認する。満たされていない項目があれば著者に提示する。

- [ ] Step 3 の error が 0件
- [ ] `/review` の CRITICAL が 0件、または理由付きで著者が承認済み
- [ ] `topics` が Zenn に実在するトピック名（不安なものは `zenn.dev/topics/<name>` を確認）
- [ ] 変化しやすい情報（バージョン・料金・UI）に時点注記がある
- [ ] `## おわりに` / `## まとめ` がある

満たされていれば `published: false` → `true` に書き換える。**確認を1回だけ取る**。

### 5. コミット

コミットメッセージを組み立てる。

```
<prefix>: <日本語サマリ>

<必要なら1〜3行の補足>

## 記事レビュー対応状況

- [fixed]   No.1 🚨 L88 — Slack スクショを差し替え
- [wontfix] No.5 🔵 L23 — 「のではないでしょうか」（理由: 語り口として意図的）
```

prefix はこのリポジトリの粒度に合わせる:

| prefix | 用途 |
|---|---|
| `article` | 記事の新規追加 |
| `update` | 既存記事の加筆・修正 |
| `publish` | `published: true` への切り替え |
| `fix` | typo・画像パス等の小修正 |
| `chore` | 設定・スクリプト・スキルの変更 |

台帳を埋め込むときの注意: 番号は `No.N` 形式にする。`#数字` を書くと GitHub が無関係な issue に
自動リンクしてしまう。

`git add <files>` + `git commit` をそのまま実行する（チャットで確認を出さない）。

### 6. push

```bash
git push
```

`pre-push` フックが最終ゲートとして走る。**フックが落ちたら push を強行しない**。
落ちた内容を Step 3 に戻して修正する。

`--no-verify` は提案しない。著者が明示的に求めた場合のみ、以下を伝えたうえで実行する:

- 秘匿値の指摘は回避してはいけない（push した時点で公開される）
- それ以外の指摘は、回避してもよいが理由を台帳に残す

**ブランチ運用の場合**は、push 後に PR を作成する。

```bash
gh pr create --title "<記事タイトル>" --body "..." --draft
```

PR 本文には概要と台帳を入れる。

### 7. 完了報告

```
Done: articles/<slug>.md

タイトル: <title>
published: false → true
コミット: <prefix>: <サマリ> (<sha>)
push: origin/main

/review: 🚨0 ⚠️3 🔵5 🟢2 → fixed 6 / wontfix 2 / deferred 2
機械検査: error 0 / warn 1
pre-push: 通過

残:
- [deferred] No.7 図解の追加

確認:
- Zenn 側で記事が同期されたか https://zenn.dev/killinsun
```

## ルール

1. **承認ポイントは2回だけ** — 停止するのは (1) Step 2 の指摘取捨選択、(2) Step 6 の push 実行のみ。commit はそのまま実行する
2. **push 前に disclosure を必ず通す** — PUBLIC リポジトリなので `published: false` でも公開と同じ。`/review` のスキップ条件を満たしても disclosure だけは回す
3. **秘匿値が出たら即停止** — 修正して再実行するまで先へ進まない。既に push 済みならキーのローテーションを促す
4. **`published: true` は確認を取る** — 自動で切り替えない
5. **pre-push が落ちたら強行しない** — `--no-verify` を自分から提案しない
6. **台帳をコミットに残す** — `/review` の結果を `## 記事レビュー対応状況` としてコミット本文へ。`#数字` を使わない
7. **CRITICAL の wontfix は人間の判断を取る** — 機械ゲートと別に、明示的に確認する
8. **ゲートであって代行ではない** — 記事の中身を良くするのは `/review` と各チェックスキルの役割。本スキルは工程を通す

## 関連

- レビュー: `.agents/skills/review/SKILL.md`
- 観点別スキル: `.agents/skills/{disclosure-check,fact-check,code-verify,writing-check,publish-check}/SKILL.md`
- 機械検査: `scripts/validate-articles.mjs`
- push ゲート: `.githooks/pre-push`（`git config core.hooksPath .githooks` で有効化）
- 共通ガイド: `.agents/references/zenn-writing-guide.md`
