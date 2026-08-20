import { defineTool } from '@deepseek-ai/dsh-tools';
import {
  SrcStore, checkScope, extractTargetsFromCommand, normalizeScope,
  requiredString, optionalString, enumValue, stringList, concreteId,
  FACT_KINDS, EVIDENCE_STATES, INTENT_STATES, SEVERITIES, ASSET_TYPES, PLATFORMS,
} from './store.js';
import { SRC_SECTION_ORDER, SRC_PROTOCOL_SECTION, buildReport } from './protocol.js';

// Cordis Fiber 对 class 插件只调 constructor + [symbols.init]()，不调 apply()；
// 对 function 插件直接调用函数体（即使被 new 也会执行）。因此用 function 而非 class。
// inject 声明 Cordis 服务依赖：systemPrompt（协议段）、tools（工具注册）。
export default function dshSrc(ctx) {
  const store = new SrcStore();
  registerProtocol(ctx);
  registerTools(ctx, store);
  if (typeof ctx.on === 'function') ctx.on('tools/before-call', (payload, next) => guard(payload, next, store));
}

dshSrc.inject = ['systemPrompt', 'tools'];

function guard(payload, next, store) {
  const name = payload?.name || payload?.toolName || payload?.tool || '';
  if (name.startsWith('src_')) return next?.();
  if (!/bash|shell|exec|command|web|fetch|http|url|request|curl/i.test(name)) return next?.();
  const args = payload?.args || payload?.input || payload?.arguments || {};
  const sessionId = payload?.sessionId || payload?.session?.id || '';
  if (!sessionId) throw new Error('[dsh-src Scope Guard] 无法确定会话，已按 fail-closed 阻止网络类工具调用');
  const view = store.view(sessionId);
  if (!view.engagement) throw new Error('[dsh-src Scope Guard] 尚未登记授权，已阻止网络类工具调用');
  const targets = collectTargets(args);
  if (!targets.length) throw new Error('[dsh-src Scope Guard] 无法解析网络目标，已按 fail-closed 阻止调用');
  for (const target of targets) {
    const result = checkScope(view.engagement, target);
    if (result.status !== 'in-scope') throw new Error(`[dsh-src Scope Guard] 目标 ${result.value || target} 状态为 ${result.status}，已阻止调用`);
  }
  return next?.();
}

function registerProtocol(ctx) {
  // dsh-system-prompt 的 section 属性格式是 {name, order, text}，不是 content。
  // interpolate() 读取 input.text，传 content 会导致 undefined.indexOf("{{") 崩溃。
  const section = { name: 'src:protocol', order: SRC_SECTION_ORDER, text: SRC_PROTOCOL_SECTION };
  const prompt = ctx.systemPrompt;
  if (typeof prompt?.section === 'function') prompt.section(section);
  else if (typeof prompt?.add === 'function') prompt.add(section);
  else if (typeof prompt?.register === 'function') prompt.register(section);
  else if (typeof prompt?.contribute === 'function') prompt.contribute(section);
}

// dsh-tools 的 render 必须返回 content blocks 数组 [{type:'text',text}]，
// 裸字符串会被 snapshotProjection 原样保留，contentHasImage 递归时对字符串调 .some() 崩溃。
const text = (s) => [{ type: 'text', text: s }];

