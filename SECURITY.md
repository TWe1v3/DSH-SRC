# 安全策略

## 报告漏洞

如果你在 dsh-src 中发现安全漏洞，请**不要**在公开 Issue 中披露。

请通过 GitHub 的 [Security Advisories](https://github.com/TWe1v3/DSH-SRC/security/advisories) 私密报告。

## 安全设计原则

dsh-src 的核心设计目标是**安全可控**：

1. **Fail-closed**：Scope Guard 在无法确定目标范围时默认阻止，而非放行
2. **最小权限**：子 Agent 只能访问指定的已审批 intent，工具集受限
3. **人工门禁**：漏洞确认必须人工复现，AI 不能自行升级
4. **数据最小化**：证据记录经过脱敏检查，禁止凭据/Token 入库
5. **本地优先**：UI 无外部 CDN，默认只绑定 127.0.0.1

##  scope

安全问题包括但不限于：

- Scope Guard 绕过
- 审批门禁绕过
- 证据脱敏检查绕过
- 持久化数据注入

以下不属于安全漏洞：

- 在未安装 dsh-src 的环境中进行的测试
- 用户主动关闭 Scope Guard 后的行为
- 平台规则本身的变更
