import { Context } from 'koishi'
import { ChatChain } from '../chains/chain'
import { Config } from '../config'

export function apply(ctx: Context, config: Config, chain: ChatChain) {
    ctx.inject(['chatluna_long_memory'], (ctx) => {
        ctx.command('chatluna.memory', { authority: 1 })

        ctx.command('chatluna.memory.search <query:string>')
            .option('type', '-t <type:string>')
            .option('limit', '-l <limit:number>')
            .option('page', '-p <page:number>')
            .option('view', '-v <view:string>')
            .action(async ({ options, session }, query) => {
                await chain.receiveCommand(session, 'search_memory', {
                    type: options.type,
                    page: options.page ?? 1,
                    limit: options.limit ?? 6,
                    view: options.view,
                    query
                })
            })

        ctx.command('chatluna.memory.delete <...ids>')
            .option('type', '-t <type:string>')
            .option('view', '-v <view:string>')
            .action(async ({ session, options }, ...ids) => {
                await chain.receiveCommand(session, 'delete_memory', {
                    ids,
                    type: options.type,
                    view: options.view
                })
            })

        ctx.command('chatluna.memory.clear')
            .option('type', '-t <type:string>')
            .option('view', '-v <view:string>')
            .action(async ({ session, options }) => {
                await chain.receiveCommand(session, 'clear_memory', {
                    type: options.type,
                    view: options.view
                })
            })

        ctx.command('chatluna.memory.add <content:text>')
            .option('type', '-t <type:string>')
            .option('view', '-v <view:string>')
            .action(async ({ session, options }, content) => {
                await chain.receiveCommand(session, 'add_memory', {
                    type: options.type,
                    view: options.view,
                    content
                })
            })

        ctx.command('chatluna.memory.edit <id:string>')
            .option('type', '-t <type:string>')
            .option('view', '-v <view:string>')
            .action(async ({ session, options }, id, content) => {
                await chain.receiveCommand(session, 'edit_memory', {
                    memoryId: id,
                    content,
                    type: options.type,
                    view: options.view
                })
            })
    })
}
