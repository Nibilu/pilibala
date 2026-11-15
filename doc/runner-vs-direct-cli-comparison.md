# Pilibala 内置 Runner 与直接使用 CLI Agent 的功能对比

- 日期:2026-11-15
- 任务:AMB-296(输出到 artifacts 的对比文档;本文件为仓库留档副本)
- 基线:工作树分支 `AMB-296-pilibala-runner-claude-code-codex-hermes-pi-antifacts`(最近提交 `ad1ec36cb1`)
- 对比对象:**Claude Code / Codex / Hermes / Pi** 四类 harness
- 依据文档:`doc/GOAL.md`、`doc/PRODUCT.md`、`doc/SPEC-implementation.md`、`doc/architecture/pilibala-runner.md`、`doc/architecture/pilibala-runner-compatibility.md`、`doc/RUNNER-INTEGRATION-PLAYBOOK.md`、`doc/runner-api-tools.md`、`doc/AGENT-ARTIFACTS.md`、`packages/pilibala-runner/README.md`、`server/src/services/agent-runner-selection.ts`、`server/src/services/heartbeat/native-lifecycle.ts`、`server/src/services/native-runtime/pilibala-runner-tool-authority.ts`、`packages/pilibala-runner/acpx-profiles.json`

---

## 0. TL;DR

直接使用 Claude Code / Codex / Hermes / Pi,你得到的是「**模型 + 本地工具 + 你自己的会话管理**」。Pilibala 内置 Runner(Pilibala Native Runner,`pilibala_runner` 适配器)在同一个 provider 会话外面包了一层**公司控制面执行结构**:任务/组织/目标上下文注入、40+ 个 run 绑定的语义工具、持久化人机交互、预算硬停、全程审计、崩溃恢复与确定性重放、远程执行环境(SSH/沙箱/云)、多 provider 统一资格管理。代价是:协议归一化带来的能力有损、运行时版本 pin、更高的基础设施复杂度,以及部分 provider 的 native 能力缺口(诚实标注为不支持)。

一句话:**裸 CLI 解决"一个会话能不能干活";内置 Runner 解决"一个 AI 公司的劳动是否可治理、可恢复、可审计、可扩展"。**

---

## 1. 两条执行路径分别是什么

### 1.1 直接使用(裸 CLI / Pilibala direct adapter)

- **纯裸 CLI**:在终端直接运行 `claude` / `codex` / `hermes` / `pi`。任务管理、上下文、凭据、恢复全部自己负责。
- **Pilibala direct adapter(legacy 路径)**:Pilibala server 通过内置适配器直接拉起或恢复本地 CLI 会话并跟踪运行(`claude_local`、`codex_local`、`gemini_local`、`opencode_local`、`pi_local`、`hermes_local`、`hermes_gateway`、`openclaw_gateway` 等,见 SPEC-implementation §7.2)。心跳调用、转录投影、运行状态/取消由适配器完成;适配器在 server 进程内执行,最终化沿用 legacy 启发式,不产生任何 native 记录(兼容性不变量 1–5,`doc/architecture/pilibala-runner-compatibility.md`)。
- 适配器契约就是最小三件套:`invoke / status / cancel`(SPEC-implementation §11.1)。

### 1.2 内置 Runner(native 路径)

架构拓扑(`doc/architecture/pilibala-runner.md`):

```text
Pilibala server
  |  认证 PRP v1 WebSocket(/api/runner/v1/connect/:runId)
  v
pilibala-runnerd(独立执行进程,Rust)
  |  合格 provider 原生协议
  v
Codex app-server / OpenCode server / ACPX sidecar(Claude/Grok/Pi/Cursor/Copilot/Kimi)/ Claude Managed / AWS AgentCore / Cursor Cloud
```

系统架构上比 direct 路径**多出的组件**:

