/* eslint-disable max-len */
import { Document } from '@langchain/core/documents'
import {
    AIMessage,
    BaseMessage,
    HumanMessage,
    SystemMessage
} from '@langchain/core/messages'
import {
    BaseChatPromptTemplate,
    HumanMessagePromptTemplate,
    MessagesPlaceholder,
    SystemMessagePromptTemplate
} from '@langchain/core/prompts'
import { ChainValues, PartialValues } from '@langchain/core/utils/types'
import { messageTypeToOpenAIRole } from 'koishi-plugin-chatluna/llm-core/utils/count_tokens'
import {
    AuthorsNote,
    PresetTemplate,
    RoleBook
} from 'koishi-plugin-chatluna/llm-core/prompt'
import { logger } from 'koishi-plugin-chatluna'
import { SystemPrompts } from 'koishi-plugin-chatluna/llm-core/chain/base'
import { Logger } from 'koishi'
import { getMessageContent } from 'koishi-plugin-chatluna/utils/string'
import type { PresetFormatService } from 'koishi-plugin-chatluna/services/chat'

export interface ChatLunaChatPromptInput {
    messagesPlaceholder?: MessagesPlaceholder
    tokenCounter: (text: string) => Promise<number>
    sendTokenLimit?: number
    preset?: () => Promise<PresetTemplate>
    partialVariables?: PartialValues
    variableService: PresetFormatService
}

export interface ChatLunaChatPromptFormat {
    input: BaseMessage
    chat_history: BaseMessage[] | string
    variables?: ChainValues
    agent_scratchpad?: BaseMessage[] | BaseMessage
    instructions?: string
}

