---
name: publish-check
description: >-
  記事が出せる状態かを読み取り専用で確認する。機械検査スクリプトを走らせ、
  機械では判定できない項目（topics の実在、リンクの生存、時点注記、他スキルの実施状況）を足して
  判定を出す。ファイルは変更しない。
  `/publish-check` または `/publish-check <ファイル>` で起動。
  「公開前チェック」「出せる状態か」「diagnose」でも起動。
  実際に push・公開まで進めたい場合には反応しない（publish に委譲）。
---

# publish-check

記事が出せる状態かを**読み取り専用**で診断する。修正も commit も push もしない。

実際に出すところまで進めたいときは `/publish` を使う。本スキルはその前段の様子見、
または `/publish` の Step 3 から呼ばれる部品として使う。

**出力言語: 日本語**

## ワークフロー

### 0. スキル使用の明示

「**publish-check** skill を使います。」と発言してから作業開始。

### 1. 対象記事の特定

引数指定 → 未コミットの `articles/*.md` → 最終更新が最新、の順。

### 2. 機械検査

```bash
node scripts/validate-articles.mjs articles/<file>.md
pnpm exec textlint articles/<file>.md
```

`scripts/validate-articles.mjs` が機械検査の唯一の正。**同じ検査を本スキル側で再実装しない。**
検査内容（frontmatter の Zenn 制約、秘匿値、画像の実在、H1、書きかけ検出など）はスクリプトのコメントを参照。

厳しさは `published` の値で変わる。`published: false` では秘匿値・画像不在・frontmatter 構文のみ error、
`published: true` では全項目が error になる。

### 3. 機械では判定できない項目

スクリプトが見られないものを補う。ここが本スキルの本体。

| 項目 | 確認方法 |
|---|---|
| **topics の実在** | 各トピックが Zenn に実在するか。`WebSearch` で `zenn.dev/topics/<name>` を確認。表記が違うと別トピック扱いになり流入しない |
| **外部リンクの生存** | `WebFetch` で到達確認。数が多い場合は主要なものに絞り、**絞ったことと件数を報告する** |
| **時点注記** | バージョン・料金・UI に触れているのに「〇〇年〇月時点」がない箇所 |
| **導入と締め** | 冒頭2〜4文で「何の記事か」が分かるか。`## おわりに` / `## まとめ` があるか |
| **画像の中身** | スクリーンショットを `Read` で開き、写り込みがないか。詳細な判定は `/disclosure-check` に委譲 |
| **空セクション** | 見出しだけで本文がない箇所 |

### 4. 他スキルの実施状況

以下を著者に確認する。未実施があれば、公開前の実施を促す。

| スキル | 確認すること |
|---|---|
| `/review` | 5観点の並列レビューを通したか（これを通していれば以下は概ねカバーされる） |
| `/disclosure-check` | 社外秘スクリーニング済みか。**PUBLIC リポジトリなので `published: false` でも必須** |
| `/fact-check` | バージョン・料金・API 名の裏取り済みか |
| `/code-verify` | コードブロックの検証済みか（コードを含む記事のみ） |
| `/writing-check` | 推敲済みか |

記事が業務・プロダクトに言及していて disclosure が未実施の場合、**判定を「公開不可」にする**。

### 5. レポート

```
## publish-check: articles/<slug>.md

判定: ✅ 出せる / ⚠️ 要確認 <N>件 / ❌ 出せない <N>件

### 機械検査
error <N>件 / warn <N>件
（validate-articles.mjs と textlint の出力をそのまま貼る）

### 機械では見られない項目
| 項目 | 判定 | 内容 |
|---|---|---|
| topics の実在 | ⚠️ | 「ClaudeCode」は Zenn では「claudecode」 |
| 外部リンク | ✅ | 5件すべて到達（うち2件は未確認: 認証が必要） |
| 時点注記 | ❌ | 料金に触れているが時点の記載なし |

### 他スキルの実施状況
- [ ] /review          ← 未実施
- [ ] /disclosure-check ← 未実施。業務ネタのため必須
- [x] /fact-check

### 次にやること
1. /disclosure-check を通す
2. L42 に「2026年8月時点」を追加
3. topics を claudecode に修正
```

## ルール

1. **読み取り専用** — ファイルを変更しない。commit も push もしない。修正が必要なら該当スキルへ案内する
2. **機械検査を再実装しない** — `scripts/validate-articles.mjs` が唯一の正。判定基準を本スキルに書き写さない
3. **確認できなかったものを黙らせない** — リンクを絞った、画像を開けなかった等は必ず報告する
4. **disclosure 未実施の業務ネタは「出せない」** — PUBLIC リポジトリなので push 自体が公開になる
5. **判定を丸めない** — 「だいたい大丈夫」と言わない。✅ / ⚠️ / ❌ のいずれかで示す
6. **topics は実在確認する** — 推測で判定しない

## 関連

- 機械検査の実体: `scripts/validate-articles.mjs`
- 出すところまで進める: `.agents/skills/publish/SKILL.md`
- 内容のレビュー: `.agents/skills/review/SKILL.md`
- push ゲート: `.githooks/pre-push`