| 组件 | 作用 |
|---|---|
| `@pilibalaai/pilibala-runner` 独立包 | 语言中立 PRP 协议、TypeScript 契约 + Rust runner core、跨语言确定性 parity、conformance 套件 |
| runnerd 守护进程 | provider 进程组监督、会话/回合传输、durable outbox、命令回执、重启恢复(进程所有权移出 server 进程) |
| PRP v1 协议 | fail-closed:未知必需版本/discriminator/enum 一律拒绝;帧、头、重放窗口全部有界;事件身份跨重连稳定 |
| server 侧 native-runtime 服务 | completion contracts、native_run_results、finalizations、work assessments、status arbiter、status decisions、effect ledger(`server/src/services/native-runtime/`) |
| native 运行信封 | `heartbeat_runs` 增加 `runtime_mode`、completion contract 引用、driver 身份、`native_phase` 等一等字段;`heartbeat_run_events` 增加 source instance/event/seq 溯源列 |
| RunnerExecutionDriver | 本地 / SSH / 沙箱(Daytona)执行环境的准备、激活、checkpoint、释放钩子;Kubernetes 执行模式 |
| provider pack + ACPX sidecar | `pilibala-runner-acpx-sidecar` v2 stdio 桥,在进程边界校验模型、会话身份、工具目录、结构化输入与终端结算;Linux x64/arm64 遥距 pack |

### 1.3 「当前版本默认启用」的准确含义

历史 ADR(2026-08-24)把 Runner 描述为 default-off 实验门;但 playbook 明确提醒「historical ADRs describe rollout phases and can lag current product configuration」。当前代码(`server/src/services/agent-runner-selection.ts`)的真实规则是:

- `runner: "auto"`(默认)时,`agentRunnerAvailability()` 在**合格 harness + 合格执行环境/平台**上返回 `defaultRunner: "pilibala"`,新 agent 自动落在 native Runner;
- 不合格(musl libc、过旧 glibc、未资格化沙箱镜像、macOS-over-SSH 的 Claude 等)自动落回 legacy direct;
- `runner: "legacy"` 显式保留 direct 路径,现有 agent 保持已存选择,升级转换保留 harness/模型/账号绑定/指令/历史(PRODUCT.md「Agent Execution」升级段落);
- **禁止静默回退**:选定 `pilibala_runner` 的启动失败必须可见地报错,不允许悄悄换成 `codex_local`(compatibility doc「Runtime selection」);
- 已持久化 native 模式的 run 在 flag 关闭后仍可恢复/终结;flag 只挡新的 native 启动(kill switch 语义)。

---

## 2. 产品需求视角:内置 Runner 多出来的能力

SPEC-implementation §2 定义 V1 成果:「一名操作者端到端运营一家小型 AI 原生公司,具备清晰可见性与控制」。直接 CLI 只覆盖第 3 条(agents 执行任务);内置 Runner 是让其余五条在 CLI harness 上成立执行结构。

### 2.1 控制面上下文注入(裸 CLI 完全没有)

- 每次运行绑定 company / agent / issue / run 身份,任务标题、描述、work mode、完成契约作为**封闭严格 schema**(`NativeExecutionInputV1` → `NativeModelEnvelopeV1`)进入模型输入;binding ID、凭据引用、runner profile、驱动控制数据**留在模型可见内容之外**。
- 目标层级/任务树("为什么做这件事")由控制面维护并在任务上下文中给出;裸 CLI 里这只能靠人肉维护 CLAUDE.md/AGENTS.md。

### 2.2 心跳与自治调度

- 每 agent 调度参数:`enabled`、`intervalSec`(≥30)、`maxConcurrentRuns`(默认 20,钳位 1..50);调度器在 paused/terminated、已有活动 run、预算硬停时跳过调用(SPEC-implementation §11.7)。
- 唤醒载荷(wake payload)、routines/定时触发、watchdog 监控、监控检查(Monitoring 状态)——自治公司的"神经系统"。
- 裸 CLI:没有调度概念,会话结束即停止。

### 2.3 任务生命周期与工作模式

- **原子 checkout**:单条 SQL `WHERE status IN (...) AND assignee IS NULL OR =:agentId`,冲突返回 409;`in_progress` 必须有负责人(SPEC-implementation §10.4.1)。多 agent 并发抢单安全。
- 状态机(backlog/todo/in_progress/in_review/done/blocked/cancelled)、单一负责人、阻塞关系、子任务委派。
- work mode(standard / ask / planning):planning 模式接受计划确认后**同事务**原子切到 standard。
- 非终态活性规则(liveness):每个未完结任务必须有活的执行路径、显式等待路径或恢复路径;裸 CLI 无此概念。

### 2.4 语义工具桥(最大增量)

native Runner 把 Pilibala 能力以**协议级工具**注入 provider 会话(`server/src/services/native-runtime/pilibala-runner-tool-authority.ts`),每个调用按当前 run 绑定重新授权(company/run/work mode/权限/预算),未绑定或未授权操作对发现不可见;同幂等键重放返回原回执,改参重放失败:

