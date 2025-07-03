import { h, Session } from 'koishi'
import { Config, logger } from 'koishi-plugin-chatluna'
import { Message } from '../types'
import {
    ChatLunaError,
    ChatLunaErrorCode
} from 'koishi-plugin-chatluna/utils/error'

export class MessageTransformer {
    private _transformFunctions: Record<string, MessageTransformFunction> = {}

    constructor(private _config: Config) {}

    async transform(
        session: Session,
        elements: h[],
        message: Message = {
            content: '',
            additional_kwargs: {}
        },
        quote = false,
        model?: string
    ): Promise<Message> {
        for (const element of elements) {
            const transformFunction = this._transformFunctions[element.type]
            if (transformFunction != null) {
                const result = await transformFunction(
                    session,
                    element,
                    message,
                    model
                )

                if (result === false && element.children) {
                    await this.transform(
                        session,
                        element.children,
                        message,
                        false,
                        model
                    )
                }
            } else if (element.children) {
                await this.transform(
                    session,
                    element.children,
                    message,
                    quote,
                    model
                )
            }
        }

        if (session.quote && !quote && this._config.includeQuoteReply) {
            const quoteMessage = await this.transform(
                session,
                session.quote.elements ?? [],
                {
                    content: '',
                    additional_kwargs: {}
                },
                true,
                model
            )

            // merge images

            if (
                quoteMessage.content.length > 0 &&
                quoteMessage.content !== '[image]'
            ) {
                message.additional_kwargs['raw_content'] = message.content
                // eslint-disable-next-line max-len
                message.content = `The following is a quoted message: "${quoteMessage.content}"\n\nPlease consider this quote when generating your response. User's message: ${message.content}`
            }

            if (quoteMessage.additional_kwargs['images']) {
                const currentImages = message.additional_kwargs['images'] ?? []
                message.additional_kwargs['images'] = [
                    ...currentImages,
                    ...quoteMessage.additional_kwargs['images']
                ]
            }
        }

        return message
    }

    intercept(type: string, transformFunction: MessageTransformFunction) {
        if (type === 'text' && this._transformFunctions['text'] != null) {
            throw new ChatLunaError(
                ChatLunaErrorCode.UNKNOWN_ERROR,
                new Error('text transform function already exists')
            )
        }

        if (this._transformFunctions[type] != null && !['img'].includes(type)) {
            logger?.warn(
                `transform function for ${type} already exists. Check your installed plugins.`
            )
        }

        this._transformFunctions[type] = transformFunction

        return () => {
            delete this._transformFunctions[type]
        }
    }

    replace(type: string, transformFunction: MessageTransformFunction) {
        if (type === 'text') {
            throw new ChatLunaError(
                ChatLunaErrorCode.UNKNOWN_ERROR,
                new Error('text transform function already exists')
            )
        }

        if (this._transformFunctions[type] == null) {
            logger?.warn(
                `transform function for ${type} not exists. Check your installed plugins.`
            )
        }

        this._transformFunctions[type] = transformFunction
        return () => {
            delete this._transformFunctions[type]
        }
    }

    has(type: string) {
        return this._transformFunctions[type] != null
    }
}

export type MessageTransformFunction = (
    session: Session,
    element: h,
    message: Message,
    model?: string
) => Promise<boolean | void>
