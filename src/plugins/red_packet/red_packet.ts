import {Context} from "koishi";
import {StarCoinHelper} from '../../utils/starcoin_helper';
import {Config} from "../../index";
import {createTextMsgNode, getUserName} from "../../utils/onebot_helper";
import {normalRandom} from '../../utils/pseudo_random_helper';
import {useConfirmationHelper} from '../../utils/confirmation_helper';

interface RedPacket {
    id: number;
    creatorId: string;
    channelId: string;
    platform: string;
    amount: number;      // 总星币数
    totalCount: number;  // 总红包数
    remainingAmount: number;
    remainingCount: number;
    createTime: number;
    expiryTime: number;
    status: 'active' | 'expired' | 'completed';
    fee: number;
}

interface RedPacketClaim {
    id: number;
    packetId: number;
    userId: string;
    amount: number;
    claimTime: number;
}

// 声明数据表
declare module 'koishi' {
    interface Tables {
        red_packets: RedPacket;
        red_packet_claims: RedPacketClaim;
    }
}

export const name = 'red-packet';

export function red_packet(ctx: Context, config: Config) {
    // 确保数据表存在
    ctx.database.extend('red_packets', {
        id: 'unsigned',
        creatorId: 'string',
        channelId: 'string',
        platform: 'string',
        amount: 'unsigned',
        totalCount: 'unsigned',
        remainingAmount: 'unsigned',
        remainingCount: 'unsigned',
        createTime: 'unsigned',
        expiryTime: 'unsigned',
        status: 'string',
        fee: 'unsigned'
    }, {
        primary: 'id',
        autoInc: true
    });

    ctx.database.extend('red_packet_claims', {
        id: 'unsigned',
        packetId: 'unsigned',
        userId: 'string',
        amount: 'unsigned',
        claimTime: 'unsigned'
    }, {
        primary: 'id',
        autoInc: true
    });

    // 使用确认辅助函数
    const confirmationManager = useConfirmationHelper(ctx);

    // 发红包命令
    ctx.command('redpacket <amount:number> <count:number>', '发送红包')
        .action(async ({session}, amount: number, count: number) => {
            const channelId = session.channelId;
            const userId = session.userId;
            const platform = session.platform;
            
            // 验证金额和数量
            if (!amount || amount <= 0) {
                return '❌ 红包金额必须大于0';
            }
            
            if (!count || count <= 0 || count > 100) {
                return '❌ 红包数量必须为 1-100 之间的整数';
            }
            
            // 确保初始星币大于等于人数
            if (amount < count) {
                return '❌ 红包总金额不能小于红包数量，每个红包至少需要1星币';
            }

            const fee = config.red_packet.smallPacketFee;
            const totalCost = amount + fee;

            // 检查用户星币是否足够
            const hasEnough = await StarCoinHelper.hasEnoughStarCoin(ctx, userId, channelId, totalCost);
            if (!hasEnough) {
                const currentStarCoin = await StarCoinHelper.getUserStarCoin(ctx, userId, channelId);
                return `❌ 您的星币不足，需要 ${totalCost} 星币（红包 ${amount} + 手续费 ${fee}）！当前星币: ${currentStarCoin}`;
            }

            try {
                // 请求确认
                await session.send(`⚠️ 您即将发送 ${amount} 星币的 ${count} 个红包，需要支付 ${fee} 星币手续费。\n请发送「确认」继续，「取消」放弃操作（${config.red_packet.confirmationTimeout}秒后自动取消）`);

                // 创建确认 Promise
                const confirmed = await confirmationManager.createConfirmation(ctx, session, config.red_packet.confirmationTimeout);
                if (!confirmed) {
                    return '❌ 操作已取消或超时';
                }

                // 扣除星币
                const success = await StarCoinHelper.removeUserStarCoin(ctx, userId, channelId, totalCost);
                if (!success) {
                    return '❌ 星币扣除失败，请稍后再试';
                }

                // 计算过期时间
                const now = Date.now();
                const expiryTime = now + config.red_packet.packetExpiryTime * 60 * 60 * 1000;

                // 创建红包记录
                const packet = await ctx.database.create('red_packets', {
                    creatorId: userId,
                    channelId,
                    platform,
                    amount,
                    totalCount: count,
                    remainingAmount: amount,
                    remainingCount: count,
                    createTime: now,
                    expiryTime,
                    status: 'active',
                    fee
                });

                // 发送红包消息
                await session.send(`🎁 ${session.username || userId} 发了一个 ${count} 个共 ${amount} 星币的红包！\n发送「抢红包 ${packet.id}」来领取吧~\n有效期：${config.red_packet.packetExpiryTime}小时`);

                // 通知手续费
                const remainingStarCoin = await StarCoinHelper.getUserStarCoin(ctx, userId, channelId);
                return `✅ 红包创建成功！红包ID：${packet.id}\n💸 已扣除 ${totalCost} 星币（红包 ${amount} + 手续费 ${fee}），剩余星币：${remainingStarCoin}`;
            } catch (error: any) {
                return `❌ ${error.message || '操作失败，请稍后再试'}`;
            }
        });

    // 抢红包命令
    ctx.command('grab <packetId:number>', '领取红包')
        .alias('抢红包')
        .action(async ({session}, packetId: number) => {
            const channelId = session.channelId;
            const userId = session.userId;

            // 查找红包
            const packets = await ctx.database.get('red_packets', { id: packetId });
            if (packets.length === 0) {
                return '❌ 红包不存在或已被删除';
            }

            const packet = packets[0];

            // 检查红包是否在当前频道
            if (packet.channelId != channelId) {
                return '❌ 这个红包不在当前频道';
            }

            // 检查红包状态
            const now = Date.now();
            if (packet.status !== 'active') {
                if (packet.status === 'expired') {
                    return '❌ 红包已过期';
                } else if (packet.status === 'completed') {
                    return '❌ 红包已被领完';
                }
                return '❌ 红包状态异常';
            }

            // 检查是否过期
            if (now > packet.expiryTime) {
                await ctx.database.set('red_packets', { id: packetId }, { status: 'expired' });
                return '❌ 红包已过期';
            }

            // 检查用户是否已经领取过
            const claims = await ctx.database.get('red_packet_claims', {
                packetId,
                userId
            });
            if (claims.length > 0) {
                return '❌ 您已经领取过这个红包了';
            }

            // 检查红包是否已被领完
            if (packet.remainingAmount <= 0 || packet.remainingCount <= 0) {
                await ctx.database.set('red_packets', { id: packetId }, { status: 'completed' });
                return '❌ 红包已被领完';
            }

            // 计算领取金额（使用正态分布）
            const claimAmount = calculateClaimAmount(packet, `${packetId}_${userId}_${now}`);

            // 判断是否是最后一个红包
            const isLastPacket = packet.remainingCount === 1;

            // 更新红包状态
            await ctx.database.set('red_packets', { id: packetId }, {
                remainingAmount: packet.remainingAmount - claimAmount,
                remainingCount: packet.remainingCount - 1,
                status: isLastPacket ? 'completed' : 'active'
            });

            // 添加领取记录
            await ctx.database.create('red_packet_claims', {
                packetId,
                userId,
                amount: claimAmount,
                claimTime: now
            });

            // 增加用户星币
            await StarCoinHelper.addUserStarCoin(ctx, userId, channelId, claimAmount);

            // 获取领取后的星币数量
            const remainingStarCoin = await StarCoinHelper.getUserStarCoin(ctx, userId, channelId);

            // 通知发送者
            const creatorName = session.bot ? await getUserName(ctx, session, packet.creatorId) : packet.creatorId;
            const receiverName = session.username || userId;
            
            // 发送系统通知
            if (isLastPacket) {
                // 最后一个红包被领取，通知红包已被领完
                await ctx.broadcast([`${packet.platform}:${channelId}`], [
                    `🎉 ${receiverName} 领取了 ${creatorName} 发的红包 ${packet.id} 的最后一份，获得 ${claimAmount} 星币！\n🎊 本轮红包已被全部领完！`
                ]);
            } else {
                // 普通领取通知
                await ctx.broadcast([`${packet.platform}:${channelId}`], [`🎊 ${receiverName} 领取了 ${creatorName} 发的红包，获得 ${claimAmount} 星币！`]);
            }

            return `🎉 恭喜您领取了 ${claimAmount} 星币！当前星币：${remainingStarCoin}`;
        });

    // 查询红包状态命令
    ctx.command('redpacket.stats <packetId:number>', '查询红包状态')
        .action(async ({session}, packetId: number) => {
            const channelId = session.channelId;

            // 查找红包
            const packets = await ctx.database.get('red_packets', { id: packetId });
            if (packets.length === 0) {
                return '❌ 红包不存在或已被删除';
            }

            const packet = packets[0];

            // 检查红包是否在当前频道
            if (packet.channelId !== channelId) {
                return '❌ 这个红包不在当前频道';
            }

            // 获取领取记录
            const claims = await ctx.database.get('red_packet_claims', { packetId });

            // 计算剩余时间
            const now = Date.now();
            let remainingTime = '';
            if (packet.status === 'active' && now < packet.expiryTime) {
                const hoursLeft = Math.floor((packet.expiryTime - now) / (60 * 60 * 1000));
                const minutesLeft = Math.floor((packet.expiryTime - now) % (60 * 60 * 1000) / (60 * 1000));
                remainingTime = `，剩余 ${hoursLeft}小时${minutesLeft}分钟`;
            }

            // 构建状态消息
            const statusMessages = [
                `红包ID：${packetId}`,
                `创建者：${await getUserName(ctx, session, packet.creatorId) || packet.creatorId}`,
                `总金额：${packet.amount} 星币`,
                `红包数量：${packet.totalCount} 个`,
                `剩余金额：${packet.remainingAmount} 星币`,
                `剩余数量：${packet.remainingCount} 个`,
                `手续费：${packet.fee} 星币`,
                `状态：${getStatusText(packet.status)}${remainingTime}`,
                `领取人数：${claims.length}人`
            ];

            // 添加领取明细
            if (claims.length > 0) {
                statusMessages.push('领取明细：');
                // 按金额排序，显示手气最佳
                const sortedClaims = [...claims].sort((a, b) => b.amount - a.amount);
                for (const claim of sortedClaims) {
                    const userName = await getUserName(ctx, session, claim.userId) || claim.userId;
                    statusMessages.push(`- ${userName}：${claim.amount} 星币`);
                }
            }

            return statusMessages.join('\n');
        });

    // 查看当前频道可领取的红包命令
    ctx.command('redpacket.remain', '查看当前频道可领取的红包')
        .action(async ({session}) => {
            const channelId = session.channelId;
            const now = Date.now();

            // 查询当前频道中状态为active的红包
            const activePackets = await ctx.database.get('red_packets', {
                channelId,
                status: 'active',
                expiryTime: { $gt: now },
                remainingCount: { $gt: 0 },
                remainingAmount: { $gt: 0 }
            });

            if (activePackets.length === 0) {
                return '🎈 当前频道没有可领取的红包';
            }

            // 按创建时间降序排列（最新的红包在前）
            activePackets.sort((a, b) => b.createTime - a.createTime);

            // 构建红包列表消息
            const packetMessages = ['🎉 当前频道可领取的红包：'];
            for (const packet of activePackets) {
                const creatorName = await getUserName(ctx, session, packet.creatorId) || packet.creatorId;
                const hoursLeft = Math.floor((packet.expiryTime - now) / (60 * 60 * 1000));
                const minutesLeft = Math.floor((packet.expiryTime - now) % (60 * 60 * 1000) / (60 * 1000));
                
                packetMessages.push(`🧧 【红包ID：${packet.id}】`);
                packetMessages.push(`创建者：${creatorName}`);
                packetMessages.push(`总金额：${packet.amount} 星币，总数量：${packet.totalCount} 个`);
                packetMessages.push(`剩余：${packet.remainingAmount} 星币，${packet.remainingCount} 个`);
                packetMessages.push(`有效期：${hoursLeft}小时${minutesLeft}分钟`);
            }

            const botName = await getUserName(this.ctx, session, session.bot?.userId) || "Bot";

            // 抢红包提示文本
            const claimHint = '💡 发送 [抢红包 红包 ID] 来领取红包！';
            
            if (session.onebot) {
                await session.onebot.sendGroupForwardMsg(channelId, [
                    createTextMsgNode(session.bot?.userId, botName, '🎉 当前频道可领取的红包：'),
                    createTextMsgNode(session.bot?.userId, botName, packetMessages.slice(1).join('\n')),
                    createTextMsgNode(session.bot?.userId, botName, claimHint)
                ])
            } else {
                packetMessages.push(claimHint);
                return packetMessages.join('\n');
            }
        });

    // 辅助函数：获取状态文本
    function getStatusText(status: string): string {
        switch (status) {
            case 'active': return '进行中';
            case 'completed': return '已领完';
            case 'expired': return '已过期';
            default: return '未知';
        }
    }

    // 辅助函数：使用正态分布计算领取金额
    function calculateClaimAmount(packet: RedPacket, seed: string): number {
        // 如果是最后一个红包，直接返回剩余全部金额
        if (packet.remainingCount === 1) {
            return packet.remainingAmount;
        }

        // 平均值为剩余金额除以剩余数量
        const avg = packet.remainingAmount / packet.remainingCount;
        // 标准差为平均值的 30%
        const sigma = avg * 0.3;
        // 最小金额为 1
        const minAmount = 1;
        // 最大金额不超过剩余金额减去剩余人数-1（确保剩下的人每人至少有1星币）
        const maxAmount = Math.min(Math.floor(2 * avg), packet.remainingAmount - (packet.remainingCount - 1));

        // 使用正态分布生成随机金额
        let amount = Math.round(normalRandom(seed, avg, sigma));
        // 确保金额在有效范围内
        amount = Math.max(minAmount, Math.min(amount, maxAmount));
        
        return amount;
    }

    // 定时检查并处理过期红包（每小时执行一次）
    ctx.setInterval(async () => {
        const now = Date.now();
        
        // 查找所有活跃但已过期的红包
        const expiredPackets = await ctx.database.get('red_packets', {
            status: 'active',
            expiryTime: { $lt: now }
        });

        for (const packet of expiredPackets) {
            // 更新红包状态为过期
            await ctx.database.set('red_packets', { id: packet.id }, { status: 'expired' });

            // 如果红包还有剩余金额，可以选择退还，但当前需求没有明确要求，所以这里暂时不处理
            if (packet.remainingAmount > 0) {
                // 记录日志，但不实际退还
                ctx.logger.info(`红包 ${packet.id} 已过期，剩余 ${packet.remainingAmount} 星币未领取`);
            }
        }
    }, 60 * 60 * 1000);
}