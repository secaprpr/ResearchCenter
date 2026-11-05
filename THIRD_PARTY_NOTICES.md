# 第三方软件声明

Research Workbench 使用以下主要开源组件。完整依赖版本记录在 `package-lock.json` 中；直接运行组件的原始许可证文本保存在 [`licenses/`](./licenses/) 中，并随桌面发行版分发。

| 组件 | 版本 | 用途 | 许可证文本 |
| --- | --- | --- | --- |
| React | 19.2.8 | 用户界面 | [MIT](./licenses/react.txt) |
| React DOM | 19.2.8 | 用户界面 | [MIT](./licenses/react-dom.txt) |
| Zustand | 5.0.15 | 本地状态管理 | [MIT](./licenses/zustand.txt) |
| clsx | 2.1.1 | CSS 类名组合 | [MIT](./licenses/clsx.txt) |
| Lucide React | 0.468.0 | 界面图标 | [ISC](./licenses/lucide-react.txt) |
| Inter | 5.3.0 | 西文字体 | [SIL Open Font License 1.1](./licenses/inter-OFL.txt) |
| Source Serif 4 | 5.3.0 | 西文衬线字体 | [SIL Open Font License 1.1](./licenses/source-serif-4-OFL.txt) |
| Noto Serif SC | 5.3.0 | 简体中文衬线字体 | [SIL Open Font License 1.1](./licenses/noto-serif-sc-OFL.txt) |
| Electron | 43.4.0 | Windows 桌面运行时 | [MIT](./licenses/electron.txt)，并包含 Chromium、Node.js 等第三方组件 |

Electron 构建产物还自带 `LICENSE.electron.txt` 和 `LICENSES.chromium.html`。构建与测试使用 TypeScript、Vite、Vitest、Playwright、ESLint 和 electron-builder；它们适用各自的软件许可证。

本项目的许可证不改变上述第三方组件各自的许可证和版权归属。


## CCF 目录元数据

`src/port/data/ccf-2026.json` 提取自中国计算机学会《推荐国际学术会议和期刊目录》2026 年第七版、2026-04-09 勘误版，用于本地名称匹配。数据保留官方来源、版本和 PDF 页码；未打包原 PDF。官方发布页：https://www.ccf.org.cn/Academic_Evaluation/By_category/ 。本项目的代码许可证不改变原目录的权利归属。


## Markdown 研究笔记

Vditor 4.0.1 用于所见所得 Markdown 编辑（[MIT](./licenses/vditor.txt)），diff-match-patch 1.0.5 用于编辑历史（[Apache-2.0](./licenses/diff-match-patch.txt)）。编辑器附带的 Lute（[MulanPSL-2.0](./licenses/lute.txt)）、KaTeX（[MIT](./licenses/katex.txt)）与 Highlight.js（[BSD-3-Clause](./licenses/highlightjs.txt)）资源随应用本地打包；各组件版权与许可证保持不变。


## 研究脉络动效

Motion 14.8.0（[MIT](./licenses/motion.txt)）用于布局让位、节点增删与拖动；其 React 实现 Framer Motion 14.8.0（[MIT](./licenses/framer-motion.txt)）、Motion DOM 14.8.0（[MIT](./licenses/motion-dom.txt)）和 Motion Utils 14.7.0（[MIT](./licenses/motion-utils.txt)）随应用本地打包。各组件版权归各自作者所有。
