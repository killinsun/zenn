# Zenn 記事リポジトリ — Claude Code 指示書

@AGENTS.md

## Claude 固有設定

- Claude Code のプロジェクト入口はこのファイル。共通指示は `AGENTS.md`、スキルのオリジナルは `.agents/skills/`
- `.claude/skills` は `.agents/skills` へのシンボリックリンク。スキルを編集するときは `.agents/skills/` 側を直接編集する
- `natural-japanese` は `npx skills add coji/natural-japanese` で入れた第三者製スキル。`skills-lock.json` で管理されているので手編集しない

### 返答スタイル

- すべての文に対して日本語で返答すること

### Skill 参照

- 記事を書き始めるとき: `/article`
- 書き終えたあと: `/review`（5観点の並列レビュー）→ `/publish`（ゲート → コミット → push）
- 観点を個別に深掘りしたいとき: `/writing-check` `/fact-check` `/code-verify` `/disclosure-check` `/natural-japanese`
- 出せる状態かだけ見たいとき: `/publish-check`（読み取り専用）

### 守ること

- **`git push` の前に必ず disclosure を通す**。PUBLIC リポジトリなので `published: false` でも公開と同じ
- **`git push --no-verify` を自分から提案しない**。pre-push ゲートが落ちたら内容を直す
- 機械検査の判定基準を変えるときは `scripts/validate-articles.mjs` を直す。スキル側に条件を書き写さない
