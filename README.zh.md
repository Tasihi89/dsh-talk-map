# dsh-talk-map · 对话地图

[English](README.md) | 中文

DeepSeek Harness（dsh）的可视化对话地图插件：把你的每一个会话变成白板上的一张卡片。

- **空间记忆代替脑内记忆**：卡片自由摆放 + 网格吸附，位置永远不会被自动打乱——你记得"那个对话在左下角"，它就一直在左下角。为 ADHD 用户设计，对所有人有效。
- **双击即聊**：双击白板空白处，就地新建一个会话，卡片出生在你点的位置。
- **连线分叉**：从一张卡拉一根线到空白处，预览（可编辑）将要注入的上下文摘要，确认后开一个"带着旧对话记忆"的新会话。
- **卡片正面 = 恢复现场**：标题、摘要的"下一步"、相对时间、运行状态。回来扫一眼就知道该干嘛。
- **自动摘要**：会话空闲后自动生成三字段摘要（概要 / 关键结论 / 下一步），用你部署里的默认模型；卡片上的 ⟳ 可手动重生成。
- **血缘可见**：dsh 原生的 fork/子代理血缘自动画成虚线，你拉的注入线是实线。

## 安装

```sh
# npm（推荐）
dsh plugin --profile web add dsh-talk-map

# 或 GitHub（构建产物已随仓库提交，无需 allowBuilds 也能用）
dsh plugin --profile web add github:Tasihi89/dsh-talk-map
```

重启 `dsh web`，侧栏底部出现地图按钮。

## 使用

| 动作 | 效果 |
|---|---|
| 点侧栏地图按钮 / Esc | 开关地图 |
| 拖动卡片 | 摆放（16px 网格吸附，位置持久化） |
| 双击空白 | 在该位置新建会话并进入 |
| 双击卡片 | 打开该会话 |
| 从卡片右侧拉线到空白 | 预览注入上下文 → 开分叉会话 |
| 卡片上的 ⟳ | 手动重新生成摘要 |

## 数据存哪

- 画布数据（卡片位置、连线、摘要）：`$DSH_HOME/storages/talk_map.json`，走 dsh 官方 storage-domain，原子落盘。
- 会话本身：完全归 dsh 管，本插件只读会话、只在分叉时通过官方 API 创建新会话。
- 摘要生成用你配置的默认模型，走本地 dsh 的 LLM 通道；除此之外无任何外部请求。

## 兼容性

针对 deepseek-harness `0.1.0-rc.6` 开发（rc 阶段 API 可能漂移）。结构化契约集中在 `src/client/dsh.ts` 与 `src/host/dsh-host.ts`，升级排查从这两个文件开始。

## Roadmap（第三刀）

多板架子（项目=白板，WIP 上限）· 整板归档/搁置 · 时间视图（镜头飞回）· 替身卡 · 多父合并注入 UI · 选段注入 · 卡上速问 · 两周未动变暗。

## 开发

```sh
pnpm install
pnpm run build        # host → lib/，client → client/client.js
dsh plugin --profile dev add /绝对路径/dsh-talk-map
dsh --profile dev     # 配一份 profile patch 换端口即可与主实例共存
```

MIT License.
