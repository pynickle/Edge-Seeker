import {Context, Schema} from 'koishi'
import {zanwo} from "./plugins/zanwo/zanwo";
import JrrpPlugin from "./plugins/jrrp/jrrp";
import {cat} from "./plugins/cat/cat";
import {gh_url} from "./message/github/gh_url";
import {whois} from "./plugins/whois/whois";
import {minecraft_notifier} from "./intervals/minecraft/minecraft_notifier";
import {emoji_gen} from "./plugins/emoji/emoji";
import StarCoinPlugin from "./plugins/starcoin/starcoin";
import {waifu} from "./plugins/waifu/waifu";
import JrysPlugin from "./plugins/jrys/jrys";
import {choose} from "./plugins/choose/choose";

export const inject = ['database', 'puppeteer']

export const name = 'edge-seeker'

export interface Config {
    jrrp: {
        cleanupDays: number,
        rankLimit: number
        rankUseForwardMsg: boolean
    },
    github: {
        timeout: number
        maxRetries: number
        enableShortName: boolean
    }
}

export const Config: Schema<Config> = Schema.object({
    jrrp: Schema.object({
        cleanupDays: Schema.number().default(30),
        rankLimit: Schema.number().default(7),
        rankUseForwardMsg: Schema.boolean().default(true),
    }),
    github: Schema.object({
        timeout: Schema.number().min(1000).max(30000).default(10000),
        maxRetries: Schema.number().min(0).max(5).default(2),
        enableShortName: Schema.boolean().default(false)
    })
}).i18n({
    'zh-CN': require('./locales/zh-CN.schema.yml'),
    /* 'en-US': require('./locales/en-US.schema.yml') */
})

export function apply(ctx: Context, cfg: Config) {
    ctx.plugin(JrrpPlugin, cfg);
    ctx.plugin(JrysPlugin, cfg);
    ctx.plugin(StarCoinPlugin, cfg);
    ctx.plugin(zanwo, cfg);
    ctx.plugin(cat, cfg);
    ctx.plugin(whois, cfg);
    ctx.plugin(emoji_gen, cfg);
    ctx.plugin(waifu, cfg);
    ctx.plugin(choose, cfg);

    ctx.plugin(gh_url, cfg);

    ctx.plugin(minecraft_notifier, cfg)
}
