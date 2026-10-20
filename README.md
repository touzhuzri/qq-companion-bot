# QQ 陪伴型 Bot 模板

一个**不带任何角色设定**的 QQ 群聊天 bot 骨架。开箱即可运行，但默认人设是空的——
所有 TODO 都集中在 [`src/persona.js`](src/persona.js)，按 [「如何定制性格」](#如何定制性格) 填完，
它就有自己的性格和说话方式了。

对话由 [presence-turn runtime](vendor/presence-turn-runtime)（已内置）统一约束：
每轮先判断用户意图，再套用约束卡，最后剥离旁白、必要时抢救重写一次，并让情绪状态带进下一轮。
你只需要写「这个人是谁、怎么说话」。

```
QQ 群 @消息 ⇄ NapCat(OneBot 11) ⇄ 本服务(Node)
                                   ├─ 表情包: MD5 缓存 → 多模态模型识别
                                   ├─ presence-turn runtime: 分类→约束→剥离→抢救≤1→情绪叠态+记忆
                                   └─ LLM: 任意 OpenAI 兼容端点(默认本地 llama.cpp)
                                          └─ 可选: GPT-SoVITS 语音(api_v2)
```

## 特性

- **零 npm 依赖**：Node ≥ 22 自带 WebSocket / fetch，clone 下来直接跑。
- **只在被 @ 时回复**：连续消息（默认 2 秒内、同一人）自动合并成一轮；同群有冷却。
- **按群隔离**：上下文、情绪叠态、记忆、表情包缓存都按群号分开落盘，互不串台。
- **对话纪律层**：禁止括号动作旁白、禁止仆人式讨好、禁止「你先忙」式打发；
  模型跑偏时会自动纠正一次（salvage ≤ 1）。
- **模型自由**：本地 llama.cpp / vLLM，或任何 OpenAI 兼容在线 API，改 `llm.endpoint` 即可。
- **图片识别**：群里发表情包时，用同一个多模态模型压成一句话喂给对话；同图只识别一次。
- **语音可选**：接 GPT-SoVITS `api_v2` 合成语音，失败自动降级为纯文字。

## 目录结构

```
.
├── src/
│   ├── persona.js        ★ 角色人设（唯一需要大改的文件）
│   ├── bot.js            主流程：@触发 → 合并 → 冷却 → sendTurn → 分条发送
│   ├── config.js         配置加载与校验（fail fast）
│   ├── onebot.js         NapCat 正向 WebSocket 客户端（心跳假死检测、指数退避重连）
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
├── start-all.sh          一键启动：模型 → 语音(可选) → bot → NapCat
└── state/                运行数据（按群文件，首次运行自动生成）
```

## 环境要求

| 依赖 | 用途 | 是否必需 |
| --- | --- | --- |
| Node.js ≥ 22 | 运行 bot | 必需 |
| [NapCat](https://napcat.napneko.icu/) | QQ ⇄ OneBot 11 网关 | 必需 |
| OpenAI 兼容模型端点 | 对话；视觉需要多模态 | 必需 |
| [llama.cpp](https://github.com/ggml-org/llama.cpp) `llama-server` | 本地跑模型 | 可选 |
| GPT-SoVITS | 语音合成 | 可选 |

> NapCat 走的是非官方协议，**有封号风险，请用小号**，不要用大号。

## 快速开始

### 1. 准备配置

```bash
cp config.example.json config.json
```

至少填 `botQQ`（bot 的 QQ 号），并确认 `onebot.wsUrl` 和 NapCat 的监听端口一致。

### 2. 准备模型

**本地（默认）**：把两个 gguf 放进 `models/qwen3-vl-4b/`，然后：

```bash
./scripts/start-llama.sh
```

模型文件名或目录不同，用环境变量指定：

```bash
MODEL_DIR=/path/to/model MODEL_FILE=xxx.gguf MMPROJ_FILE=mmproj.gguf ./scripts/start-llama.sh
```

**远程 / 在线 API**：不用启动 llama-server，把 `config.json` 的 `llm` 改成对应端点即可：

```json
"llm": {
  "endpoint": "https://your-provider/v1/chat/completions",
  "apiKey": "sk-...",
  "model": "your-model"
}
```

> `apiKey` 也可以走环境变量，自行改为读取 `process.env`；不要把真实 key 提交进仓库。

### 3. 配置 NapCat

1. 安装并登录 QQ 小号。
2. 打开 NapCat 的**网络配置**，启用**正向 WebSocket 服务**，监听 `127.0.0.1:3001`
   （要和 `config.json` 的 `onebot.wsUrl` 一致）。
3. 如果设置了 access token，同步填进 `onebot.accessToken`。
4. 把 bot 拉进群，设为普通成员即可；**只有 @ 它才会回话**。

### 4. 启动

```bash
npm start
```

或者一键启动（模型 + 可选语音 + bot + NapCat 前台二维码）：

```bash
./start-all.sh
```

设置 `SOVITS_DIR=/path/to/GPT-SoVITS/repo` 才会顺带启动语音服务；
使用远程模型时用 `START_LLAMA=0 ./start-all.sh`。

启动成功的标志是日志出现 `OneBot 已连接`。

## 配置说明（config.json）

| 字段 | 默认 | 说明 |
| --- | --- | --- |
| `botQQ` | — | bot 的 QQ 号，@ 判定依据，**必填** |
| `onebot.wsUrl` | `ws://127.0.0.1:3001` | NapCat 正向 WS 地址 |
| `onebot.accessToken` | `""` | WS access token，没设就留空 |
| `onebot.staleTimeoutMs` | `120000` | 多久没收到任何帧就判定假死并重连 |
| `llm.endpoint` | `http://127.0.0.1:8080/v1/chat/completions` | OpenAI 兼容对话端点 |
| `llm.apiKey` | `local` | 本地服务随便填；在线 API 填真 key |
| `llm.model` | `qwen3-vl-4b` | 模型名 |
| `groups.allow` | `[]` | 允许响应的群号列表，**空 = 所有群** |
| `trigger.debounceMs` | `2000` | 触发后等待合并后续消息的窗口 |
| `trigger.cooldownMs` | `8000` | 同群两次回复之间的最短间隔 |
| `history.maxItems` | `24` | 每群保留的历史条数（真正喂给模型的更少） |
| `vision.enabled` | `true` | 是否识别图片；模型端点必须是多模态的 |
| `voice.enabled` | `false` | 是否发送语音 |
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

模板里已经按顺序留好了 TODO，照着填即可：

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

- [ ] `src/persona.js` 里没有残留的 TODO
- [ ] `name` 和 `voiceHint` 已改，不是模板默认值
- [ ] 例句里没有括号动作/神态描写
- [ ] 没有出现现代词或元词汇（除非角色本身就该说）
- [ ] `npm test` 通过
- [ ] `npm run smoke` 连续三轮表现稳定，再放入 QQ 群

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

`refAudioPath` 必须是**绝对路径**：NapCat 进程的工作目录和 bot 不同，相对路径它打不开。
文字回复一定会先发；语音合成或发送失败只记日志，不会影响对话。

> 不同 GPT-SoVITS 版本输出的采样率不同（v2 = 32 kHz，v4 = 48 kHz），
> 部分 NapCat 版本对高采样率转码不稳定。若语音发送失败，先检查日志里的 TTS/转码报错，
> 必要时在 `src/voice.js` 里补一步 ffmpeg 重采样。

## 图片识别

- 收到图片时，会把图片下载下来、按 MD5 缓存描述，同一张图只识别一次。
- 识别请求发往 `llm.endpoint`，因此端点必须支持多模态输入；
  纯文本模型请把 `vision.enabled` 设为 `false`。
- 识别失败会降级成「一张表情包（识别失败）」，不会中断对话。

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

**@ 了但没反应？**
检查：`groups.allow` 是否包含该群、是否真的 @ 到了 bot、是否在 `cooldownMs` 冷却中、
日志里是否有 `OneBot 已连接`。NapCat 掉线时 bot 会自动重连，日志会有提示。

**回复里还是有括号旁白？**
runtime 和 `bot.js` 都会剥离括号内容。如果模型仍大量输出旁白，
多半是 persona 的例句示范了动作描写——把例句改成纯台词再试。

**模型总猜用户的名字 / 乱编称呼？**
在 `systemPrompt` 的「绝对禁止」里加一条具体反例，并保留「不知道就说没记住」的引导。
runtime 也会从对话里提取并记忆用户自述的事实，多聊几轮会更稳。

**换角色要改代码吗？**
不用。改 `src/persona.js`，必要时换 `config.voice` 的参考音频即可。

**显存不够？**
4B 级 Q4 量化模型（含视觉投影）约 4~5 GB；若还要同时跑 TTS，
可降低上下文长度（`-c 2048`）、减少 GPU 层数（`-ngl`）或把模型放到远程端点。

## 致谢与许可

- 对话纪律层 `vendor/presence-turn-runtime/` 来自 presence-turn-runtime，MIT License，原样内置。
- 模板代码可自由用于个人项目；使用 NapCat / GPT-SoVITS 时请遵守各自许可与使用条款。
