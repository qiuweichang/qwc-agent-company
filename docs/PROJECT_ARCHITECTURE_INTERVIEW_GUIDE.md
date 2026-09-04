# Agent Company 项目底层流程与面试讲解

> 本文面向“能讲清项目、能回答追问”的场景，不展开具体代码。内容以当前仓库的 Runtime、Web 工作台、SQLite 结构、`team` 协议、PTY 生命周期和项目工作流为依据。

## 一、先用一句话定义项目

Agent Company 是一个面向个人开发者的、本机单用户的 AI 软件公司工作台：它通过 Node.js Runtime 管理真实的 Claude Code 和 Codex CLI 进程，使用 PTY 保留交互式上下文，用 `team` 协议完成派单与回报，用 SQLite 保存可恢复的业务事实，再通过 React Web 工作台把规划、开发、验收和产物展示组织成一个完整流程。

可交互架构图：[Agent Company 底层系统架构](./design/agent-company-system-architecture.html)

## 二、面试开场怎么讲

### 30 秒版

“这个项目不是在网页里模拟几个 Agent，而是一个本机 AI Agent 控制平面。Web 端负责交互和可观测性，Node Runtime 负责工作流、派单、状态和资源生命周期，真正的工作由本机 Claude Code 或 Codex CLI 在独立 PTY 中完成。Agent 之间通过带 `dispatch_id` 的 `team` 协议派单和回报，业务状态保存在 SQLite，项目源码和文档保存在独立工作区。”

### 90 秒版

“项目的核心设计是‘规划与执行分离’。规划线里先由产品经理澄清需求并封板，再由架构师和 UI 设计师产出可确认方案；只有架构和 UI 都由用户通过，执行线才能进入开发和验收。底层上，部门经理是业务编排者，但 Runtime 才是确定性的控制层：它校验阶段门、记录消息和派单、启动或恢复 CLI 进程，再把系统提示写入目标 PTY。Worker 完成后用 `team report` 带着原派单 ID 回报，Runtime 把 ledger 收口、更新成员状态，并把结果写回部门经理的 PTY 和 Web 对话。这样既保留了真实 CLI 的能力，又有可追溯、可恢复、可观测的任务系统。”

## 三、系统分层

| 层次 | 核心职责 | 你在面试中要强调的点 |
| --- | --- | --- |
| React Web 工作台 | 项目、对话、阶段门、成员状态、终端、产物和部署交互 | 它是控制台和观察面，不是 Agent 的真实执行环境 |
| 本地 HTTP / WebSocket 网关 | REST 路由、静态文件、UI 会话、Agent 鉴权、终端流和任务文件推送 | 只监听 `127.0.0.1`，UI 和 CLI Agent 使用不同的身份机制 |
| RuntimeStore 门面 | 对上提供统一业务能力，对下组合 workflow、message、dispatch、agent runtime、tasks watcher 等服务 | 它是应用服务门面和资源生命周期边界，不是单纯的数据存储类 |
| 工作流与阶段门 | 管理 requirements、solution、development、acceptance、complete 以及两份方案的审批状态 | 关键约束由服务端校验，不只是前端隐藏按钮 |
| Team 派单协议 | 按名称找到成员，创建派单，投递到 PTY，接收 status/report/cancel | `dispatch_id` 是异步任务的关联键，消息日志与派单 ledger 各司其职 |
| Agent Runtime | 启动配置、运行注册、Agent token、会话恢复、输入投递、退出收口 | 业务上的 Agent 和操作系统进程是两个概念，Runtime 负责把两者绑定 |
| PTY 进程层 | 通过 node-pty/ConPTY 启动真实 CLI，处理 stdin、stdout、resize、pause/resume 和 stop | 选 PTY 而不是普通子进程 pipe，是为了保留 CLI 的交互式行为 |
| SQLite 事实库 | 保存项目、成员、消息、派单、启动配置、运行记录、会话 ID、工作流和设置 | 持久化数据是可恢复的事实；活跃 PTY、socket 和快照才放在内存 |
| 项目工作区 | 保存源码、需求、架构、UI、测试、部署产物以及 `.hive` 协议文件 | SQLite 管“协作事实”，文件系统管“工程成果” |
| 专业能力 | Archify、Stitch MCP、grill-me、to-spec 等 | 这些是被角色调用的专业能力，不是取代 Runtime 的编排引擎 |

