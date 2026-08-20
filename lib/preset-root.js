// preset-root 插件（可选工具）：把包内 preset/ 目录注册为 dsh 的只读 preset 根。
//
// 注意：dsh rc.6 的 composeProfile 会在运行时强制覆盖 agent-presets.config.roots
// 为仅含官方 preset 目录，且 bundle patch 中的插件行在当前版本不会被 Loader 执行。
// 因此本文件默认不被 cordis.patch.yml 引用。
//
// 自定义 preset 的官方注册方式是放入用户目录：
//   $DSH_HOME/.agent-presets/<id>/
// 使用 scripts/install.js 自动完成复制。
//
// 如果未来 dsh 版本支持通过 patch 注入 preset 根，可在 cordis.patch.yml 中添加：
//   - insert:
//       - id: src-preset-root
//         name: dsh-src/preset-root
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const inject = ['agentPresets'];

export default class DshSrcPresetRoot {
  apply(ctx) {
    const presets = ctx.agentPresets ?? ctx.get?.('agentPresets');
    if (!presets) return;
    const root = path.resolve(fileURLToPath(new URL('../preset/', import.meta.url)));
    const roots = Array.isArray(presets.resolvedRoots) ? presets.resolvedRoots : [];
    if (!roots.some((r) => r && path.resolve(r.path) === root)) {
      roots.unshift({ path: root, trust: 'system' });
    }
  }
}
