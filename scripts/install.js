#!/usr/bin/env node
// dsh-src 安装脚本：把 preset/src 复制到 dsh 用户 preset 目录。
//
// 用法：
//   node scripts/install.js                  # 复制到 ~/.dsh/.agent-presets/src/
//   node scripts/install.js --uninstall      # 删除已复制的 preset
//
// dsh 的 agent-presets 服务默认扫描 $DSH_HOME/.agent-presets/（includeUserRoot），
// 这是官方支持的自定义 preset 注册方式。
import { cpSync, rmSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const presetSrc = path.resolve(__dirname, '../preset/src');
const dshHome = process.env.DSH_HOME || join(homedir(), '.dsh');
const presetDest = join(dshHome, '.agent-presets', 'src');

const uninstall = process.argv.includes('--uninstall');

if (uninstall) {
  if (existsSync(presetDest)) {
    rmSync(presetDest, { recursive: true, force: true });
    console.log(`[dsh-src] 已删除 ${presetDest}`);
  } else {
    console.log(`[dsh-src] ${presetDest} 不存在，无需删除`);
  }
  process.exit(0);
}

if (!existsSync(presetSrc)) {
  console.error(`[dsh-src] 错误：找不到 preset 源目录 ${presetSrc}`);
  process.exit(1);
}

cpSync(presetSrc, presetDest, { recursive: true, force: true });
console.log(`[dsh-src] preset 已复制到 ${presetDest}`);
console.log('[dsh-src] 重启 dsh web 后，新建会话即可选择「SRC挖洞模式」');
