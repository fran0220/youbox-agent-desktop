---
name: 技能构建器
description: >
  创建和管理 Agent 技能包。
  创建和管理 Agent 技能包。当用户要求创建技能、新建 skill、编写 SKILL.md 时使用。Triggers on: 创建技能, 新建skill, create skill, build skill.
---

# 技能构建器

帮助用户创建、安装和管理 Agent 技能包。

## 技能结构

每个技能需要一个 `SKILL.md` 文件，包含 YAML frontmatter：

```markdown
---
name: my-skill-name
description: Does X when Y happens. Use for Z tasks.
---

# Skill Title

Instructions go here.
```

## Frontmatter 要求

### name (必需)
- 最多 64 个字符
- 仅使用小写字母 (a-z)、数字 (0-9) 和连字符
- 不能以连字符开头或结尾，不能连续连字符
- 必须与父目录名一致
- 使用动名词形式：`processing-pdfs`、`analyzing-data`

### description (必需)
- 最多 1024 个字符（尽量简短）
- 第三人称描述（"处理文件" 而非 "我处理文件"）
- 同时说明技能做什么 AND 何时触发
- 包含关键词便于发现
- 如果包含冒号或特殊字符，用引号包裹

**好的描述：**
- "从 PDF 文件中提取文本和表格。当需要读取或编辑 PDF 时使用。"
- "查询 BigQuery 数据集。用于数据分析、SQL 查询任务。"

### 可选字段
- `allowed-tools`: 技能可使用的工具列表
- `argument-hint`: 参数提示

## 目录结构

### 简单技能（仅说明）
```
my-skill/
└── SKILL.md
```

### 带脚本的技能
```
my-skill/
├── SKILL.md
└── scripts/
    └── my-script.sh
```

### 复杂技能（渐进式加载）
```
my-skill/
├── SKILL.md           # 概览，500 行以内
├── reference/
│   ├── api.md         # 详细 API 文档
│   └── examples.md    # 代码示例
└── scripts/
    └── validate.py    # 可执行脚本
```

## 创建技能的工作流

### 技能存放位置

用户技能安装到 `$USER_SKILLS_DIR`（默认 `~/.jacoworks/skills/`）。

### 创建步骤

```
步骤 1: 询问技能用途和名称
步骤 2: 在 $USER_SKILLS_DIR 下创建 <name>/ 目录
步骤 3: 编写 SKILL.md (frontmatter + 说明)
步骤 4: 如需脚本，创建 scripts/ 目录
步骤 5: 运行同步脚本持久化到云端:
        bash scripts/sync-skill.sh <name>
        (脚本位于本技能的 scripts/ 目录)
步骤 6: 提示用户新建会话以加载新技能
```

> **重要**: 步骤 5 不可省略！不同步到云端的话，容器重建后技能会丢失。

### 同步脚本路径

同步脚本在本技能的 `scripts/` 目录下。获取绝对路径的方式：

```bash
# 找到本技能目录（在 builtin skills 路径中搜索）
SKILL_SCRIPTS=$(find /home/agent/.jacoworks/skills -path "*/building-skills/scripts" -type d 2>/dev/null | head -1)

# 同步创建/更新
bash "$SKILL_SCRIPTS/sync-skill.sh" <skill-id>

# 同步删除
bash "$SKILL_SCRIPTS/delete-skill.sh" <skill-id>
```

### 从 GitHub 安装技能

```
步骤 1: 使用 web_fetch 或 git clone 获取仓库内容
步骤 2: 找到 SKILL.md 文件，验证 frontmatter 格式
步骤 3: 将整个技能目录复制到 $USER_SKILLS_DIR
步骤 4: 运行 sync-skill.sh <name> 同步到云端
步骤 5: 提示用户新建会话以加载新技能
```

### 删除技能

```
步骤 1: 运行 delete-skill.sh <name> 从云端删除
步骤 2: 删除本地目录 rm -rf $USER_SKILLS_DIR/<name>
步骤 3: 提示用户新建会话以生效
```

## 编写有效说明

### 应该
- 以清晰的一行摘要开头
- 列出具体能力
- 提供分步工作流
- 包含具体示例
- 用执行意图引用脚本："运行 `scripts/validate.py` 来检查..."

### 避免
- 解释模型已知的概念
- 冗长的介绍或总结
- 在主要部分包含时效性信息
- 使用抽象示例

## 渐进式加载

技能分阶段加载以节省上下文：

1. **Level 1 - 元数据**：启动时加载名称 + 描述（~100 tokens）
2. **Level 2 - 说明**：触发时加载 SKILL.md 正文（<5k tokens）
3. **Level 3 - 资源**：需要时才加载额外文件

保持 SKILL.md 在 500 行以内，大内容拆分到单独文件。
