# 第三方 notices

本仓库包含或改编了以下第三方代码：

## qikou (Cadence)

`src/split.js` 的断句与打包逻辑移植/精简自：

- 项目：https://github.com/Grabrun/qikou
- 用途：按标点与长度切分聊天回复
- 许可：MIT

```
MIT License

Copyright (c) 2026 Grabrun

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```

## presence-turn-runtime

`vendor/presence-turn-runtime/` 来自上游，许可文本见
`vendor/presence-turn-runtime/LICENSE`（MIT）。本仓库对
`src/runtime/composer.js` 和 `src/runtime/compilePrompt.js` 做了少量修改：
支持通过 persona 的 `format` 字段控制回复句数、单句字数和整轮字数，
其余逻辑保持上游原样。

## 未随仓库分发的项目

- SnowLuma（QQ ⇄ OneBot 网关）：源码可见的非商业许可，本仓库不包含其源码或二进制。
  请从官方 Releases 获取并遵守其 LICENSE / EULA。

以下项目的设计被调研参考，但未复制代码：

- Qbot — https://github.com/TIGillusion/Qbot (GPL-3.0)
- astrbot_plugin_proactive_chat — https://github.com/DBJD-CR/astrbot_plugin_proactive_chat (AGPL-3.0)
- dsh-napcat — https://github.com/wzwei1990/dsh-napcat (MIT)
