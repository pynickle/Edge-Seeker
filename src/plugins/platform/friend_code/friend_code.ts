import { Context } from 'koishi';
import { getUserName } from '../../../utils/onebot_helper';

export const name = 'friend_code';

export function friend_code(ctx: Context) {
    const userVerificationCodes = new Map<string, string>();
    // 存储用户的定时器ID，防止重复设置定时器
    const userTimers = new Map<string, NodeJS.Timeout>();

    function generateVerificationCode(): string {
        return Math.floor(100000 + Math.random() * 900000).toString();
    }

    // 验证验证码是否有效
    async function validateCode(
        userId: string,
        code: string
    ): Promise<boolean> {
        try {
            // 检查用户是否有验证码记录
            if (!userVerificationCodes.has(userId)) {
                return false;
            }

            const storedCode = userVerificationCodes.get(userId)!;

            ctx.logger.warn(
                `用户 ${userId} 提交的验证码: ${code}, 存储的验证码: ${storedCode}`
            );
            userVerificationCodes.forEach((user, code) =>
                ctx.logger.warn(`存储的验证码 - 用户: ${user}, 验证码: ${code}`)
            );

            // 检查验证码是否匹配
            if (storedCode != code) {
                return false;
            }

            // 清除用户的定时器
            if (userTimers.has(userId)) {
                clearTimeout(userTimers.get(userId)!);
                userTimers.delete(userId);
            }

            // 验证码验证成功后删除，防止重复使用
            userVerificationCodes.delete(userId);
            return true;
        } catch (error) {
            ctx.logger.error('验证验证码失败:', error);
            return false;
        }
    }

    // 注册生成验证码的命令
    ctx.command('friend', '获取加好友验证码（有效期1分钟）').action(
        async ({ session }) => {
            if (!session.onebot) {
                return '❌ 此命令仅支持 OneBot 适配器！';
            }

            const { userId } = session;
            Date.now();
            const code = generateVerificationCode(); // 1分钟有效期

            try {
                // 清除用户之前的验证码和定时器（如果存在）
                if (userTimers.has(userId)) {
                    clearTimeout(userTimers.get(userId)!);
                    userTimers.delete(userId);
                }

                // 存储新的验证码
                userVerificationCodes.set(userId, code);

                userVerificationCodes.forEach((user, code) =>
                    ctx.logger.warn(
                        `存储的验证码222 - 用户: ${user}, 验证码: ${code}`
                    )
                );

                // 设置1分钟后自动清理验证码的定时器
                const timerId = setTimeout(() => {
                    if (userVerificationCodes.has(userId)) {
                        userVerificationCodes.delete(userId);
                        userTimers.delete(userId);
                        ctx.logger.debug(
                            `已自动清理用户 ${userId} 的过期验证码`
                        );
                    }
                }, 60000); // 1分钟 = 60000毫秒

                userVerificationCodes.forEach((user, code) =>
                    ctx.logger.warn(
                        `存储的验证码333 - 用户: ${user}, 验证码: ${code}`
                    )
                );

                // 保存定时器ID
                userTimers.set(userId, timerId);

                // 发送验证码
                return `${await getUserName(ctx, session, userId)}，您的加好友验证码是：${code}\n有效期1分钟，请在添加机器人好友时将此验证码作为验证信息发送。`;
            } catch (error) {
                ctx.logger.error('生成验证码失败:', error);
                return '❌ 生成验证码失败，请稍后重试！';
            }
        }
    );

    // 处理好友请求
    ctx.on('friend-request', async (session) => {
        const eventData = session.event?._data || {};
        const flag = eventData.flag;
        const userId = session.userId; // 添加者的 QQ 号
        const verification = session.content; // 验证信息（comment）

        ctx.logger.info(`收到好友添加请求 from ${userId}: ${verification}`);

        // 根据验证信息判断
        if (verification) {
            // 检查是否是有效的验证码
            const isValid = await validateCode(userId, verification);
            if (isValid) {
                await session.onebot.setFriendAddRequest(flag, true); // 批准
                ctx.logger.info(`批准了 ${userId} 的请求（验证码验证成功）`);
                return;
            }
        }

        // 默认拒绝
        await session.onebot.setFriendAddRequest(flag, false); // 拒绝
        ctx.logger.info(`拒绝了 ${userId} 的请求（无效或过期的验证码）`);
    });
}
