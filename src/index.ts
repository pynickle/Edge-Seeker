import {Context, Schema} from 'koishi'
import {zanwo} from "./plugins/platform/zanwo/zanwo";
import JrrpPlugin from "./plugins/fortune/jrrp/jrrp";
import {cat} from "./plugins/misc/cat/cat";
import {gh_url} from "./message/github/gh_url";
import {whois} from "./plugins/misc/whois/whois";
import {minecraft_notifier} from "./intervals/minecraft/minecraft_notifier";
import {auto_red_packet} from "./intervals/auto_red_packet/auto_red_packet";
import {emoji_gen} from "./plugins/misc/emoji/emoji";
import StarCoinPlugin from "./plugins/currency/starcoin/starcoin";
import {waifu} from "./plugins/misc/waifu/waifu";
import JrysPlugin from "./plugins/fortune/jrys/jrys";
import {choose} from "./plugins/misc/choose/choose";
import {guess_number} from "./plugins/currency/guess_number/guess_number";
import MarketPlugin from "./plugins/currency/prop/market/market";
import InventoryPlugin from "./plugins/currency/prop/inventory/inventory";
import ForeseePlugin from "./plugins/fortune/foresee/foresee";
import BaikeQuizPlugin from "./plugins/currency/baike_quiz/baike_quiz";
import {red_packet} from "./plugins/currency/red_packet/red_packet";
import {friend_code} from "./plugins/platform/friend_code/friend_code";
import {hitokoto} from "./plugins/misc/hitokoto/hitokoto";
import UserMarketPlugin from "./plugins/currency/user_market/user_market";
import {roll} from "./plugins/currency/roll/index";

export const inject = ['database', 'puppeteer', 'cron']

export const name = 'edge-seeker'

export interface Config {
    roll: {
        cost: number
        dailyLimit: number
    },
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
        firstDailyAttempts: number
        firstBonus: number
        extraDailyAttempts: number
        extraBonus: number
    },
    baike_quiz: {
        apiKey: string
        questionTimeout: number
        rewardStarCoin: number
        penaltyStarCoin: number
        adminQQs: string[]
        maxDailyAttempts: number
    },
    red_packet: {
        smallPacketFee: number
        confirmationTimeout: number
        packetExpiryTime: number
    },
    auto_sign: {
        groupIds: number[]  // 群 ID 数组，用于指定多个打卡的目标群
    },
    auto_red_packet: {
        enable: boolean
        channelConfigs: Array<{
            channelId: string
            minAmount: number
            maxAmount: number
            minCount: number
            maxCount: number
            minInterval: number
            maxInterval: number
            expiryHours: number
        }>
    }
}

export const Config: Schema<Config> = Schema.object({
    roll: Schema.object({
        cost: Schema.number().default(300),
        dailyLimit: Schema.number().default(1)
    }),
    jrrp: Schema.object({
        cleanupDays: Schema.number().default(30),
        rankLimit: Schema.number().default(7),
        rankUseForwardMsg: Schema.boolean().default(true),
    }),
    github: Schema.object({
        timeout: Schema.number().default(10000),
        maxRetries: Schema.number().default(2),
        enableShortName: Schema.boolean().default(false)
    }),
    minecraft: Schema.object({
        checkInterval: Schema.number().default(10),
        notifyChannel: Schema.array(String).default([])
    }),
    guess_number: Schema.object({
        signUpTime: Schema.number().default(45),
        guessTimeout: Schema.number().default(20),
        maxSkips: Schema.number().default(3),
        defaultStarCoin: Schema.number().default(30),
        entryFee: Schema.number().default(20),
        defaultDynamicBonus: Schema.number().default(10),
        firstDailyAttempts: Schema.number().default(5),
        firstBonus: Schema.number().default(20),
        extraDailyAttempts: Schema.number().default(5),
        extraBonus: Schema.number().default(-10)
    }),
    baike_quiz: Schema.object({
        apiKey: Schema.string().default(''),
        questionTimeout: Schema.number().default(15),
        rewardStarCoin: Schema.number().default(10),
        penaltyStarCoin: Schema.number().default(5),
        adminQQs: Schema.array(String).default([]),
        maxDailyAttempts: Schema.number().default(5)
    }),
    red_packet: Schema.object({
        smallPacketFee: Schema.number().default(10),
        confirmationTimeout: Schema.number().default(30),
        packetExpiryTime: Schema.number().default(24)
    }),
    auto_sign: Schema.object({
        groupIds: Schema.array(Schema.number()),
    }),
    auto_red_packet: Schema.object({
        enable: Schema.boolean().default(true),
        channelConfigs: Schema.array(Schema.object({
            channelId: Schema.string().required(),
            minAmount: Schema.number().default(30),
            maxAmount: Schema.number().default(50),
            minCount: Schema.number().default(3),
            maxCount: Schema.number().default(5),
            minInterval: Schema.number().default(24), // 最小发送间隔（小时）
            maxInterval: Schema.number().default(72), // 最大发送间隔（小时）
            expiryHours: Schema.number().default(2)
        })).default([])
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
    ctx.plugin(ForeseePlugin, cfg);

    ctx.plugin(JrrpPlugin, cfg);
    ctx.plugin(JrysPlugin, cfg);

    ctx.plugin(guess_number, cfg);
    ctx.plugin(red_packet, cfg);
    ctx.plugin(roll, cfg);

    ctx.plugin(zanwo, cfg);
    ctx.plugin(cat, cfg);
    ctx.plugin(whois, cfg);
    ctx.plugin(emoji_gen, cfg);
    ctx.plugin(waifu, cfg);
    ctx.plugin(choose, cfg);
    ctx.plugin(hitokoto, cfg);

    ctx.plugin(friend_code, cfg);
    ctx.plugin(UserMarketPlugin, cfg);

    // message
    ctx.plugin(gh_url, cfg);

    // intervals
    ctx.plugin(minecraft_notifier, cfg)
    ctx.plugin(auto_red_packet, cfg)
}
