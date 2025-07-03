# koishi-plugin-autochat

[![npm version](https://img.shields.io/npm/v/koishi-plugin-autochat?color=brightgreen&style=flat-square)](https://www.npmjs.com/package/koishi-plugin-autochat)
[![koishi](https://img.shields.io/badge/koishi-4.x-orange?style=flat-square)](https://koishi.chat/)
[![license](https://img.shields.io/github/license/lijirou12/koishi-plugin-autochat?style=flat-square)](LICENSE)

> 🕰️ 定时向 ChatLuna 询问并自动将回复发送到指定频道的 Koishi 插件，旨在实现AI主动发起聊天。
> 
> 典型场景：每隔 60 分钟询问当前时间并记录到群聊。

## ✨ 特性

- ⏰ **定时触发**：按设定间隔自动与 AI 对话
- 🎯 **灵活投递**：支持群聊 / 私聊，两种模式
- 🤖 **多 Bot 兼容**：可指定 `selfId`，亦可自动选取首个 Bot
- 🔗 **依赖 ChatLuna**：复用 `koishi-plugin-chatluna` 与各类 LLM 平台
- 🛠️ **手动触发**：提供 `/autochat` 指令即时调用

## 📦 安装

```bash
# yarn
yarn add koishi-plugin-autochat

# npm
npm i koishi-plugin-autochat
```

> 本插件依赖 `koishi-plugin-chatluna`，请确保已安装并正确配置对应平台（如 Google Gemini、OpenAI 等目前只确定适配了Gemini）。

## 🚀 快速上手

在 `koishi.yml` 中启用插件填写配置也可以直接在webui中配置：

```yaml
plugins:
  autochat:
    interval: 60                     # 任务间隔（分钟）
    prompt: 现在是北京时间 {time}，请记录下来。  # 发送给 AI 的内容模板
    channelId: '123456'              # 群号或 QQ 号
    channelType: group               # group | private
    botSelfId: ''                    # （可选）指定用于发送消息的机器人 selfId
```

### 配置项详解

| 名称 | 类型 | 默认值 | 说明 |
| ---- | ---- | ------ | ---- |
| `interval` | `number` | `60` | 触发间隔（分钟） |
| `prompt` | `string` | `"现在是北京时间 {time}，请记录下来。"` | 发送给 AI 的模板。`{time}` 会被替换为当前北京时间 |
| `channelId` | `string` | – | 目标频道 ID（群号或 QQ 号） |
| `channelType` | `'group' \| 'private'` | `'group'` | 发送到群聊还是私聊 |
| `botSelfId` | `string` | `''` | 指定发送消息的机器人 selfId（留空则自动选择首个 Bot） |

### 指令

| 指令 | 权限 | 功能 |
| ----- | ----- | ----- |
| `/autochat [prompt]` | 1 | 立即触发一次自动聊天；`prompt` 将覆盖默认模板 |

**示例：**
```
/autochat 现在几点？
```

插件会把该提问发送给 ChatLuna，并将 AI 回复转发到 `channelId` 指定的频道。

## 🖥️ 本地开发

```bash
# 克隆仓库
git clone https://github.com/lijirou12/koishi-plugin-autochat
cd koishi-plugin-autochat

# 安装依赖
yarn

# 构建
yarn build
```

## 📄 License

MIT © 2024 lijirou12
