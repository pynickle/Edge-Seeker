import { Context, Session } from 'koishi';
import { getFestivalBonus, getFestivals } from '../../../plugins/fortune/jrrp/festival';
import {randomInt} from '../../pseudo_random_helper';

// 运势等级配置接口
export interface LuckLevel {
    min: number;
    message: (luck: number) => string;
}

// 运势等级配置
const LUCK_LEVELS: readonly LuckLevel[] = [
    { min: 90, message: (luck: number) => `今日人品值：${luck}。运势极佳，今天将是大展身手的好日子！` },
    { min: 70, message: (luck: number) => `今日人品值：${luck}。运势良好，适合尝试新的挑战。` },
    { min: 50, message: (luck: number) => `今日人品值：${luck}。运势平稳，适合按部就班完成计划。` },
    { min: 30, message: (luck: number) => `今日人品值：${luck}。运势稍低，建议谨慎行事，避免冒险。` },
    { min: 0, message: (luck: number) => `今日人品值：${luck}。运势较低，保持乐观，明天会更好！` }
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
export async function storeLuckRecord(ctx: Context, userId: string, date: string, luck: number): Promise<void> {
    await ctx.database.upsert('jrrp', [{
        userId,
        date,
        luck,
    }], ['userId', 'date']);
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
        { min: 90, message: (luck: number) => `明日人品值：${luck}。运势极佳，明天将是大展身手的好日子！` },
        { min: 70, message: (luck: number) => `明日人品值：${luck}。运势良好，适合尝试新的挑战。` },
        { min: 50, message: (luck: number) => `明日人品值：${luck}。运势平稳，适合按部就班完成计划。` },
        { min: 30, message: (luck: number) => `明日人品值：${luck}。运势稍低，建议谨慎行事，避免冒险。` },
        { min: 0, message: (luck: number) => `明日人品值：${luck}。运势较低，保持乐观，后天会更好！` }
    ] as const;

    const luckLevel = luckLevelMessages.find(level => luck >= level.min);
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
export function formatTodayLuckMessage(
    userId: string,
    date: string,
    luck: number
): string {
    const luckLevel = LUCK_LEVELS.find(level => luck >= level.min);
    let message = luckLevel?.message(luck) || `今日人品值：${luck}`;

    const { bonus, description } = getFestivalBonusForLuck(userId, date);
    if (bonus !== 0) {
        message += `\n节日加成：${description}`;
    }

    return message;
}