| 类别 | 工具 |
|---|---|
| 任务 | `get_task_context`、`get_task_history`、`search_tasks`、`create_task`、`reassign_task`、`set_task_title`、`set_task_monitor`、`set_dependencies`、`report_progress` |
| 文档 | `list_documents`、`read_document`、`list_document_revisions`、`write_document` |
| 组织/审批 | `list_agents`、`get_agent`、`list_approvals`、`get_approval`、`get_approval_context`、`hire_agent` |
| 交互 | `request_human_input`、`send_chat_message` |
| 项目/仓库 | `create_project`、`list_projects`、`list_project_repositories` |
| 工作区 | `get_workspace`、`list_workspaces`、`select_workspace`、`prepare_repository` |
| REST 逃生舱 | `search_api` / `call_api`(按 run 签发短期服务端 JWT 走真实 HTTP 路由;16 KiB URL / 10 MiB 上传 / 24 KiB 内联 / 1 GiB 捕获 / 每 run 4 GiB、每公司 20 GiB 预算) |
| 交付物 | `register_deliverable`(校验字节与 SHA-256,原子发布,重放安全)、`download_artifact`、`generate_image`(每调用独立成本事件) |
| 完成契约 | `pilibala_finish` / `pilibala_block` 结构化完成声明 |
| 记忆/技能 | agent instructions 读写/历史/恢复、`create_skill`/`update_skill`、workflows/cases、`submit_complaint`/`submit_suggestion` |
| 超大 MCP 目录 | `pilibala_search_assigned_tools` / `pilibala_call_assigned_tool`(目录超 256 操作/768 KiB 时替换直发) |

裸 CLI 中这些一律不存在;Pilibala direct adapter 的 agent 只能靠 REST API + skills(pilibala skill)自力更生。native 差异在于:**工具发现由服务端按 run 投影、调用带持久化回执、UI 渲染真实工具卡片、幂等/重放/越权全部 fail-closed**。

### 2.5 人机交互持久化

- 问题/权限/计划回调先**持久化再呈现**;结构化 `pilibala.question_set.v1`;答案在不可信 API 边缘与持久化问题集各验一次。
- 陈旧/重复/跨问题答案拒绝;provider 死亡时请求过期而非静默重放;浏览器重连与 controller 重启期间同一请求只投递一次。
- 裸 CLI:交互只是终端里的行,关掉就没了。

### 2.6 预算与成本治理

- cost_events 归账(company/agent/issue/project 维度)、月度预算、80% 软提醒、100% 硬停自动暂停并阻断新 checkout。
- native run 在治理等待取消后的**bounded accounting-only drain** 保留最终 usage 回执;缺回执继续阻塞预算准入。
- 部分无法计量成本的 provider(如 Cursor Cloud usage API 未接通)诚实标注「unknown」,预算策略可阻止无可靠定价的新工作。
- 裸 CLI:token 花费只存在于 provider 自己的仪表盘。

### 2.7 治理与审批

- approvals(hire_agent / approve_ceo_strategy / budget_override / request_board_approval)、board 随时 pause/resume/terminate/改派。
- governed actions 的 ask-first 确认卡与正式审批分离;agent 不能自批。
- 裸 CLI:没有"治理"对象。

### 2.8 审计与运行日志

- 每次变更写 activity_log(actor/run/归因/前后值);`heartbeat_run_events` 运行日志(本实例库内);runner 回执、语义动作回执、useage 事件全部结构化。
- 三条数据路径分离:Telemetry(可退出,发 Pilibala 端点)、Observability(OTel,设端点才启用)、Run log(本地库)——按路径适用不同审查级别(AGENTS.md §5.7)。
- 裸 CLI:只有终端 scrollback 和 provider 自己的会话文件。

### 2.9 持久交付与崩溃恢复(Runner 的核心卖点)

- **先持久化后发送**:runnerd 事件落盘后才发送;server 累积游标 ACK;ACK 验证后才删数据。重连上报已处理命令/下一序列/未确认区间;服务端可重放一条 pending 命令并接受字节等价事件重试。
- **命令幂等**:同 command ID 同规范输入返回存储结果;异输入 fail closed;重复语义工具调用不会重复应用效果。
- **恢复有界**:存储/重连/命令/时间上限耗尽即按分类失败结束,不会无限循环。
- **完成仲裁**:native 结果是**不可信声明**,须经 completion contract(不可变修订)→ 结果摄入(规范字节 SHA-256 幂等)→ workspace_finalize 屏障 → 证据分类 → work assessment → 纯函数 StatusArbiter → 串行化 decision/effect ledger;报告的 `done` 永不直接关闭 issue;与 board 操作竞争时 `status_version` CAS 产生取代性 assessment 而非覆盖。
- controller/runner 重启、断线、provider 崩溃均有确定性恢复(如 ACPX controller replacement 回归:活动回合重连、删掉 controller 存储后 checkpoint 恢复、断线期间完成、provider 崩溃)。
- 裸 CLI:进程没了就是没了(Claude Code/Codex 有各自的会话恢复,但无跨机恢复、无治理性恢复动作、无重放保证)。