## 四、最重要的端到端流程

### 1. Runtime 启动

1. 命令行入口解析端口和数据目录。
2. Runtime 打开 `runtime.sqlite`，按 schema version 完成数据库初始化和迁移。
3. 组装 workspace、message、dispatch、workflow、agent run、session、settings、tasks watcher 等服务。
4. 历史上未正常结束的 run 会被标记为旧运行，避免重启后还把它们当成活跃进程。
5. 从 SQLite 恢复项目和成员摘要，为已有项目重新建立 `.hive/tasks.md` 文件监听。
6. 创建仅接受本地请求的 HTTP 服务，同一个 server 同时承载 REST、Web 静态资源和 WebSocket upgrade。

这一段可以概括为：先恢复事实状态，再开放网络入口；内存中不假设上次的进程仍然存活。

### 2. 创建项目与团队快照

1. Web 提交项目名称和工作目录，Runtime 验证并创建精确目录。
2. SQLite 先产生 workspace 记录，同时建立一个逻辑上的部门经理 Agent。
3. Web 根据当前角色模板，创建产品、架构、UI、前端、后端和测试六个项目成员。
4. 每个成员得到独立 ID、角色描述和 CLI 启动配置。之后再修改全局模板，不会溯及修改已建项目的团队快照。
5. 创建时默认不立即启动全部 CLI，而是等到用户真正发送任务时按需启动，避免重复任务和空转进程。

### 3. 用户消息如何进入 Agent

1. Web 消息会带上项目、当前 planning/execution 线程和指定收件人。
2. 如果收件人是部门经理，Runtime 确保其 CLI 运行，再把用户内容写入其 PTY。
3. 如果用户直接回复产品经理或其他成员，Runtime 会绕过部门经理的对话转发，把内容直接变成该成员的派单。
4. 用户消息仍然被保存在对应线程中，因此可以展示和恢复。

直接路由的意义是：某个专业成员正在向用户提问时，用户回答不需要先被部门经理“转述”，从而避免协调者忙碌或停止时吞掉回答。

### 4. 一次派单如何闭环

1. 发起者在自己的 CLI 里执行 `team send <成员> <任务>`。
2. `team` 命令从运行时注入的环境变量中取得 Runtime 端口、项目 ID、Agent ID 和短期 token，调用本地 API。
3. Runtime 验证 token、项目归属和角色权限，再按成员名称找到目标 Agent。
4. 先写入一条可展示的消息日志，再在 dispatch ledger 中创建全局唯一的 `dispatch_id`，初始状态为 queued。
5. 如果目标成员没有活跃 CLI，Runtime 根据已保存的启动配置按需启动。
6. 派单改为 submitted，Runtime 把包含发起者、角色职责、任务内容、`dispatch_id` 和强制回报规则的系统提示写入目标 PTY。
7. 成员的 pending 计数加一；如果进程存活，状态转为 working。
8. 成员执行真实工作，可以通过 `team status` 持续发送进度，但 status 不关闭派单。
9. 完成后成员使用 `team report` 回传结果、原 `dispatch_id` 和产物路径。
10. Runtime 查找对应的开放派单，将其转为 reported，保存 report 消息，将 pending 计数减一，并把回报写入部门经理的 PTY。
11. Web 端下一次刷新时看到新消息、新状态和新产物。

如果创建 ledger 后启动或 PTY 投递失败，系统会删除这次 dispatch 和对应消息，不向上层伪装成“已派发”。这是本项目最值得讲的一致性设计之一。

### 5. 终端内容如何实时展示

