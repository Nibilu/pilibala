# PRD：受管运行时模式 D —— 分层键控的共享环境池（覆盖并统一模式 C）

**状态**：设计定稿（下一版本实施）｜ **前置**：alpha 0.0.11（模式 C 加固）已验收
**范围**：仅 Paperclip 侧；不修改 Hermes；不新增数据库表的强依赖

---

## 1. 背景与问题

alpha 0.0.11 将受管 AI 连接的运行环境改为**每 grant 持久化**（模式 C）。它修复了 per-run 一次性 home 的致命缺陷（每 run 重跑 ~1.2GB 引导），但键选择带来的代价在多租户形态下线性放大：

- **每凭据作用域一份重环境**：N 个用户各自连接 → N × ~1.2GB；
- **共享即耦合**：同一 grant 的全部 agent 共享 daemon/会话库——爆炸半径对称（0.0.11 已修复其孤儿 socket 与记录毒化两类缺陷，但共享面内部仍无租户卫生）；
- **组织共享连接无法细化**：公司级 grant 下所有 agent 共享一份凭据语义，用户无法"自带凭据 + 共享环境"。

## 2. 目标与非目标

**目标**
- G1 一个公司内支持：多用户、多 agent、多 provider；
- G2 环境按 **harness 种类**池化（hermes / codex / gemini 各一份重环境），agent 间共享；
- G3 每用户可设置自己的 connection（凭据隔离），凭据层轻量化（MB 级）；
- G4 任务上下文隔离维持现状（per-run/per-issue 工作区，与连接机制正交）；
- G5 模式 C 语义作为 D 的退化特例被完整保留（组织级 grant → 单轻层，行为与 C 一致）。

**非目标**
- 不做跨凭据的 daemon 共享（P5：承载身份/状态的进程永不跨凭据共享——安全边界）；
- 不修改 Hermes 仓库（全部能力来自既有原语：multiplexer、借用启动、PM 账本）；
- 不改变授权模型（connection_grants / audience / responsible-user 语义原样保留）。

## 3. 核心设计：把 home 的键拆成两层

| 层 | 键 | 内容 | 生命周期 | 大小 |
|---|---|---|---|---|
| **环境池** | harness（+版本钉住） | 只读共享的 venv / PM installs（借用启动） | 随 harness 版本演进，引用计数退役 | ~1.2GB × harness 种类 |
| **凭据轻层** | **grantId**（沿用现有凭据作用域单元） | config + auth + state + **每 grant 一个 daemon** | 随 grant 创建/退役 | MB 级/个 |

**为什么轻层按 grant 而不是按 user**：grant 已经是数据模型中的凭据作用域与授权单元。按 grant 键控使 C 成为 D 的自然退化（组织 grant → 单轻层 → 全公司共享，行为与 C 完全一致），无需维护两种模式。

## 4. 关键机制

### 4.1 借用启动（已验证）
轻层 home 的 `hermes-agent` 符号链接指向宿主 checkout；`hermes pm` 账本在池侧。0.0.11 的 execute.ts 预置符号链接 + 一次性 `pm repair` 已实测打通（冷 home 分钟级可用）。

### 4.2 socket 锚定（0.0.11 已内置）
control socket 锚在 `/run/user/<uid>/pilibala-ai/hermes-gw-<home哈希>/`——短路径（AF_UNIX 104 字节内）、跨 run 持久、叶子哈希区分 home。D 的轻层直接继承。

### 4.3 凭据投递
每 run 凭据刷新（epoch 守卫，0.0.11 已实现）；`PILIBALA_<PROVIDER>_KEY` + `key_env` 投递（CLI 通道已验证，ACP 通道按 0.0.11 批次推进）。

### 4.4 daemon 策略
每轻层一个 daemon（idle_exit 600s）为缺省；Hermes multiplexer（单 daemon 多 profile）作为后续池化选项——注意 multiplexer 的 profile home 仍各自有数据根，池化收益来自**轻层本身**而非 daemon 合并。

