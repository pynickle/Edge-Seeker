import {Context, Schema} from 'koishi'
import {zanwo} from "./zanwo/zanwo";
import JrrpPlugin from "./jrrp/jrrp";
import {cat} from "./cat/cat";

export const inject = ['database']

export const name = 'edge-seeker'

export interface Config {
    jrrp: {
        cleanupDays: number,
        rankLimit: number
        rankUseForwardMsg: boolean
    }
}

export const Config: Schema<Config> = Schema.object({
    jrrp: Schema.object({
        cleanupDays: Schema.number().default(30),
        rankLimit: Schema.number().default(7),
        rankUseForwardMsg: Schema.boolean().default(true),
    })
}).i18n({
    'zh-CN': require('./locales/zh-CN.schema.yml'),
    /* 'en-US': require('./locales/en-US.schema.yml') */
})

export function apply(ctx: Context, cfg: Config) {
    ctx.plugin(JrrpPlugin, cfg);
    ctx.plugin(zanwo, cfg);
    ctx.plugin(cat, cfg);
}
