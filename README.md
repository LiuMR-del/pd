# PD — 拼豆图纸生成

把图片转换为拼豆（Perler / Hama / MARD 等）图纸的工具：PC 网页（同时适配手机浏览器）+ 微信小程序（uni-app）。

当前处于**阶段 1a：PC 网页 MVP**（阶段 0 算法验证已完成，见 `docs/阶段0-算法报告.md`）。

## 目录

```
packages/pattern-core/   # 算法（纯 TS、零运行时依赖），可在小程序 Worker / H5 / Node 中运行
packages/palettes/       # 色卡数据（JSON）+ 校验脚本
packages/editor-core/    # 图纸文档、编辑命令、撤销重做、用量统计、草稿序列化
packages/render/         # 图纸渲染与导出排版（标准 Canvas 2D 子集，网页 / 小程序共用）
apps/web/                # PC 网页（Vue 3 + Vite），算法在 Web Worker 里跑，作品存在浏览器 IndexedDB
tools/bench/             # 评测：测试集清单、合成图、指标脚本、本地对比页
docs/                    # 方案、任务清单、阶段报告
```

## 开发

```bash
corepack enable pnpm
pnpm install        # 安装依赖，并自动生成色卡数据 packages/palettes/data/palettes.json
pnpm palettes:sync  # 下载 MARD 色值到本机并重新生成色卡（每台电脑运行一次；不运行时用 perler-beads 色值）
pnpm -r test        # 单元测试
pnpm -r typecheck   # 类型检查
pnpm dev:web        # 本地运行网页，浏览器打开终端里显示的地址
pnpm build:web      # 打包网页到 apps/web/dist/（静态文件）
pnpm bench          # 跑评测，输出到 tools/bench/out/（需先把测试图放进 tools/bench/images/）
```

## 来源与许可证

本项目基于 [Zippland/perler-beads](https://github.com/Zippland/perler-beads) 修改，
源码地址：<https://github.com/Zippland/perler-beads>，
引入时的版本为 commit `2efee730f73dd4eb472ebde443a022d11f98bc21`（2026-05-14）。
原项目版权归原作者所有；原作者声明：请勿将其代码包装为闭源商业产品。

本项目整体以 **GNU Affero General Public License v3.0（AGPL-3.0）** 开源，全文见 [LICENSE](./LICENSE)。
依照 AGPL-3.0 第 13 条，通过网络向用户提供本程序（含修改版）服务时，须向这些用户提供对应源码。

### 隔离原则

- 所有源自 perler-beads 的代码与数据**只放在** `packages/pattern-core` 和 `packages/palettes` 两个包内。
- 每个源自 perler-beads 的文件，在文件头（JSON / CSV 等无法加注释的数据文件则在同目录的 `NOTICE.md`）注明：来源仓库、commit、原文件路径、AGPL-3.0、修改说明。
- 仓库其余代码均为本项目自研。
- 暂不接受外部 PR；如需接受，将先引入贡献者授权协议（CLA）。

### 测试图

`tools/bench/images/` 下的测试图为 CC BY 许可的第三方图片，已随仓库分发；对外展示或分发时请按 `tools/bench/images/manifest.csv` 注明作者和来源链接。人像类图片仅用于算法评测，不用于产品内素材或宣传。