### 4.5 生命周期与失效协议（P3/P6 落地）
- 轻层删除 → 级联失效其 acpx 记录引用（广播 reset 标记，替代静默消失）；
- 池退役按引用计数（无轻层借用且无活跃 run）；池只读化，轻层永不写池；
- prep 失败语义分两层：池 prep 失败（全局，告警+重试）vs 轻层 prep 失败（删轻层重建）。

## 5. 用户故事

1. **公司管理员**创建一个组织级 nvidia 连接并共享 → 全公司 50 个 agent 使用，环境仅 hermes/codex 两份重池 + 每 grant 一份轻层（本例 1 份）。
2. **用户 A**为自己的 agent 选择"个人连接"（delegated）→ 生成 A 的轻层（MB 级、秒级），借用共享 hermes 池；B 同理互不可见。
3. **用户 A 更换凭据**（rotate）→ 仅 A 的轻层凭据刷新（epoch 守卫），环境池不动，B 无感。
4. **公司连接凭据轮换** → 组织轻层凭据刷新，全公司 agent 的后续 run 自动携带新 key。
5. **同 agent 在共享/个人连接间切换** → 轻层随之切换，会话连续性按既有 reset/handoff 协议处理。

## 6. 验收标准

| # | 标准 | 验证方式 |
|---|---|---|
| A1 | 组织 grant：N agent 双消息 chat 连续成功（无隔条失败） | 双消息实测 + 记录无毒标记 |
| A2 | 个人 grant：新用户首条消息 ≤ 60s 完成（无 1.2GB 引导） | 计时 + 引导日志为零 |
| A3 | 凭据轮换：rotate 后下一 run 用新 key（epoch 递增），在飞 run 不受影响 | secret 版本断言 |
| A4 | 池复用：两个轻层的 venv 指向同一池（inode/realpath 断言） | 文件系统断言 |
| A5 | 爆炸半径：轻层损坏只影响该 grant 的 agent（跨 grant 隔离断言） | 注入故障实测 |
| A6 | C 退化等价：组织 grant 下 D 行为与 0.0.11 C 逐项一致（socket 路径、会话语义、清理时机） | 对照测试 |

## 7. 风险与对策

| 风险 | 对策 |
|---|---|
| 池级故障影响所有借用者 | 池只读 + 版本化；轻层永不写池；池损坏 = 全局告警 + 重建池 |
| 多租户会话卫生（同 grant 共享 daemon 的 noisy neighbor） | daemon 每 grant 隔离（现状保持）；迭代上限已有；后续可选 per-轻层 daemon 池化 |
| 借用启动与宿主升级的版本漂移 | 池版本钉住 + pre-repair 再验证（0.0.11 已有原型） |
| PM 账本在借用模式下的维护操作边界 | `hermes pm repair` 已实测；repair/write 分叉用例补测试 |
| /run/user 清理策略（logind 会话结束） | mkdir 幂等 + 缺失时回退 TMPDIR（0.0.11 行为），daemon 重启自然重锚 |

## 8. 实施切分（建议三步，均独立可验收）

1. **S1 环境池**：managedAiRuntimeDir/Pool 键控 + 借用启动参数化（池路径可配）；验收 A4/A2。
2. **S2 轻层键控**：prepare 返回轻层 home（grant 键）+ 级联失效协议；验收 A1/A5/A6。
3. **S3 凭据层强化**：rotate 传播测试 + 池/轻层生命周期管理命令；验收 A3。

## 9. 度量

- 每公司磁盘：环境 GB 数（目标 ≤ harness 种类数）+ 轻层 MB 数（= 活跃 grant 数）；
- 冷启动：新 grant 首条消息 P50 ≤ 60s；热启动 P50 ≤ 15s；
- 隔条失败率：0（双消息连续成功为门槛）。
