import { Context, h } from 'koishi'
import { Config } from '../config'
import { ChatChain } from '../chains/chain'
import { RenderType } from '../types'

export function apply(ctx: Context, config: Config, chain: ChatChain) {
    ctx.command('chatluna', {
        authority: 1
    }).alias('chatluna')

    ctx.command('chatluna.chat', {
        authority: 1
    })

    ctx.command('chatluna.chat.text <message:text>')
        .option('room', '-r <room:string>')
        .option('type', '-t <type: string>')
        .action(async ({ options, session }, message) => {
            const renderType = options.type ?? config.outputMode

            if (
                !ctx.chatluna.renderer.rendererTypeList.some(
                    (type) => type === renderType
                )
            ) {
                return session.text('.invalid-render-type')
            }

            const elements = h.parse(message)
            await chain.receiveCommand(
                session,
                '',
                {
                    message: elements,
                    room_resolve: {
                        name: options.room
                    },
                    renderOptions: {
                        session,
                        split: config.splitMessage,
                        type: renderType as RenderType
                    }
                },
                ctx
            )
        })

    ctx.command('chatluna.chat.rollback [message:text]')
        .option('room', '-r <room:string>')
        .option('i', '-i <i: string>')
        .action(async ({ options, session }, message) => {
            const elements = message ? h.parse(message) : undefined
            await chain.receiveCommand(
                session,
                'rollback',
                {
                    message: elements,
                    room_resolve: {
                        name: options.room
                    },
                    renderOptions: {
                        session,
                        split: config.splitMessage,
                        type: config.outputMode as RenderType
                    },
                    rollback_round: options.i ?? 1
                },
                ctx
            )
        })

    ctx.command('chatluna.chat.stop')
        .option('room', '-r <room:string>')
        .action(async ({ options, session }, message) => {
            await chain.receiveCommand(
                session,
                'stop_chat',
                {
                    room_resolve: {
                        name: options.room
                    }
                },
                ctx
            )
        })

    ctx.command('chatluna.chat.voice <message:text>')
        .option('room', '-r <room:string>')
        .option('speaker', '-s <speakerId:number>', { authority: 1 })
        .action(async ({ options, session }, message) => {
            const elements = message ? h.parse(message) : undefined
            await chain.receiveCommand(
                session,
                '',
                {
                    message: elements,
                    renderOptions: {
                        split: config.splitMessage,
                        type: 'voice',
                        voice: {
                            speakerId: options.speaker
                        },
                        session
                    },
                    room_resolve: {
                        name: options.room
                    }
                },
                ctx
            )
        })

    ctx.command('chatluna.wipe', { authority: 3 }).action(
        async ({ session }) => {
            await chain.receiveCommand(session, 'wipe')
        }
    )

    ctx.command('chatluna.restart').action(async ({ options, session }) => {
        await chain.receiveCommand(session, 'restart')
    })
}
