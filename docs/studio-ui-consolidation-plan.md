# Studio UI 收敛方案:侧边栏统一 + Chat 复用

> 状态:提案(待评审)
> 范围:apps/electron renderer 层。GameStudio / Design / Canvas 三个 studio 模式与 Work 主界面的 UI 架构收敛。

## 1. 背景与问题

当前四个顶层模式(work | canvas | gamestudio | design)由顶栏 `AppModeSwitcher` 切换,但三个 studio 模式在 UI 架构上各自为政:

1. **入口点击成本高**:进入指定项目需要 3-4 次点击(切模式 → 点标题开浮层 → 选项目),且进模式即自动加载最近项目(GameStudio 还会拉起 native 预览窗格),选其他项目时这次加载是纯浪费。
2. **侧边栏割裂**:Work 模式左栏约 8 个顶层条目(全部展开 18-20 行),一半是低频配置入口;studio 模式则完全隐藏侧边栏,项目列表退化为三个各自实现的模态浮层。
3. **Chat 三套复制品**:GameStudio / Design / Canvas 各自维护一个纯文本 mini chat(合计约 800 行,其中约 550-600 行为三份重复逻辑),功能远弱于主 Chat(无 markdown、无工具卡片、无停止、无附件、无权限提示)。

## 2. 现状盘点(研究结论)

### 2.1 主 Chat 栈(Work 模式)

| 文件 | 行数 | 角色 |
|---|---|---|
| `pages/ChatPage.tsx` | 840 | 页面壳:PanelHeader、会话生命周期、草稿、已读/未读 |
| `components/app-shell/ChatDisplay.tsx` | 2439 | 核心 chat 面:turn 渲染、流式、搜索、overlay、输入区 |
| `components/app-shell/input/FreeFormInput.tsx` | 2677 | 富输入:附件、@技能、斜杠命令、模型/来源选择 |
| `atoms/sessions.ts` + `App.tsx` 事件订阅 + `event-processor/` | ~3200 | 全局唯一 `onSessionEvent` 订阅 → 纯 reducer → `sessionAtomFamily` |

关键事实:

- **事件管线是全局的**:`App.tsx` 是唯一的 `onSessionEvent` 订阅者,所有 session(包括 `hidden: true` 的 studio session)只要注册进 renderer(`ensureSessionRegisteredInRenderer`),流式更新就自动落入 `sessionAtomFamily`,studio 免费可用。
- **ChatDisplay 是 prop 驱动的**:session 以 prop 传入,消息渲染原语全部来自 `@craft-agent/ui`(纯展示)。已有 `compactMode` 支持(去掉 option badges、紧凑 padding、drawer 式选择器),`EditPopover.tsx` 和 playground mobile 预览是两个已验证的嵌入先例。
- **嵌入的硬依赖**:AppShellProvider / NavigationContext / Focus 等 provider 栈——studio 页面本来就渲染在 AppShell provider 树内(经 `MainContentPanel`),全部天然满足。
- **已知坑**:`useFocusZone({ zoneId: 'chat' })` 写死,同窗口双实例会冲突(需加 zoneId prop 或 `enabled: false`);分支/导入会话动作会导航到 Work 路由(studio session 应设 `supportsBranching: false` 或禁用)。

### 2.2 三套 studio chat

| 维度 | GameStudio | Design | Canvas |
|---|---|---|---|
| 位置 | `GameStudioPage.tsx` 内联(~270 行)+ `lib/gamestudio-chat.ts`(138) | `DesignChatPanel.tsx`(278)+ `lib/design-chat.ts`(166) | `CanvasChatPanel.tsx`(227),无 lib |
| session 创建 | hidden + workingDirectory + preset `gamestudio` | hidden + workingDirectory + preset `design` | hidden + 命名,无 preset/workingDirectory |
| 事件处理 | 裸 `onSessionEvent`,5 种事件 | 同左 + tool_start/result(驱动预览刷新) | 裸 `onSessionEvent`,5 种事件 |
| 消息存储 | 本地 useState | 本地 useState | 本地 useState,**不恢复历史** |
| UI | 纯文本,无停止/附件/markdown | 同左 | 同左 + 选区上下文前缀、关闭按钮 |

函数级重复(节选,详见研究记录):

- `appendAssistantDelta` / `replaceAssistantText`:3-4 份拷贝
- `sessionMessagesTo*ChatMessages`、`build*SessionCreateOptions`、`resolve*ProjectDir`:gamestudio 与 design 的 lib 逐字节雷同(仅类型名/字面量不同),lib 文件约 85% 互为拷贝
- `ensureSession`(验证-复用-创建-持久化-回滚)三份,GameStudio 内部还自我重复一次(EmptyState 创建路径)
- `create*PreviewRefreshScheduler`、私有路径工具函数(`normalizePath` 等 5 个)成套复制
- `gameToolInputTouchesProject` / `extractGameToolPaths` 是死代码(GameStudio 实际走主进程文件监听)

必须保留的 studio 差异(收敛后作为参数/回调注入):

