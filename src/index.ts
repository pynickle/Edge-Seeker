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
import {guess_number} from "./plugins/guess_number/guess_number";
import MarketPlugin from "./plugins/prop/market/market";
import InventoryPlugin from "./plugins/prop/inventory/inventory";
import BaikeQuizPlugin from "./plugins/baike_quiz/baike_quiz";

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
    },
    minecraft: {
        checkInterval: number
        notifyChannel: string[]
    },
    guess_number: {
        signUpTime: number
        guessTimeout: number
        maxSkips: number
        defaultStarCoin: number
        entryFee: number
        defaultDynamicBonus: number
    },
    baike_quiz: {
        apiKey: string
        questionTimeout: number
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
    }),
    minecraft: Schema.object({
        checkInterval: Schema.number().min(1).default(10),
        notifyChannel: Schema.array(String).default([])
    }),
    guess_number: Schema.object({
        signUpTime: Schema.number().default(45),
        guessTimeout: Schema.number().default(20),
        maxSkips: Schema.number().default(3),
        defaultStarCoin: Schema.number().default(30),
        entryFee: Schema.number().default(20),
        defaultDynamicBonus: Schema.number().default(10)
    }),
    baike_quiz: Schema.object({
        apiKey: Schema.string().default(''),
        questionTimeout: Schema.number().min(5).max(120).default(20)
    })
}).i18n({
    'zh-CN': require('./locales/zh-CN.schema.yml'),
    /* 'en-US': require('./locales/en-US.schema.yml') */
})

export function apply(ctx: Context, cfg: Config) {
    ctx.plugin(StarCoinPlugin, cfg);
    ctx.plugin(BaikeQuizPlugin, cfg);

    ctx.plugin(InventoryPlugin, cfg);
    ctx.plugin(MarketPlugin, cfg);

    ctx.plugin(JrrpPlugin, cfg);
    ctx.plugin(JrysPlugin, cfg);

    ctx.plugin(guess_number, cfg);

    ctx.plugin(zanwo, cfg);
    ctx.plugin(cat, cfg);
    ctx.plugin(whois, cfg);
    ctx.plugin(emoji_gen, cfg);
    ctx.plugin(waifu, cfg);
    ctx.plugin(choose, cfg);

    ctx.plugin(gh_url, cfg);

    ctx.plugin(minecraft_notifier, cfg)
}
