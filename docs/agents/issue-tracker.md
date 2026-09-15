# Issue tracker: GitHub

本仓库使用 [qinqiana/pindou-calculate 的 GitHub Issues](https://github.com/qinqiana/pindou-calculate/issues) 跟踪需求与规格。技能要求“发布到 issue tracker”时，创建或更新对应 GitHub Issue。

## 操作约定

- 优先使用已连接的 GitHub 工具；能力缺失时使用原生 Git 或 `gh`。工具路由不扩大当前任务授权。
- 查询时同时读取正文、评论、标签与状态；写入前查找已有对应 Issue，避免重复创建。
- `gh` 多行正文使用临时文件配合 `--body-file`，保留真实换行。
- 外部写入结果不明时，先回读远端确认，再决定是否重试。
- 推送本地已有提交使用 `git push`，保持本地提交历史；推送后回读远端分支与文件。
- 标签含义见 [triage-labels.md](triage-labels.md)。GitHub Issues 用于任务与规格发布；根规格的可编辑真源为仓库 `SPEC.md`，Issue 发布其对应版本并链接真源，变更时同步更新，避免两份规则漂移。

## Pull requests as a triage surface

**PRs as a request surface: no.**

## 领域决策与子任务

既有 `.wayfinder/` 文件作为历史决策来源保留。若后续任务明确使用 GitHub 子任务或依赖，则优先使用原生子 Issue 与依赖；工具不支持时，在正文中列出任务链接和阻塞关系。不把现有历史记录批量迁移或自动建成 Issue。
