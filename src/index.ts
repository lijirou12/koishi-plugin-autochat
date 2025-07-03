import { Context, Schema } from 'koishi'
import 'koishi-plugin-chatluna'
import {
  queryJoinedConversationRoom,
  queryPublicConversationRoom,
} from 'koishi-plugin-chatluna/chains'

export const name = 'autochat'
export const reusable = true
export const inject = ['chatluna', 'database']

export interface Config {
  interval: number
  prompt: string
  channelId: string // QQ 号或群号（根据 channelType 决定）
  channelType?: 'group' | 'private' // 默认 group
  botSelfId?: string // 指定使用的机器人 selfId，可选
  // name?: string // 传递给 ChatLuna 的 {name} 变量（已回退）
}

export const Config: Schema<Config> = Schema.object({
  interval: Schema.number()
    .description('定时任务的间隔时间（分钟）')
    .default(60),
  prompt: Schema.string()
    .description('发送给 AI 的内容模板，`{time}` 将被替换为当前时间。')
    .default('现在是北京时间 {time}，请记录下来。'),
  channelId: Schema.string()
    .description('要把回复发送到的频道 ID（QQ 号或群号）')
    .required(),
  channelType: Schema.union(['group', 'private'])
    .description('发送到群聊还是私聊')
    .default('group'),
  botSelfId: Schema.string()
    .description('（可选）指定用于发送消息的机器人 selfId，如果留空则使用第一个可用机器人。')
    .default(''),
  // name: Schema.string()
  //   .description('替换 ChatLuna 预设中的 {name} 变量')
  //   .default(''),
})

function buildSession(ctx: Context, bot, config: Config, content: string) {
  const s = bot.session()
  if (config.channelType === 'group') {
    s.guildId = config.channelId
    s.channelId = config.channelId
    s.userId = 'autochat' // 一个占位 userId，用于加入房间
  } else {
    s.guildId = '0'
    s.channelId = config.channelId
    s.userId = config.channelId // 私聊用对方 QQ 号
  }
  s.content = content
  return s as any
}

export function apply(ctx: Context, config: Config) {
  let intervalHandle: (() => void) | null = null
  const loadedPlatforms = new Set<string>()

  const events = {
    'llm-queue-waiting': async () => {},
    'llm-used-token-count': async () => {},
  }

  async function sendOnce(customPrompt?: string, sessionSource?) {
    const bot = ctx.bots.find((b) => !config.botSelfId || b.selfId === config.botSelfId)
    if (!bot) {
      ctx.logger.warn('[autochat] 没有找到可用的 bot，取消发送。')
      return
    }

    const timeStr = new Date().toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' })
    const message = (customPrompt && customPrompt.length > 0)
      ? customPrompt
      : config.prompt.replace('{time}', timeStr)

    // 构造虚拟 Session
    const vSession = sessionSource ?? buildSession(ctx, bot, config, message)

    // 获取房间
    let room
    if (config.channelType === 'private') {
      room = await queryJoinedConversationRoom(ctx, vSession)
    } else {
      room = await queryPublicConversationRoom(ctx, vSession)
    }

    if (!room) {
      ctx.logger.warn('[autochat] 找不到对应房间，已跳过。')
      return
    }

    // 确保平台已就绪（只等待一次）
    try {
      const platform = room.model.split('/')[0]
      if (!loadedPlatforms.has(platform)) {
        ctx.logger.info(`[autochat] 等待平台 ${platform} 加载...`)
        await (ctx as any).chatluna.awaitLoadPlatform(platform, 60000)
        loadedPlatforms.add(platform)
        ctx.logger.info(`[autochat] 平台 ${platform} 已就绪。`)
      }
    } catch {}

    try {
      ctx.logger.info(`[autochat] 向房间发送: ${message}`)
      const replyMsg = await (ctx as any).chatluna.chat(
        vSession,
        room,
        { role: 'user', content: message },
        events,
        false,
      )
      const reply = replyMsg?.content ?? ''
      if (!reply) return
      ctx.logger.info(`[autochat] ChatLuna 回复: ${reply}`)

      const targetId = (config.channelType === 'private' ? 'private:' : 'group:') + config.channelId
      await bot.sendMessage(targetId, reply)
    } catch (err) {
      ctx.logger.error('[autochat] 调用 ChatLuna 失败', err)
    }
  }

  const startInterval = () => {
    if (intervalHandle) return
    intervalHandle = ctx.setInterval(() => sendOnce(), config.interval * 60 * 1000)
  }

  startInterval()

  ctx.on('dispose', () => {
    intervalHandle?.()
    intervalHandle = null
  })

  ctx.command('autochat [prompt:text]', '立即触发一次自动聊天', { authority: 1 })
    .usage('示例: /autochat 现在几点？')
    .action(async ({ session }, prompt) => {
      await sendOnce(prompt, session as any)
    })
}
