# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.2.0] - 2026-08-19

### Added
- 探索图可视化：交互式卡片看板，支持自由拖拽、边实时跟随、一键重置布局
- Web UI 客户端插件：在 dsh web 会话视图中注册「探索图」标签页
- 12 个 SRC 工具：engagement、scope check、asset、intent、fact、finding、report
- Fail-closed Scope Guard：网络类工具调用前自动检查目标范围
- 逐方案审批门禁：每个 intent 需用户本轮明确审批
- 受控子 Agent 委派：只能处理指定 intent，只能回写资产和事实
- 证据脱敏检查：禁止凭据/Token 入库
- 离线平台规则参考：快手、腾讯、阿里、360、行业通用规范
- 漏洞报告模板：脱敏 Markdown 草稿

### Security
- 授权过期后主动操作被阻止
- 排除规则优先于包含规则
- AI 不能单独把候选提升为 finding

## [0.1.0] - 2026-08-18

### Added
- 初始版本：核心状态机和工具集
