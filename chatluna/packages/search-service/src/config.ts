import { Context, Schema } from 'koishi'
import { Config } from '.'
import { PlatformService } from 'koishi-plugin-chatluna/llm-core/platform/service'
import { ModelType } from 'koishi-plugin-chatluna/llm-core/platform/types'

export async function apply(ctx: Context, _config: Config) {
    ctx.on('chatluna/model-added', (service) => {
        ctx.schema.set('model', Schema.union(getModelNames(service)))
    })

    ctx.on('chatluna/model-removed', (service) => {
        ctx.schema.set('model', Schema.union(getModelNames(service)))
    })

    ctx.schema.set('model', Schema.union(getModelNames(ctx.chatluna.platform)))
}

function getModelNames(service: PlatformService) {
    return service
        .getAllModels(ModelType.llm)
        .concat('empty')
        .map((m) => Schema.const(m))
}
