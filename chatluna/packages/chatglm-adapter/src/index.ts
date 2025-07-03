import { ChatLunaPlugin } from 'koishi-plugin-chatluna/services/chat'
import { Context, Schema } from 'koishi'
import { OpenLLMClient } from './client'

export function apply(ctx: Context, config: Config) {
    const plugin = new ChatLunaPlugin(ctx, config, 'openllm')

    ctx.on('ready', async () => {
        plugin.registerToService()

        await plugin.parseConfig((config) => {
            return config.apiKeys.map(([apiKey, apiEndpoint]) => {
                return {
                    apiKey,
                    apiEndpoint,
                    platform: 'openllm',
                    chatLimit: config.chatTimeLimit,
                    timeout: config.timeout,
                    maxRetries: config.maxRetries,
                    concurrentMaxSize: config.chatConcurrentMaxSize
                }
            })
        })

        plugin.registerClient(
            (_, clientConfig) =>
                new OpenLLMClient(ctx, config, clientConfig, plugin)
        )

        await plugin.initClients()
    })
}

export interface Config extends ChatLunaPlugin.Config {
    apiKeys: [string, string][]
    embeddings: string
    maxTokens: number
    temperature: number
    presencePenalty: number
    frequencyPenalty: number
}

export const Config: Schema<Config> = Schema.intersect([
    ChatLunaPlugin.Config,
    Schema.object({
        apiKeys: Schema.array(
            Schema.tuple([
                Schema.string().role('secret').default(''),
                Schema.string().default('http://127.0.0.1:8000')
            ])
        ).default([['', 'http://127.0.0.1:8000']]),
        embeddings: Schema.string().default('moka-ai/m3e-base')
    }),
    Schema.object({
        maxTokens: Schema.number().min(16).max(36000).step(16).default(4096),
        temperature: Schema.percent().min(0).max(1).step(0.1).default(0.8),
        presencePenalty: Schema.number().min(-2).max(2).step(0.1).default(0.2),
        frequencyPenalty: Schema.number().min(-2).max(2).step(0.1).default(0.2)
    })
]).i18n({
    'zh-CN': require('./locales/zh-CN.schema.yml'),
    'en-US': require('./locales/en-US.schema.yml')
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
}) as any

export const inject = ['chatluna']

export const name = 'chatluna-chatglm-adapter'