### 2.10 工作区与执行环境

- 执行工作区(任务隔离目录,默认不落 agent home)、项目工作区(git repo)、生命周期类(`standing` / `task_ephemeral`)、终态清理与压缩、`merged_via_pr` 交付状态判定。
- 执行目标:本地 / SSH(平台探测:uname/glibc)/ Daytona 沙箱(OCI `@sha256` pin + 资格记录)/ Kubernetes 执行模式 / plugin runnerTasks 目标(强制 Runner)。
- 交付物上传(AGENTS.md §6 工作流:native 用 `register_deliverable`,legacy 用上传脚本)让 board 无需访问 agent 磁盘即可检查产出。
- 裸 CLI:在你当前目录干活,目录管理全靠自觉。

### 2.11 会话连续性

- **warm lifecycle**:`codex_app_server` 与 `opencode_server` 本地目标默认 warm——后续回合跳过冷启动与 session 加载(`native-lifecycle.ts`;依据 `doc/plans/2026-11-07-warm-follow-up-ttft.md` 的 TTFT 实测)。ACPX harness(如 Claude)按设计每回合重启 provider 进程,warm 不缩短其 follow-up,保持 per_turn。
- durable session goals(PRP v2 `sessionGoals` 能力,`/goal` 命令;活跃 goal 抑制过早终结化,goal 心跳沉降时暂停暖所有权,重启后经 checkpoint+authority 轮换恢复同一 provider 会话)。
- steering(活动回合内改输入)与 queued follow-up 是**不同控制**,带各自回执与消费顺序。
- 恢复身份围栏:company/agent/task/workspace/model/mode/instructions/skills/可执行 profile/环境任一变化强制新会话;checkpoint 绑定 provider 身份+目录 digest,逐项匹配才恢复。
- 裸 CLI:Claude Code/Codex/Pi 各有本地会话恢复,但无跨机、无身份围栏、无治理语义(goal 状态不会抑制/驱动任务生命周期)。

### 2.12 信任与凭据边界

- runnerd 只拿**一次性 bootstrap ticket**(绑定 company/agent/issue/run/runner/session/turn/已验证 artifact),换短期连接租约;原始 ticket 永不落盘;**runnerd 永远拿不到宽 Pilibala API key**。
- server 拒绝过期/重放/吊销/跨公司/错配/超大/协议不兼容连接;取消、超时、取代、环境租约丢失即吊销 runner 权限。
- 模型进程拿不到:agent JWT、`PILIBALA_API_KEY`、board 会话、managed MCP 凭据、`process.env`、wake 文本、skill 全文;canary 测试递归检查每个禁区(native-runner-input-boundary 契约)。
- 隔离 provider HOME/XDG;凭据由 broker/服务端解析,仅显式 run 环境转发;诊断/快照/回执全程 redact。
- 裸 CLI:provider 进程 = 你的完整用户身份 + 完整环境变量,边界就是你的自觉。

### 2.13 多 provider 统一资格管理

- 一个控制面统一管理全部合格 provider 的运行时身份:`acpx-profiles.json` 持有各 profile 的 agentServer/agentRuntime 包与版本、`commandDigest`、所需执行策略;TypeScript/Rust 双侧由生成物保证一致(`check:acpx-profiles`)。
- 当前 pin(摘要):Claude = `@agentclientprotocol/claude-agent-acp` 0.73.0 + `@anthropic-ai/claude-agent-sdk` 0.3.286;Pi = `pi-acp` 0.0.33 + `@earendil-works/pi-coding-agent` 1.0.0;Grok = builtin grok-acp + native:grok 1.0.13;Cursor = cursor-agent 2026.09.26;Copilot = `@github/copilot` 1.0.88;Kimi = `@moonshot-ai/kimi-code` 2.3.3;ACPX 层 0.13.1;远端 Codex 版本窗口 `>=0.149.0 <0.161.0`(安装 pin 0.160.0)。
- 模型策略:**显式调用方选择、无 allowlist**——ID 原样穿越 UI/server/Rust/sidecar/ACPX/provider,provider 确认生效模型后才提示;不匹配即拒绝准入,绝不悄悄换模型。
- 裸 CLI:每个工具自己升级自己,协议变了你的自动化就断了;Runner 把这类兼容性变成**受控的、有资格记录的发布物**。

