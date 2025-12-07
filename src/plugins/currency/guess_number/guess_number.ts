import { Config } from '../../../index';
import { useConfirmationHelper } from '../../../utils/confirmation_helper';
import { StarCoinHelper } from '../../../utils/starcoin_helper';
import { Context, Session } from 'koishi';

export const name = 'guess-number';

interface Participant {
    name: string;
    skipCount: number;
}

interface DailyGameCount {
    id: number;
    userId: string;
    channelId: string;
    date: string;
    gameCount: number;
}

declare module 'koishi' {
    interface Tables {
        guess_daily_counts: DailyGameCount;
    }
}

interface GameData {
    channelId: string;
    platform: string;
    creatorId: string;
    targetNumber: number;
    participants: Map<string, Participant>;
    currentPlayerIndex: number;
    gameState: 'signup' | 'playing' | 'ended' | 'confirming'; // 新增 confirming 状态表示正在等待确认
    minRange: number;
    maxRange: number;
    signUpTimer: NodeJS.Timeout | null;
    guessTimer: NodeJS.Timeout | null;
    rewardCoins: number; // 获胜者获得的星币数量
    dynamicBonus?: number; // 动态星币加法值
}

export function guess_number(ctx: Context, config: Config) {
    // 确保 guess_daily_counts 表存在
    ctx.database.extend(
        'guess_daily_counts',
        {
            id: 'unsigned',
            userId: 'string',
            channelId: 'string',
            date: 'string',
            gameCount: 'unsigned',
        },
        {
            primary: 'id',
            autoInc: true,
            unique: [['userId', 'channelId', 'date']],
        }
    );

    // 游戏状态管理
    const games = new Map<string, GameData>(); // channelId -> gameData

    // 使用确认辅助函数
    const confirmationManager = useConfirmationHelper(ctx);

    // 游戏数据结构
    function createGame(channelId: string, creatorId: string, rewardCoins: number = 100): GameData {
        return {
            channelId,
            platform: '', // 稍后设置
            creatorId,
            targetNumber: Math.floor(Math.random() * 98) + 2, // 2-99
            participants: new Map<string, Participant>(), // userId -> {name, skipCount}
            currentPlayerIndex: 0,
            gameState: 'signup', // signup, playing, ended
            minRange: 1,
            maxRange: 100,
            signUpTimer: null,
            guessTimer: null,
            rewardCoins: rewardCoins,
        };
    }

    // 获取当天日期的 YYYY-MM-DD 格式
    function getTodayString(): string {
        const now = new Date();
        const year = now.getFullYear();
        const month = String(now.getMonth() + 1).padStart(2, '0');
        const day = String(now.getDate()).padStart(2, '0');
        return `${year}-${month}-${day}`;
    }

    // 获取用户当天的游戏次数
    async function getUserGameCount(userId: string, channelId: string): Promise<number> {
        const today = getTodayString();
        const records = await ctx.database.get('guess_daily_counts', {
            userId: userId,
            channelId: channelId,
            date: today,
        });

        if (records.length === 0) {
            return 0;
        }
        return records[0].gameCount;
    }

    // 获取频道当天的游戏总次数
    async function getChannelGameCount(channelId: string): Promise<number> {
        const today = getTodayString();
        // 查询当天该频道所有用户的游戏记录
        const records = await ctx.database.get('guess_daily_counts', {
            channelId: channelId,
            date: today,
        });

        // 计算总次数
        return records.reduce((total, record) => total + record.gameCount, 0);
    }

    // 增加用户当天的游戏次数
    async function incrementGameCount(userId: string, channelId: string): Promise<void> {
        const today = getTodayString();
        const records = await ctx.database.get('guess_daily_counts', {
            userId: userId,
            channelId: channelId,
            date: today,
        });

        if (records.length === 0) {
            await ctx.database.create('guess_daily_counts', {
                userId: userId,
                channelId: channelId,
                date: today,
                gameCount: 1,
            });
        } else {
            await ctx.database.set(
                'guess_daily_counts',
                { userId: userId, channelId: channelId, date: today },
                { gameCount: records[0].gameCount + 1 }
            );
        }
    }

    // 等待用户确认
    function waitForConfirmation(session: Session): Promise<boolean> {
        return confirmationManager.createConfirmation(ctx, session, 15);
    }

    ctx.command('guess [dynamicBonus:number]', '开启动态计算星币的猜数字游戏').action(
        async ({ session }, dynamicBonus?: number) => {
            if (!session.guildId) {
                return '请在群聊中使用 guess 命令哦！';
            }

            const channelId = session.channelId;
            const platform = session.platform;

            if (games.has(channelId)) {
                const existingGame = games.get(channelId);
                if (existingGame.gameState === 'confirming') {
                    return '当前频道有用户正在确认开启游戏，请稍候再试！';
                } else {
                    return '当前频道已有进行中的游戏！';
                }
            }

            // 检查用户权限
            const user = await ctx.database.getUser(session.platform, session.userId);
            const userAuthority = user.authority;

            // 特权用户标记（authority>3）
            const isAuthorizedUser = userAuthority > 3;

            // 确定用户每日游戏次数限制
            let maxGamesPerDay = 0; // 默认为无限制
            let todayGameCount = 0;

            const channelGameCount = await getChannelGameCount(channelId);

            // 只有非特权用户才受限制
            if (!isAuthorizedUser) {
                // 计算频道每日游戏次数上限 - 使用配置的前五次和额外五次
                const MAX_CHANNEL_GAMES_PER_DAY =
                    config.guess_number.firstDailyAttempts + config.guess_number.extraDailyAttempts;

                // 检查频道当日游戏次数是否达到上限
                if (channelGameCount >= MAX_CHANNEL_GAMES_PER_DAY) {
                    return `❌ 本频道今日游戏次数已达上限 (${MAX_CHANNEL_GAMES_PER_DAY}次)，请明天再来！`;
                }

                // 确定用户每日游戏次数限制
                if (userAuthority === 3) {
                    maxGamesPerDay = 5;
                } else if (userAuthority < 3) {
                    maxGamesPerDay = 2;
                }

                // 检查每日游戏次数限制
                if (maxGamesPerDay > 0) {
                    todayGameCount = await getUserGameCount(session.userId, channelId);
                    if (todayGameCount >= maxGamesPerDay) {
                        return `❌ 您今天的游戏次数已达上限 (${maxGamesPerDay}次)，请明天再来！`;
                    }
                }
            }

            // 确定动态奖励加法值
            let bonus = config.guess_number.defaultDynamicBonus;

            // 处理低于 authority3 的用户
            if (userAuthority < 3) {
                // 如果指定了值，提示不允许
                if (dynamicBonus) {
                    return '❌ 权限不足，您不能指定数值！';
                }

                if (channelGameCount > config.guess_number.firstDailyAttempts) {
                    bonus = config.guess_number.extraBonus;
                } else {
                    bonus = config.guess_number.firstBonus;
                }

                // 检查用户是否有足够的星币支付 10 星币
                const userRecord = await ctx.database.get('sign_in', {
                    userId: session.userId,
                    channelId: channelId,
                });

                if (userRecord.length === 0 || userRecord[0].starCoin < 10) {
                    return '❌ 您的星币不足10个，无法开启游戏！';
                }

                // 提示用户扣除10星币前，先在 games 中创建一个临时标记，防止其他用户同时开启游戏
                // 创建一个临时游戏对象作为标记
                const tempGame = createGame(
                    channelId,
                    session.userId,
                    config.guess_number.defaultStarCoin
                );
                tempGame.platform = platform;
                tempGame.gameState = 'confirming'; // 添加确认状态
                games.set(channelId, tempGame);

                await session.send(
                    `💸 开启游戏需要扣除10个星币，15秒内回复"确认"继续，回复"取消"放弃。`
                );

                // 等待用户确认
                const confirmed = await waitForConfirmation(session);

                if (!confirmed) {
                    // 用户取消，删除临时游戏标记
                    games.delete(channelId);
                    return '❌ 游戏已取消！';
                }

                // 扣除10星币
                await StarCoinHelper.removeUserStarCoin(ctx, session.userId, channelId, 10);

                // 确认成功，删除临时游戏标记（会在后面重新创建正式游戏）
                games.delete(channelId);
            }
            // 处理 authority=3 的用户
            else if (userAuthority === 3) {
                if (dynamicBonus) {
                    if (dynamicBonus < -30 || dynamicBonus > 30) {
                        return '❌ 您只能指定 -30 到 30 之间的数值！';
                    }
                    bonus = dynamicBonus;
                }
            }
            // 处理 authority > 3 的用户
            else if (userAuthority > 3) {
                if (dynamicBonus) {
                    bonus = dynamicBonus;
                }
            }

            // 增加用户当天的游戏次数（特权用户不计入）
            let updatedGameCount = 0;
            if (!isAuthorizedUser && maxGamesPerDay > 0) {
                await incrementGameCount(session.userId, channelId);
                updatedGameCount = todayGameCount + 1;
            }

            // 获取并显示频道剩余游戏次数
            const currentChannelGameCount = await getChannelGameCount(channelId);
            const MAX_CHANNEL_GAMES_PER_DAY =
                config.guess_number.firstDailyAttempts + config.guess_number.extraDailyAttempts;
            const remainingChannelGames = MAX_CHANNEL_GAMES_PER_DAY - currentChannelGameCount;

            // 保存乘数信息到游戏数据中
            const game = createGame(channelId, session.userId, config.guess_number.defaultStarCoin);
            game.platform = platform;
            games.set(channelId, game);
            game.dynamicBonus = bonus; // 保存动态乘数

            // 设置报名倒计时
            game.signUpTimer = setTimeout(() => {
                startGame(channelId);
            }, config.guess_number.signUpTime * 1000);

            const remainingGames =
                maxGamesPerDay > 0
                    ? `\n💡 今日剩余游戏次数：${maxGamesPerDay - updatedGameCount}`
                    : '';
            const channelRemainingInfo = `\n📢 本频道今日剩余游戏次数：${remainingChannelGames}`;

            return [
                '🎮 动态奖励猜数字游戏开始报名！',
                `📝 报名时间：${config.guess_number.signUpTime}秒`,
                '🎯 游戏规则：系统会在 2-99 (包含两边的数字) 之间随机选择一个数字',
                '💡 发送"参加游戏"来参加比赛',
                `⏰ 每轮限时 ${config.guess_number.guessTimeout} 秒，连续 ${config.guess_number.maxSkips} 次超时将被踢出`,
                bonus >= 0
                    ? `💰 获胜奖励：动态计算（报名费总和 + ${bonus} 星币）`
                    : `💰 获胜奖励：动态计算（报名费总和 - ${Math.abs(bonus)} 星币）`,
                `💸 报名费用：${config.guess_number.entryFee} 星币`,
                remainingGames,
                channelRemainingInfo,
            ].join('\n');
        }
    );

    ctx.command('guess.party [rewardCoins:number]', '开启固定星币奖励的猜数字游戏派对').action(
        async ({ session }, rewardCoins?: number) => {
            if (!session.guildId) {
                return '请在群聊中使用 guess.party 命令哦！';
            }

            const channelId = session.channelId;
            const platform = session.platform;

            if (games.has(channelId)) {
                return '当前频道已有进行中的游戏！';
            }

            // 检查用户权限
            const user = await ctx.database.getUser(session.platform, session.userId);
            const userAuthority = user.authority;

            // 特权用户标记（authority>3）
            const isAuthorizedUser = userAuthority > 3;

            // 只有非特权用户才受限制
            const channelGameCount = await getChannelGameCount(channelId);
            const MAX_CHANNEL_GAMES_PER_DAY =
                config.guess_number.firstDailyAttempts + config.guess_number.extraDailyAttempts;
            if (!isAuthorizedUser) {
                // 检查频道当日游戏次数是否达到上限
                if (channelGameCount >= MAX_CHANNEL_GAMES_PER_DAY) {
                    return `❌ 本频道今日游戏次数已达上限 (${MAX_CHANNEL_GAMES_PER_DAY}次)，请明天再来！`;
                }
            }

            // 确定奖励星币数量
            if (rewardCoins) {
                // 验证奖励数量是否为有效数字且合理
                if (rewardCoins <= 0 || rewardCoins > 1000) {
                    return '请输入 1-1000 之间的有效数字作为星币奖励！';
                }
            } else {
                rewardCoins = config.guess_number.defaultStarCoin;
            }

            const game = createGame(channelId, session.userId, rewardCoins);
            game.platform = platform;
            games.set(channelId, game);

            // 设置报名倒计时
            game.signUpTimer = setTimeout(() => {
                startGame(channelId);
            }, config.guess_number.signUpTime * 1000);

            // 增加用户当天的游戏次数（特权用户不计入）
            if (!isAuthorizedUser) {
                let maxGamesPerDay = 0; // 默认为无限制
                if (userAuthority === 3) {
                    maxGamesPerDay = 5;
                } else if (userAuthority < 3) {
                    maxGamesPerDay = 2;
                }

                if (maxGamesPerDay > 0) {
                    const todayGameCount = await getUserGameCount(session.userId, channelId);
                    if (todayGameCount < maxGamesPerDay) {
                        await incrementGameCount(session.userId, channelId);
                    }
                }
            }

            // 获取并显示频道剩余游戏次数
            const currentChannelGameCount = channelGameCount + 1; // 包括当前游戏
            const remainingChannelGames = MAX_CHANNEL_GAMES_PER_DAY - currentChannelGameCount;

            return [
                '🎉 固定奖励猜数字游戏派对开始报名！',
                `📝 报名时间：${config.guess_number.signUpTime}秒`,
                '🎯 游戏规则：系统会在 2-99 (包含两边的数字) 之间随机选择一个数字',
                '💡 发送"参加游戏"来参加比赛',
                `⏰ 每轮限时 ${config.guess_number.guessTimeout} 秒，连续 ${config.guess_number.maxSkips} 次超时将被踢出`,
                `💰 获胜奖励：${rewardCoins} 星币！`,
                `💸 报名费用：${config.guess_number.entryFee} 星币`,
                `📢 本频道今日剩余游戏次数：${remainingChannelGames}`,
            ].join('\n');
        }
    );

    // 监听参加游戏的消息
    ctx.middleware(async (session, next) => {
        const channelId = session.channelId;
        const game = games.get(channelId);
        const content = session.content?.trim();

        // 只有当消息包含'参加游戏'且存在进行中的报名阶段游戏时才处理
        if (!content || !content.includes('参加游戏') || !game || game.gameState !== 'signup') {
            return next();
        }

        // 检查用户是否已经参加
        if (game.participants.has(session.userId)) {
            await session.send('你已经参加过了！');
            return;
        }

        // 检查用户是否有足够星币支付报名费
        const entryFee = config.guess_number.entryFee;

        const hasEnough = await StarCoinHelper.hasEnoughStarCoin(
            ctx,
            session.userId,
            channelId,
            entryFee
        );
        if (!hasEnough) {
            const currentStarCoin = await StarCoinHelper.getUserStarCoin(
                ctx,
                session.userId,
                channelId
            );
            await session.send(
                `❌ 您的星币不足，需要 ${entryFee} 星币才能参加游戏！当前星币：${currentStarCoin}`
            );
            return;
        }

        // 扣除报名费
        const success = await StarCoinHelper.removeUserStarCoin(
            ctx,
            session.userId,
            channelId,
            entryFee
        );

        if (!success) {
            await session.send('❌ 报名费扣除失败，请稍后再试');
            return;
        }

        // 获取扣除后的星币数量
        const remainingStarCoin = await StarCoinHelper.getUserStarCoin(
            ctx,
            session.userId,
            channelId
        );

        game.participants.set(session.userId, {
            name: session.username || session.userId,
            skipCount: 0,
        });

        await session.send(
            `✅ ${session.username || session.userId} 成功报名！当前参赛人数：${game.participants.size}\n💸 已扣除报名费 ${entryFee} 星币，剩余星币：${remainingStarCoin}`
        );
        return;
    });

    ctx.command('guess.quit', '终止游戏（仅限创建者）').action(async ({ session }) => {
        const channelId = session.channelId;
        const game = games.get(channelId);

        if (!game) {
            return '当前没有进行中的游戏';
        }

        if (session.userId !== game.creatorId) {
            return '只有游戏创建者可以结束游戏';
        }

        // 判断是否需要退还报名费（游戏还在报名阶段或刚创建不久）
        await endGame(channelId, '游戏被创建者终止', true);
        return '游戏已终止，已退还所有报名者的报名费';
    });

    // 监听数字输入
    ctx.middleware(async (session, next) => {
        const channelId = session.channelId;
        const game = games.get(channelId);

        if (!game || game.gameState !== 'playing') {
            return next();
        }

        const content = session.content?.trim();
        if (!/^\d+$/.test(content)) {
            return next();
        }

        const currentPlayerList = Array.from(game.participants.keys());
        const currentPlayerId = currentPlayerList[game.currentPlayerIndex];

        if (session.userId !== currentPlayerId) {
            return next();
        }

        const guess = parseInt(content);
        await handleGuess(game, session, guess);
        return;
    });

    // 开始游戏
    async function startGame(channelId: string) {
        const game = games.get(channelId);
        if (!game) return;

        if (game.participants.size < 2) {
            // 人数不足，使用新的退款机制
            await endGame(
                channelId,
                `❌ 小于两个玩家参加，游戏取消\n💸 已退还所有报名者 ${config.guess_number.entryFee} 星币`,
                true
            );
            return;
        }

        // 动态计算星币奖励（如果是动态游戏）
        if (game.dynamicBonus) {
            // 计算所有报名费的总和
            const totalEntryFee = game.participants.size * config.guess_number.entryFee;
            // 应用加法值
            game.rewardCoins = totalEntryFee + game.dynamicBonus;
            // 确保奖励不为负数
            if (game.rewardCoins < 0) game.rewardCoins = 0;
        }

        game.gameState = 'playing';

        await ctx.broadcast(
            [`${game.platform}:${channelId}`],
            [
                '🎮 游戏开始！',
                `👥 参赛玩家：${Array.from(game.participants.values())
                    .map((p) => p.name)
                    .join(', ')}`,
                `🎯 请在 ${game.minRange + 1}-${game.maxRange - 1} 之间猜一个数字`,
                '🔄 游戏将按报名顺序轮流进行',
                `💰 获胜奖励：${game.rewardCoins} 星币！`,
            ].join('\n')
        );

        await nextPlayer(game);
    }

    // 下一个玩家
    async function nextPlayer(game: GameData) {
        if (game.gameState !== 'playing') return;

        const playerList = Array.from(game.participants.keys());
        if (playerList.length === 0) {
            // 所有玩家都被踢出，不需要退款，因为游戏已经开始
            await endGame(game.channelId, '❌ 所有玩家都被踢出，游戏结束');
            return;
        }

        // 循环到下一个玩家
        game.currentPlayerIndex = game.currentPlayerIndex % playerList.length;
        const currentPlayerId = playerList[game.currentPlayerIndex];
        const currentPlayer = game.participants.get(currentPlayerId);
        if (!currentPlayer) return;

        await ctx.broadcast(
            [`${game.platform}:${game.channelId}`],
            `🎯 轮到 ${currentPlayer.name} 猜数字！\n` +
                `📊 当前范围：${game.minRange + 1}-${game.maxRange - 1}\n` +
                `⏰ 限时 ${config.guess_number.guessTimeout} 秒`
        );

        // 设置超时
        game.guessTimer = setTimeout(() => {
            handleTimeout(game, currentPlayerId);
        }, config.guess_number.guessTimeout * 1000);
    }

    // 处理猜数字
    async function handleGuess(game: GameData, session: Session, guess: number) {
        // 清除超时定时器
        if (game.guessTimer) {
            clearTimeout(game.guessTimer);
            game.guessTimer = null;
        }

        // 重置当前玩家的跳过计数
        const currentPlayer = game.participants.get(session.userId);
        if (currentPlayer) {
            currentPlayer.skipCount = 0;
        }

        // 验证数字范围
        if (guess <= game.minRange || guess >= game.maxRange) {
            await ctx.broadcast(
                [`${game.platform}:${game.channelId}`],
                `❌ ${session.username || session.userId}，请输入 ${game.minRange + 1}-${game.maxRange - 1} 之间的数字！`
            );
            // 不移动到下一个玩家，让当前玩家重新猜
            game.guessTimer = setTimeout(() => {
                handleTimeout(game, session.userId);
            }, config.guess_number.guessTimeout * 1000);
            return;
        }

        // 检查是否猜中
        if (guess === game.targetNumber) {
            // 给予星币奖励
            const success = await StarCoinHelper.addUserStarCoin(
                ctx,
                session.userId,
                game.channelId,
                game.rewardCoins
            );

            if (success) {
                // 获取更新后的星币数量
                const updatedStarCoin = await StarCoinHelper.getUserStarCoin(
                    ctx,
                    session.userId,
                    game.channelId
                );

                await endGame(
                    game.channelId,
                    `🎉 恭喜 ${session.username || session.userId} 猜中了！答案是 ${game.targetNumber}\n💰 获得奖励：${game.rewardCoins} 星币\n💎 当前星币：${updatedStarCoin}`
                );
            } else {
                await endGame(
                    game.channelId,
                    `🎉 恭喜 ${session.username || session.userId} 猜中了！答案是 ${game.targetNumber}\n⚠️ 星币奖励发放失败，请联系管理员`
                );
            }

            return;
        }

        // 更新范围
        if (guess < game.targetNumber) {
            game.minRange = guess;
            await ctx.broadcast(
                [`${game.platform}:${game.channelId}`],
                `📈 ${session.username || session.userId} 猜了 ${guess}，答案更大！\n` +
                    `🎯 新范围：${game.minRange + 1}-${game.maxRange - 1}`
            );
        } else {
            game.maxRange = guess;
            await ctx.broadcast(
                [`${game.platform}:${game.channelId}`],
                `📉 ${session.username || session.userId} 猜了 ${guess}，答案更小！\n` +
                    `🎯 新范围：${game.minRange + 1}-${game.maxRange - 1}`
            );
        }

        // 移动到下一个玩家
        game.currentPlayerIndex++;
        setTimeout(() => nextPlayer(game), 1000);
    }

    // 处理超时
    async function handleTimeout(game: GameData, playerId: string) {
        const player = game.participants.get(playerId);
        if (!player) return;

        player.skipCount++;

        await ctx.broadcast(
            [`${game.platform}:${game.channelId}`],
            `⏰ ${player.name} 超时！(${player.skipCount}/${config.guess_number.maxSkips})`
        );

        if (player.skipCount >= config.guess_number.maxSkips) {
            game.participants.delete(playerId);
            await ctx.broadcast(
                [`${game.platform}:${game.channelId}`],
                `❌ ${player.name} 连续超时被踢出游戏`
            );

            // 如果当前被踢出的玩家正好是当前索引，需要调整索引
            const playerList = Array.from(game.participants.keys());
            if (game.currentPlayerIndex >= playerList.length) {
                game.currentPlayerIndex = 0;
            }
        } else {
            game.currentPlayerIndex++;
        }

        setTimeout(() => nextPlayer(game), 1000);
    }

    // 结束游戏
    async function endGame(channelId: string, message: string, refundEntryFee: boolean = false) {
        const game = games.get(channelId);
        if (!game) return;

        // 清理定时器
        if (game.signUpTimer) {
            clearTimeout(game.signUpTimer);
        }
        if (game.guessTimer) {
            clearTimeout(game.guessTimer);
        }

        // 如果需要退还报名费和开启费用
        if (refundEntryFee) {
            const entryFee = config.guess_number.entryFee;
            const refundPromises = [];

            // 退还参与者的报名费
            if (game.participants.size > 0) {
                for (const [userId] of game.participants.entries()) {
                    refundPromises.push(
                        StarCoinHelper.addUserStarCoin(ctx, userId, channelId, entryFee)
                    );
                }
            }

            // 检查游戏创建者是否是付费开启游戏的用户 (authority < 3)
            try {
                const creator = await ctx.database.getUser(game.platform, game.creatorId);
                if (creator && creator.authority < 3) {
                    // 退还 10 个星币开启费用
                    refundPromises.push(
                        StarCoinHelper.addUserStarCoin(ctx, game.creatorId, channelId, 10)
                    );
                }
            } catch (error) {
                this.ctx.logger.warn('检查创建者权限失败:', error);
            }

            await Promise.all(refundPromises);
        }

        games.delete(channelId);
        await ctx.broadcast([`${game.platform}:${channelId}`], message);
    }

    // 插件卸载时清理
    ctx.on('dispose', () => {
        for (const game of games.values()) {
            if (game.signUpTimer) clearTimeout(game.signUpTimer);
            if (game.guessTimer) clearTimeout(game.guessTimer);
        }
        games.clear();
    });
}
