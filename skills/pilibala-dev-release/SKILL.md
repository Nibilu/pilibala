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

2. **merge 目标必须是 clip_fork，且 merge 前先把 clip_fork fast-forward 到 dev 线最新。**
   主分支唯一：clip_fork。禁止把工作 merge 到主 checkout 顺手所在的其它分支（那是 AMB-323
   剪线事故的直接成因）。流程：`git fetch origin` → 确认 clip_fork 已含 dev 线全部提交
   （或先把 dev 线 FF 进 clip_fork）→ 再把任务分支 merge 进 clip_fork。
   同时 merge 前检查谱系一致性：目标分支必须包含本地关键补丁。已知关键补丁：
   - `packages/adapters/pi-local/src/server/pi-command.ts`（pi CLI 解析的
     `~/.pi/agent/bin/pi` managed-home 回退；源自 dafe66d7b1 / AMB-311）
   - 校验：`git merge-base --is-ancestor <补丁commit> <目标HEAD>`
   - 谱系分叉的分支禁止直接 checkout 切换主仓（会静默丢失补丁并热重启）

3. **merge 后必做验证，不通过不算发布。**
   - `curl -fsS http://127.0.0.1:3104/api/health`：`commit` == 新 HEAD 且
     `bootstrapStatus: ready`
   - 四方对齐：clip_fork == origin/clip_fork == 主 checkout HEAD == health.commit
     （巡检脚本：/home/amber/.local/bin/pilibala-dev-alignment-check；push 后复查）
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

6. **health.commit 不证明运行代码版本；packages/* 改动可能不触发热重启。**
   `/api/health` 的 `commit` 字段是**实时读 git HEAD**，不是进程启动时的版本——
   HEAD 新 ≠ 进程新。判定运行版本：`ss -tlnp | grep 3104` 取 PID →
   `ps -o lstart -p <PID>`，与目标 commit 时间比较；或直接用业务 API 的行为验证
   （如 pi 模型 label 是否已是新格式）。watch 模式下 `scanForBackendChanges`
   仅 dev 模式生效，且 `tsx watch src/index.ts` 对 packages/* 的修改可能漏触发
   ——改完 `packages/*/src`（如 pi-local models.ts）后若 API 行为未变，**显式
   重启**（按规则 5 判 run 数）再验证。

7. **模型目录不更新先查两处覆盖点。**
   - declared models：`PILIBALA_ADAPTER_MODELS` env 声明的列表优先于
     `adapter.listModels` 动态发现（registry.ts `declaredModelsForAdapter`）
   - 动态发现缓存：pi-local models.ts 有 60s TTL 内存缓存

## 事故特征速查

| 症状 | 根因 |
| --- | --- |
| run=interrupted + `Scheduled bounded retry 1/2` + journal 有 tsx change 行 | 热重启自杀（违反规则 1） |
| 重试秒失败 `Command not found in PATH: "pi"`，logBytes=0 | 谱系缺 pi-command.ts（违反规则 2） |
| 页面报错横幅 Retry + Inspect run | 上述两者下游：重试耗尽 → recovery hold |
| 代码已提交但 API 行为仍是旧逻辑（health.commit 却显示新 HEAD） | 运行进程是旧的：health.commit 实时读 HEAD 不证明版本；按规则 6 查进程启动时间并显式重启 |
| 改了 adapter 模型目录但 API 仍返回旧列表 | declared models（PILIBALA_ADAPTER_MODELS）覆盖动态发现，或 60s 发现缓存未过期 |
