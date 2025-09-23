import { Config } from "../../index";
import { Context, Session } from "koishi";

export const name = 'guess-number'

interface Participant {
    name: string;
    skipCount: number;
}

interface GameData {
    channelId: string;
    platform: string;
    creatorId: string;
    targetNumber: number;
    participants: Map<string, Participant>;
    currentPlayerIndex: number;
    gameState: 'signup' | 'playing' | 'ended';
    minRange: number;
    maxRange: number;
    signUpTimer: NodeJS.Timeout | null;
    guessTimer: NodeJS.Timeout | null;
    rewardCoins: number; // 获胜者获得的星币数量
    dynamicBonus?: number; // 动态星币加法值
}

export function guess_number(ctx: Context, config: Config) {
    // 游戏状态管理
    const games = new Map<string, GameData>() // channelId -> gameData

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
        }
    }

    ctx.command('guess [dynamicBonus:number]', '开启动态计算星币的猜数字游戏')
        .action(async ({ session }, dynamicBonus?: number) => {
            if (!session.guildId) {
                return "请在群聊中使用 guess 命令哦！";
            }

            const channelId = session.channelId
            const platform = session.platform

            if (games.has(channelId)) {
                return '当前频道已有进行中的游戏！'
            }

            // 检查用户权限，只有authority5的用户才能指定数值
            const user = await ctx.database.getUser(session.platform, session.userId);
            const userAuthority = user.authority;
            
            // 确定动态奖励加法值
            let bonus = config.guess_number.defaultDynamicBonus;
            if (dynamicBonus) {
                if (userAuthority < 5) {
                    // 非authority5用户，限制在-15到15之间
                    if (dynamicBonus < -15 || dynamicBonus > 15) {
                        return '❌ 非最高权限用户只能指定 -15 到 15 之间的数值！';
                    }
                }
                bonus = dynamicBonus;
            }

            // 保存乘数信息到游戏数据中
            const game = createGame(channelId, session.userId, config.guess_number.defaultStarCoin)
            game.platform = platform
            games.set(channelId, game)
            game.dynamicBonus = bonus; // 保存动态乘数

            // 设置报名倒计时
            game.signUpTimer = setTimeout(() => {
                startGame(channelId)
            }, config.guess_number.signUpTime * 1000)

            return [
                '🎮 动态奖励猜数字游戏开始报名！',
                `📝 报名时间：${config.guess_number.signUpTime}秒`,
                '🎯 游戏规则：系统会在 2-99 (包含两边的数字) 之间随机选择一个数字',
                '💡 发送"参加游戏"来参加比赛',
                `⏰ 每轮限时 ${config.guess_number.guessTimeout} 秒，连续 ${config.guess_number.maxSkips} 次超时将被踢出`,
                bonus >= 0 ? `💰 获胜奖励：动态计算（报名费总和 + ${bonus} 星币）` : `💰 获胜奖励：动态计算（报名费总和 - ${Math.abs(bonus)} 星币）`,
                `💸 报名费用：${config.guess_number.entryFee} 星币`,

            ].join('\n')
        })

    ctx.command('guess.party [rewardCoins:number]', '开启固定星币奖励的猜数字游戏派对')
        .action(async ({ session }, rewardCoins?: number) => {
            if (!session.guildId) {
                return "请在群聊中使用 guess.party 命令哦！";
            }

            const channelId = session.channelId
            const platform = session.platform

            if (games.has(channelId)) {
                return '当前频道已有进行中的游戏！'
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

            const game = createGame(channelId, session.userId, rewardCoins)
            game.platform = platform
            games.set(channelId, game)

            // 设置报名倒计时
            game.signUpTimer = setTimeout(() => {
                startGame(channelId)
            }, config.guess_number.signUpTime * 1000)

            return [
                '🎉 固定奖励猜数字游戏派对开始报名！',
                `📝 报名时间：${config.guess_number.signUpTime}秒`,
                '🎯 游戏规则：系统会在 2-99 (包含两边的数字) 之间随机选择一个数字',
                '💡 发送"参加游戏"来参加比赛',
                `⏰ 每轮限时 ${config.guess_number.guessTimeout} 秒，连续 ${config.guess_number.maxSkips} 次超时将被踢出`,
                `💰 获胜奖励：${rewardCoins} 星币！`,
                `💸 报名费用：${config.guess_number.entryFee} 星币`,
            ].join('\n')
        })

    ctx.command('参加游戏', '参加猜数字游戏')
        .action(async ({ session }) => {
            const channelId = session.channelId
            const game = games.get(channelId)

            if (!game) {
                return '当前没有进行中的游戏，发送"guess"开启新游戏 (只有最高权限用户组可以使用)'
            }

            if (game.gameState !== 'signup') {
                return '游戏已开始，无法再报名'
            }

            if (game.participants.has(session.userId)) {
                return '你已经参加过了！'
            }

            // 检查用户是否有足够星币支付报名费
            try {
                const entryFee = config.guess_number.entryFee;
                const userRecord = await ctx.database.get('sign_in', {
                    userId: session.userId,
                    channelId: channelId
                });

                if (userRecord.length === 0 || userRecord[0].starCoin < entryFee) {
                    return `❌ 您的星币不足，需要 ${entryFee} 星币才能参加游戏！`;
                }

                // 扣除报名费
                await ctx.database.set('sign_in',
                    { userId: session.userId, channelId: channelId },
                    { starCoin: userRecord[0].starCoin - entryFee }
                );

                game.participants.set(session.userId, {
                    name: session.username || session.userId,
                    skipCount: 0,
                })

                return `✅ ${session.username || session.userId} 成功报名！当前参赛人数：${game.participants.size}\n💸 已扣除报名费 ${entryFee} 星币，剩余星币：${userRecord[0].starCoin - entryFee}`;
            } catch (error) {
                console.error('扣除报名费失败:', error);
                return '❌ 报名费扣除失败，请稍后再试';
            }
        })

    ctx.command('guess.quit', '终止游戏（仅限创建者）')
        .action(async ({ session }) => {
            const channelId = session.channelId
            const game = games.get(channelId)

            if (!game) {
                return '当前没有进行中的游戏'
            }

            if (session.userId !== game.creatorId) {
                return '只有游戏创建者可以结束游戏'
            }

            endGame(channelId, '游戏被创建者终止')
        })

    // 监听数字输入
    ctx.middleware(async (session, next) => {
        const channelId = session.channelId
        const game = games.get(channelId)

        if (!game || game.gameState !== 'playing') {
            return next()
        }

        const content = session.content?.trim()
        if (!/^\d+$/.test(content)) {
            return next()
        }

        const currentPlayerList = Array.from(game.participants.keys())
        const currentPlayerId = currentPlayerList[game.currentPlayerIndex]

        if (session.userId !== currentPlayerId) {
            return next()
        }

        const guess = parseInt(content)
        await handleGuess(game, session, guess)
        return
    })

    // 开始游戏
    async function startGame(channelId: string) {
        const game = games.get(channelId)
        if (!game) return

        if (game.participants.size < 2) {
            // 人数不足，退还所有报名者的报名费
            const entryFee = config.guess_number.entryFee;
            for (const [userId] of game.participants.entries()) {
                try {
                    // 获取用户当前星币
                    const userRecord = await ctx.database.get('sign_in', {
                        userId: userId,
                        channelId: channelId
                    });

                    // 退还报名费
                    if (userRecord.length > 0) {
                        await ctx.database.set('sign_in',
                            { userId: userId, channelId: channelId },
                            { starCoin: userRecord[0].starCoin + entryFee }
                        );
                    }
                } catch (error) {
                    console.error('退还报名费失败:', error);
                }
            }
            
            endGame(channelId, `❌ 小于两个玩家参加，游戏取消\n💸 已退还所有报名者 ${entryFee} 星币`)
            return
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

        game.gameState = 'playing'

        await ctx.broadcast([`${game.platform}:${channelId}`], [
            '🎮 游戏开始！',
            `👥 参赛玩家：${Array.from(game.participants.values()).map(p => p.name).join(', ')}`,
            `🎯 请在 ${game.minRange + 1}-${game.maxRange - 1} 之间猜一个数字`,
            '🔄 游戏将按报名顺序轮流进行',
            `💰 获胜奖励：${game.rewardCoins} 星币！`
        ].join('\n'))

        nextPlayer(game)
    }

    // 下一个玩家
    function nextPlayer(game: GameData) {
        if (game.gameState !== 'playing') return

        const playerList = Array.from(game.participants.keys())
        if (playerList.length === 0) {
            endGame(game.channelId, '❌ 所有玩家都被踢出，游戏结束')
            return
        }

        // 循环到下一个玩家
        game.currentPlayerIndex = game.currentPlayerIndex % playerList.length
        const currentPlayerId = playerList[game.currentPlayerIndex]
        const currentPlayer = game.participants.get(currentPlayerId)
        if (!currentPlayer) return

        ctx.broadcast([`${game.platform}:${game.channelId}`],
            `🎯 轮到 ${currentPlayer.name} 猜数字！\n` +
            `📊 当前范围：${game.minRange + 1}-${game.maxRange - 1}\n` +
            `⏰ 限时 ${config.guess_number.guessTimeout} 秒`
        )

        // 设置超时
        game.guessTimer = setTimeout(() => {
            handleTimeout(game, currentPlayerId)
        }, config.guess_number.guessTimeout * 1000)
    }

    // 处理猜数字
    async function handleGuess(game: GameData, session: Session, guess: number) {
        // 清除超时定时器
        if (game.guessTimer) {
            clearTimeout(game.guessTimer)
            game.guessTimer = null
        }

        // 重置当前玩家的跳过计数
        const currentPlayer = game.participants.get(session.userId)
        if (currentPlayer) {
            currentPlayer.skipCount = 0
        }

        // 验证数字范围
        if (guess <= game.minRange || guess >= game.maxRange) {
            await ctx.broadcast([`${game.platform}:${game.channelId}`],
                `❌ ${session.username || session.userId}，请输入 ${game.minRange + 1}-${game.maxRange - 1} 之间的数字！`
            )
            // 不移动到下一个玩家，让当前玩家重新猜
            game.guessTimer = setTimeout(() => {
                handleTimeout(game, session.userId)
            }, config.guess_number.guessTimeout * 1000)
            return
        }

        // 检查是否猜中
        if (guess === game.targetNumber) {
            // 给予星币奖励
            try {
                // 查找用户的星币记录
                const userRecord = await ctx.database.get('sign_in', {
                    userId: session.userId,
                    channelId: game.channelId
                });

                let starCoin: number;
                
                // 更新或创建用户的星币记录
                if (userRecord.length > 0) {
                    // 用户已有记录，增加星币
                    starCoin = userRecord[0].starCoin + game.rewardCoins;
                    await ctx.database.set('sign_in',
                        { userId: session.userId, channelId: game.channelId },
                        { starCoin: starCoin }
                    );
                } else {
                    // 用户没有记录，创建新记录
                    starCoin = game.rewardCoins;
                    await ctx.database.create('sign_in', {
                        userId: session.userId,
                        channelId: game.channelId,
                        starCoin: starCoin,
                        consecutiveDays: 0,
                        lastSignIn: Date.now()
                    });
                }

                endGame(game.channelId, `🎉 恭喜 ${session.username || session.userId} 猜中了！答案是 ${game.targetNumber}\n💰 获得奖励：${game.rewardCoins} 星币\n💎 当前星币：${starCoin}`)
            } catch (error) {
                console.error('发放星币奖励失败:', error);
                endGame(game.channelId, `🎉 恭喜 ${session.username || session.userId} 猜中了！答案是 ${game.targetNumber}\n⚠️ 星币奖励发放失败，请联系管理员`)
            }
            return
        }

        // 更新范围
        if (guess < game.targetNumber) {
            game.minRange = guess
            await ctx.broadcast([`${game.platform}:${game.channelId}`],
                `📈 ${session.username || session.userId} 猜了 ${guess}，答案更大！\n` +
                `🎯 新范围：${game.minRange + 1}-${game.maxRange - 1}`
            )
        } else {
            game.maxRange = guess
            await ctx.broadcast([`${game.platform}:${game.channelId}`],
                `📉 ${session.username || session.userId} 猜了 ${guess}，答案更小！\n` +
                `🎯 新范围：${game.minRange + 1}-${game.maxRange - 1}`
            )
        }

        // 移动到下一个玩家
        game.currentPlayerIndex++
        setTimeout(() => nextPlayer(game), 1000)
    }

    // 处理超时
    function handleTimeout(game: GameData, playerId: string) {
        const player = game.participants.get(playerId)
        if (!player) return

        player.skipCount++

        ctx.broadcast([`${game.platform}:${game.channelId}`],
            `⏰ ${player.name} 超时！(${player.skipCount}/${config.guess_number.maxSkips})`
        )

        if (player.skipCount >= config.guess_number.maxSkips) {
            game.participants.delete(playerId)
            ctx.broadcast([`${game.platform}:${game.channelId}`],
                `❌ ${player.name} 连续超时被踢出游戏`
            )

            // 如果当前被踢出的玩家正好是当前索引，需要调整索引
            const playerList = Array.from(game.participants.keys())
            if (game.currentPlayerIndex >= playerList.length) {
                game.currentPlayerIndex = 0
            }
        } else {
            game.currentPlayerIndex++
        }

        setTimeout(() => nextPlayer(game), 1000)
    }

    // 结束游戏
    function endGame(channelId: string, message: string) {
        const game = games.get(channelId)
        if (!game) return

        // 清理定时器
        if (game.signUpTimer) {
            clearTimeout(game.signUpTimer)
        }
        if (game.guessTimer) {
            clearTimeout(game.guessTimer)
        }

        games.delete(channelId)
        ctx.broadcast([`${game.platform}:${channelId}`], message)
    }

    // 插件卸载时清理
    ctx.on('dispose', () => {
        for (const game of games.values()) {
            if (game.signUpTimer) clearTimeout(game.signUpTimer)
            if (game.guessTimer) clearTimeout(game.guessTimer)
        }
        games.clear()
    })
}