- **GameStudio**:preset、`skillSlugs: ['gameblocks']`、运行时错误自动修复(30s 冷却的 prompt 注入)、`complete` 时 checkpoint + 缩略图、主进程文件监听驱动预览刷新
- **Design**:preset、tool_result 路径匹配 → 预览刷新、严格回滚 + toast 的 sessionId 持久化
- **Canvas**:每 doc 一个命名 session、选区上下文前缀、面板可关闭

### 2.3 Shell 布局与侧边栏

- `PanelStackContainer` 有三个槽:sidebarSlot(220px)/ navigatorSlot(300px)/ 内容面板栈。studio 路由并非结构上绕过面板系统,而是被 `isFullBleedRoute` **策略性**隐藏了前两个槽(且隐藏逻辑在 AppShell:600 与 PanelStackContainer `resolvePanelChromeHidden` **两处重复实施**,`nav-helpers.ts` 的 compact 判断是第三处)。
- navigatorSlot 按 `navState.navigator` 分支渲染 `SessionList` / `SourcesListPanel` / `SkillsListPanel` / `AutomationsListPanel`,**没有 studio 分支**(所以才必须隐藏)。
- 可复用性结论:
  - `EntityList`(`components/ui/entity-list.tsx`)是正确的通用原语,Sources/Skills/Automations 列表都是它的薄封装,项目列表照抄该模式即可;
  - `NavigatorPanel` 是现成的通用包装组件,目前实际无人使用,可直接采用;
  - `SessionList`(831 行)深度绑定 session 语义,**不**复用于项目列表;
  - 数据无需新管道:`canvasDocsAtom` / `gamestudioProjectsAtom` / `designProjectsAtom` 已在 AppShell 全局镜像并保持 live(但那三段镜像 effect 本身是逐字重复,应抽 hook)。
- 三个 studio 页面各自实现了与 navigator 等价的"项目/文档列表"浮层:`ProjectPickerOverlay` / `DesignProjectGallery` / `DocPickerOverlay`,互为重复。

## 3. 目标架构

```text
TopBar: [workspace] [AppModeSwitcher(带最近项目下拉)] [...]
┌───────────┬──────────────┬──────────────────────────────┐
│ sidebar   │ navigator    │ content panels               │
│ (Work 专属│ 模式感知:    │ Work: ChatPage               │
│  且瘦身,  │  work→会话   │ Studio: 预览/画布            │
│  studio   │  studio→项目 │   + 内嵌 ChatDisplay         │
│  下隐藏)  │  列表(Entity │     (compactMode)            │
│           │  List)       │                              │
└───────────┴──────────────┴──────────────────────────────┘
```

- **一套 chat**:studio 侧栏 chat 直接嵌入 `ChatDisplay`(compactMode),session 生命周期收敛为一个共享 hook。
- **一套导航**:navigatorSlot 增加 studio 分支显示项目列表,三个浮层退役;侧边栏仅 Work 模式显示且瘦身。
- **一套工具库**:gamestudio/design/canvas 的 chat lib 与 atoms 合并为泛型工厂。

## 4. 实施方案(分四个阶段,可独立交付)

### Phase 1:纯重构,零 UI 变化(低风险,先行)

1. **抽共享 studio-chat lib**:新建 `lib/studio-chat.ts`(或 `lib/project-chat.ts`):
   - `resolveProjectDir(root, subdir, id)`、`buildProjectSessionCreateOptions({ preset, projectDir, name? })`
   - `sessionMessagesToChatMessages`、`appendAssistantDelta` / `replaceAssistantText`
   - `createPreviewRefreshScheduler`、路径工具族、`toolInputTouchesProject`(统一到 design 版本,删除 gamestudio 死代码)
   - 三个 lib 文件改为对它的薄再导出或直接删除,测试随迁。
2. **抽 `useWorkspaceCollectionMirror` hook**:替换 AppShell ~960-1032 三段逐字重复的镜像 effect。
3. **抽泛型 project-collection atoms 工厂**:合并 `atoms/gamestudio.ts` 与 `atoms/design.ts` 的 `pendingRename` / `mostRecent*` / `sortByUpdatedAtDesc` / sessionId 缓存 atom(三个 `*ChatSessionIdsAtom` 同形)。
4. **抽 `useProjectChatSession(adapter)` hook**:统一三份 `ensureSession`(验证-复用-创建-持久化-回滚)与历史加载 effect。adapter 注入:create options、持久化函数(`gameProjectUpdate` / `designProjectUpdate` / `canvasUpdate`)、回滚策略、事件钩子(`onTurnComplete`、tool_result 回调)。同时消除 GameStudio EmptyState 里的第四份创建拷贝。

### Phase 2:studio chat 升级为 ChatDisplay(核心收益)

以 `EditPopover` 为嵌入范本,每个面板约 100-150 行胶水:

1. `ChatDisplay` 增加 `focusZoneId?: string` prop(默认 `'chat'`),解决双实例焦点冲突。
2. 新建 `components/studio/StudioChatPanel.tsx`:
   - 用 Phase 1 的 `useProjectChatSession` 拿到 sessionId → `ensureSessionRegisteredInRenderer` + `ensureSessionMessagesLoadedAtom` + `useSession(id)`
   - 渲染 `<ChatDisplay session compactMode placeholder emptyStateLabel onSendMessage .../>`
   - props 承载 studio 差异:`sendDecorator`(GameStudio 加 skillSlugs、Canvas 加选区前缀)、`headerExtra`(Canvas 关闭按钮/选区计数)、queued prompt 注入口(GameStudio 自动修复)。
