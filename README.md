# koishi-plugin-autochat

定时向 **ChatLuna / Gemini** 发送北京时间并把回复转发到指定的私聊或群组的 [Koishi](https://koishi.chat/) 插件。

> Periodically send the current Beijing time to **ChatLuna / Gemini** and forward the reply back to a private or group chat.

---

## 安装 Installation

```bash
pnpm add koishi-plugin-autochat
# 或者 npm / yarn
# npm i koishi-plugin-autochat
# yarn add koishi-plugin-autochat
```

安装完成后，在 Koishi 控制台中 **启用插件** 并按照下方的配置说明填写参数即可。

## 用例 Example

```ts
import { Context } from 'koishi'
import * as autochat from 'koishi-plugin-autochat'

export const name = 'my-bot'
export function apply(ctx: Context) {
  ctx.plugin(autochat, {
    interval: 30, // 每 30 分钟
    channelId: '123456',
    channelType: 'group',
  })
}
```

## 依赖 Dependencies

- `koishi >= 4.15.0`
- `koishi-plugin-chatluna`（或兼容的 ChatLuna / Gemini 提供者）

## License

[MIT](./LICENSE) 