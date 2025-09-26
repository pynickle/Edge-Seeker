// 通用方法：使用buff类型道具
import {BuffType} from "./inventory/inventory";
import {Item} from "./item_mapping";
import {formatDate} from "../../utils/time_helper";
import {Context, Session} from "koishi";

export async function useBuffItem(session: Session, ctx: Context, item: Item): Promise<string> {
    const {userId, channelId, username} = session;
    const {id: itemId, name: itemName, buffConfig} = item;

    if (!buffConfig) {
        return `@${username}，道具 "${itemName}" 的配置不完整，无法使用。`;
    }

    const {durationDays, maxDurationDays, buffType} = buffConfig;

    // 检查 buffType 是否是 BuffType 枚举的合法值
    const buffTypeEnum = Object.values(BuffType).includes(buffType)
        ? buffType as BuffType
        : undefined;

    if (!buffTypeEnum) {
        return `@${username}，道具 "${itemName}" 的Buff类型配置错误。`;
    }

    // 获取当前buff的剩余天数和最大结束日期
    const currentRemainingDays = await getBuffRemainingDays(ctx, userId, buffTypeEnum);
    const totalDuration = currentRemainingDays + durationDays;
    
    // 检查是否超过最大叠加天数
    if (totalDuration > maxDurationDays) {
        return `@${username}，您的${itemName}效果已达到最大叠加天数（${maxDurationDays}天），无法继续使用。`;
    }

    // 减少用户道具数量
    const success = await decreaseItemQuantity(ctx, userId, channelId, itemId);
    if (!success) {
        return `@${username}，您没有${itemName}。`;
    }

    // 添加或更新buff效果
    const newEndDate = await addOrUpdateBuffEffect(ctx, userId, buffTypeEnum, durationDays);

    // 获取日期信息用于反馈消息
    const today = new Date();
    const startDateStr = formatDate(today);
    const endDateStr = formatDate(newEndDate);
    const totalDays = Math.ceil((newEndDate.getTime() - today.getTime()) / (1000 * 60 * 60 * 24)) + 1;

    // 检查是否是过期后重新使用
    const hadExpired = currentRemainingDays === 0;
    
    if (hadExpired) {
        return `✨ @${username} 使用了${itemName}！效果已重置，将持续到${endDateStr}，总计${totalDays}天！${item.effect || '获得特殊效果'}`;
    } else {
        return `✨ @${username} 使用了${itemName}！效果将持续到${endDateStr}，总计${totalDays}天！${item.effect || '获得特殊效果'}`;
    }
}

// 通用方法：减少用户道具数量
export async function decreaseItemQuantity(ctx: Context, userId: string, channelId: string, itemId: string): Promise<boolean> {
    const userItem = await ctx.database.select('market_user_items')
        .where({userId, channelId, itemId})
        .execute();

    if (userItem.length === 0 || userItem[0].quantity <= 0) {
        return false;
    }

    // 更新道具数量
    if (userItem[0].quantity === 1) {
        await ctx.database.remove('market_user_items', {
            userId, channelId, itemId
        });
    } else {
        await ctx.database.set('market_user_items',
            {userId, channelId, itemId},
            {quantity: userItem[0].quantity - 1}
        );
    }
    return true;
}

// 通用方法：添加或更新buff效果（支持叠加）
export async function addOrUpdateBuffEffect(ctx: Context, userId: string, buffType: BuffType, durationDays: number, data ?: Record<string, any>): Promise<Date> {
    const today = new Date();
    const todayStr = formatDate(today);
    
    // 查找用户当前有效的buff效果
    const activeEffects = await ctx.database.select('user_buff_effects')
        .where({
            userId,
            buffType,
            endDate: { $gte: todayStr }
        })
        .orderBy('endDate', 'desc')
        .limit(1)
        .execute();
    
    let newEndDate: Date;
    
    if (activeEffects.length > 0) {
        // 已有活动buff，在结束日期基础上叠加
        const existingEndDate = new Date(activeEffects[0].endDate);
        newEndDate = new Date(existingEndDate);
        newEndDate.setDate(existingEndDate.getDate() + durationDays);
        
        // 更新现有的buff效果
        await ctx.database.set('user_buff_effects', 
            { id: activeEffects[0].id }, 
            { endDate: formatDate(newEndDate) }
        );
    } else {
        // 没有活动buff，创建新的buff效果
        newEndDate = new Date(today);
        newEndDate.setDate(today.getDate() + durationDays - 1);
        
        // 创建新的buff效果
        await ctx.database.create('user_buff_effects', {
            userId,
            buffType,
            startDate: todayStr,
            endDate: formatDate(newEndDate),
            data
        });
    }
    
    return newEndDate;
}

// 计算用户当前buff的剩余天数
export async function getBuffRemainingDays(ctx: Context, userId: string, buffType: BuffType): Promise<number> {
    const today = new Date();
    const todayStr = formatDate(today);
    
    // 查找用户当前有效的buff效果
    const activeEffects = await ctx.database.select('user_buff_effects')
        .where({
            userId,
            buffType,
            endDate: { $gte: todayStr }
        })
        .orderBy('endDate', 'desc')
        .limit(1)
        .execute();
    
    if (activeEffects.length === 0) {
        return 0;
    }
    
    // 计算剩余天数
    const endDate = new Date(activeEffects[0].endDate);
    const diffTime = endDate.getTime() - today.getTime();
    const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24)) + 1; // +1 因为当天也算一天
    
    return Math.max(0, diffDays);
}

// 通用方法：检查用户是否有激活的buff
export async function hasActiveBuff(ctx: Context, userId: string, buffType: BuffType): Promise<boolean> {
    const today = formatDate(new Date());
    const effects = await ctx.database.select('user_buff_effects')
        .where({
            userId,
            buffType,
            startDate: {$lte: today},
            endDate: {$gte: today}
        })
        .execute();

    return effects.length > 0;
}
