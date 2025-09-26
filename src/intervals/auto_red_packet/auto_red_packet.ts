import {Config} from '../../index';
import {Context} from "koishi";
import {randomInt} from "../../utils/pseudo_random_helper";

// 声明数据表，用于存储上次发送红包的信息
export interface AutoRedPacketRecord {
    id: number;
    lastSendTime: number;
    channelId: string;
}

declare module 'koishi' {
    interface Tables {
        auto_red_packet_record: AutoRedPacketRecord;
    }
}

export const name = 'auto_red_packet';

export function auto_red_packet(ctx: Context, cfg: Config) {
    // 确保数据表存在
    ctx.database.extend('auto_red_packet_record', {
        id: 'integer',
        lastSendTime: 'unsigned',
        channelId: 'string'
    }, {primary: 'id'});

    // 获取上次发送红包的时间
    const getLastSendTime = async (channelId: string): Promise<number> => {
        const records = await ctx.database.get('auto_red_packet_record', {
            channelId
        });
        if (records.length > 0) {
            return records[0].lastSendTime;
        }
        return 0;
    };

    // 更新上次发送红包的时间
    const updateLastSendTime = async (channelId: string, time: number): Promise<void> => {
        const records = await ctx.database.get('auto_red_packet_record', {
            channelId
        });
        if (records.length > 0) {
            await ctx.database.set('auto_red_packet_record', {
                channelId
            }, {
                lastSendTime: time
            });
        } else {
            await ctx.database.create('auto_red_packet_record', {
                id: Date.now(),
                channelId,
                lastSendTime: time
            });
        }
    };

    // 检查当前时间是否在允许的时段内（排除晚上 0-6 点）
    const isAllowedTime = (): boolean => {
        const now = new Date();
        const hour = now.getHours();
        return hour >= 6 && hour < 24; // 6 点到 23 点 59 分允许发送
    };

    // 检查是否应该发送红包
    const shouldSendRedPacket = async (channelId: string, minInterval: number, maxInterval: number): Promise<boolean> => {
        if (!isAllowedTime()) {
            return false;
        }

        const now = Date.now();
        const lastSendTime = await getLastSendTime(channelId);
        const elapsedTime = now - lastSendTime;

        // 首次发送或超过随机间隔时间
        return lastSendTime === 0 || elapsedTime >= randomInt(minInterval, maxInterval);
    };

    // 自动发送红包
    const sendAutoRedPacket = async () => {
        try {
            // 检查自动红包功能是否启用
            if (!cfg.auto_red_packet?.enable) {
                return;
            }

            // 获取所有要发送红包的频道配置
            const channelConfigs = cfg.auto_red_packet.channelConfigs || [];

            for (const config of channelConfigs) {
                const {channelId, minAmount, maxAmount, minCount, maxCount, minInterval, maxInterval, expiryHours} = config;
                
                if (await shouldSendRedPacket(channelId, minInterval * 3600000, maxInterval * 3600000)) {
                    const bot = ctx.bots[0];
                    if (!bot) continue;

                    // 使用配置中的范围生成随机金额和数量
                    const amount = randomInt(minAmount, maxAmount);
                    const count = randomInt(minCount, maxCount);
                    // 将小时转换为毫秒
                    const intervalMinMs = minInterval * 3600000;
                    const intervalMaxMs = maxInterval * 3600000;

                    // 使用Bot的ID作为创建者
                    const botId = bot.userId;
                    const platform = bot.platform;
                    const now = Date.now();

                    // 计算过期时间
                    const expiryTime = now + expiryHours * 60 * 60 * 1000;

                    // 创建红包记录
                    const packet = await ctx.database.create('red_packets', {
                        creatorId: botId,
                        channelId,
                        platform,
                        amount,
                        totalCount: count,
                        remainingAmount: amount,
                        remainingCount: count,
                        createTime: now,
                        expiryTime,
                        status: 'active',
                        fee: 0 // 自动红包不收取手续费
                    });

                    // 发送红包消息
                    await bot.sendMessage(channelId, `🎁 系统福利红包来啦！${count} 个共 ${amount} 星币的红包！\n发送「抢红包 ${packet.id}」来领取吧~\n有效期：${expiryHours}小时`);

                    // 更新上次发送时间
                    await updateLastSendTime(channelId, now);

                    ctx.logger('auto-red-packet').info(`已在频道 ${channelId} 发送自动红包，ID：${packet.id}`);
                }
            }
        } catch (error) {
            ctx.logger('auto-red-packet').error('发送自动红包时出错：', error);
        }
    };

    // 初始检查一次，然后每小时检查一次是否需要发送红包
    ctx.setInterval(sendAutoRedPacket, 60 * 60 * 1000); // 每小时检查一次

    // 初始化时立即检查一次
    setTimeout(sendAutoRedPacket, 5000);
}