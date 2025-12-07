import { getFestivalBonus, getFestivals } from '../../../plugins/fortune/jrrp/festival';
import { randomInt } from '../../pseudo_random_helper';
import { Context, Session } from 'koishi';

// 运势等级配置接口
export interface LuckLevel {
    min: number;
    message: (luck: number) => string;
}

// 人品等级配置
const LUCK_LEVELS: readonly LuckLevel[] = [
    {
        min: 90,
        message: (luck: number) => {
            const messages = [
                `今日人品值：${luck}。人品爆发！今天你无论做什么都可能得到意想不到的好运反馈！`,
                `今日人品值：${luck}。人品爆表！你的善意和正直终于得到了应有的回报，一切都会顺利！`,
                `今日人品值：${luck}。人品极佳！你的好人缘将助你一臂之力，任何请求都更容易得到帮助！`,
                `今日人品值：${luck}。人品超棒！你的真诚和友善为你积累了巨大的人气，今天正是收获的时候！`,
            ];
            return messages[Math.floor(Math.random() * messages.length)];
        },
    },
    {
        min: 70,
        message: (luck: number) => {
            const messages = [
                `今日人品值：${luck}。人品良好！你平日里的善举开始显现效果，今天会有不错的人缘运！`,
                `今日人品值：${luck}。人品优秀！你的正直和诚信为你赢得了信任，今天适合与他人合作！`,
                `今日人品值：${luck}。人品不错！你的热心帮助会让你获得他人的好感，人际关系会更上一层楼！`,
                `今日人品值：${luck}。人品在线！你的友善态度会为你带来好的机遇，不妨多与他人交流！`,
            ];
            return messages[Math.floor(Math.random() * messages.length)];
        },
    },
    {
        min: 50,
        message: (luck: number) => {
            const messages = [
                `今日人品值：${luck}。人品平稳！你的日常表现中规中矩，今天一切都会按部就班地进行！`,
                `今日人品值：${luck}。人品普通！保持平常心，你的真诚会慢慢积累成更大的好运！`,
                `今日人品值：${luck}。人品正常！继续保持你的善良和正直，好运会在不经意间降临！`,
                `今日人品值：${luck}。人品稳定！踏实做好每一件事，你的努力终将得到认可！`,
            ];
            return messages[Math.floor(Math.random() * messages.length)];
        },
    },
    {
        min: 30,
        message: (luck: number) => {
            const messages = [
                `今日人品值：${luck}。人品稍低！可能最近有些急躁，不妨放缓脚步，多一点耐心和包容！`,
                `今日人品值：${luck}。人品波动！或许你需要反思一下最近的言行，多做一些善意的举动！`,
                `今日人品值：${luck}。人品待提升！尝试主动帮助他人，你的善意会让人品值回升！`,
                `今日人品值：${luck}。人品低迷！保持积极心态，从小事做起，积累正能量！`,
            ];
            return messages[Math.floor(Math.random() * messages.length)];
        },
    },
    {
        min: 0,
        message: (luck: number) => {
            const messages = [
                `今日人品值：${luck}。人品低谷！不要灰心，每个人都有低谷期，这正是积累人品的好时机！`,
                `今日人品值：${luck}。人品急需补充！多做善事，多说善言，你的人品值会逐渐回升！`,
                `今日人品值：${luck}。人品寒冬！保持乐观，主动关心他人，温暖他人的同时也会温暖自己！`,
                `今日人品值：${luck}。人品挑战期！这是对你的考验，坚持做正确的事，光明就在前方！`,
            ];
            return messages[Math.floor(Math.random() * messages.length)];
        },
    },
] as const;

/**
 * 计算并存储用户的人品值
 */
export async function calculateAndStoreLuck(
    ctx: Context,
    session: Session,
    date: string,
    isTomorrow: boolean = false
): Promise<number> {
    const { userId } = session;
    // 生成种子，区分今日和明日的计算
    const seed = isTomorrow ? `${date}${userId}` : Date.now().toString();
    const baseLuck = randomInt(1, 100, seed);
    const { bonus } = getFestivalBonusForLuck(userId, date);
    let finalLuck = baseLuck + bonus;

    // 确保在 1-100 范围内
    finalLuck = Math.max(1, Math.min(100, finalLuck));

    await storeLuckRecord(ctx, userId, date, finalLuck);
    return finalLuck;
}

/**
 * 获取节日加成
 */
export function getFestivalBonusForLuck(userId: string, date: string) {
    const year = new Date().getFullYear();
    const festivals = getFestivals(year);
    return getFestivalBonus(userId, date, festivals);
}

/**
 * 存储人品记录
 */