function registerTools(ctx, store) {
  const reg = (tool) => ctx.tools.register(defineTool(tool));

  reg({
    name: 'src_start_engagement',
    description: '建立或重置一次 SRC 授权研究会话。必须登记明确授权、有效期和包含/排除范围。',
    parameters: {
      platform: { type: 'string', required: true, enum: PLATFORMS },
      scopeDomains: { type: 'array', items: { type: 'string' } },
      scopeIps: { type: 'array', items: { type: 'string' }, description: 'IP 或 CIDR' },
      scopeApps: { type: 'array', items: { type: 'string' } },
      excludedTargets: { type: 'array', items: { type: 'string' } },
      tierMap: { type: 'object', additionalProperties: true },
      authorization: { type: 'string', required: true },
      expiresAt: { type: 'string', required: true, description: 'ISO 8601 授权截止时间' },
      rulesAcknowledged: { type: 'boolean', required: true },
    },
    output: { schema: { type: 'object', additionalProperties: true }, render: (_a, v) => text(`Engagement ${v.goalId} 已建立，范围 ${v.scopeCount} 项，有效至 ${v.expiresAt}`) },
    execute: async (args, exec) => {
      if (args.rulesAcknowledged !== true) throw new Error('必须明确阅读并同意平台规则');
      const expiresAt = parseFutureDate(args.expiresAt);
      const scope = normalizeScope({
        domains: args.scopeDomains, ips: args.scopeIps, apps: args.scopeApps,
        excluded: args.excludedTargets, tierMap: args.tierMap,
      });
      const scopeCount = scope.domains.length + scope.ips.length + scope.apps.length;
      if (!scopeCount) throw new Error('至少登记一个授权域名、IP/CIDR 或 App');
      const engagement = store.startEngagement(exec.agent.session.id, {
        platform: enumValue(args.platform, 'platform', PLATFORMS), scope,
        authorization: requiredString(args.authorization, 'authorization'),
        rulesAcknowledged: true, startedAt: new Date().toISOString(), expiresAt,
      });
      return { goalId: engagement.id, scopeCount, expiresAt };
    },
  });

  reg({
    name: 'src_check_scope', description: '检查单个目标是否处于当前授权范围；所有主动验证前必须调用。',
    parameters: { target: { type: 'string', required: true } },
    output: { schema: { type: 'object', additionalProperties: true }, render: (_a, v) => text(`[${v.status}] ${v.value || v.raw}${v.matched ? `（${v.matched}）` : ''}`) },
    execute: async (args, exec) => checkScope(store.view(exec.agent.session.id).engagement, requiredString(args.target, 'target')),
  });

  reg({
    name: 'src_add_asset', description: '记录被动侦察或手工发现的资产；不会授权范围外测试。',
    parameters: {
      type: { type: 'string', required: true, enum: ASSET_TYPES }, value: { type: 'string', required: true },
      parentId: { type: 'string' }, note: { type: 'string' },
    },
    output: { schema: { type: 'object', additionalProperties: true }, render: (_a, v) => text(`资产 ${v.id} [${v.scopeStatus}] ${v.value}`) },
    execute: async (args, exec) => {
      const sessionId = exec.agent.session.id;
      const value = requiredString(args.value, 'value');
      const scope = checkScope(store.view(sessionId).engagement, value);
      const parentId = args.parentId ? concreteId(args.parentId, 'parentId', 'asset') : '';
      const node = store.addAsset(sessionId, {
        type: enumValue(args.type, 'type', ASSET_TYPES), value, parentId,
        note: optionalString(args.note), scopeStatus: scope.status, scopeMatched: scope.matched || '',
      });
      return node;
    },
  });

  reg({
    name: 'src_add_intent', description: '登记一个最小、低影响的漏洞验证方案；登记后仍需用户逐项审批。',
    parameters: {
      target: { type: 'string', required: true }, hypothesis: { type: 'string', required: true }, method: { type: 'string', required: true },
      requestBudget: { type: 'number', required: true, description: '本轮最大网络请求数，1..20' },
      stopConditions: { type: 'array', required: true, items: { type: 'string' } },
      expectedEvidence: { type: 'string', required: true }, derivedFromFactId: { type: 'string' },
    },
    output: { schema: { type: 'object', additionalProperties: true }, render: (_a, v) => text(`方案 ${v.id} 待审批：[${v.scopeStatus}] ${v.target}，预算 ${v.requestBudget} 请求`) },
    execute: async (args, exec) => {
      const sessionId = exec.agent.session.id;
      const target = requiredString(args.target, 'target');
      const scope = checkScope(store.view(sessionId).engagement, target);
      if (scope.status !== 'in-scope') throw new Error(`目标状态为 ${scope.status}，不能创建主动验证方案`);
      const budget = Number(args.requestBudget);
      if (!Number.isInteger(budget) || budget < 1 || budget > 20) throw new Error('requestBudget 必须为 1..20 的整数');
      return store.addIntent(sessionId, {
        target, scopeStatus: scope.status, hypothesis: requiredString(args.hypothesis, 'hypothesis'),
        method: requiredString(args.method, 'method'), requestBudget: budget,
        stopConditions: stringList(args.stopConditions, 'stopConditions', { min: 1 }),
        expectedEvidence: requiredString(args.expectedEvidence, 'expectedEvidence'),
        derivedFromFactId: args.derivedFromFactId ? concreteId(args.derivedFromFactId, 'derivedFromFactId', 'fact') : '',
      });
    },
  });

  reg({
    name: 'src_approve_intent', description: '记录用户对一个具体验证方案的本轮明确审批。只有用户刚刚确认了目标、方法、预算和停止条件时才调用。',
    parameters: {
      intentId: { type: 'string', required: true }, approvalStatement: { type: 'string', required: true },
      approvedByUser: { type: 'boolean', required: true },
    },
    output: { schema: { type: 'object', additionalProperties: true }, render: (_a, v) => text(`方案 ${v.id} 已审批，可开始低影响验证`) },
    execute: async (args, exec) => {
      if (args.approvedByUser !== true) throw new Error('未获得用户明确审批');
      return store.approveIntent(exec.agent.session.id, concreteId(args.intentId, 'intentId', 'intent'), {
        statement: requiredString(args.approvalStatement, 'approvalStatement'),
      });
    },
  });

  reg({
    name: 'src_update_intent', description: '更新已登记方案状态；in-progress 仅允许已审批方案。',
    parameters: { intentId: { type: 'string', required: true }, status: { type: 'string', required: true, enum: INTENT_STATES }, note: { type: 'string' } },
    output: { schema: { type: 'object', additionalProperties: true }, render: (_a, v) => text(`方案 ${v.id} → ${v.status}`) },
    execute: async (args, exec) => store.setIntentStatus(exec.agent.session.id,
      concreteId(args.intentId, 'intentId', 'intent'), enumValue(args.status, 'status', INTENT_STATES), optionalString(args.note)),
  });

  reg({
    name: 'src_add_fact', description: '向已审批 intent 写入实际观察；内容必须脱敏，不得包含凭据或真实用户数据。',
    parameters: {
      intentId: { type: 'string', required: true }, kind: { type: 'string', required: true, enum: FACT_KINDS },
      evidenceState: { type: 'string', required: true, enum: EVIDENCE_STATES }, target: { type: 'string', required: true },
      detail: { type: 'string', required: true }, evidenceRef: { type: 'string' },
    },
    output: { schema: { type: 'object', additionalProperties: true }, render: (_a, v) => text(`事实 ${v.id} [${v.evidenceState}/${v.kind}] 已记录`) },
    execute: async (args, exec) => store.addFact(exec.agent.session.id, {
      intentId: concreteId(args.intentId, 'intentId', 'intent'), kind: enumValue(args.kind, 'kind', FACT_KINDS),
      evidenceState: enumValue(args.evidenceState, 'evidenceState', EVIDENCE_STATES),
      target: requiredString(args.target, 'target'), detail: safeEvidence(args.detail), evidenceRef: optionalString(args.evidenceRef),
    }),
  });

  reg({
    name: 'src_add_finding', description: '把已审批 intent 和 confirmed 事实提升为漏洞；必须由用户人工复现。',
    parameters: {
      intentId: { type: 'string', required: true }, supportingFactIds: { type: 'array', required: true, items: { type: 'string' } },
      title: { type: 'string', required: true }, severity: { type: 'string', required: true, enum: SEVERITIES },
      category: { type: 'string', required: true }, description: { type: 'string', required: true },
      impact: { type: 'string', required: true }, remediation: { type: 'string', required: true },
      reproducibleSteps: { type: 'array', required: true, items: { type: 'string' } },
      affectedAssetIds: { type: 'array', items: { type: 'string' } }, humanReproduced: { type: 'boolean', required: true },
    },
    output: { schema: { type: 'object', additionalProperties: true }, render: (_a, v) => text(`漏洞 ${v.id} [${v.severity}] ${v.title}`) },
    execute: async (args, exec) => {
      if (args.humanReproduced !== true) throw new Error('AI 发现必须经过用户人工复现才能形成 finding');
      return store.addFinding(exec.agent.session.id, {
        intentId: concreteId(args.intentId, 'intentId', 'intent'),
        supportingFactIds: stringList(args.supportingFactIds, 'supportingFactIds', { min: 1 }).map((id) => concreteId(id, 'supportingFactIds', 'fact')),
        title: requiredString(args.title, 'title'), severity: enumValue(args.severity, 'severity', SEVERITIES),
        category: requiredString(args.category, 'category'), description: safeEvidence(args.description),
        impact: safeEvidence(args.impact), remediation: requiredString(args.remediation, 'remediation'),
        reproducibleSteps: stringList(args.reproducibleSteps, 'reproducibleSteps', { min: 1 }).map(safeEvidence),
        affectedAssetIds: (args.affectedAssetIds || []).map((id) => concreteId(String(id), 'affectedAssetIds', 'asset')),
        humanReproduced: true,
      });
    },
  });

  reg({
    name: 'src_submit', description: '子 Agent 专用：向父会话的指定已审批 intent 回写事实或资产；不能直接创建 finding。',
    parameters: {
      intentId: { type: 'string', required: true },
      facts: { type: 'array', items: { type: 'object', additionalProperties: true } }, assets: { type: 'array', items: { type: 'object', additionalProperties: true } },
    },
    output: { schema: { type: 'object', additionalProperties: true }, render: (_a, v) => text(`已向 ${v.intentId} 回写 ${v.facts} 事实 / ${v.assets} 资产`) },
    execute: async (args, exec) => {
      const child = exec.agent.session;
      const parentSessionId = child.header?.parentSession;
      if (!parentSessionId) throw new Error('src_submit 只能由子 Agent 调用');
      const intentId = concreteId(args.intentId, 'intentId', 'intent');
      const parentView = store.view(parentSessionId);
      const intent = parentView.intents.find((item) => item.id === intentId);
      if (!intent || !intent.approval) throw new Error(`父会话中不存在已审批方案 ${intentId}`);
      let assetCount = 0; let factCount = 0;
      for (const asset of Array.isArray(args.assets) ? args.assets : []) {
        if (!asset?.value) continue;
        const value = String(asset.value);
        const scope = checkScope(parentView.engagement, value);
        store.addAsset(parentSessionId, { type: ASSET_TYPES.includes(asset.type) ? asset.type : 'other', value,
          parentId: '', note: optionalString(asset.note), scopeStatus: scope.status, scopeMatched: scope.matched || '' });
        assetCount++;
      }
      for (const fact of Array.isArray(args.facts) ? args.facts : []) {
        if (!fact?.detail) continue;
        store.addFact(parentSessionId, {
          intentId, kind: FACT_KINDS.includes(fact.kind) ? fact.kind : 'observation',
          evidenceState: EVIDENCE_STATES.includes(fact.evidenceState) ? fact.evidenceState : 'candidate',
          target: optionalString(fact.target) || intent.target, detail: safeEvidence(String(fact.detail)), evidenceRef: optionalString(fact.evidenceRef),
        });
        factCount++;
      }
      try { exec.agent.session && ctx.sessions?.get?.(parentSessionId)?.append?.('tool/call', {
        turn: child.header?.turn || 0, step: projection.next(), callId: `src-submit-${projection.n}`,
        name: 'src_submit', arguments: { intentId, facts: factCount, assets: assetCount },
      }); } catch { /* storage remains authoritative */ }
      return { intentId, facts: factCount, assets: assetCount };
    },
  });

  reg({
    name: 'src_state', description: '查看当前授权、资产、方案、事实、漏洞和状态。', parameters: {},
    output: { schema: { type: 'object', additionalProperties: true }, render: (_a, v) => text(`状态：资产 ${v.counts.assets}｜方案 ${v.counts.intents}｜事实 ${v.counts.facts}｜漏洞 ${v.counts.findings}`) },
    execute: async (_args, exec) => store.view(exec.agent.session.id),
  });

  reg({
    name: 'src_graph', description: '查看探索链路的节点和边。', parameters: {},
    output: { schema: { type: 'object', additionalProperties: true }, render: (_a, v) => text(`探索图：${v.nodes.length} 节点 / ${v.edges.length} 边`) },
    execute: async (_args, exec) => {
      const view = store.view(exec.agent.session.id);
      const nodes = [
        ...(view.engagement ? [{ id: view.engagement.id, kind: 'goal', label: view.engagement.platform, status: view.engagement.status }] : []),
        ...view.assets.map((n) => ({ id: n.id, kind: 'asset', label: n.value, status: n.scopeStatus })),
        ...view.intents.map((n) => ({ id: n.id, kind: 'intent', label: n.target, status: n.status })),
        ...view.facts.map((n) => ({ id: n.id, kind: 'fact', label: n.detail.slice(0, 80), status: n.evidenceState })),
        ...view.findings.map((n) => ({ id: n.id, kind: 'finding', label: n.title, status: n.severity })),
      ];
      return { nodes, edges: view.edges };
    },
  });

  reg({
    name: 'src_report', description: '生成脱敏的 SRC 提交草稿，不自动发送。', parameters: {},
    output: { schema: { type: 'object', additionalProperties: true }, render: (_a, v) => text(`报告草稿已生成：${v.findingCount} 条漏洞，${v.byteLength} 字节`) },
    execute: async (_args, exec) => {
      const view = store.view(exec.agent.session.id); const markdown = buildReport(view);
      return { markdown, findingCount: view.findings.length, byteLength: Buffer.byteLength(markdown, 'utf8') };
    },
  });
}

function collectTargets(args) {
  if (typeof args.url === 'string') return [args.url];
  if (typeof args.command === 'string') return extractTargetsFromCommand(args.command);
  if (typeof args.query === 'string') return extractTargetsFromCommand(args.query);
  return [];
}
function parseFutureDate(value) {
  const date = new Date(requiredString(value, 'expiresAt'));
  if (Number.isNaN(date.getTime()) || date.getTime() <= Date.now()) throw new Error('expiresAt 必须是未来的 ISO 8601 时间');
  return date.toISOString();
}
function safeEvidence(value) {
  const text = requiredString(String(value), 'evidence');
  if (/(authorization|cookie|set-cookie|token|password|passwd|secret|api[-_]?key)\s*[:=]/i.test(text)) {
    throw new Error('证据疑似包含凭据或敏感字段，请脱敏后再记录');
  }
  return text;
}
const projection = { n: 0, next() { return ++this.n; } };