export class ChatLunaChatPrompt
    extends BaseChatPromptTemplate<ChatLunaChatPromptFormat>
    implements ChatLunaChatPromptInput
{
    getPreset?: () => Promise<PresetTemplate>

    tokenCounter: (text: string) => Promise<number>

    conversationSummaryPrompt?: SystemMessagePromptTemplate

    _tempPreset?: [PresetTemplate, [SystemPrompts, string[]]]

    sendTokenLimit?: number

    variableService: PresetFormatService

    partialVariables: PartialValues = {}

    private _systemPrompts: BaseMessage[]

    private fields: ChatLunaChatPromptInput

    constructor(fields: ChatLunaChatPromptInput) {
        super({
            inputVariables: [
                'chat_history',
                'variables',
                'input',
                'agent_scratchpad',
                'instructions'
            ]
        })

        this.partialVariables = fields.partialVariables

        this.tokenCounter = fields.tokenCounter

        this.sendTokenLimit = fields.sendTokenLimit ?? 4096
        this.getPreset = fields.preset
        this.variableService = fields.variableService
        this.fields = fields
    }

    _getPromptType() {
        return 'chatluna_chat' as const
    }

    private async _countMessageTokens(message: BaseMessage) {
        let content = getMessageContent(message.content)

        if (
            content.includes('![image]') &&
            content.includes('base64') &&
            message.additional_kwargs?.['images']
        ) {
            // replace markdown image to '
            content = content.replaceAll(/!\[.*?\]\(.*?\)/g, '')
            message.content = content
        }

        let result =
            (await this.tokenCounter(getMessageContent(message.content))) +
            (await this.tokenCounter(
                messageTypeToOpenAIRole(message.getType())
            ))

        if (message.name) {
            result += await this.tokenCounter(message.name)
        }

        return result
    }

    private async _formatSystemPrompts(variables: ChainValues) {
        const preset = await this.getPreset()

        // TODO: knowledge prompt
        if (!this._tempPreset || this._tempPreset[0] !== preset) {
            this.conversationSummaryPrompt =
                SystemMessagePromptTemplate.fromTemplate(
                    preset.config.longMemoryPrompt ?? // eslint-disable-next-line max-len
                        `Relevant context: {long_history}

Guidelines for response:
1. Use the system prompt as your primary guide.
2. Incorporate the provided context if relevant, but don't force its inclusion.
3. Generate thoughtful, creative, and diverse responses.
4. Avoid repetition and expand your perspective.

Your goal is to craft an insightful, engaging response that seamlessly integrates all relevant information while maintaining coherence and originality.`
                )
        }

        const result = (await this.variableService.formatPresetTemplate(
            preset,
            variables,
            true
        )) as [BaseMessage[], string[]]

        this._tempPreset = [preset, result]

        return result
    }

    async formatMessages({
        chat_history: chatHistory,
        input,
        variables,
        agent_scratchpad: agentScratchpad,
        instructions
    }: ChatLunaChatPromptFormat) {
        const result: BaseMessage[] = []
        let usedTokens = 0

        instructions =
            instructions ??
            (typeof this.partialVariables?.instructions === 'function'
                ? await this.partialVariables.instructions()
                : this.partialVariables?.instructions)

        const [systemPrompts] = await this._formatSystemPrompts(variables)
        this._systemPrompts = systemPrompts

        for (const message of systemPrompts || []) {
            const messageTokens = await this._countMessageTokens(message)
            result.push(message)
            usedTokens += messageTokens
        }

        if (instructions) {
            for (const message of [new SystemMessage(instructions)]) {
                const messageTokens = await this._countMessageTokens(message)
                result.push(message)
                usedTokens += messageTokens
            }
        }

        const inputTokens = await this.tokenCounter(
            getMessageContent(input.content)
        )
        const longHistory = (variables?.['long_memory'] ?? []) as Document[]
        const knowledge = (variables?.['knowledge'] ?? []) as Document[]
        const otherDocuments = (variables?.['documents'] ?? []) as Document[][]
        const loreBooks = (variables?.['lore_books'] ?? []) as RoleBook[]
        const authorsNote = variables?.['authors_note'] as AuthorsNote
        const [formatAuthorsNote, usedTokensAuthorsNote] =
            authorsNote && (authorsNote.content?.length ?? 0) > 0
                ? await this._counterAuthorsNote(authorsNote, variables)
                : [null, 0]
        usedTokens += inputTokens

        if (usedTokensAuthorsNote > 0) {
            // make authors note
            usedTokens += usedTokensAuthorsNote
        }

        if (agentScratchpad) {
            if (Array.isArray(agentScratchpad)) {
                usedTokens += await agentScratchpad.reduce(
                    async (accPromise, message) => {
                        const acc = await accPromise
                        const messageTokens =
                            await this._countMessageTokens(message)
                        return acc + messageTokens
                    },
                    Promise.resolve(0)
                )
            } else {
                if (typeof agentScratchpad === 'string') {
                    agentScratchpad = new HumanMessage(agentScratchpad)
                }

                usedTokens += await this._countMessageTokens(agentScratchpad)
            }
        }

        const formatResult = await this._formatWithMessagesPlaceholder(
            chatHistory as BaseMessage[],
            [longHistory, knowledge].concat(
                Array.isArray(otherDocuments[0])
                    ? otherDocuments
                    : [otherDocuments as unknown as Document[]]
            ),
            usedTokens
        )

        result.push(...formatResult.messages)
        usedTokens = formatResult.usedTokens

        if (loreBooks.length > 0) {
            usedTokens += await this._formatLoreBooks(
                loreBooks,
                usedTokens,
                result,
                variables
            )
        }

        result.push(input)

        if (formatAuthorsNote) {
            usedTokens = this._formatAuthorsNote(authorsNote, result, [
                formatAuthorsNote,
                usedTokensAuthorsNote
            ])
        }

        if (agentScratchpad) {
            if (Array.isArray(agentScratchpad)) {
                result.push(...agentScratchpad)
            } else {
                result.push(agentScratchpad)
            }
        }

        if (logger?.level === Logger.DEBUG) {
            logger?.debug(
                `Used tokens: ${usedTokens} exceed limit: ${this.sendTokenLimit}`
            )

            const mapMessages = result.map((msg) => {
                const original = msg?.toDict?.()

                if (original == null) {
                    // 神秘 null
                    return msg
                }

                const dict = structuredClone(original)
                if (dict.data == null) {
                    return dict
                }
                delete dict.data.additional_kwargs['images']
                delete dict.data.additional_kwargs['preset']
                return dict
            })

            logger?.debug(`messages: ${JSON.stringify(mapMessages)})`)
        }

        return result
    }

    private async _formatLoreBooks(
        loreBooks: RoleBook[],
        usedTokens: number,
        result: BaseMessage[],
        variables: ChainValues
    ) {
        const preset = this.tempPreset
        const tokenLimit =
            this.sendTokenLimit -
            usedTokens -
            (preset.loreBooks?.tokenLimit ?? 300)

        let usedToken = await this.tokenCounter(
            preset.config.loreBooksPrompt ?? '{input}'
        )

        const loreBooksPrompt = HumanMessagePromptTemplate.fromTemplate(
            preset.config.loreBooksPrompt ?? '{input}'
        )

        const canUseLoreBooks = {} as Record<
            RoleBook['insertPosition'] | 'default',
            string[]
        >

        const hasLongMemory =
            result[result.length - 1].content === 'Ok. I will remember.'

        for (const loreBook of loreBooks) {
            if ((loreBook.content?.length ?? 0) === 0) {
                continue
            }

            const loreBookTokens = await this.tokenCounter(loreBook.content)

            if (usedTokens + loreBookTokens > tokenLimit) {
                logger?.warn(
                    `Used tokens: ${usedTokens + loreBookTokens} exceed limit: ${tokenLimit}. Is too long lore books. Skipping.`
                )
                break
            }

            const position = loreBook.insertPosition ?? 'default'

            const array = canUseLoreBooks[position] ?? []
            array.push(loreBook.content)
            canUseLoreBooks[position] = array

            usedToken += loreBookTokens
        }

        for (const [position, array] of Object.entries(canUseLoreBooks)) {
            const message = await this.variableService
                .formatMessages(
                    [await loreBooksPrompt.format({ input: array.join('\n') })],
                    variables
                )
                .then((value) => value[0])

            if (position === 'default') {
                if (hasLongMemory) {
                    const index = result.findIndex(
                        (msg) =>
                            msg instanceof AIMessage &&
                            msg.content === 'Ok. I will remember.'
                    )
                    index !== -1
                        ? result.splice(index - 1, 0, message)
                        : result.push(message)
                } else {
                    result.push(message)
                }
                continue
            }

            const insertPosition = this._findIndex(
                result,
                position as RoleBook['insertPosition']
            )
            result.splice(insertPosition, 0, message)
        }

        return usedToken
    }

    private async _formatWithMessagesPlaceholder(
        chatHistory: BaseMessage[],
        documents: Document[][],
        usedTokens: number
    ): Promise<{ messages: BaseMessage[]; usedTokens: number }> {
        const result: BaseMessage[] = []

        for (const message of chatHistory.reverse()) {
            const messageTokens = await this._countMessageTokens(message)

            if (
                usedTokens + messageTokens >
                this.sendTokenLimit - (documents.length > 0 ? 480 : 80)
            ) {
                break
            }

            usedTokens += messageTokens
            result.unshift(message)
        }

        for (const document of documents) {
            usedTokens = await this._formatLongHistory(
                document,
                result,
                usedTokens,
                result
            )
        }

        return { messages: result, usedTokens }
    }

    private async _counterAuthorsNote(
        authorsNote: AuthorsNote,
        variables?: ChainValues
    ): Promise<[string, number]> {
        const formatAuthorsNote =
            await this.variableService.formatPresetTemplateString(
                authorsNote.content,
                variables
            )

        return [formatAuthorsNote, await this.tokenCounter(formatAuthorsNote)]
    }

    private _formatAuthorsNote(
        authorsNote: AuthorsNote,
        result: BaseMessage[],
        [formatAuthorsNote, usedTokens]: [string, number]
    ) {
        const rawPosition = authorsNote.insertPosition ?? 'in_chat'

        const insertPosition = this._findIndex(result, rawPosition)

        if (rawPosition === 'in_chat') {
            result.splice(
                insertPosition - (authorsNote.insertDepth ?? 0),
                0,
                new SystemMessage(formatAuthorsNote)
            )
        } else {
            result.splice(
                insertPosition,
                0,
                new SystemMessage(formatAuthorsNote)
            )
        }

        return usedTokens
    }

    private _findIndex(
        chatHistory: BaseMessage[],
        insertPosition:
            | PresetTemplate['loreBooks']['insertPosition']
            | PresetTemplate['authorsNote']['insertPosition']
            | 'before_char'
            | 'after_char'
    ) {
        if (insertPosition === 'in_chat') {
            return chatHistory.length - 1
        }

        const findIndexByType = (type: string) =>
            chatHistory.findIndex(
                (message) => message?.additional_kwargs?.type === type
            )

        const descriptionIndex = findIndexByType('description')
        const personalityIndex = findIndexByType('description')
        const scenarioIndex = findIndexByType('scenario')
        const exampleMessageStartIndex = findIndexByType(
            'example_message_first'
        )
        const exampleMessageEndIndex = findIndexByType('example_message_last')
        const firstMessageIndex = findIndexByType('first_message')

        const charDefIndex = Math.max(descriptionIndex, personalityIndex)

        switch (insertPosition) {
            case 'before_char_defs':
            case 'before_char':
                return charDefIndex !== -1 ? charDefIndex : 1

            case 'after_char_defs':
            case 'after_char':
                if (scenarioIndex !== -1) return scenarioIndex + 1
                return charDefIndex !== -1
                    ? charDefIndex + 1
                    : this._systemPrompts.length + 1

            case 'before_example_messages':
                if (exampleMessageStartIndex !== -1)
                    return exampleMessageStartIndex
                if (firstMessageIndex !== -1) return firstMessageIndex
                return charDefIndex !== -1 ? charDefIndex + 1 : 1

            case 'after_example_messages':
                if (exampleMessageEndIndex !== -1)
                    return exampleMessageEndIndex + 1
                return charDefIndex !== -1
                    ? charDefIndex + 1
                    : this._systemPrompts.length - 1

            default:
                return 1
        }
    }

    private async _formatLongHistory(
        longHistory: Document[],
        chatHistory: BaseMessage[] | string,
        usedTokens: number,
        result: BaseMessage[]
    ) {
        const formatDocuments: Document[] = []

        for (const document of longHistory) {
            if (document.pageContent.length === 0) continue
            const documentTokens = await this.tokenCounter(document.pageContent)

            if (usedTokens + documentTokens > this.sendTokenLimit - 80) {
                break
            }

            usedTokens += documentTokens
            formatDocuments.push(document)
        }

        if (formatDocuments.length < 1) {
            return usedTokens
        }

        const formatConversationSummary =
            formatDocuments.length > 0
                ? await this.conversationSummaryPrompt.format({
                      long_history: formatDocuments
                          .map(
                              (document) =>
                                  document.pageContent +
                                  ` metadata: ${JSON.stringify(document.metadata)}`
                          )
                          .join('\n'),
                      chat_history: chatHistory
                  })
                : null

        if (formatConversationSummary) {
            result.push(formatConversationSummary)
        }

        return usedTokens
    }

    get tempPreset() {
        return this._tempPreset[0]
    }

    async partial<NewPartialVariableName extends string>(
        values: PartialValues<NewPartialVariableName>
    ) {
        const newInputVariables = this.inputVariables.filter(
            (iv) => !(iv in values)
        )

        const newPartialVariables = {
            ...(this.partialVariables ?? {}),
            ...values
        }
        const promptDict = {
            ...this.fields,
            inputVariables: newInputVariables,
            partialVariables: newPartialVariables
        }
        return new ChatLunaChatPrompt(promptDict)
    }
}
