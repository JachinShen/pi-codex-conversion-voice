# Pi 浏览器 PCM 播放补丁

> 下文保留原始补丁阶段的操作记录；其中“未启用/待试听”不代表当前运行态。用户已报告修复版试听正常。本 Git 候选包已包含补丁，安装方式、构建与发布说明见根目录 `FORK.md`。

仅针对 `@howaboua/pi-codex-conversion@3.0.10`。`apply.mjs` 对包名、版本和两个原始文件的 SHA256（`upstream.json`）全部校验，再生成新目录，拒绝原地修改、覆盖、重复应用。只改变 `src/voice/lan/audio-worklet.ts` 与对应 `dist`；无需编译器或第三方测试框架。原插件与运行中语音不受影响。

## 改动

- 将固定 250ms 丢旧队列改为显式有界环形队列，默认上限 2000ms；300ms、1s 分块不再被无条件截断。持续过载只在上限丢最旧样本，不建立第二条无限等待队列。超过上限的单块仍丢弃前部，这是明确的延迟/保真取舍。
- 默认起播蓄积 80ms，欠载恢复蓄积 120ms；不足阈值的短尾巴最多等 120ms（加一个 render quantum），不永久搁置。恢复不重播已消费样本。
- 当前/下一样本留在环内，修复 drain 丢尾部样本。无 EOS 协议时最后一个源样本用保持值完成自身时长。仍为线性重采样，不改变 capture/TTS。
- 关闭/停止路径仍断开节点并关闭 AudioContext，不把队列搬到全局。额外支持 worklet 消息 `{type:'clear'}` 即时清空，包括相位与恢复状态。**当前上游没有单独的浏览器打断清队列消息链路**；此补丁不伪称新增了服务端 VAD/barge-in 协议。已有 stop/close 行为保留，测试覆盖 worklet clear。
- `processorOptions` 可配置 `startBufferMs`（0–500）、`recoveryBufferMs`（0–500）、`maxWaitMs`（20–500）、`maxBufferMs`（300–5000）。当前上游创建节点不传这些参数，故使用默认值；需要自定义时，在下游节点构造中传入这些参数，不是已有 Pi 设置项。
- 诊断仅在 worklet 内维护累计接收/丢弃/欠载/高水位/块数/最大到达间隔（render 帧时钟）。不输出、不存盘、不采集音频；未往麦克风 port 发诊断对象，避免其被上游当音频发送。

## 离线验证

```sh
PI_VOICE_UPSTREAM="$HOME/.pi/agent/npm/node_modules/@howaboua/pi-codex-conversion" \
  node --test packages/pi-voice-browser-fix/test.mjs
```

测试先复制原版到系统临时目录，再应用补丁到另一临时目录，退出清理。VM 执行真实 source/dist worklet 字符串，使用合成 PCM，不使用浏览器、录音或声卡。
覆盖：原版 300ms 截断对照、48kHz 丢两个尾样本对照、16/24/44.1/48/96kHz 插值连续性、跨 render 的突发分块、20ms 延迟到达、欠载恢复及短尾巴、60 秒持续过载、clear、非法消息和应用器拒绝错误版本/hash。

## 可逆应用（之后由用户决定；这里不会执行启用）

```sh
node packages/pi-voice-browser-fix/apply.mjs \
  "$HOME/.pi/agent/npm/node_modules/@howaboua/pi-codex-conversion" \
  /absolute/path/to/new-pi-codex-conversion
```

输出必须不存在，父目录必须存在。先审阅原目录和副本的 diff。副本不自动安装依赖；若移出原 node_modules 层级，使用它前须确保依赖可解析。待当前会话结束，在 Pi 包设置中把原 npm 来源替换为该本地目录（不要同时加载两份），另启会话做 AMD 浏览器 A/B。回滚只需恢复原 npm 来源；原包未改动。不要在活跃语音期间切换。

Nix 可通过 `pkgs.callPackage ./packages/pi-voice-browser-fix { src = pristinePackage; }` 构建；`src` 必须是完整解包原版（不能是补丁副本）。derivation 先跑测试，输出完整补丁包目录，无自动激活。Nix 构建允许写当前 `$out`；普通 CLI 拒绝 `/nix/store`。这只是补丁输出，**不是完整依赖打包/Home Manager 集成**。本轮未执行 Nix 构建。

## 限制与后续验收

真实 chunk 节奏尚未知，不能把离线通过等同于听感已修复。更大上限意味着网络大突发时可能积累最多约 2 秒本地音频；正常启动额外约 40ms。欠载时仍补零，无法重建未到达音频。

已完整检查发送链路：服务端 `browser-connections.sendAudio` 在 `bufferedAmount >= 48000` 时仍丢新块（约 1 秒 PCM）。本补丁不扩大阈值或建立服务端重试队列：那会引入额外延迟、旧音频打断风险，且没有实际拥塞证据。浏览器队列不能修复这里已丢失的音频。下一轮若仍断续，应只采计数/到达时间以区分上游丢块、浏览器调度与工作线程欠载，不录音。
