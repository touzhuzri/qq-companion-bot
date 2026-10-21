# QQ 陪伴型 Bot 模板

一个可替换角色的 QQ 群陪伴型 bot。仓库自带一个示例人设 **茜特菈莉**，已经可以直接运行；
想换成自己的角色，整段替换 [`src/persona.js`](src/persona.js) 即可，
写法见 [「如何定制性格」](#如何定制性格)。

对话由 [presence-turn runtime](vendor/presence-turn-runtime)（已内置）统一约束：
每轮先判断用户意图，再套用约束卡，最后剥离旁白、必要时抢救重写一次，并让情绪状态带进下一轮。
你只需要写「这个人是谁、怎么说话」。

```
QQ 群 @消息 ⇄ SnowLuma(OneBot 11) ⇄ 本服务(Node)
                                   ├─ 表情包: MD5 缓存 → 多模态模型识别
                                   ├─ presence-turn runtime: 分类→约束→剥离→抢救≤1→情绪叠态+记忆
                                   └─ LLM: 文字(智谱 GLM-4.5 / OpenAI 兼容) + 视觉(本地 Qwen)
                                          └─ 可选: GPT-SoVITS 语音(api_v2)
```

## 特性

- **零 npm 依赖**：Node ≥ 22 自带 WebSocket / fetch，clone 下来直接跑。
- **@ 回复 + 群聊旁听 + 私聊**：群聊默认只回 @；可在指定群开启旁听；私聊需显式 allowlist。
- **没有回复冷却**：连续消息（默认 2 秒内、同一人）仍会合并，但不会因为「刚回过」而丢弃新一轮。
- **像真人一样分条**：API 返回后随机等 4–8 秒再开口，长句按标点/长度切成多条，段间 1.2–2.8 秒。
- **按群隔离**：上下文、情绪叠态、记忆、表情包缓存都按群号分开落盘，互不串台。
- **对话纪律层**：禁止括号动作旁白、禁止仆人式讨好、禁止「你先忙」式打发；
  模型跑偏时会自动纠正一次（salvage ≤ 1）。
- **文字 / 视觉模型分离**：两个端点各司其职，provider 预留 `local` / `ollama` / `openai` / `openai-compatible`。
- **图片识别**：群里发表情包时，用视觉模型压成一句话喂给对话；同图只识别一次。
- **语音可选**：bot 自带本地控制页切换语音；语音模式只发语音、不发文字、不加等待，失败自动降级为文字。

## 目录结构

```
.
├── src/
│   ├── persona.js        ★ 角色人设（唯一需要大改的文件）
│   ├── bot.js            主流程：触发/旁听 → sendTurn → 延迟 → 分段发送
│   ├── config.js         配置加载与校验（fail fast）
│   ├── llm.js            文字/视觉端点解析（local / ollama / openai / anthropic / zhipu）
│   ├── llm-runtime.js    按协议准备运行时端点（Anthropic 时自动起桥）
│   ├── anthropic-bridge.js  Anthropic Messages ⇄ OpenAI Chat 本地桥（多 key 轮换）
│   ├── split.js          按标点和长度切分台词（移植自 qikou，MIT）
│   ├── reply.js          延迟、语音/文字投递与分段发送
│   ├── ambient.js        群聊旁听的相关度判定
│   ├── control.js        语音开关本地控制页
│   ├── onebot.js         OneBot 11 正向 WebSocket 客户端（兼容 SnowLuma；心跳假死检测、指数退避重连）
│   ├── messageParser.js  OneBot 消息段解析（@判定 / 文字 / 图片）
│   ├── contextStore.js   每群滚动短上下文
│   ├── storage.js        runtime 的 localStorage shim（按群命名空间落盘）
│   ├── vision.js         图片下载 + MD5 缓存 + 一句话描述
│   ├── voice.js          GPT-SoVITS api_v2 客户端
│   └── logger.js         带时间戳的控制台日志
├── vendor/presence-turn-runtime/   对话纪律层（MIT，上游源码原样内置）
├── scripts/
│   ├── smoke.mjs         不接 QQ，直接跑一轮完整对话，用来调人设
│   └── start-llama.sh    启动本地 llama-server（文本 + 视觉）
├── test/                 单元测试（不需要模型）
├── config.example.json   配置模板
├── start.sh              一键启动：Qwen 视觉 → GPT-SoVITS → bot → SnowLuma
└── state/                运行数据（按群文件，首次运行自动生成）
```

## 环境要求

| 依赖 | 用途 | 是否必需 |
| --- | --- | --- |
| Node.js ≥ 22 | 运行 bot | 必需 |
| [SnowLuma](https://github.com/SnowLuma/SnowLuma/releases) | QQ ⇄ OneBot 11 网关（原 NapCat 的替代） | 必需 |
| 文字模型端点 | 对话（OpenAI 或 Anthropic 协议均可） | 必需 |
| 多模态模型端点 | 读表情包（默认本地 Qwen） | 可选 |
| [llama.cpp](https://github.com/ggml-org/llama.cpp) `llama-server` | 本地跑 Qwen 视觉模型 | 可选 |
| GPT-SoVITS | 语音合成 | 可选 |

> SnowLuma 走的是第三方 QQ 协议，**有封号风险，请用小号**，不要用大号。
> 本仓库**不包含** SnowLuma 的源码或二进制：请自行从官方 Releases 获取。
> SnowLuma 采用源码可见的非商业许可（不是 OSI 开源），商业使用或公开分发修改版/衍生版需事先取得书面授权。

## 快速开始

### 1. 准备配置

```bash
cp config.example.json config.json
```

至少填 `botQQ`（bot 的 QQ 号）、`llm.apiKeys`（两个智谱 key，或改用环境变量），
并确认 `onebot.wsUrl` 和 SnowLuma 的 OneBot WebSocket 监听地址一致。

### 2. 准备模型

**文字模型：智谱 GLM-4.5（默认示例）**

智谱的 Claude 兼容入口是 Anthropic 协议，直接填进 OpenAI 链路会失败。
本项目会自动启动一个本地桥（默认 `127.0.0.1:8090`）做协议转换：

```json
"llm": {
  "provider": "zhipu",
  "endpoint": "https://open.bigmodel.cn/api/anthropic",
  "model": "glm-4.5-flash",
  "apiKeys": ["账号一的 key", "账号二的 key"]
}
```

- `glm-4.5-flash` 目前免费；也可以换 `glm-4.5-air` 或 `glm-4.5`
- 两个 key 会轮询使用，遇到 429/401/5xx 自动换下一个，并对出错的 key 短期冷却
- 不想把 key 写进文件，可以留空 `apiKeys`，改用环境变量
  `ZHIPU_API_KEY` / `ZHIPU_API_KEY_2`
- 本地桥只监听 127.0.0.1，运行时拿到的是桥的临时 token，不是你的智谱 key

**视觉模型：读表情包（本地 Qwen）**

表情包识别走独立端点，默认是本机 `models/qwen3-vl-4b/` 下的 Qwen3-VL：

```bash
./scripts/start-llama.sh
```

模型文件名或目录不同，用环境变量指定：

```bash
MODEL_DIR=/path/to/model MODEL_FILE=xxx.gguf MMPROJ_FILE=mmproj.gguf ./scripts/start-llama.sh
```

对应的 `vision.llm`：

```json
"vision": {
  "enabled": true,
  "llm": {
    "provider": "local",
    "endpoint": "http://127.0.0.1:8080/v1/chat/completions",
    "apiKey": "local",
    "model": "qwen3-vl-4b"
  }
}
```

> 智谱的 Anthropic 端点不能拿来做视觉；文字用智谱时必须单独配置 `vision.llm`
> （或把 `vision.enabled` 设为 `false`）。启动时会检查并在配置错误时直接报错。

**其他组合**：文字也可以改用本地 llama.cpp / Ollama / OpenAI，只要把 `llm`
换成对应的 provider；视觉端点则可以是任意 OpenAI 兼容的多模态服务。

### 3. 配置 SnowLuma（QQ ⇄ OneBot 网关）

SnowLuma 需要单独安装，本项目只通过 OneBot 11 与它通信。

1. 从 [SnowLuma Releases](https://github.com/SnowLuma/SnowLuma/releases) 下载对应平台的完整发行包，
   解压到项目下（`SnowLuma/` 或 `SnowLuma-vX.Y.Z-<platform>/` 都可以，后者会被 `start.sh` 自动识别），
   也可以用 `SNOWLUMA_DIR` 指定任意目录。
2. 运行 `./start.sh` 或直接运行解压目录里的 `launcher.sh`；
   打开 <http://127.0.0.1:5099>，用**终端启动日志里的初始用户名/密码**登录，并接受 EULA/PRIVACY。
3. 在 WebUI 里接入并登录 QQ 小号（不要用大号）。
4. 配置 **OneBot → WebSocket 服务端**：监听 `127.0.0.1:3001`（对应 `onebot.wsUrl`）。
   SnowLuma 默认会生成随机 access token；**推荐在 WebUI 里把它清空**，
   这样和 `config.json` 的 `onebot.accessToken: ""` 一致。
   如果保留 token，就把它复制到 `onebot.accessToken`，然后重启 bot。
5. 把 bot 拉进群，设为普通成员即可；默认**只有 @ 它才会回话**，
   未 @ 旁听需要另外开启 `ambient`（见下文）。没有群也可以按
   [「用私聊测试」](#用私聊测试没有群也能测) 配置私聊白名单。

> 首次启动会打印类似 `user=admin password=...` 的临时凭据，改密后不会再次显示。
> OneBot WS 端口 `3001` 只有在 QQ 账号接入后才会开始监听，bot 会自动重连。

> 端口和 token 都以后台 WebUI 实际配置为准。OneBot 消息段、`send_group_msg` 等动作与 NapCat 一致，
> bot 端不需要额外适配。

### 4. 启动

```bash
npm start
```

或者一键启动（Qwen 视觉 + GPT-SoVITS 语音 + bot + SnowLuma）：

```bash
./start.sh
```

`start.sh` 会依次做这些事：

1. 校验 `config.json`
2. 启动本地 Qwen 视觉模型（`llama-server :8080`）
3. 启动 GPT-SoVITS `api_v2`（`:9880`，使用现有 `tts_infer.yaml` 里的权重）
4. 启动 bot（Anthropic 桥 `:8090`、语音控制页 `:5100`）
5. 前台启动 SnowLuma（WebUI `:5099`）

默认从项目同级目录找模型/语音/SnowLuma，也可以用环境变量覆盖：

```bash
MODEL_DIR=/path/to/qwen3-vl-4b \
SOVITS_DIR=/path/to/GPT-SoVITS/repo \
SNOWLUMA_DIR=/path/to/SnowLuma \
./start.sh
```

- 跳过视觉或语音：`START_VISION=0 ./start.sh` / `START_TTS=0 ./start.sh`
- SnowLuma 没安装时，其余服务会继续在后台运行，脚本会打印下载地址并保持等待；
  按 Ctrl+C 一起退出
- 文字模型走智谱远程端点；本地 Qwen 只负责读表情包
- 语音开关在 <http://127.0.0.1:5100>，可在文字/语音模式间随时切换
- 日志在 `logs/vision.log`、`logs/tts.log`、`logs/bot.log`

启动成功的标志是日志出现 `OneBot 已连接`。

## 配置说明（config.json）

| 字段 | 默认 | 说明 |
| --- | --- | --- |
| `botQQ` | — | bot 的 QQ 号，@ 判定依据，**必填** |
| `onebot.wsUrl` | `ws://127.0.0.1:3001` | SnowLuma OneBot WS 地址 |
| `onebot.accessToken` | `""` | SnowLuma WebUI 里的 access token，没设就留空 |
| `onebot.staleTimeoutMs` | `120000` | 多久没收到任何帧就判定假死并重连 |
| `llm.provider` | `local` | `local` / `ollama` / `openai` / `anthropic` / `zhipu` / `openai-compatible` |
| `llm.endpoint` | 取决于 provider | 文字模型端点；智谱填 `https://open.bigmodel.cn/api/anthropic` |
| `llm.apiKey` | — | 单 key（OpenAI 兼容端点用） |
| `llm.apiKeys` | `[]` | 多 key 轮换（`zhipu` / `anthropic`）；也可用 `ZHIPU_API_KEY` / `ZHIPU_API_KEY_2` |
| `llm.model` | 取决于 provider | 文字模型名；智谱免费版用 `glm-4.5-flash` |
| `llm.anthropicVersion` | `2023-06-01` | Anthropic 协议版本头 |
| `llm.timeoutMs` | `60000` | 上游请求超时 |
| `llm.bridge.host` / `port` | `127.0.0.1` / `8090` | Anthropic→OpenAI 本地桥地址，仅本机可访问 |
| `vision.llm` | `null` | 独立的视觉端点对象；文字用 Anthropic 协议时**必须**单独配置 |
| `vision.enabled` | `true` | 是否用 Qwen 等视觉模型读表情包 |
| `groups.allow` | `[]` | 允许响应的群号列表，**空 = 所有群** |
| `privateChat.enabled` | `false` | 是否响应私聊 |
| `privateChat.allow` | `[]` | 允许私聊的 QQ 号；开启时必填，空列表会启动报错 |
| `trigger.debounceMs` | `2000` | 触发后等待合并后续消息的窗口 |
| `reply.delayMinMs` / `delayMaxMs` | `4000` / `8000` | API 返回后、回复前的随机等待，每轮只等一次 |
| `reply.segmentMinChars` | `12` | 单条最少字数（太短的尾巴会并回上一条） |
| `reply.segmentTargetChars` | `24` | 单条理想字数，接近时优先换条 |
| `reply.segmentMaxChars` | `45` | 单条硬上限 |
| `reply.segmentMaxMessages` | `6` | 一轮最多分几条 |
| `reply.segmentGapMinMs` / `reply.segmentGapMaxMs` | `1200` / `2800` | 分段之间的随机间隔 |
| `ambient.enabled` | `false` | 是否开启群聊旁听接话 |
| `ambient.groups` | `[]` | **指定**允许旁听的群号；开启时必填 |
| `ambient.keywords` | `[]` | 关键词预筛；空则直接交给模型判定 |
| `ambient.useLlmJudge` | `true` | 是否用文字模型判断「该不该接」 |
| `ambient.debounceMs` | `3000` | 群消息静止多久后开始判定 |
| `ambient.minIntervalMs` | `60000` | 同群两次旁听接话的最小间隔，防止刷屏 |
| `ambient.maxContextMessages` | `8` | 旁听判定和生成时参考的最近群消息条数 |
| `ambient.judgeTimeoutMs` | `8000` | 旁听判定请求的超时时间 |
| `control.enabled` | `true` | 是否启动语音开关控制页 |
| `control.host` / `port` | `127.0.0.1` / `5100` | 控制页监听地址，**不要暴露到公网** |
| `history.maxItems` | `24` | 每群保留的历史条数（真正喂给模型的更少） |
| `voice.enabled` | `false` | 语音模式的初始状态，可在控制页随时切换 |
| `voice.apiEndpoint` | `http://127.0.0.1:9880/tts` | GPT-SoVITS api_v2 地址 |
| `voice.refAudioPath` | `""` | 参考音频**绝对路径**（开启语音时必填） |
| `voice.promptText` | `""` | 参考音频里说的那句话，需逐字一致 |
| `voice.tempDir` | `./state/tts` | 临时 wav 目录，会被自动清理 |
| `stateDir` | `./state` | 上下文 / 情绪 / 记忆 / 缓存落盘目录 |

配置缺失或不合法会在启动时直接报错并说明缺哪一项。

## 如何定制性格

### 只改一个文件

所有角色设定都在 **`src/persona.js`**。它导出一个 pack 对象，runtime 会把它拼进每轮 prompt。
不需要改 `bot.js`，也不需要动 `vendor/` 里的纪律层。

```js
export const PERSONA = mergePack({
  id: 'my_character',      // 内部标识，换角色时一起改
  name: '角色名',           // 角色自称
  userName: '你',           // 角色怎么称呼对方
  voiceHint: '……',         // 语气总纲，一句话
  systemPrompt: '……',      // 人设正文
  facts: { name: '', drink: '' },
  affect: { attachmentFloor: 0.2 },
  forbidFamilies: ['servant', 'order_scold', 'peer_dodge'],
})
```

| 字段 | 作用 | 建议 |
| --- | --- | --- |
| `id` | 内部标识 | 英文小写，别和别人重名 |
| `name` | 角色自称，runtime 会注入「你现在的名字」 | 填角色名 |
| `userName` | 角色对用户的称呼 | 默认 `你` 即可 |
| `voiceHint` | 语气总纲，权重很高 | 写具象姿态，别写「温柔善良」这类标签 |
| `systemPrompt` | 人设正文，见下方六段结构 | 最重要的部分 |
| `facts.name` | 已知的用户称呼 | 留空即不强制点名 |
| `facts.drink` | 已知的饮品偏好 | 留空即不强制提 |
| `affect.attachmentFloor` | 情绪依恋地板 0~1 | 越高越不容易被一句否定打回原点 |
| `forbidFamilies` | 要屏蔽的回复族 | `servant` 仆人式伺候 / `order_scold` 训斥使唤 / `peer_dodge` 「你先忙」式打发 |

### systemPrompt 的六段结构

按下面六段来写；当前的茜特菈莉人设可以直接当参考：

1. **身份**：一句话交代是谁、从哪来、在做什么。只做底色，不要在这里写剧情。
2. **性格**：写**反应模式**，不写履历。
   - ✅「被冒犯时会直接顶回去，但对熟人反而先服软」
3. **见识**：明确「懂什么 / 不懂什么」。
   - 熟悉的领域要能主动带细节和偏好（哪家店、什么时候、什么讲究），
     否则小模型会一问三不知，或者对所有问题都用同一套含糊话术。
   - 真正的短板（没读过的书、没见过的新东西）才说「不知道」并请对方讲。
4. **说话方式**：句长、文白/口语、口头禅、被夸怎么应、求人怎么开口。
5. **例句**：给 4~8 条「场景 → 台词」，让模型学味道。这是小模型最能吃进去的部分。
6. **边界**：不碰的话题、不做的行为。

### 从 SillyTavern 角色卡迁移

- **只取性格与说话风格**：把角色卡的「性格特质」「说话风格」专条提炼进 `systemPrompt`。
- **丢掉剧情线**：世界书里的剧情、其他角色、关系史、具体事件都不要带进来——
  陪伴型对话需要的是「她遇到什么会怎么反应」，不是「她经历过什么」。
- **不要复制格式规则**：分条、纯台词、不要括号旁白、不要说「你先忙」这些都由 runtime 管，
  在 `systemPrompt` 里重复只会和引擎指令打架。你写的应只关于「这个角色」。
- **世界书里的风物可以作为「见识」**：只保留角色生活里真的会接触到的东西，当作知识背景，不要写成故事。

### 让小模型稳定守人设的技巧

1. **具体例句 > 抽象禁令**。与其写「不许敷衍」，不如写：
   `有人问你在不在→「在呢，什么事？」`
   再用一句「学这个味道，不要一字不差地抄」防止复读。
2. **给反例**。比如模型总爱猜用户名字，就明确写：
   `不知道对方称呼时，老实说还没记住，请对方再讲一遍；绝不许编造或猜测对方的名字。`
3. **明确元词汇禁区**。小模型容易冒出 `id`、`账号`、`AI`、`机器人`、`程序`、`系统` 这类词，
   在 `systemPrompt` 里列清楚要禁的词。
4. **别在 persona 里写「你是 AI」**。角色就是角色；模型的行为约束交给 runtime。
5. **一次只改一点，然后跑 smoke**。人设和格式指令冲突时，先看是谁把话说死了。

### 调试人设（不用连 QQ）

先启动模型，然后：

```bash
npm run smoke                 # 默认三连问：招呼 / 日常 / 名字回勾
npm run smoke -- "在干嘛呢"    # 单句自测
```

输出会显示每轮的 `turnKind`、是否触发抢救，以及最终台词。多聊几轮，重点看：

- 有没有括号旁白 → 有的话，通常是 persona 里的例句带了动作，删掉。
- 是不是变得像客服 → 在「性格」和例句里加强具体反应。
- 问到熟悉话题会不会说「不知道」→ 在「见识」里补细节和偏好。
- 有没有猜用户名字 → 加一条明确的反例。

### 上线前检查清单

- [ ] `src/persona.js` 已按目标角色重写，没有残留的模板文字
- [ ] `name` 和 `voiceHint` 与角色一致
- [ ] 例句里没有括号动作/神态描写
- [ ] 现代词符合角色设定（茜特菈莉会用手机、看网文，但不懂网络梗和职场黑话）
- [ ] `npm test` 通过
- [ ] `npm run smoke` 连续三轮表现稳定，再放入 QQ 群

## 回复节奏与分段

一轮文字的发送过程：

1. 模型返回后，**只等一次**随机 4–8 秒（`reply.delayMinMs` / `delayMaxMs`）；
2. 把回复按句号、问号、逗号等切成语义完整的短句；
3. 依次发送，分段之间随机等 1.2–2.8 秒（`segmentGapMinMs` / `segmentGapMaxMs`）；
4. 没有回复冷却：上一轮刚结束，下一轮 @ 仍然会正常处理。

切分逻辑移植自 [qikou（气口）](https://github.com/Grabrun/qikou)（MIT）：

- 单条硬上限 `segmentMaxChars`（默认 45 字），理想长度 `segmentTargetChars`（24）；
- 引号、括号内的标点不切；`Mr.` / `e.g.` 等英文缩写不当句末；
- 一轮最多 `segmentMaxMessages` 条（默认 6），超了会合并最短的相邻两条；
- 太短的尾巴会并回上一条，避免出现「嗯。」这种单字气泡。

觉得太碎或太慢，调 `reply` 下的参数即可，不需要改代码。

## 群聊旁听（未被 @ 时接话）

默认关闭。开启后只对 `ambient.groups` 里**指定**的群生效：

```json
"ambient": {
  "enabled": true,
  "groups": [123456789],
  "keywords": ["助手", "你们怎么看"],
  "useLlmJudge": true,
  "debounceMs": 3000,
  "minIntervalMs": 60000,
  "maxContextMessages": 8
}
```

处理流程：

1. 群里出现非 @ 消息，先记入该群最近消息窗口；
2. 消息静止 `debounceMs` 后，若有 `keywords`，先做一次关键词预筛；
3. `useLlmJudge` 为 true 时，用文字模型结合最近 8 条群聊判断「适不适合接」；
4. 通过后，以该条消息为输入生成回复，并走正常的延迟/分段/语音流程；
5. 同群两次旁听接话至少间隔 `minIntervalMs`，避免刷屏。

判定失败、模型超时或返回非 YES 都按「不接」处理。旁听只是锦上添花，不会阻塞正常的 @ 回复。
`ambient.groups` 为空时启动会直接报错，防止误开后在所有群接话。
如果 `groups.allow` 非空，旁听群也必须同时在 `groups.allow` 里。

## 用私聊测试（没有群也能测）

1. 在 `config.json` 里开启私聊，并填上测试账号的 QQ 号：

```json
"privateChat": {
  "enabled": true,
  "allow": [你的测试QQ号]
}
```

2. 重启 bot（或重新运行 `./start.sh`）。
3. 用测试账号给 bot 发私聊，**不需要 @**。
4. 日志会出现 `私聊 <QQ号> | ...`；历史、情绪叠态按私聊会话单独落盘：
   `state/history_private_<QQ号>.json`、`state/private_<QQ号>.json`。

要点：

- `privateChat.enabled` 为 true 时 `allow` 不能为空，启动会直接报错，避免对陌生人回复。
- 私聊也走相同的随机延迟、分段和语音开关；语音通过 `send_private_msg` 发送。
- 前提仍然是 SnowLuma 已注入 QQ、OneBot WS 已连上，否则 bot 收不到事件。
- 群聊和私聊可以同时开着；群聊历史不受影响。

## 文字 / 视觉模型分离

两个端点独立配置，各司其职：

```json
"llm": {
  "provider": "zhipu",
  "endpoint": "https://open.bigmodel.cn/api/anthropic",
  "model": "glm-4.5-flash",
  "apiKeys": ["账号一的 key", "账号二的 key"]
},
"vision": {
  "enabled": true,
  "llm": {
    "provider": "local",
    "endpoint": "http://127.0.0.1:8080/v1/chat/completions",
    "apiKey": "local",
    "model": "qwen3-vl-4b"
  }
}
```

| provider | 默认端点 | 默认 key |
| --- | --- | --- |
| `local` | `http://127.0.0.1:8080/v1/chat/completions` | `local` |
| `ollama` | `http://127.0.0.1:11434/v1/chat/completions` | `ollama` |
| `openai` | `https://api.openai.com/v1/chat/completions` | 环境变量 `OPENAI_API_KEY` |
| `anthropic` | `https://api.anthropic.com` | 环境变量 `ANTHROPIC_API_KEY` |
| `zhipu` | `https://open.bigmodel.cn/api/anthropic` | `ZHIPU_API_KEY` / `ZHIPU_API_KEY_2` |
| `openai-compatible` | 必须自己填 | `LLM_API_KEY` 或自己填 |

- `vision.llm` 填了就**完全独立**，不会字段级混用；不填则回退到文字 `llm`。
- 文字用 `anthropic` / `zhipu` 时**不能**回退到文字端点做视觉（协议不同）；
  必须单独配置 OpenAI 兼容的多模态 `vision.llm`，或关闭 `vision.enabled`。
- 视觉端点必须是多模态模型；纯文本模型请把 `vision.enabled` 设为 `false`。
- 视觉请求按图片 MD5 缓存，同一张表情包只识别一次。

### 智谱多账号与本地桥

- `provider: "zhipu"` / `"anthropic"` 时，bot 启动会在 `llm.bridge.port`（默认 8090）
  起一个本地桥，把运行时的 OpenAI 请求翻译成 Anthropic Messages，再转回 OpenAI 响应。
- 桥只监听 `127.0.0.1`，并要求一个进程内随机 token；你的智谱 key 不会传给运行时或日志。
- `apiKeys` 数组按顺序轮询；某个 key 返回 429/401/5xx 时自动换下一个，
  并对该 key 冷却一段时间（429 冷却 30s，鉴权失败冷却 5 分钟）。
- 请求日志只记录 `key#1`、`key#2`，不打印 key 内容。
- `npm run smoke` 也会自动起桥，所以调试人设不需要另外运行代理。

## 语音（GPT-SoVITS，可选）

默认关闭。需要时：

1. 按 [GPT-SoVITS 官方文档](https://github.com/RVC-Boss/GPT-SoVITS) 训练角色音色，
   准备一段**3~10 秒、干净、无背景音**的参考音频。
2. 启动 `api_v2.py`，默认监听 `127.0.0.1:9880`。
3. 在 `config.json` 里填写：

```json
"voice": {
  "enabled": true,
  "apiEndpoint": "http://127.0.0.1:9880/tts",
  "refAudioPath": "/绝对路径/参考音频.wav",
  "promptText": "参考音频里说的那句话，逐字一致"
}
```

### 语音开关

bot 启动后会提供一个本地控制页：<http://127.0.0.1:5100>。
勾选「发送语音」立即生效，状态写入 `state/voice.json`，重启后保留。
端口和监听地址由 `control.host` / `control.port` 控制，**默认只绑定 127.0.0.1，不要暴露到公网**。

> SnowLuma 的 WebUI 是封闭的第三方前端，没有插件/扩展接口，无法在不 fork 并重建它的情况下
> 往里加开关。所以语音开关放在 bot 自己的控制页，不影响 SnowLuma 的登录和 OneBot 配置。

### 语音模式的行为

- **只发语音**：不再发送文字，也不发第一条文字提示；
- **不加等待**：跳过 4–8 秒和分段间隔，TTS 就绪后直接发；
- **失败降级**：TTS 合成或发送失败时，自动按文字模式重发（此时恢复随机等待和分段）；
- 念的内容是整轮台词拼接后的文本，仍会写入对话历史。

`refAudioPath` 必须是**绝对路径**：SnowLuma 的工作目录和 bot 不同，相对路径它找不到。

> SnowLuma 自带 ffmpeg 原生组件，会把 `voice.js` 产出的 wav 自动转成 QQ 需要的 silk，
> 因此不需要额外安装 ffmpeg，也不用关心 GPT-SoVITS 输出是 32 kHz 还是 48 kHz。
> 若语音发送失败，先看 bot 日志里的 TTS 报错，再看 SnowLuma WebUI 的实时日志。

## 表情包识别（视觉模型）

- 群里发表情包/图片时，bot 会下载图片、按 MD5 缓存描述，同一张图只识别一次。
- 识别请求发往 `vision.llm.endpoint`（默认本地 Qwen3-VL），**不会**走文字模型；
  这样智谱只负责说话，Qwen 只负责读图。
- 识别失败会降级成「一张表情包（识别失败）」，不会中断对话。
- 本地 Qwen 视觉服务用 `./scripts/start-llama.sh` 启动；没有启动时，
  bot 仍可正常聊天，只是表情包会变成通用描述。

## 测试

```bash
npm test         # 单元测试：@解析、上下文裁剪、存储隔离、人设结构；不需要模型
npm run smoke    # 端到端对话，需要模型在线
```

## 数据与隐私

- 所有运行数据都在 `stateDir`（默认 `./state`）下，按群号分文件：
  历史、情绪叠态、记忆、语音临时文件、图片缓存。
- **想清空某个群的记忆/情绪**：停掉 bot，删除 `state/` 里对应的 `group_<群号>.json`
  和 `history_<群号>.json`。
- `config.json`、`state/`、`logs/` 已在 `.gitignore` 中；不要把它们提交到公开仓库。
- `config.json` 里有 QQ 号和 API key，分享项目前先删掉。

## 常见问题

**SnowLuma 报 `COMPONENT_LOAD_FAILED` / `component loading failed`？**
Linux 下 SnowLuma 通过 ptrace 把 Hook 注入 QQ。若 `kernel.yama.ptrace_scope > 0`，
同用户但非父子进程的注入会被拒绝（`/proc/<QQ pid>/mem` 也会提示权限不足）。临时处理：

```bash
sudo sysctl -w kernel.yama.ptrace_scope=0
```

然后在 SnowLuma WebUI 里重新加载/重连 QQ 进程。需要持久化可写入
`/etc/sysctl.d/99-snowluma.conf`；注意这会降低本机进程隔离，建议只在个人机器上使用。
Docker 部署则需要 `cap_add: SYS_PTRACE` 和 `security_opt: seccomp=unconfined`。

**@ 了但没反应？**
检查：`groups.allow` 是否包含该群、是否真的 @ 到了 bot、日志里是否有 `OneBot 已连接`。
没有冷却机制；如果上一轮还在生成，新消息会排队等回合锁。SnowLuma 掉线或重启时
bot 会自动重连，日志会有提示。

**回复里还是有括号旁白？**
runtime 和 `bot.js` 都会剥离括号内容。如果模型仍大量输出旁白，
多半是 persona 的例句示范了动作描写——把例句改成纯台词再试。

**模型总猜用户的名字 / 乱编称呼？**
在 `systemPrompt` 的「绝对禁止」里加一条具体反例，并保留「不知道就说没记住」的引导。
runtime 也会从对话里提取并记忆用户自述的事实，多聊几轮会更稳。

**为什么 bot 接话太频繁 / 不接话？**
旁听只在 `ambient.groups` 指定的群里生效。太频繁就调大 `ambient.minIntervalMs`、收紧
`ambient.keywords`，或关掉 `ambient.enabled`；不接话先看日志里有没有「旁听判定」，
再确认文字模型能正常响应判定请求。

**回复为什么像小作文？**
检查 `reply.segmentMaxChars`（默认 45）和 `segmentMaxMessages`（默认 6）。
如果模型一次就输出了一大段且没有标点，只会按长度硬切，读起来仍会偏机械，
可以在 persona 的例句里示范短句。

**语音模式下为什么没有文字？**
这是预期行为：语音模式只发语音、不加等待。TTS 失败时才会自动降级为文字。
想改回文字，打开 <http://127.0.0.1:5100> 取消勾选即可。

**换角色要改代码吗？**
不用。改 `src/persona.js`，必要时换 `config.voice` 的参考音频即可。

**显存不够？**
4B 级 Q4 量化模型（含视觉投影）约 4~5 GB；若还要同时跑 TTS，
可降低上下文长度（`-c 2048`）、减少 GPU 层数（`-ngl`）或把模型放到远程端点。

## 致谢与许可

- 对话纪律层 `vendor/presence-turn-runtime/` 来自 presence-turn-runtime，MIT License，原样内置。
- 分段逻辑移植自 [qikou（气口）](https://github.com/Grabrun/qikou)，MIT License，
  Copyright (c) 2026 Grabrun；本仓库做了面向 QQ 纯台词的精简。完整许可见
  [`THIRD_PARTY_NOTICES.md`](THIRD_PARTY_NOTICES.md)。
- 设计调研参考了 [Qbot](https://github.com/TIGillusion/Qbot) 的分段后随机间隔、
  [astrbot_plugin_proactive_chat](https://github.com/DBJD-CR/astrbot_plugin_proactive_chat)
  的主动对话/分段配置思路、[dsh-napcat](https://github.com/wzwei1990/dsh-napcat) 的按长度分段。
  这些项目许可各不相同（GPL/AGPL/MIT），本仓库只借鉴思路，未复制其代码。
- 模板代码可自由用于个人项目；使用 GPT-SoVITS 时请遵守其许可与使用条款。
- [SnowLuma](https://github.com/SnowLuma/SnowLuma) 是独立的第三方项目，采用源码可见的非商业许可，
  **本仓库不包含其源码或二进制**。请从官方 Releases 获取，并遵守其 LICENSE / EULA；
  商业使用或公开分发修改版、衍生版需事先取得书面授权。