1. 每次 CLI 启动产生独立 run ID，PTY 输出进入全局 output bus。
2. 浏览器为一个 run 建立两条 WebSocket：IO 通道传输终端字节，control 通道传输 resize、stop、restore、exit 和确认信号。
3. 服务端用无界面的终端镜像维护屏幕状态。新打开的观察者先得到 snapshot，再接收后续增量，避免只看到“半个终端”。
4. 浏览器处理完输出后回传字节数确认。如果某个观察者积压过多，服务端可暂停 PTY 读取，积压恢复后再 resume，避免慢客户端导致无界缓冲。
5. 多个浏览器观察者可以共享一个 run，但每个观察者都有自己的 client ID 和流控状态。

### 6. 为什么业务页面用轮询，终端用 WebSocket

Web 工作台约每 1.4 秒并行获取工作流、对话、成员、运行和计划摘要，且下一次轮询会等上一次完成，不会重叠。这些数据变化频率低、可容忍秒级延迟，轮询让一致性和错误恢复更简单。

终端输出是高频、连续、双向的字节流，必须低延迟传输并且需要流控，因此使用 WebSocket。`.hive/tasks.md` 更新也由文件监听器触发 WebSocket 推送。

这不是“技术栈不统一”，而是根据数据特性分流：低频事实用拉取，高频字节流用推送。

### 7. 会话恢复与异常退出

Agent Runtime 有两级恢复机制：

1. 优先恢复 CLI 原生会话。Runtime 会捕获 Claude Code、Codex 等工具的会话 ID，下次启动时用对应的 resume 参数继续。
2. 如果没有可用的原生会话，Runtime 会根据近期用户消息、任务事件、所有未完派单、`.hive/tasks.md` 头部和当前团队状态，构建一份接力摘要注入新 PTY。

进程退出时，Runtime 会将最终输出、退出码和结束时间收口到运行记录，撤销 Agent token，解决运行等待者，并将 Agent 业务状态置为 stopped。即使该 Agent 仍有 pending 任务，也不会显示为 working，因为状态首先回答“进程是否真的在运行”。

### 8. 产物如何进入对话

1. Worker 在项目工作区中产出文件，并在 report 时上报工作区相对路径。
2. 路径随消息和 dispatch 记录持久化，Web 对话因此知道哪个产物属于哪次回报。
3. 浏览器请求产物时，Runtime 会对工作区根目录和目标文件都执行真实路径解析，防止绝对路径、`..` 和符号链接越界。
4. 只对允许的 HTML、JSON 和常见图片格式提供展示，并关闭缓存、开启 `nosniff`。
5. Archify 产生的交互式 HTML 和 Stitch 产生的 UI 素材都使用这条统一的产物链路。

### 9. 项目完成、部署与删除

- 只有处于 complete 阶段的项目可以从 Web 启动本地部署。Runtime 会识别包管理器和启动命令，生成 Windows 一键运行脚本，分配前后端端口，并跟踪本次本地部署进程。
- 删除项目时，先停止部署、shell 和所有 Agent run，再停止 tasks watcher，清理派单、工作流、消息、运行和启动配置。
- 如果用户选择同时删除工作区，Runtime 先验证目标位于允许的项目根且不会包含其他已注册项目，再执行文件删除。

## 五、产品工作流与阶段门

### 主状态

| 阶段 | 活跃对话 | 进入条件 | 主要产物 |
| --- | --- | --- | --- |
| requirements | planning | 项目创建 | 澄清后的需求与封板规格 |
| solution | planning | 用户确认封板需求 | 架构方案、Archify 架构图、UI 方案 |
| development | execution | 架构与 UI 两项都 approved | 前后端实现、运行配置 |
| acceptance | execution | 开发阶段完成 | 真实点击、接口、端到端测试证据 |
| complete | execution | 验收通过 | 完整归档和可启动的本地交付 |

### 两个方案审批状态

架构和 UI 分别维护 not_ready、pending、approved、revision_requested。用户点击“要求修改”不会继续向后流转，而是生成一条持久化的流程事件并通知部门经理重新派单。用户点击“确认通过”前，服务端还会检查对应角色是否真的上报了产物，避免前端仅凭一个布尔值放行。

### 为什么要分 planning 和 execution

