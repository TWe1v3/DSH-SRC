import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import net from 'node:net';

export const FACT_KINDS = ['observation', 'evidence', 'vuln-candidate', 'negative'];
export const EVIDENCE_STATES = ['candidate', 'confirmed', 'disproved'];
export const INTENT_STATES = ['planned', 'approved', 'in-progress', 'confirmed', 'disproved', 'blocked'];
export const SEVERITIES = ['critical', 'high', 'medium', 'low', 'info'];
export const ASSET_TYPES = ['domain', 'subdomain', 'ip', 'port', 'url', 'endpoint', 'app', 'other'];
export const PLATFORMS = ['kuaishou', 'tencent', 'alibaba', 'bytedance', '360', 'other'];

export function dshHome() {
  return process.env.DSH_HOME || path.join(os.homedir(), '.dsh');
}

function emptySession() {
  return {
    schemaVersion: 2,
    engagement: null,
    assets: [],
    intents: [],
    facts: [],
    findings: [],
    edges: [],
    counters: {},
    updatedAt: nowIso(),
  };
}

export class SrcStore {
  constructor(file = path.join(dshHome(), 'storages', 'src-sessions.json')) {
    this.file = file;
    this.data = { schemaVersion: 2, sessions: {} };
    this.#load();
  }

  #load() {
    try {
      const parsed = JSON.parse(fs.readFileSync(this.file, 'utf8'));
      if (parsed && typeof parsed === 'object' && parsed.sessions) {
        this.data = { schemaVersion: 2, ...parsed };
      }
    } catch {
      // First run or unreadable legacy state: start from an empty in-memory store.
    }
  }

  #save() {
    fs.mkdirSync(path.dirname(this.file), { recursive: true });
    const tmp = `${this.file}.${process.pid}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(this.data, null, 2), { mode: 0o600 });
    fs.renameSync(tmp, this.file);
  }

  session(id, { create = true } = {}) {
    if (!this.data.sessions[id] && create) this.data.sessions[id] = emptySession();
    return this.data.sessions[id] || null;
  }

  allSessions() {
    return this.data.sessions;
  }

  nextId(session, kind) {
    session.counters[kind] = (session.counters[kind] || 0) + 1;
    return `${kind}-${session.counters[kind]}`;
  }

  startEngagement(sessionId, engagement) {
    const s = emptySession();
    const goalId = this.nextId(s, 'goal');
    s.engagement = { id: goalId, status: 'active', ...engagement };
    this.data.sessions[sessionId] = s;
    this.#touchAndSave(s);
    return s.engagement;
  }

  addAsset(sessionId, input) {
    const s = this.#active(sessionId);
    if (input.parentId) this.requireNode(s, 'asset', input.parentId);
    const existing = s.assets.find((a) => a.type === input.type && a.value === input.value);
    if (existing) return existing;
    const node = { id: this.nextId(s, 'asset'), ...input, createdAt: nowIso() };
    s.assets.push(node);
    s.edges.push({ from: input.parentId || s.engagement.id, to: node.id, kind: input.parentId ? 'parent' : 'contains' });
    this.#touchAndSave(s);
    return node;
  }

  addIntent(sessionId, input) {
    const s = this.#active(sessionId);
    const parentId = input.derivedFromFactId || s.engagement.id;
    if (input.derivedFromFactId) this.requireNode(s, 'fact', input.derivedFromFactId);
    const duplicate = s.intents.find((i) =>
      !['confirmed', 'disproved', 'blocked'].includes(i.status) &&
      normalize(i.target) === normalize(input.target) && normalize(i.method) === normalize(input.method));
    if (duplicate) throw new Error(`重复假设：${duplicate.id} 正在验证同一目标和方法`);
    const node = {
      id: this.nextId(s, 'intent'),
      status: 'planned',
      approval: null,
      ...input,
      createdAt: nowIso(),
      updatedAt: nowIso(),
    };
    s.intents.push(node);
    s.edges.push({ from: parentId, to: node.id, kind: input.derivedFromFactId ? 'derived_from' : 'spawns' });
    this.#touchAndSave(s);
    return node;
  }

  approveIntent(sessionId, intentId, approval) {
    const s = this.#active(sessionId);
    const intent = this.requireNode(s, 'intent', intentId);
    if (intent.scopeStatus !== 'in-scope') throw new Error(`假设 ${intentId} 的目标不在授权范围内`);
    if (!['planned', 'approved'].includes(intent.status)) throw new Error(`假设 ${intentId} 当前状态 ${intent.status} 不可审批`);
    intent.status = 'approved';
    intent.approval = { ...approval, approvedAt: nowIso() };
    intent.updatedAt = nowIso();
    this.#touchAndSave(s);
    return intent;
  }

  setIntentStatus(sessionId, intentId, status, note = '') {
    const s = this.#active(sessionId);
    const intent = this.requireNode(s, 'intent', intentId);
    if (!INTENT_STATES.includes(status)) throw new Error(`未知 intent 状态：${status}`);
    if (status === 'in-progress' && !intent.approval) throw new Error(`假设 ${intentId} 尚未获得本轮人工审批`);
    intent.status = status;
    intent.statusNote = note;
    intent.updatedAt = nowIso();
    this.#touchAndSave(s);
    return intent;
  }

  addFact(sessionId, input) {
    const s = this.#active(sessionId);
    const intent = this.requireNode(s, 'intent', input.intentId);
    if (!intent.approval) throw new Error(`假设 ${input.intentId} 尚未审批，不能写入验证证据`);
    const node = { id: this.nextId(s, 'fact'), ...input, createdAt: nowIso() };
    s.facts.push(node);
    s.edges.push({ from: input.intentId, to: node.id, kind: 'yields' });
    this.#touchAndSave(s);
    return node;
  }

  addFinding(sessionId, input) {
    const s = this.#active(sessionId);
    const intent = this.requireNode(s, 'intent', input.intentId);
    if (!intent.approval) throw new Error(`假设 ${input.intentId} 尚未审批`);
    const supportingFacts = input.supportingFactIds.map((id) => this.requireNode(s, 'fact', id));
    if (supportingFacts.some((f) => f.intentId !== input.intentId)) throw new Error('支撑事实必须属于同一个 intent');
    if (!supportingFacts.some((f) => f.evidenceState === 'confirmed')) throw new Error('至少需要一条 confirmed 支撑事实');
    for (const id of input.affectedAssetIds) this.requireNode(s, 'asset', id);
    const node = {
      id: this.nextId(s, 'finding'),
      status: 'confirmed',
      ...input,
      createdAt: nowIso(),
    };
    s.findings.push(node);
    s.edges.push({ from: input.intentId, to: node.id, kind: 'proves' });
    for (const factId of input.supportingFactIds) s.edges.push({ from: factId, to: node.id, kind: 'supports' });
    intent.status = 'confirmed';
    intent.updatedAt = nowIso();
    this.#touchAndSave(s);
    return node;
  }

  view(sessionId) {
    const s = this.session(sessionId);
    return {
      ...s,
      counts: {
        assets: s.assets.length,
        intents: s.intents.length,
        facts: s.facts.length,
        findings: s.findings.length,
      },
    };
  }

  requireNode(session, kind, id) {
    const map = { asset: 'assets', intent: 'intents', fact: 'facts', finding: 'findings' };
    const collection = map[kind];
    const node = collection ? session[collection].find((item) => item.id === id) : null;
    if (!node) throw new Error(`${kind} ${id} 不存在`);
    return node;
  }

  #active(sessionId) {
    const s = this.session(sessionId);
    if (!s.engagement || s.engagement.status !== 'active') throw new Error('尚未建立有效 engagement');
    if (s.engagement.expiresAt && Date.parse(s.engagement.expiresAt) <= Date.now()) throw new Error('engagement 授权已过期');
    return s;
  }

  #touchAndSave(session) {
    session.updatedAt = nowIso();
    this.#save();
  }
}

export function normalizeScope(input = {}) {
  return {
    domains: uniqueStrings(input.domains).map(normalizeDomainPattern),
    ips: uniqueStrings(input.ips),
    apps: uniqueStrings(input.apps),
    excluded: uniqueStrings(input.excluded),
    tierMap: input.tierMap && typeof input.tierMap === 'object' ? input.tierMap : {},
  };
}

export function classifyTarget(target) {
  const raw = requiredString(target, 'target');
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(raw)) {
    try {
      const url = new URL(raw);
      return { raw, kind: net.isIP(url.hostname) ? 'ip' : 'domain', value: stripIpv6Brackets(url.hostname).toLowerCase() };
    } catch {
      return { raw, kind: 'unknown', value: raw };
    }
  }
  const unwrapped = stripIpv6Brackets(raw);
  if (net.isIP(unwrapped)) return { raw, kind: 'ip', value: unwrapped };
  if (/^[a-z0-9.-]+(?::\d+)?$/i.test(raw)) {
    const host = raw.replace(/:\d+$/, '').replace(/\.$/, '').toLowerCase();
    if (net.isIP(host)) return { raw, kind: 'ip', value: host };
    if (host.includes('.') || host === 'localhost') return { raw, kind: 'domain', value: host };
  }
  return { raw, kind: 'app', value: raw };
}

export function checkScope(engagement, target) {
  const parsed = classifyTarget(target);
  if (!engagement || engagement.status !== 'active') return { status: 'unknown', ...parsed, reason: '尚未建立有效 engagement' };
  if (engagement.expiresAt && Date.parse(engagement.expiresAt) <= Date.now()) return { status: 'unknown', ...parsed, reason: 'engagement 授权已过期' };
  const scope = normalizeScope(engagement.scope);
  if (scope.excluded.some((rule) => targetMatches(parsed, rule))) {
    return { status: 'excluded', ...parsed, reason: `命中排除规则` };
  }
  const candidates = parsed.kind === 'domain' ? scope.domains : parsed.kind === 'ip' ? scope.ips : scope.apps;
  const matched = candidates.find((rule) => targetMatches(parsed, rule));
  if (matched) return { status: 'in-scope', ...parsed, matched, tier: scope.tierMap[matched] || '' };
  return { status: 'out-of-scope', ...parsed, reason: `${parsed.value} 不在当前授权范围内` };
}

export function targetMatches(parsed, rule) {
  const value = parsed.value.toLowerCase();
  const pattern = String(rule).trim().toLowerCase();
  if (!pattern) return false;
  if (parsed.kind === 'domain') {
    if (pattern.startsWith('*.')) {
      const base = pattern.slice(2);
      return value !== base && value.endsWith(`.${base}`);
    }
    return value === pattern.replace(/\.$/, '');
  }
  if (parsed.kind === 'ip') return ipMatches(value, pattern);
  return value === pattern;
}

function ipMatches(ip, rule) {
  if (!rule.includes('/')) return ip === stripIpv6Brackets(rule);
  const [network, prefixText] = rule.split('/');
  const version = net.isIP(ip);
  if (!version || net.isIP(network) !== version) return false;
  const prefix = Number(prefixText);
  const max = version === 4 ? 32 : 128;
  if (!Number.isInteger(prefix) || prefix < 0 || prefix > max) return false;
  const a = ipToBigInt(ip, version);
  const b = ipToBigInt(network, version);
  const shift = BigInt(max - prefix);
  return (a >> shift) === (b >> shift);
}

function ipToBigInt(ip, version) {
  if (version === 4) return ip.split('.').reduce((n, part) => (n << 8n) + BigInt(part), 0n);
  const [leftRaw, rightRaw = ''] = ip.toLowerCase().split('::');
  const left = leftRaw ? leftRaw.split(':') : [];
  const right = rightRaw ? rightRaw.split(':') : [];
  const fill = Array(Math.max(0, 8 - left.length - right.length)).fill('0');
  return [...left, ...fill, ...right].reduce((n, part) => (n << 16n) + BigInt(parseInt(part || '0', 16)), 0n);
}

export function extractTargetsFromCommand(command) {
  if (typeof command !== 'string') return [];
  const targets = new Set();
  for (const match of command.matchAll(/\b(?:https?:\/\/)?([a-z0-9][a-z0-9.-]*\.[a-z]{2,})(?::\d+)?\b/gi)) targets.add(match[1].toLowerCase());
  for (const match of command.matchAll(/\b(?:\d{1,3}\.){3}\d{1,3}\b/g)) targets.add(match[0]);
  return [...targets].filter((target) => !isToolingTarget(target));
}

const TOOLING_DOMAINS = ['github.com', 'githubusercontent.com', 'npmjs.com', 'registry.npmjs.org', 'nodejs.org', 'pypi.org', 'python.org', 'deepseek.com'];
function isToolingTarget(target) {
  return TOOLING_DOMAINS.some((domain) => target === domain || target.endsWith(`.${domain}`));
}

export function requiredString(value, field) {
  if (typeof value !== 'string' || !value.trim()) throw new Error(`参数 ${field} 必须是非空字符串`);
  return value.trim();
}
export function optionalString(value) { return typeof value === 'string' ? value.trim() : ''; }
export function enumValue(value, field, allowed) {
  if (!allowed.includes(value)) throw new Error(`参数 ${field} 必须是 ${allowed.join(' / ')} 之一`);
  return value;
}
export function stringList(value, field, { min = 0 } = {}) {
  if (!Array.isArray(value)) throw new Error(`参数 ${field} 必须是字符串数组`);
  const result = value.map((item) => requiredString(String(item), field));
  if (result.length < min) throw new Error(`参数 ${field} 至少需要 ${min} 项`);
  return result;
}
export function concreteId(value, field, prefix = '') {
  const id = requiredString(value, field);
  if (!/^[a-z]+-\d+$/.test(id) || (prefix && !id.startsWith(`${prefix}-`))) throw new Error(`${field} 必须是真实的 ${prefix || '节点'} id`);
  return id;
}
function uniqueStrings(value) { return [...new Set((Array.isArray(value) ? value : []).map((item) => String(item).trim()).filter(Boolean))]; }
function normalizeDomainPattern(value) { return value.toLowerCase().replace(/\.$/, ''); }
function stripIpv6Brackets(value) { return value.replace(/^\[|\]$/g, ''); }
function normalize(value) { return String(value).trim().toLowerCase(); }
function nowIso() { return new Date().toISOString(); }
