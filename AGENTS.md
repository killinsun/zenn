# Zenn 記事リポジトリ — エージェント指示書

[Zenn](https://zenn.dev/) で公開する技術記事の執筆リポジトリ。

## 最重要の前提

**このリポジトリは PUBLIC で、main への直 push が基本運用。**

| 操作 | 起きること |
|---|---|
| `git push`（`published: false`） | **GitHub 上で誰でも読める**。Zenn には下書きとして同期される |
| `git push`（`published: true`） | 上に加えて Zenn で公開される |

`published: false` は隠蔽にならない。社外秘・秘匿値のチェックは「公開前」ではなく
**push 前**に通す。この前提が執筆フローとゲート設計の起点になっている。

## 構成

| パス | 内容 |
|---|---|
| `articles/*.md` | 記事本体。ファイル名は14桁の16進数（slug） |
| `books/` | Zenn の本 |
| `images/` | 記事から `/images/<name>.png` で参照する画像 |
| `.textlintrc` | 日本語校正ルール（`preset-ja-technical-writing` + `prh`） |
| `prh.yml` | 用語統一ルール。**用語の表記ゆれに関する唯一の正** |
| `scripts/validate-articles.mjs` | 記事の機械検査。**検査ロジックの唯一の正** |
| `.githooks/pre-push` | push ゲート。上のスクリプト + textlint を走らせる |
| `.agents/references/zenn-writing-guide.md` | 記事の共通ライティングガイド |
| `.agents/skills/` | スキル定義のオリジナル。`.claude/skills` はここへのシンボリックリンク |

## コマンド

```bash
npx zenn new:article     # 記事の新規作成
npx zenn preview         # ローカルプレビュー（Zenn 側のバリデーション結果も見られる）

pnpm validate            # 変更された記事の機械検査
pnpm validate:all        # 全記事の機械検査
pnpm textlint            # 日本語校正
pnpm textlint:fix        # 自動修正
pnpm natural <file>      # AI 臭さ・悪文の検出（natural-japanese / uv が必要）
pnpm gate                # push ゲートを手動で回す
```

`pnpm install` で `core.hooksPath` が `.githooks` に設定され、push ゲートが有効になる。

## 執筆フロー

```
/article          記事の新規作成・構成づくり
      ↓  （本文を書く）
/review           5観点を並列レビュー → union 集約 → その場修正 → 対応台帳
      ↓
/publish          機械検査ゲート → published 切り替え → コミット（台帳埋め込み）→ push
      ↓
pre-push フック    機械検査 + textlint。落ちたら push が止まる（強制ゲート）
```

### 単体で回すスキル

`/review` が内部で使う観点を、個別に深掘りしたいとき:

| スキル | 用途 |
|---|---|
| `/writing-check` | textlint + 構成・論理・読者視点の推敲 |
| `/fact-check` | バージョン・料金・API 名を一次情報で裏取り |
| `/code-verify` | コードブロックの構文・型・実行可否を検証 |
| `/disclosure-check` | 社外秘スクリーニング（本文・コード・画像の中身） |
| `/publish-check` | 出せる状態かの読み取り専用診断 |
| `/natural-japanese` | 文体の推敲・AI 臭さの除去（第三者製・MIT） |

各スキルの詳細は `.agents/skills/<name>/SKILL.md` を参照。

## 3層のゲート

| 層 | 実体 | 強制力 |
|---|---|---|
| 1. 著者が1次レビュワー | `/review` | AI・任意 |
| 2. 提出の指揮者 | `/publish` | AI・指揮 |
| 3. 機械ゲート | `.githooks/pre-push` + `scripts/validate-articles.mjs` | **機械・強制** |

3層目は AI を通さない。`/publish` を使わずに `git push` しても、秘匿値の混入・frontmatter 不正・
画像パス切れなら push が失敗する。

検査の厳しさは `published` の値で変わる:

- `published: false` → 秘匿値・画像不在・frontmatter 構文のみ push を止める（WIP を妨げない）
- `published: true` → 全項目で止める

## 執筆ルール

- 文章のルールは `.agents/references/zenn-writing-guide.md` に従う
- 用語の統一は `prh.yml` が正。ガイドやスキルに用語集を重複させない
- 機械検査の判定基準は `scripts/validate-articles.mjs` が正。スキルに書き写さない
- 新規記事は必ず `published: false` で作成し、`/publish` を通してから公開する
- 記事の本文見出しは `##` から始める（`title` が H1 として扱われるため）
- **push 前に必ず disclosure を通す**。`published: false` でも GitHub 上では公開される