- 减少实现日志对需求讨论的污染。
- 用“需求封板 + 方案确认”作为开发前的显式契约。
- 让项目回看时能区分“为什么这样做”和“具体做了什么”。
- 阶段门是服务端持久化状态机，后续自动化和手工操作可以共享同一条规则。

## 六、三组状态要分清

### Agent 业务状态

- idle：PTY 存活，当前没有待办派单。
- working：PTY 存活，且至少有一条 pending 派单。
- stopped：当前没有可执行的 CLI 进程。它可能仍然有 pending 任务，这表示任务在等待重启恢复。

### Dispatch 状态

- queued：事实已持久化，尚未写入目标 CLI。
- submitted：系统已尝试投递到目标 PTY，等待完成。
- reported：Worker 已回传最终结果，派单闭环。
- cancelled：派单被取消，取消理由被保存，并尝试通知目标 Worker。

### Run 状态

Run 是一次操作系统进程生命周期，包含 starting、running、exited、error。它和 Agent 状态不是一回事：Agent 是长期角色身份，Run 是该角色的一次 CLI 进程实例。一个 Agent 可以有多条历史 Run，但同一时刻只应有一条活跃 Run。

## 七、数据一致性与可恢复性

### SQLite 保存什么

- workspaces / workers：项目和团队快照。
- messages：用户输入、派单摘要、进度、回报和工作流系统事件。
- dispatches：可独立查询和收口的任务 ledger。
- agent_launch_configs：每个 Agent 如何启动、如何 resume、如何捕获 session ID。
- agent_runs / agent_sessions：历史运行和最后可恢复会话。
- project_workflows：当前阶段、活跃线程和两项审批状态。
- command_presets / role_templates / settings / app_state：可复用配置和 UI 状态。

### 为什么消息表和派单表都需要

messages 解决“用户和角色看到了什么”，dispatches 解决“哪个任务是否还未闭环”。如果只有消息，需要靠推理消息序列来猜任务状态；如果只有 ledger，又无法还原完整对话。两者通过 Agent ID、时序和 `dispatch_id` 组成完整审计链。

### DB-first 和补偿回滚

- 对项目、成员等持久状态，先成功写 SQLite，再更新内存快照。
- 派单是“持久化 + 外部 PTY 副作用”的跨边界操作，无法用单一 SQLite 事务覆盖。因此系统先写事实，若后续启动或投递失败，就明确删除本次消息和 dispatch。
- 报告时先把派单收口并修正 pending，向部门经理 PTY 转发失败会被记录为 forward error，但不会抹掉已经收到的 Worker 报告。这是因为“报告已到达 Runtime”与“协调者当前可写”是两个事实。

## 八、安全边界

1. Runtime 默认仅绑定回环地址，并对 HTTP 和 WebSocket 都执行本地请求检查。
2. Web UI 首先初始化本地会话，之后通过 Cookie 访问 UI API 和 WebSocket。
3. CLI Agent 不使用 UI Cookie。每次 Agent 运行会获得对应身份的 token，Runtime 同时校验 Agent ID、项目归属和角色能否执行目标 `team` 命令。
4. 项目产物必须是工作区相对路径，且真实解析后仍在工作区内，用来阻断符号链接逃逸。
5. 项目删除有额外的根目录和其他项目保护，防止把广泛目录或包含其他工作区的上层目录当成删除目标。

最重要的安全边界不是“浏览器沙箱”，而是“本机 Windows 用户 + 被选择的项目工作区”。CLI Agent 实际继承当前用户权限，能读写文件和执行命令，所以系统定位是“仅打开可信本机项目”，而不是对抗恶意工作区的多租户云平台。

## 九、为什么这样选型

### 为什么是真实 CLI，不是在服务端直接调模型 API

- 可以直接复用 Claude Code 和 Codex 已有的工具调用、终端交互、本地认证和项目上下文。
- 每个角色拥有独立会话，不会把所有专业上下文塞进一个大 prompt。
- 用户可以看到真实过程、命令输出和等待状态，可观测性更强。
- 代价是必须解决 PTY、编码、启动提示、会话捕获和进程异常等操作系统问题。

### 为什么是 SQLite

