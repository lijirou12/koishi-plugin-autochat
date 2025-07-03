import { ChatGenerationChunk } from '@langchain/core/outputs'
import {
    EmbeddingsRequester,
    EmbeddingsRequestParams,
    ModelRequester,
    ModelRequestParams
} from 'koishi-plugin-chatluna/llm-core/platform/api'
import { ClientConfig } from 'koishi-plugin-chatluna/llm-core/platform/config'
import {
    ChatLunaError,
    ChatLunaErrorCode
} from 'koishi-plugin-chatluna/utils/error'
import { sseIterable } from 'koishi-plugin-chatluna/utils/sse'
import * as fetchType from 'undici/types/fetch'
import { Config, logger } from '.'
import {
    ChatCompletionResponse,
    ChatCompletionResponseMessageRoleEnum,
    CreateEmbeddingResponse
} from './types'
import {
    convertDeltaToMessageChunk,
    formatToolsToOpenAITools,
    langchainMessageToOpenAIMessage
} from './utils'
import { ChatLunaPlugin } from 'koishi-plugin-chatluna/services/chat'

export class OpenAIRequester
    extends ModelRequester
    implements EmbeddingsRequester
{
    constructor(
        private _config: ClientConfig,
        private _pluginConfig: Config,
        private _plugin: ChatLunaPlugin
    ) {
        super()
    }

    async *completionStream(
        params: ModelRequestParams
    ): AsyncGenerator<ChatGenerationChunk> {
        const enableGoogleSearch =
            this._pluginConfig.googleSearch &&
            this._pluginConfig.googleSearchSupportModel.some((model) =>
                (params.model?.toLowerCase() ?? '').includes(
                    model?.toLowerCase() ?? ''
                )
            )

        const supportImageInput = this._pluginConfig.additionalModels.find(
            (model) => model.model === params.model
        )?.imageInput

        if (enableGoogleSearch || supportImageInput) {
            logger.debug(
                `enableGoogleSearch: ${enableGoogleSearch}, supportImageInput: ${supportImageInput}, model: ${params.model}`
            )
        }
        try {
            const response = await this._post(
                'chat/completions',
                {
                    model: params.model,
                    messages: langchainMessageToOpenAIMessage(
                        params.input,
                        params.model,
                        supportImageInput
                    ),
                    tools:
                        enableGoogleSearch || params.tools != null
                            ? formatToolsToOpenAITools(
                                  params.tools ?? [],
                                  enableGoogleSearch
                              )
                            : undefined,
                    stop: params.stop != null ? params.stop : undefined,
                    // remove max_tokens
                    max_tokens: params.model.includes('vision')
                        ? undefined
                        : params.maxTokens,
                    temperature: params.temperature,
                    presence_penalty: params.presencePenalty,
                    frequency_penalty: params.frequencyPenalty,
                    n: params.n,
                    top_p: params.topP,
                    user: params.user ?? 'user',
                    stream: true,
                    logit_bias: params.logitBias
                },
                {
                    signal: params.signal
                }
            )

            const iterator = sseIterable(response)

            let defaultRole: ChatCompletionResponseMessageRoleEnum = 'assistant'

            let errorCount = 0

            let reasoningContent = ''
            let reasoningTime = 0
            let isSetReasoingTime = false

            for await (const event of iterator) {
                const chunk = event.data
                if (chunk === '[DONE]') {
                    break
                } else if (
                    chunk === '' ||
                    chunk == null ||
                    chunk === 'undefined'
                ) {
                    continue
                }

                try {
                    const data = JSON.parse(chunk) as ChatCompletionResponse

                    // eslint-disable-next-line @typescript-eslint/no-explicit-any
                    if ((data as any).error) {
                        throw new ChatLunaError(
                            ChatLunaErrorCode.API_REQUEST_FAILED,
                            new Error(
                                'error when calling openai completion, Result: ' +
                                    chunk
                            )
                        )
                    }

                    const choice = data.choices?.[0]
                    if (!choice) {
                        continue
                    }

                    const { delta } = choice
                    const messageChunk = convertDeltaToMessageChunk(
                        delta,
                        defaultRole
                    )

                    if (delta.reasoning_content) {
                        reasoningContent = (reasoningContent +
                            delta.reasoning_content) as string

                        if (reasoningTime === 0) {
                            reasoningTime = Date.now()
                        }
                    }

                    if (
                        (delta.reasoning_content == null ||
                            delta.reasoning_content === '') &&
                        delta.content &&
                        delta.content.length > 0 &&
                        reasoningTime > 0 &&
                        !isSetReasoingTime
                    ) {
                        reasoningTime = Date.now() - reasoningTime
                        messageChunk.additional_kwargs.reasoning_time =
                            reasoningTime
                        isSetReasoingTime = true
                    }

                    defaultRole = (
                        (delta.role?.length ?? 0) > 0 ? delta.role : defaultRole
                    ) as ChatCompletionResponseMessageRoleEnum

                    const generationChunk = new ChatGenerationChunk({
                        message: messageChunk,
                        text: messageChunk.content as string
                    })

                    yield generationChunk
                } catch (e) {
                    if (errorCount > 5) {
                        logger.error('error with chunk', chunk)
                        throw new ChatLunaError(
                            ChatLunaErrorCode.API_REQUEST_FAILED,
                            e
                        )
                    } else {
                        errorCount++
                        continue
                    }
                }
            }

            if (reasoningContent.length > 0) {
                logger.debug(
                    `reasoning content: ${reasoningContent}. Use time: ${reasoningTime / 1000}s`
                )
            }
        } catch (e) {
            if (e instanceof ChatLunaError) {
                throw e
            } else {
                throw new ChatLunaError(ChatLunaErrorCode.API_REQUEST_FAILED, e)
            }
        }
    }

    async embeddings(
        params: EmbeddingsRequestParams
    ): Promise<number[] | number[][]> {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        let data: CreateEmbeddingResponse | string

        try {
            const response = await this._post('embeddings', {
                input: params.input,
                model: params.model
            })

            data = await response.text()

            data = JSON.parse(data as string) as CreateEmbeddingResponse

            if (data.data && data.data.length > 0) {
                return (data as CreateEmbeddingResponse).data.map(
                    (it) => it.embedding
                )
            }

            throw new Error(
                'error when calling openai embeddings, Result: ' +
                    JSON.stringify(data)
            )
        } catch (e) {
            const error = new Error(
                'error when calling openai embeddings, Result: ' +
                    JSON.stringify(data)
            )

            logger.debug(e)

            throw new ChatLunaError(ChatLunaErrorCode.API_REQUEST_FAILED, error)
        }
    }

    async getModels(): Promise<string[]> {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        let data: any
        try {
            const response = await this._get('models')
            data = await response.text()
            data = JSON.parse(data as string)

            if (data.data?.length < 1) {
                // remove the aoi key and request again
                const response = await this._get('models', {
                    'Content-Type': 'application/json'
                })
                data = await response.text()
                data = JSON.parse(data as string)
            }

            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            return (<Record<string, any>[]>data.data).map((model) => model.id)
        } catch (e) {
            logger.error(e)
            throw new Error(
                'error when listing openai models, Result: ' +
                    JSON.stringify(data)
            )
        }
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    private _post(url: string, data: any, params: fetchType.RequestInit = {}) {
        const requestUrl = this._concatUrl(url)

        for (const key in data) {
            if (data[key] == null) {
                delete data[key]
            }
        }

        const body = JSON.stringify(data)

        // logger.debug(`Request to ${requestUrl} with body ${body}`)

        return this._plugin.fetch(requestUrl, {
            body,
            headers: this._buildHeaders(),
            method: 'POST',
            ...params
        })
    }

    private _get(
        url: string,
        headers: Record<string, string> = this._buildHeaders()
    ) {
        const requestUrl = this._concatUrl(url)

        return this._plugin.fetch(requestUrl, {
            method: 'GET',
            headers
        })
    }

    private _buildHeaders() {
        const result = {
            Authorization: `Bearer ${this._config.apiKey}`,
            'Content-Type': 'application/json',
            'HTTP-Referer': 'https://github.com/ChatLunaLab/chatluna', // Optional. Site URL for rankings on openrouter.ai.
            'X-Title': 'ChatLuna' // Optional. Site title for rankings on openrouter.ai.
        }

        if (Object.keys(this._pluginConfig.additionCookies).length > 0) {
            result['Cookie'] = Object.keys(this._pluginConfig.additionCookies)
                .map((key) => {
                    return `${key}=${this._pluginConfig.additionCookies[key]}`
                })
                .join('; ')
        }

        return result
    }

    private _concatUrl(url: string): string {
        const apiEndPoint = this._config.apiEndpoint

        if (apiEndPoint.endsWith('/')) {
            return apiEndPoint + url
        }

        return apiEndPoint + '/' + url
    }

    async init(): Promise<void> {}

    async dispose(): Promise<void> {}
}
