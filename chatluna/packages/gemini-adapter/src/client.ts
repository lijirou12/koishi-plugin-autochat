import { Context } from 'koishi'
import { PlatformModelAndEmbeddingsClient } from 'koishi-plugin-chatluna/llm-core/platform/client'
import { ClientConfig } from 'koishi-plugin-chatluna/llm-core/platform/config'
import {
    ChatHubBaseEmbeddings,
    ChatLunaChatModel,
    ChatLunaEmbeddings
} from 'koishi-plugin-chatluna/llm-core/platform/model'
import {
    ModelInfo,
    ModelType
} from 'koishi-plugin-chatluna/llm-core/platform/types'
import {
    ChatLunaError,
    ChatLunaErrorCode
} from 'koishi-plugin-chatluna/utils/error'
import { Config } from '.'
import { GeminiRequester } from './requester'
import { ChatLunaPlugin } from 'koishi-plugin-chatluna/services/chat'

export class GeminiClient extends PlatformModelAndEmbeddingsClient {
    platform = 'gemini'

    private _requester: GeminiRequester

    private _models: Record<string, ModelInfo>

    constructor(
        ctx: Context,
        private _config: Config,
        clientConfig: ClientConfig,
        plugin: ChatLunaPlugin
    ) {
        super(ctx, clientConfig)
        this.platform = this.config.platform

        this._requester = new GeminiRequester(
            clientConfig,
            plugin,
            this._config
        )
    }

    async init(): Promise<void> {
        await this.getModels()
    }

    async refreshModels(): Promise<ModelInfo[]> {
        try {
            let rawModels = await this._requester.getModels()

            if (!rawModels.length) {
                throw new ChatLunaError(
                    ChatLunaErrorCode.MODEL_INIT_ERROR,
                    new Error('No model found')
                )
            }

            rawModels = rawModels.map((model) => model.replace('models/', ''))

            const models: ModelInfo[] = []

            for (const model of rawModels) {
                const info = {
                    name: model,
                    maxTokens: ((model) => {
                        if (model.includes('gemini-1.5-pro')) {
                            return 1048576
                        }
                        if (
                            model.includes('gemini-1.5-flash') ||
                            model.includes('gemini-2.0-pro') ||
                            model.includes('gemini-2.5-pro')
                        ) {
                            return 2097152
                        }
                        if (model.includes('gemini-1.0-pro')) {
                            return 30720
                        }
                        return 1048576
                    })(model),
                    type: model.includes('embedding')
                        ? ModelType.embeddings
                        : ModelType.llm,
                    functionCall: !model.includes('vision'),
                    supportMode: ['all']
                }

                if (model.includes('gemini-2.5')) {
                    if (!model.includes('-thinking')) {
                        models.push(
                            { ...info, name: model + '-no-thinking' },
                            { ...info, name: model + '-thinking' },
                            info
                        )
                    } else {
                        models.push(info)
                    }
                } else {
                    models.push(info)
                }
            }

            return models
        } catch (e) {
            throw new ChatLunaError(ChatLunaErrorCode.MODEL_INIT_ERROR, e)
        }
    }

    async getModels(): Promise<ModelInfo[]> {
        if (this._models) {
            return Object.values(this._models)
        }

        const models = await this.refreshModels()

        this._models = {}

        for (const model of models) {
            this._models[model.name] = model
        }
    }

    protected _createModel(
        model: string
    ): ChatLunaChatModel | ChatHubBaseEmbeddings {
        const info = this._models[model]

        if (info == null) {
            throw new ChatLunaError(ChatLunaErrorCode.MODEL_NOT_FOUND)
        }

        if (info.type === ModelType.llm) {
            return new ChatLunaChatModel({
                modelInfo: info,
                requester: this._requester,
                model,
                modelMaxContextSize: info.maxTokens,
                maxTokenLimit: this._config.maxTokens,
                timeout: this._config.timeout,
                temperature: this._config.temperature,
                maxRetries: this._config.maxRetries,
                llmType: this.platform
            })
        }

        return new ChatLunaEmbeddings({
            client: this._requester,
            model,
            maxRetries: this._config.maxRetries
        })
    }
}