- 项目是本机单用户应用，数据量和并发规模有界，嵌入式数据库不需要独立服务。
- 消息、派单、阶段和运行需要事务、索引和重启恢复，又不适合只放 JSON 文件。
- 代价是不适合直接扩展为多机、高并发、多租户系统，如果产品定位变化就需要重新设计持久化和协调方式。

### 为什么有 RuntimeStore 门面

路由如果直接依赖 SQLite、PTY、watcher 和各种 map，很快会把业务一致性分散到整个项目。RuntimeStore 用一个门面暴露用例，内部再将持久化、运行时、流程和文件服务组合起来。这样可以把“先停资源还是先删数据”、“失败时回滚什么”等跨模块规则集中在用例边界。

## 十、项目的典型技术取舍和现有边界

- 本地单进程架构部署简单，但 Runtime 本身是一个中心故障点。项目通过 SQLite 和会话恢复降低重启成本，而不是做高可用集群。
- 派单不经过 RabbitMQ/Kafka，而是 SQLite ledger + PTY 投递。这符合本机规模，也意味着“排队”更像可恢复的工作列表，不是通用消息中间件。
- Web 业务数据使用轮询，实现简单但有秒级延迟；终端和 tasks 另走 WebSocket，保证高频路径的实时性。
- 部署记录的活跃进程部分主要是运行时内存状态，Runtime 自身重启后不能像 SQLite 业务事实一样无缝恢复所有部署控制句柄。
- 系统不是多租户安全沙箱。CLI 拥有本机用户权限，所以安全基础是本机信任、回环网络、身份 token 和工作区路径边界。

## 十一、容易讲错的点

1. 不要说“前端调用多个大模型 API”。前端调用本地 Runtime，Runtime 管理的是真实 CLI 进程。
2. 不要说“部门经理就是后端调度器”。部门经理是一个可推理的编排 Agent；Runtime 是确定性的协议、状态和资源控制层。
3. 不要把 planning/execution 和系统线程混为一谈。它们是对话与业务流程分区，不是 OS thread。
4. 不要把 Agent 状态和 Run 状态混为一谈。Agent 是角色，Run 是一次进程实例。
5. 不要说“所有数据都在 SQLite”。业务事实在 SQLite，真正的工程成果在项目工作区，活跃 PTY/socket 在内存。
6. 不要把 status 和 report 混为一谈。status 是中间进度，report 才关闭一条派单。
7. 不要说“WebSocket 承载所有实时数据”。当前终端与 tasks 用 WebSocket，对话和成员摘要主要用轮询。
8. 不要说“Archify 是 Runtime 的调度核心”。Archify 是架构师可调用的产物能力，Runtime 才管理整体协作和进程。

## 十二、高频面试追问与参考回答

### Q1：这个项目最核心的技术难点是什么？

不是单纯的 prompt 组装，而是如何把不可预测、可随时退出的交互式 CLI，包装成一个有确定性任务状态、可恢复会话、可追溯消息和可观测终端的本地运行时。具体体现在 PTY 生命周期、dispatch 闭环、DB 与外部副作用的一致性、session 恢复和 WebSocket 流控。

### Q2：为什么不直接让 Agent 互相发 prompt？

直连 prompt 没有可靠的任务身份、状态收口和恢复语义。`team` 协议将任务显式化为 dispatch，通过 `dispatch_id` 关联发起、中间进度、最终报告和取消，使 Runtime 可以统计 pending、恢复未完任务并对外提供审计视图。

### Q3：如果 Worker 完成了，但部门经理的 CLI 正好停了，会丢报告吗？

不会丢业务事实。Worker 的 report 先进入 Runtime，保存到消息和 ledger，并关闭派单。向部门经理 PTY 写入是后续转发，失败会带回 forward error，但 Web 对话和恢复摘要仍能从 SQLite 取到该报告。

### Q4：如果 Runtime 在派单中途崩溃怎么办？

派单事实先进 SQLite，重启后可以从 ledger 恢复开放任务和 pending 计数。原 PTY 不能被当成仍然存活，所以旧 run 会被收口，Agent 重启时优先 resume 原生会话，失败则用未完派单和近期消息构建接力摘要。它的语义是“可恢复继续”，不是分布式队列那种严格 exactly-once。