---

## 3. 直接使用 CLI 仍然更好的地方(诚实对比)

1. **零基础设施**:装个 CLI 就能干活;Runner 需要 server + DB + runnerd + (远程时)执行环境。单人临时任务,这条差距是决定性的。
2. **完整原生工具面**:provider-native 事件/工具全部直达;Runner 的 driver 归一化是**有损翻译**——native 消息被翻译成 provider-neutral PRP 事件,未入目录的能力会丢失或降级(playbook §4.2 要求逐字段记录损失边界)。
3. **交互式人机流**:终端里即时提问/steer/取消,无 run 生命周期、无 work mode、无审批门。
4. **无版本 pin**:永远用最新 CLI;Runner 的远端 Codex 有兼容窗口,ACPX profile 有 digest pin(换来可复现,牺牲即时升级)。
5. **单 agent 上下文天然完整**:你的 shell、你的 HOME、你的 MCP/hooks/IDE 集成全部可用;Runner 的隔离 home/isolated 模式是安全特性,也是功能约束(如 preconfigured 模式下 ACPX 只允许 approve-all)。
6. **部分 native 能力缺口是产品事实**:如 Cursor Cloud 无独立模型确认、无 per-run 美元硬顶、无 native 权限/计划回调;Grok 受限模式缺少独立绑定的工具 authority,需操作者决策;这些在 doc 中都明确标注 unsupported。

Pilibala 的定位也是 explicit 的:控制面**不运行 agent,只编排**;「adapter is still the boundary」(PRODUCT.md Principles 1/5)。Runner 不是替代 CLI,而是把 CLI 变成公司里可治理的"员工工位"。

---

## 4. 逐 harness 对照

| Harness | 直接路径(Pilibala 内) | 内置 Runner 路径 | 当前默认 |
|---|---|---|---|
| **Claude Code** | `claude_local`:CLI 或 ACP engine(engine=acp 仅能在编辑表单设置);`dangerouslySkipPermissions` 等原生选项 | `pilibala_runner` + ACPX claude profile(权限默认 `approve-all`="Full auto");技能经 runtime-context snapshot 物化进隔离 Claude home 的 `skills/`;`model`/`availableModels` 双 pin 防别名替换;冷启动预算 60s | 合格平台默认 Runner;例外:macOS-over-SSH、不合格 sandbox 平台保持 legacy |
| **Codex** | `codex_local`:engine=cli\|acp;`dangerouslyBypassApprovalsAndSandbox` 等 CLI 选项;legacy 默认 `codexPermissionMode=never` | `pilibala_runner` + `codex_app_server` 驱动;远端版本窗口 `>=0.149.0 <0.161.0`(pin 0.160.0);Linux 沙箱需 bubblewrap+AppArmor;本地默认 **warm**;session goals 支持 | 合格环境默认 Runner;musl/未知 libc/glibc<2.39 自动 legacy |
| **Hermes** | `hermes_local`(本机 runtime);`hermes_gateway`(远程 HTTP/SSE gateway,`GET /v1/capabilities` 能力契约:run_submission/status/events_sse/stop/steer/approval_response/idempotency) | **无 Runner provider profile**——不在合格目录,保持 direct/gateway 适配器路径 | 永远 direct/gateway |
| **Pi** | `pi_local`:CLI;`thinking` 等设置;legacy 下部分 runner 专属设置不兼容会显式报错 | `pilibala_runner` + ACPX pi profile(**必须显式 model**);凭据来自显式 run 环境(支持 `PILIBALA_PI_PROVIDERS` 自定义 provider);冷启动预算 60s;Linux ARM64 pack **不**资格化 Pi/Cursor/Copilot | 平台合格时默认 Runner(linux-x64 / darwin);其余 legacy |

要点:

