# 科研工作台 CLI

让 Codex 或其他本机终端直接查询、补齐课题与节点，追加或修正进展记录。写入使用运行中桌面应用的同一份状态和校验逻辑，界面立即更新。

桌面应用需要运行。首次更新此功能后须重启桌面主进程；普通界面刷新不会启动主进程接口。打开课题或节点的更多菜单 → **CLI 接入** → **复制给 Codex**，可得到带当前课题/节点 ID 和准确命令路径的指令。

## 入口

在此仓库中：

```powershell
node E:\codex\Research-Workbench\electron\research-cli.cjs status
node E:\codex\Research-Workbench\electron\research-cli.cjs schema
node E:\codex\Research-Workbench\electron\research-cli.cjs topics list
```

也可使用 `npm run cli -- topics list`。程序调用建议直接运行 Node 入口，避免 npm 的附加输出。命令成功时向标准输出返回 JSON；失败时向标准错误返回 JSON，退出码为 1。

默认从当前用户目录下 `.research-workbench/cli.json` 发现运行中的实例。每个桌面配置目录也有独立的 `research-cli.json`；使用 `--connection <文件>` 或环境变量 `RW_CLI_CONNECTION_FILE` 指定实例。复制的 Codex 指令会绑定当前实例，不会混用其他配置的数据。

连接只监听 `127.0.0.1` 的随机端口。连接文件包含本地凭据，不要提交到仓库或粘贴给远端服务；命令结果不包含该凭据。退出时清理连接，重启后自动轮换。CLI 不执行任意系统命令，不提供删除操作。

## 查询

```powershell
node electron/research-cli.cjs catalog
node electron/research-cli.cjs topics list --search "食管癌"
node electron/research-cli.cjs topics get TOPIC_ID
node electron/research-cli.cjs nodes list --topic TOPIC_ID
node electron/research-cli.cjs nodes get NODE_ID --topic TOPIC_ID
```

`catalog` 返回工作区、可用标签、字段模板与状态值。名称仅用于搜索，写入应使用返回的准确 ID。课题默认排除已归档项；查询时可使用 `--archived`。

## 创建节点和补齐内容

将 UTF-8 JSON 保存到 `node.json`：

```json
{
  "title": "下载探索数据，用于跨中心验证",
  "description": "建立第一轮数据底座",
  "categoryIds": ["data", "download"],
  "nodeType": "数据下载",
  "parentIds": ["PARENT_NODE_ID"],
  "branch": false,
  "status": "running",
  "createdAt": "2026-10-30T10:05:00+08:00"
}
```

```powershell
node electron/research-cli.cjs nodes create --topic TOPIC_ID --file node.json --request-id download-20261030 --dry-run
node electron/research-cli.cjs nodes create --topic TOPIC_ID --file node.json --request-id download-20261030
```

预检和正式写入使用同一请求 ID、相同输入。未提供节点 ID 时，软件从请求 ID 生成稳定 ID。空 `parentIds` 表示独立节点；多个前置表示汇合，`branch: true` 表示并行分支。循环和跨课题前置会被拒绝。

补齐已有节点只传需要修改的字段，例如 `patch.json`：

```json
{"description":"核查患者、切片与分子信息的对应关系","notes":"保留原始下载日志"}
```

```powershell
node electron/research-cli.cjs nodes update NODE_ID --topic TOPIC_ID --file patch.json --expect-updated-at UPDATED_AT --request-id clarify-purpose-1
```

支持标题、描述、备注、Markdown 正文、标签、节点类型/样式、版本和接续关系。未提供的内容、关联文件、论文、讨论与事件均保留。节点状态变化应通过事件记录，而不是直接修改状态。

## 追加进展和修正历史记录

`event.json`：

```json
{
  "title": "下载完成并通过完整性检查",
  "occurredAt": "2026-10-30T15:42:00+08:00",
  "evidence": "download.log 中的完成时间与校验结果",
  "status": "completed",
  "fields": [
    {"id":"location","label":"实际保存位置","type":"path","value":"/data/tcga/brca"},
    {"id":"count","label":"文件数量","type":"number","value":"2418"}
  ]
}
```

```powershell
node electron/research-cli.cjs events append --topic TOPIC_ID --node NODE_ID --file event.json --request-id download-complete-1
node electron/research-cli.cjs events update EVENT_ID --topic TOPIC_ID --node NODE_ID --file correction.json --request-id verify-result-1
```

`occurredAt` 是核实后的实际发生时间，必须带时区；无法确认时写 `null`，不能用询问/补录时间替代。`recordedAt` 由软件填写。修正已有事件时保留原始来源和补录时间，只有显式提供的实际时间会改变。

自定义字段数组按字段 ID 合并，未提到的字段保留；支持 `text / number / url / path / date`。模板记录使用 `templateId` 与字段值对象，例如 `{"location":"/data/brca"}`，必填字段与版本快照仍会校验。将模板记录改为自定义字段时须明确提供 `"templateId":""`。

一次补录多个时间点可提交 `{"events":[...]}`。已有 Prompt 输出的 `research-workbench.task.v1` JSON 仍可通过 `apply --file record.json` 导入。

## 重试、并发与保存

- 最近 200 个成功写入请求随业务数据一起持久保存；同一请求 ID 和相同内容返回 `replayed: true`，不会再次执行。相同请求 ID 配不同内容报 `CONFLICT`。
- 超时不代表未写入。保存终端返回的 `requestId`，先重新读取，或使用同一 ID 和相同输入重试。
- `--expect-updated-at` 检查先前读到的修订时间；不一致时停止写入，重新读取后合并。
- 界面正编辑目标节点时返回 `EDIT_IN_PROGRESS`，不会覆盖未提交的输入。结束编辑后重试即可。
- `--dry-run` 只校验，不保存，也不会消耗请求 ID。归档课题不可写。
- 业务数据与去重凭据在同一次本地状态写入中保存；持久化失败会报错并恢复旧状态，不返回成功。

每个写入请求是一次操作；跨多条命令不是事务。修改历史记录之前应先读取其 ID 和现有内容，避免反复追加代表同一个事实的新记录。

## 延续已有工作与节点跟进

先用 `nodes list --topic TOPIC_ID --search 关键词` 找到已有工作，再用 `nodes get` 读取完整内容。一次进度询问通常追加到原节点；修正同一个事实使用 `events update`。

节点支持四个可选文本字段，创建、查询、更新和原 JSON 导入都支持：

| 字段 | 用途 |
| --- | --- |
| `expectedOutput` | 预期产物，例如数据清单、校验日志、结果图 |
| `nextStep` | 下次接续这项工作时要做什么 |
| `blocker` | 当前受阻的具体原因 |
| `waitingFor` | 当前等待的外部结果或回复 |

这些字段不改变生命周期状态。问题解除后明确传 `"blocker":""`；等待结束后传 `"waitingFor":""`。未提供的字段会保留。界面可筛选受阻、等待结果、缺少下一步及 7 天未更新的未结束节点；补录时间也参与判断最后更新。

写入与 `--dry-run` 返回 `operation`、`changes`、`changeCount`、`changesTruncated`。每项列出资源类型、创建/修改、准确 ID 与变更字段名；最多展示 8 项细节，总变更数仍准确。回执不复制正文或字段值。重试返回原回执和 `replayed:true`，不再次创建记录。

界面「更多 → CLI 写入记录」可查看当前课题最近 30 次成功写入。连接、校验、并发或保存失败仍通过命令的非零退出码与错误 JSON 返回，不记为成功。