### Q5：怎么避免重复启动同一个 Agent？

Agent Runtime 按 workspace + agent 查找当前活跃 run，并对同一 Agent 的同时启动保留共享的启动 Promise。派单前先检查活跃 run，仅在不存在时按已保存配置启动。

### Q6：为什么 Agent 已有 pending 任务，还可能显示 stopped？

因为 stopped 表示没有活跃执行进程，pending 表示尚有未闭环的业务任务。把两者强行合并会让 UI 把“有任务但进程挂了”错报为“正在工作”。

### Q7：为什么终端要拆两个 WebSocket？

IO 通道是高频字节流，control 通道是低频但关键的状态和确认消息。拆开后，恢复快照、退出、resize、stop 和 output ack 不会与普通输出字节混在一个协议里，也更方便实现背压。

### Q8：工作流为什么不只在前端维护？

前端状态可被刷新、并发请求或未来的自动化路径绕过。服务端持久化状态机并校验前置条件，才能保证“没有需求封板不能批方案、没有两份方案通过不能开发、没有验收不能完成”是业务不变式。

### Q9：如何保证角色不越权？

第一层是 Agent token 和项目归属验证，第二层是不同角色可执行的 `team` 命令权限，第三层是启动时注入的角色职责和协议说明。但要如实说明，这些是本机协作约束，不是把 CLI 放入强沙箱；CLI 仍拥有当前 Windows 用户权限。

### Q10：Archify 和 Stitch 在系统里是什么位置？

它们是角色能力层。架构师用 Archify 生成经验证的交互式 HTML 架构图，UI 设计师可通过 Runtime 代理调用 Stitch MCP。两者的结果最终都是项目工作区产物，通过 report 和统一 artifact 路由进入 Web 对话与审批门。

### Q11：这个系统能水平扩展吗？

当前不以水平扩展为目标。SQLite、本地 PTY、内存 run registry 和回环端口都表明它是单机控制平面。如果要改造成多机系统，需要将进程执行抽象为远程 worker，将持久化迁移到共享数据库，引入可靠消息中间件、分布式锁/租约、租户鉴权和远程工作区隔离。

### Q12：这个项目的创新点是什么？

创新不是发明了某个新模型，而是把真实 CLI Agent、软件开发角色、用户审批门、可追溯派单、可恢复会话和可内嵌产物组合成一个完整的本地交付流程。它试图解决的是“怎么让多个强大但不确定的 CLI Agent，在人可控、可回看、有阶段约束的前提下完成软件交付”。

## 十三、最后用一个心智模型记住全项目

把 Agent Company 记成三个平面：

- 产品平面：planning / execution、需求封板、方案审批、开发、验收和部署。
- 控制平面：RuntimeStore、workflow 状态机、team 协议、dispatch ledger、Agent Runtime 和安全边界。
- 执行平面：PTY、真实 Claude Code/Codex CLI、项目工作区和 Archify/Stitch/Skills。

再用两句话收尾：

1. SQLite 记录“发生过什么”，PTY 承载“现在正在发生什么”，项目工作区保存“最终做出了什么”。
2. 部门经理负责智能编排，Runtime 负责确定性约束，专业 Worker 负责真实交付，用户通过阶段门保留最终决策权。

## 十四、建议的面试准备顺序

1. 先熟练说出上面的 30 秒版和 90 秒版。
2. 对着架构图，能不看文稿讲完“Web → Runtime → Team → Agent Runtime → PTY → CLI”。
3. 能独立讲完一次 send/status/report 闭环，并说清失败回滚。
4. 能画出 workflow、Agent、Dispatch、Run 四组状态，不把它们混在一起。
5. 能回答“为什么是 PTY”、“为什么是 SQLite”、“为什么轮询和 WebSocket 并存”。
6. 主动讲出当前边界：本机单用户、单 Runtime、非强沙箱、非多机高可用。能说边界通常比把项目包装成“什么都能做”更有说服力。