- **Hermes 是唯一的例外**:四者中只有 Hermes 没有 runner 集成。它的治理靠 gateway 适配器能力契约 + Pilibala 侧适配器能力检查(manual capability check → diff → upgrade task 流程,SPEC-implementation §11.2)。
- **Claude / Codex / Pi 三条腿都站**:direct 与 runner 并存,`runner` 字段显式选择;auto 模式下平台合格即 Runner。
- Runner 选择是 heartbeat 协调器里**唯一**的分支缝(architecture ADR「Direct adapter boundary」):direct 适配器内部不允许出现 runner 分支,flag-off 的 `codex_local` 心跳必须证明:一次直接调用、字节稳定的 result/finalization、零 runner 进程、零 PRP 连接、零 native 行。

---

## 5. 维度总结表

| 维度 | 直接使用 CLI | Pilibala 内置 Runner |
|---|---|---|
| 启动成本 | 安装即用 | server+DB+runnerd(+执行环境) |
| 任务/组织/目标 | 无(自己维护) | 控制面一等公民,任务树可追溯到公司目标 |
| 调度 | 无 | 心跳调度、并发钳位、routines、watchdog |
| 并发安全 | 无 | 原子 checkout、单一负责人、409 冲突 |
| Pilibala 语义工具 | 无(或 direct agent 靠 REST+skills) | 40+ 协议级工具,run 绑定授权+持久化回执 |
| 人机交互 | 终端行,易失 | 先持久化再呈现;陈旧/重复/越权 fail closed |
| 成本 | provider 仪表盘 | cost_events、月度预算、硬停自动暂停、usage 回执 |
| 审计 | 无 | activity_log + run log + runner 回执 |
| 崩溃恢复 | 各 CLI 自带(本机) | durable outbox、确定性重放、checkpoint、controller 替换、有界恢复 |
| 完成判定 | 模型说了算 | completion contract + 证据分类 + StatusArbiter,`done` 声明≠关单 |
| 执行环境 | 本机 | 本地/SSH/沙箱(OCI pin)/Kubernetes,平台资格探测 |
| 凭据边界 | 完整用户身份 | bootstrap ticket+短租约+隔离 home+凭据 broker |
| 版本管理 | 各自升级 | 统一 profile pin + digest + 版本窗口 + 资格记录 |
| 原生能力保真 | 100% | 归一化有损(损失边界逐项记录) |
| 适用场景 | 个人/临时/单任务 | 多 agent 公司治理、自治运行、合规审计、规模化 |

---

## 6. 选型建议

- **个人跑一个想法、调试 prompt、一次性脚本** → 直接用 CLI。Runner 的全部治理结构对你是纯开销。
- **多 agent 公司、任务需要委托/审批/预算、无人值守长时间运行、要求可审计可恢复** → 内置 Runner。这正是它相对裸 CLI 多出来的全部东西。
- **Claude/Codex/Pi 用户**:让 auto 默认选 Runner,把 `runner: "legacy"` 留给确认需要原生完整行为或平台不合格的场景;两者并存,历史 run 按持久化模式终结,切换只影响未来 run。
- **Hermes 用户**:当前只有 direct/gateway 路径;若需要 runner 级治理,关注适配器能力契约检查(capability check → diff → upgrade task)带来的演进。

---

## 7. 参考来源

- `doc/GOAL.md`(双层架构:控制面/执行服务)
- `doc/PRODUCT.md`(四种 heartbeat 运行方式;Runner 合格默认与升级;预算行为)
- `doc/SPEC-implementation.md` §2/§7.2/§8.2/§10.4/§11/§12/§13(V1 契约、适配器清单、状态机、checkout、适配器契约、治理、预算)
- `doc/architecture/pilibala-runner.md`(Runner ADR:拓扑、信任边界、durable delivery、语义动作、结构化输入、finalization)
- `doc/architecture/pilibala-runner-compatibility.md`(兼容性不变量、runtime selection 表、Codex 版本窗口、kill switch)
- `doc/RUNNER-INTEGRATION-PLAYBOOK.md`(集成方法、能力清单、验收矩阵、诚实的 unsupported 处理)
- `doc/runner-api-tools.md`、`doc/AGENT-ARTIFACTS.md`(search_api/call_api、register_deliverable、交付工作流)
- `packages/pilibala-runner/README.md`(包边界、执行环境生命周期、各 provider 发布细节、平台基线)
- `server/src/services/agent-runner-selection.ts`(默认 runner 选择与转换逻辑)
- `server/src/services/heartbeat/native-lifecycle.ts`(warm/per_turn 默认)
- `server/src/services/native-runtime/pilibala-runner-tool-authority.ts`(native 工具目录)
- `packages/pilibala-runner/acpx-profiles.json`(资格 profile pin)
