# dsh-src 0.2 构建与架构说明

## 定位

这是 DSH 的 SRC 授权漏洞研究模式，不是通用自动化渗透框架。核心目标是把授权、范围、逐方案审批、低影响验证、证据和报告连接成一个可审计闭环。

## 状态机

```text
engagement(active + expiresAt)
  ├─ asset(scopeStatus)
  └─ intent(planned)
       ├─ user approval → approved
       ├─ execution → in-progress
       ├─ fact(candidate / confirmed / disproved)
       └─ finding(confirmed + humanReproduced)
```

## 模块

- `lib/store.js`：领域状态、原子 JSON 持久化、引用完整性、域名/IP/CIDR 范围判断。
- `lib/src.js`：12 个 SRC 工具、逐方案审批门禁和 fail-closed Scope Guard。
- `lib/protocol.js`：系统协议和脱敏报告生成。
- `lib/view-model.js`：宿主 API 与独立 UI 共用的数据契约。
- `lib/index.js`：为 dsh web 注册 `/src-graph-api` 和 `/src-graph`。
- `ui/`：无第三方 CDN、本机绑定的探索记录页面。
- `preset/src/`：指挥 Agent 与受限执行子 Agent 的组合配置。

## 构建

项目是纯 ESM JavaScript，无编译阶段：

```bash
npm pack
```

产物为 `dsh-src-0.2.0.tgz`。包内包含运行源码、Preset、规则参考、报告模板、安装脚本和 UI。

## 安装闭环

```bash
dsh plugin --profile web add file:$(pwd)/dsh-src-0.2.0.tgz
node ~/.dsh/profiles/web/node_modules/dsh-src/scripts/install.js
```

第一步安装 bundle 与工具，第二步把 Preset 注册到 `$DSH_HOME/.agent-presets/src/`。

## 关键约束

1. Engagement 必须有未来有效期和非空授权范围。
2. `*.example.com` 只匹配子域；IP 支持 CIDR；排除规则优先。
3. 网络类工具在缺会话、缺目标、解析失败或越界时 fail-closed。
4. Intent 请求预算限定为 1..20，并要求停止条件。
5. 未经 `src_approve_intent` 的 intent 不能写验证事实。
6. Finding 必须关联同 intent 的 confirmed fact，并声明人工复现。
7. 子 Agent 必须显式提供 intentId，不能自动锚定“最后一个 open intent”。
8. 报告只生成本地草稿，不自动提交。

## 数据存储

默认文件：`$DSH_HOME/storages/src-sessions.json`。

- schema version：2
- 临时文件 + rename 原子更新
- 新文件权限：0600
- 记录包含 engagement、assets、intents、facts、findings、edges 和 counters

## DSH 兼容边界

Peer dependency 限定为 `>=0.1.0-rc.6 <0.2.0`。DSH 仍处预览期，升级到 0.2 或更高版本时应重新核对 Cordis 插件、工具定义和事件钩子接口。
