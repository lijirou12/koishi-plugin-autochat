import { Context, Schema } from 'koishi'
import 'koishi-plugin-chatluna'
import { queryJoinedConversationRoom, queryPublicConversationRoom } from 'koishi-plugin-chatluna/chains'

export const name = 'autochat'
export const reusable = true
export const inject = ['chatluna', 'database']

export interface Config {
  interval: number
  prompt: string
  channelId: string
  channelType?: 'group' | 'private'
  botSelfId?: string
}

export const Config: Schema<Config> = Schema.object({
  interval: Schema.number().description('定时任务的间隔时间（分钟）').default(60),
  prompt: Schema.string().description('发送给 AI 的内容模板，`{time}` 将被替换为当前时间。').default('现在是北京时间 {time}，请记录下来。'),
  channelId: Schema.string().description('要把回复发送到的频道 ID（QQ 号或群号）').required(),
  channelType: Schema.union(['group', 'private']).description('发送到群聊还是私聊').default('group'),
  botSelfId: Schema.string().description('（可选）指定用于发送消息的机器人 selfId，如果留空则使用第一个可用机器人。').default(''),
})

function buildSession(ctx: Context, bot, config: Config, content: string) {
  const s = bot.session()
  if (config.channelType === 'group') {
    s.guildId = config.channelId
    s.channelId = config.channelId
    s.userId = 'autochat'
  } else {
    s.guildId = '0'
    s.channelId = config.channelId
    s.userId = config.channelId
  }
  s.content = content
  return s as any
}

export function apply(ctx: Context, config: Config) {
  let intervalHandle: () => void | null = null
  const loadedPlatforms = new Set<string>()
  const events = {
    'llm-queue-waiting': async () => {},
    'llm-used-token-count': async () => {},
  }

  async function sendOnce(customPrompt?: string, sessionSource?) {
    const bot = ctx.bots.find(b => !config.botSelfId || b.selfId === config.botSelfId)
    if (!bot) return

    const timeStr = new Date().toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' })
    const message = customPrompt?.length ? customPrompt : config.prompt.replace('{time}', timeStr)

    const vSession = sessionSource ?? buildSession(ctx, bot, config, message)

    const room = config.channelType === 'private'
      ? await queryJoinedConversationRoom(ctx, vSession)
      : await queryPublicConversationRoom(ctx, vSession)
    if (!room) return

    const [platform] = room.model.split('/')
    if (!loadedPlatforms.has(platform)) {
      await (ctx as any).chatluna.awaitLoadPlatform(platform, 60_000)
      loadedPlatforms.add(platform)
    }

    const replyMsg = await (ctx as any).chatluna.chat(
      vSession,
      room,
      { role: 'user', content: message },
      events,
      false,
    )

    const reply = replyMsg?.content
    if (!reply) return

    const targetId = (config.channelType === 'private' ? 'private:' : 'group:') + config.channelId
    await bot.sendMessage(targetId, reply)
  }

  const start = () => {
    if (intervalHandle) return
    intervalHandle = ctx.setInterval(() => sendOnce(), config.interval * 60 * 1000)
  }

  start()
  ctx.on('dispose', () => intervalHandle?.())

  ctx.command('autochat [prompt:text]', '立即触发自动聊天').action(({ session }, prompt) => sendOnce(prompt, session))
} 