export async function storeLuckRecord(
    ctx: Context,
    userId: string,
    date: string,
    luck: number
): Promise<void> {
    await ctx.database.upsert(
        'jrrp',
        [
            {
                userId,
                date,
                luck,
            },
        ],
        ['userId', 'date']
    );
}

/**
 * 格式化人品消息 - 为 jrrp 插件使用
 */
export function formatLuckMessage(
    ctx: Context,
    session: Session,
    date: string,
    luck: number
): string {
    const { userId } = session;
    const isTomorrow = true; // 因为这个函数在 foresee 插件中只用于明日人品

    // 针对明日人品自定义消息
    const luckLevelMessages = [
        {
            min: 90,
            message: (luck: number) => {
                const messages = [
                    `明日人品值：${luck}。明日人品爆发！你的积累将迎来爆发期，抓住每一个机会！`,
                    `明日人品值：${luck}。明日人品爆表！做好准备，明天你的好运气将超乎想象！`,
                    `明日人品值：${luck}。明日人品极佳！你的好人缘将在明天发挥重要作用，事半功倍！`,
                    `明日人品值：${luck}。明日人品超棒！你的真诚和友善将在明天得到丰厚的回报！`,
                ];
                return messages[Math.floor(Math.random() * messages.length)];
            },
        },
        {
            min: 70,
            message: (luck: number) => {
                const messages = [
                    `明日人品值：${luck}。明日人品良好！你的善意和努力将在明天开始收获，保持积极！`,
                    `明日人品值：${luck}。明日人品优秀！你的正直和诚信将为明天的交流合作铺平道路！`,
                    `明日人品值：${luck}。明日人品不错！你的热心和体贴将让明天的人际关系更加和谐！`,
                    `明日人品值：${luck}。明日人品在线！你的友善态度将为明天带来新的机遇和朋友！`,
                ];
                return messages[Math.floor(Math.random() * messages.length)];
            },
        },
        {
            min: 50,
            message: (luck: number) => {
                const messages = [
                    `明日人品值：${luck}。明日人品平稳！保持平常心，明天的一切都会顺利进行！`,
                    `明日人品值：${luck}。明日人品普通！继续做好自己，你的真诚会慢慢积累成更大的好运！`,
                    `明日人品值：${luck}。明日人品正常！不必过于担心，按计划行事，明天会是平静的一天！`,
                    `明日人品值：${luck}。明日人品稳定！踏实做好每一件事，明天的努力不会白费！`,
                ];
                return messages[Math.floor(Math.random() * messages.length)];
            },
        },
        {
            min: 30,
            message: (luck: number) => {
                const messages = [
                    `明日人品值：${luck}。明日人品稍低！明天可能会有些小摩擦，多一些理解和包容！`,
                    `明日人品值：${luck}。明日人品波动！明天需要更加谨慎，避免不必要的误会和冲突！`,
                    `明日人品值：${luck}。明日人品待提升！明天尝试多做一些善意的举动，积累人品！`,
                    `明日人品值：${luck}。明日人品低迷！明天保持低调，做好自己该做的事，耐心等待转机！`,
                ];
                return messages[Math.floor(Math.random() * messages.length)];
            },
        },
        {
            min: 0,
            message: (luck: number) => {
                const messages = [
                    `明日人品值：${luck}。明日人品低谷！不要气馁，这正是你积累人品的好时机，明天多做善事！`,
                    `明日人品值：${luck}。明日人品急需补充！明天记得保持微笑，多鼓励他人，你的善意会有回报！`,
                    `明日人品值：${luck}。明日人品寒冬！明天保持乐观，相信否极泰来，阳光总在风雨后！`,
                    `明日人品值：${luck}。明日人品挑战期！明天是对你的考验，坚持善良，你会度过难关！`,
                ];
                return messages[Math.floor(Math.random() * messages.length)];
            },
        },
    ] as const;

    const luckLevel = luckLevelMessages.find((level) => luck >= level.min);
    let message = luckLevel?.message(luck) || `明日人品值：${luck}`;

    const { bonus, description } = getFestivalBonusForLuck(userId, date);
    if (bonus !== 0) {
        message += `\n节日加成：${description}`;
    }

    return message;
}

/**
 * 格式化今日人品消息 - 为 jrrp 插件使用
 */
export function formatTodayLuckMessage(userId: string, date: string, luck: number): string {
    const luckLevel = LUCK_LEVELS.find((level) => luck >= level.min);
    let message = luckLevel?.message(luck) || `今日人品值：${luck}`;

    const { bonus, description } = getFestivalBonusForLuck(userId, date);
    if (bonus !== 0) {
        message += `\n节日加成：${description}`;
    }

    return message;
}