3. 三个面板迁移后删除各自的消息 useState、裸 `onSessionEvent` 订阅与纯文本渲染。studio session 设 `supportsBranching: false`(或等价 flag)避免导航逃逸到 Work 路由。
4. 收益:studio chat 立即获得 markdown、工具活动卡、停止/中断、权限与凭据提示、附件;Canvas 顺带获得历史恢复(行为变化,可接受,见 §6)。

### Phase 3:navigator 模式感知,浮层退役

采用研究中的 Option A(保持侧边栏在 studio 下隐藏,只恢复 navigator):

1. 拆分"full-bleed"语义:`lib/full-bleed-routes.ts` 区分"隐藏 sidebar"与"隐藏 navigator";studio 路由只隐藏 sidebar。**三处联动必须同改**:AppShell:600 附近、`PanelStackContainer` 的 `resolvePanelChromeHidden`、`nav-helpers.ts` 的 `isDetailNavState`(studio case 从恒 true 改为 `details !== null`,compact 模式获得真实的列表→详情滑动)。
2. AppShell navigatorSlot 增加三个分支:`GameProjectsListPanel` / `DesignProjectsListPanel` / `CanvasDocsListPanel`,全部基于 `EntityList`(参照 `SkillsListPanel`),包装用现成的 `NavigatorPanel`。数据来自既有 atoms;行点击 → `navigate(routes.view.gamestudio(id))` 等;header "+" 复用创建逻辑(创建/重命名/删除 helper 从页面移入共享模块,Phase 1 的 atoms 工厂已备好)。
3. `ProjectPickerOverlay` / `DesignProjectGallery` / `DocPickerOverlay` 退役(过渡期可保留为次要入口,一个版本后删除)。
4. `AppModeSwitcher` 增强为 split target:点击 = 现行为;hover/箭头展开「最近 5 个项目 + 新建」菜单,指定项目 2 击直达,避免先加载错项目。

### Phase 4:Work 侧边栏瘦身(独立可选)

1. 侧边栏保留:New Session、All Sessions(状态/Flagged/Archived)、Labels/Views。
2. Sources / Skills / Automations 收敛进 Settings 分组页(`routes.view.settings(subpage)` 机制现成),或合并为单一「资源库」条目;navigatorSlot 对应分支保留,入口位置变化不影响列表实现。
3. What's New 移入 Settings 底部或 TopBar 帮助菜单,保留未读红点。

## 5. 工作量与依赖

| 阶段 | 预估 | 依赖 | 风险 |
|---|---|---|---|
| Phase 1 | 2-3 天 | 无 | 低(纯重构,测试已有基础:design-chat.test.ts 等) |
| Phase 2 | 3-5 天 | Phase 1 | 中(焦点区、权限提示接线、GameStudio 自动修复回归) |
| Phase 3 | 3-4 天 | 无硬依赖,建议在 2 后 | 中(隐藏逻辑三处联动;compact 模式回归) |
| Phase 4 | 1-2 天 | 无 | 低(纯信息架构调整 + i18n 五语言文案) |

## 6. 风险与注意事项

1. **在途变更冲突**:工作区当前有大量未提交的 gamestudio/design 改动(game-server-manager、game-pane、gamestudio RPC 等),Phase 1/2 动同一批文件,需先落地或协调在途工作。
2. **焦点系统**:`useFocusZone('chat')` 双实例冲突是 Phase 2 的第一个前置修改,必须先行。
3. **行为变化清单**(需产品确认):Canvas chat 将恢复历史消息(原设计"deliberately minimal");studio 进入 compact 模式后有列表→详情两级导航;浮层退役。
4. **隐藏逻辑三处重复**:Phase 3 若只改一处,会出现 navigator 宽度动画到 0 或 compact 模式错乱;建议顺手把判定收敛为单一来源(`resolvePanelChromeHidden` 作为唯一裁决点)。
5. **性能**:ChatDisplay 比纯文本面板重;compactMode + 反向分页(默认末 20 turns)已缓解,GameStudio 侧需验证与 native 游戏窗格并存时的帧率。
6. **i18n**:新增文案需同步 en/de/es/... 全部 locale 文件(仓库惯例)。

## 7. 验收标准

- 三个 studio chat 面板均由 `StudioChatPanel`(内嵌 ChatDisplay)驱动,`lib/gamestudio-chat.ts` 与 `lib/design-chat.ts` 的重复函数归零。
- studio 模式下 navigator 显示项目/文档列表,任意项目 2 击可达(顶栏模式 → 列表项)。
- `bun test`(含 nav-helpers、panel-stack-full-bleed、design-chat、gamestudio 相关既有测试)全绿;typecheck / lint 通过。
- Work 模式侧边栏顶层条目 ≤ 5(Phase 4 完成后)。
