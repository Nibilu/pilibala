---
name: pilibala-dev-release
description: >
  Pilibala/Paperclip 自身代码的修改、合并与 dev 服务发布守则。当任务涉及修改
  pilibala 仓源码、merge 到主分支、dev 服务（paperclip-dev, :3104）热加载/重启、
  或发布后验证时必须遵循。违背本守则曾导致 AMB-323 式收尾事故。
---

# Pilibala Dev 修复与发布守则

适用：任何修改 pilibala/paperclip 仓并需要在 dev 实例生效的任务。

## 硬规则（违反任一条 = 事故）

1. **run 存活期间禁止在主仓 `/home/amber/paperclip` 做 git checkout / merge /
   修改被 server 引用的源文件。**
   dev 服务 = tsx watch 主仓；主仓被监视文件一变 → 立即热重启 → SIGTERM 杀掉
   所有存活 run（包括发起合并的 run 自己）。journal 特征：
   `[tsx] change in ./src/... Restarting...` 出现在 SIGTERM 前一秒。
   - 开发与测试一律在 worktree（`.pilibala/worktrees/`，已被 tsx 排除）
   - 合并收尾由编排者在 run 结束后执行；若 run 必须自己收尾：**先写状态+评论
     （持久化），merge 放最后一步**，并接受 merge 即自毁

2. **merge 前检查谱系一致性。**
   目标分支必须包含本地关键补丁。已知关键补丁：
   - `packages/adapters/pi-local/src/server/pi-command.ts`（pi CLI 解析的
     `~/.pi/agent/bin/pi` managed-home 回退；源自 dafe66d7b1 / AMB-311）
   - 校验：`git merge-base --is-ancestor <补丁commit> <目标HEAD>`
   - 谱系分叉的分支禁止直接 checkout 切换主仓（会静默丢失补丁并热重启）

3. **merge 后必做验证，不通过不算发布。**
   - `curl -fsS http://127.0.0.1:3104/api/health`：`commit` == 新 HEAD 且
     `bootstrapStatus: ready`
   - pi_local 自检：对目标 agent 跑 capability-check 或一次试运行，确认无
     `Command not found in PATH: "pi"`
   - UI 改动：`pnpm --filter @pilibalaai/ui build` → 比对 served bundle hash
     （`/` HTML 中 assets/index-*.js 与 `ls ui/dist/assets/` 一致；注意
     `server/ui-dist/` 阴影问题，必要时刷新该目录而非重启）

4. **dev 服务 PATH 不含 `~/.local/bin`。**
   pi 命令解析依赖 pi-command.ts 的 managed-home 回退。见到
   `Command not found in PATH: "pi"`（run 秒失败、logBytes=0）先检查该文件
   是否存在于当前谱系。

5. **重启纪律。**
   `systemctl --user restart paperclip-dev` 会杀掉所有存活 run。仅当
   heartbeat_runs 中 status='running' 数为 0 时才允许执行；重启后需重新登录
   board 会话。

## 事故特征速查

| 症状 | 根因 |
| --- | --- |
| run=interrupted + `Scheduled bounded retry 1/2` + journal 有 tsx change 行 | 热重启自杀（违反规则 1） |
| 重试秒失败 `Command not found in PATH: "pi"`，logBytes=0 | 谱系缺 pi-command.ts（违反规则 2） |
| 页面报错横幅 Retry + Inspect run | 上述两者下游：重试耗尽 → recovery hold |
