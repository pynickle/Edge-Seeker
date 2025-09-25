import {formatDate} from '../../utils/time_helper';
import {StarCoinHelper} from '../../utils/starcoin_helper';
import axios from 'axios';
import {Context} from "koishi";

// 定义数据库表结构
export interface BaikeQuizRecord {
    id: number; // 自增主键
    userId: string; // 用户QQ号
    channelId: string; // 频道ID（群号）
    dailyAttempts: number; // 当日答题次数
    lastAttemptDate: string; // 最后答题日期（格式：YYYY-MM-DD）
    correctAnswers: number; // 正确答案数量
    wrongAnswers: number; // 错误答案数量
}

export interface BaikeQuizState {
    id: number; // 自增主键
    channelId: string; // 频道ID（群号）
    currentQuestion: string; // 当前问题
    answerA: string; // 答案A
    answerB: string; // 答案B
    answerC: string; // 答案C
    answerD: string; // 答案D
    correctAnswer: string; // 正确答案（A/B/C/D）
    analytic: string; // 答案解析
    questionerId: string; // 出题用户ID
    createTime: number; // 创建时间戳
}

export const name = 'baike_quiz';

// 定义问答结果类型
type QuizResult = {
    code: number;
    msg: string;
    result?: {
        title: string;
        answerA: string;
        answerB: string;
        answerC: string;
        answerD: string;
        answer: string;
        analytic: string;
    };
};

declare module 'koishi' {
    interface Tables {
        baike_quiz_record: BaikeQuizRecord;
        baike_quiz_state: BaikeQuizState;
    }
}

class BaikeQuizPlugin {
    private readonly API_URL = 'https://apis.tianapi.com/baiketiku/index';
    private readonly MAX_DAILY_ATTEMPTS = 5;
    private readonly REWARD_STAR_COIN = 10;
    private readonly PENALTY_STAR_COIN = 5;
    private readonly apiKey: string;
    private readonly questionTimeout: number;
    private readonly activeTimeouts = new Map<string, NodeJS.Timeout>();

    constructor(private ctx: Context, config: any) {
        this.apiKey = config?.baike_quiz?.apiKey || '';
        this.questionTimeout = config?.baike_quiz?.questionTimeout || 20;
        // 扩展数据库，创建baike_quiz_record表
        ctx.model.extend('baike_quiz_record', {
            id: 'unsigned',
            userId: 'string',
            channelId: 'string',
            dailyAttempts: 'integer',
            lastAttemptDate: 'string',
            correctAnswers: 'integer',
            wrongAnswers: 'integer',
        }, {
            primary: 'id',
            autoInc: true,
            unique: [['userId', 'channelId']]
        });

        // 扩展数据库，创建baike_quiz_state表
        ctx.model.extend('baike_quiz_state', {
            id: 'unsigned',
            channelId: 'string',
            currentQuestion: 'string',
            answerA: 'string',
            answerB: 'string',
            answerC: 'string',
            answerD: 'string',
            correctAnswer: 'string',
            analytic: 'string',
            questionerId: 'string',
            createTime: 'unsigned',
        }, {
            primary: 'id',
            autoInc: true,
            unique: ['channelId']
        });

        this.registerCommands();
        this.registerMessageListener();
    }

    private registerCommands(): void {
        // 开始百科问答
        this.ctx.command('quiz', '开始一次百科知识问答')
            .action(this.handleStartQuiz.bind(this));

        // 查看百科问答统计
        this.ctx.command('quiz.stats', '查看个人百科问答统计信息')
            .action(this.handleQuizStats.bind(this));
    }

    private registerMessageListener(): void {
        // 监听消息，检测用户直接输入的A/B/C/D回答
        this.ctx.on('message', async (session) => {
            // 只在群聊中处理
            if (!session.guildId) return;
            
            const { userId, channelId, content } = session;
            // 提取纯文本内容（去掉可能的at和特殊符号）
            const cleanContent = content.replace(/@\S+/g, '').trim().toUpperCase();
            
            // 检查是否是A/B/C/D回答
            if (!['A', 'B', 'C', 'D'].includes(cleanContent)) return;
            
            // 检查是否有活跃的问答
            const quizState = await this.getQuizState(channelId);
            if (!quizState) return;
            
            // 检查是否是开启问答的用户在回答
            if (userId !== quizState.questionerId) {
                console.log(`用户${userId}尝试回答用户${quizState.questionerId}开启的问题，已拒绝`);
                return;
            }
            
            // 处理回答
            try {
                const result = await this.handleAnswer(channelId, userId, session.username, cleanContent);
                if (result) {
                    await session.send(result);
                }
            } catch (error) {
                console.error('处理回答失败:', error);
            }
        });
    }

    /**
     * 获取用户问答记录
     */
    private async getUserRecord(userId: string, channelId: string): Promise<BaikeQuizRecord | null> {
        const records = await this.ctx.database
            .select('baike_quiz_record')
            .where({ userId, channelId })
            .execute();
        return records.length > 0 ? records[0] : null;
    }

    /**
     * 获取当前群的问答状态
     */
    private async getQuizState(channelId: string): Promise<BaikeQuizState | null> {
        const states = await this.ctx.database
            .select('baike_quiz_state')
            .where({ channelId })
            .execute();
        return states.length > 0 ? states[0] : null;
    }

    /**
     * 更新或创建用户问答记录
     */
    private async updateUserRecord(userId: string, channelId: string, attemptResult: 'correct' | 'wrong'): Promise<void> {
        const today = formatDate(new Date());
        const userRecord = await this.getUserRecord(userId, channelId);

        if (userRecord) {
            // 检查是否跨天，跨天则重置每日答题次数
            if (userRecord.lastAttemptDate !== today) {
                await this.ctx.database.set('baike_quiz_record', 
                    { userId, channelId }, 
                    {
                        dailyAttempts: 1,
                        lastAttemptDate: today,
                        correctAnswers: attemptResult === 'correct' ? userRecord.correctAnswers + 1 : userRecord.correctAnswers,
                        wrongAnswers: attemptResult === 'wrong' ? userRecord.wrongAnswers + 1 : userRecord.wrongAnswers
                    }
                );
            } else {
                await this.ctx.database.set('baike_quiz_record', 
                    { userId, channelId }, 
                    {
                        dailyAttempts: userRecord.dailyAttempts + 1,
                        correctAnswers: attemptResult === 'correct' ? userRecord.correctAnswers + 1 : userRecord.correctAnswers,
                        wrongAnswers: attemptResult === 'wrong' ? userRecord.wrongAnswers + 1 : userRecord.wrongAnswers
                    }
                );
            }
        } else {
            // 创建新记录
            await this.ctx.database.upsert('baike_quiz_record', [{
                userId,
                channelId,
                dailyAttempts: 1,
                lastAttemptDate: today,
                correctAnswers: attemptResult === 'correct' ? 1 : 0,
                wrongAnswers: attemptResult === 'wrong' ? 1 : 0,
            }], ['userId', 'channelId']);
        }
    }

    /**
     * 检查用户当日答题次数是否已达上限
     */
    private async checkDailyLimit(userId: string, channelId: string): Promise<boolean> {
        const today = formatDate(new Date());
        const userRecord = await this.getUserRecord(userId, channelId);

        if (!userRecord || userRecord.lastAttemptDate !== today) {
            return false; // 未达到上限
        }

        return userRecord.dailyAttempts >= this.MAX_DAILY_ATTEMPTS;
    }

    /**
     * 从API获取百科问答题目
     */
    private async fetchQuizQuestion(): Promise<QuizResult | null> {
        if (!this.apiKey) {
            console.error('百科题库API密钥未配置，请在配置文件中设置baike_quiz.apiKey');
            return null;
        }

        try {
            const response = await axios.get<QuizResult>(this.API_URL, {
                params: {
                    key: this.apiKey
                }
            });
            return response.data;
        } catch (error) {
            console.error('Error fetching quiz question:', error);
            return null;
        }
    }

    /**
     * 更新星币数量
     */
    private async updateStarCoin(userId: string, channelId: string, amount: number): Promise<void> {
        try {
            if (amount > 0) {
                await StarCoinHelper.addUserStarCoin(this.ctx, userId, channelId, amount);
            } else if (amount < 0) {
                await StarCoinHelper.removeUserStarCoin(this.ctx, userId, channelId, Math.abs(amount));
            }
        } catch (error) {
            console.error('更新星币失败:', error);
        }
    }

    /**
     * 设置问题超时处理
     */
    private setupQuestionTimeout(channelId: string): void {
        // 清除之前的超时计时器
        if (this.activeTimeouts.has(channelId)) {
            clearTimeout(this.activeTimeouts.get(channelId)!);
        }

        // 设置新的计时器
        const timeout = setTimeout(async () => {
            try {
                const quizState = await this.getQuizState(channelId);
                if (quizState) {
                    // 通知用户问题已超时
                    await this.ctx.broadcast([channelId],
                        `⏰ 百科问答题目已超时！正确答案是：${quizState.correctAnswer}`
                    );
                    
                    // 删除当前问答状态
                    await this.ctx.database.remove('baike_quiz_state', { channelId });
                }
                
                // 移除超时计时器
                this.activeTimeouts.delete(channelId);
            } catch (error) {
                console.error('处理问题超时失败:', error);
            }
        }, this.questionTimeout * 1000);

        this.activeTimeouts.set(channelId, timeout);
    }

    /**
     * 处理回答逻辑
     */
    private async handleAnswer(channelId: string, userId: string, username: string, userAnswer: string): Promise<string | null> {
        // 检查当日答题次数是否已达上限
        const reachedLimit = await this.checkDailyLimit(userId, channelId);
        if (reachedLimit) {
            return `你今日已用完${this.MAX_DAILY_ATTEMPTS}次答题机会，请明天再来吧！`;
        }

        // 获取当前问答状态
        const quizState = await this.getQuizState(channelId);
        if (!quizState) {
            return null;
        }

        // 再次确认回答者是开启问答的用户
        if (userId !== quizState.questionerId) {
            return '只有开启问答的用户才能回答哦！';
        }

        const { correctAnswer, analytic } = quizState;
        const isCorrect = userAnswer === correctAnswer;

        // 更新用户答题记录
        await this.updateUserRecord(userId, channelId, isCorrect ? 'correct' : 'wrong');

        // 更新星币
        const starCoinAmount = isCorrect ? this.REWARD_STAR_COIN : -this.PENALTY_STAR_COIN;
        await this.updateStarCoin(userId, channelId, starCoinAmount);

        // 删除当前问答状态
        await this.ctx.database.remove('baike_quiz_state', { channelId });
        
        // 清除超时计时器
        if (this.activeTimeouts.has(channelId)) {
            clearTimeout(this.activeTimeouts.get(channelId)!);
            this.activeTimeouts.delete(channelId);
        }

        // 获取用户当日剩余答题次数
        const userRecord = await this.getUserRecord(userId, channelId);
        const remainingAttempts = userRecord ? this.MAX_DAILY_ATTEMPTS - userRecord.dailyAttempts : this.MAX_DAILY_ATTEMPTS - 1;

        // 生成回答结果
        if (isCorrect) {
            return [
                `🎉 恭喜 @${username} 回答正确！`,
                `获得 ${this.REWARD_STAR_COIN} 星币奖励！`,
                `📝 解析：${analytic}`,
                `你今日还剩 ${remainingAttempts} 次答题机会。`
            ].join('\n');
        } else {
            return [
                `😔 很遗憾 @${username} 回答错误！`,
                `扣除 ${this.PENALTY_STAR_COIN} 星币...`,
                `正确答案是：${correctAnswer}`,
                `📝 解析：${analytic}`,
                `你今日还剩 ${remainingAttempts} 次答题机会。`
            ].join('\n');
        }
    }

    /**
     * 开始百科问答命令处理
     */
    private async handleStartQuiz({ session }: { session: any }): Promise<string> {
        if (!session.guildId) {
            return '请在群聊中使用此命令哦！';
        }

        const { userId, channelId } = session;

        // 检查当日答题次数是否已达上限
        const reachedLimit = await this.checkDailyLimit(userId, channelId);
        if (reachedLimit) {
            return `你今日已用完${this.MAX_DAILY_ATTEMPTS}次答题机会，请明天再来吧！`;
        }

        // 检查是否已有活跃的问答
        const currentState = await this.getQuizState(channelId);
        if (currentState) {
            // 检查问答是否已过期（10分钟）
            const tenMinutesAgo = Date.now() - 10 * 60 * 1000;
            if (currentState.createTime > tenMinutesAgo) {
                // 检查是否是自己开启的问答
                if (currentState.questionerId === userId) {
                    return `你当前已有活跃的问答题目，请先回答完再继续！\n问题：${currentState.currentQuestion}`;
                } else {
                    return `当前已有其他用户开启的活跃问答题目，请等待其完成或超时后再继续！`;
                }
            } else {
                // 清理过期的问答状态
                await this.ctx.database.remove('baike_quiz_state', { channelId });
                if (this.activeTimeouts.has(channelId)) {
                    clearTimeout(this.activeTimeouts.get(channelId)!);
                    this.activeTimeouts.delete(channelId);
                }
            }
        }

        // 获取新的问答题目
        const quizResult = await this.fetchQuizQuestion();
        if (!quizResult || quizResult.code !== 200 || !quizResult.result) {
            const errorMsg = quizResult?.msg || '获取题目失败';
            return `❌ 获取百科题目失败：${errorMsg}`;
        }

        const { title, answerA, answerB, answerC, answerD, answer, analytic } = quizResult.result;

        // 保存问答状态
        await this.ctx.database.upsert('baike_quiz_state', [{
            channelId,
            currentQuestion: title,
            answerA,
            answerB,
            answerC,
            answerD,
            correctAnswer: answer,
            analytic,
            questionerId: userId,
            createTime: Date.now()
        }], ['channelId']);

        // 设置问题超时处理
        this.setupQuestionTimeout(channelId);

        // 格式化问题和选项
        return [
            `📚 百科知识问答 - 问题来了！`,
            `❓ ${title}`,
            `A. ${answerA}`,
            `B. ${answerB}`,
            `C. ${answerC}`,
            `D. ${answerD}`,
            `请直接输入 A/B/C/D 来回答问题！（只有你能回答哦）`
        ].join('\n');
    }

    /**
     * 查看百科问答统计命令处理
     */
    private async handleQuizStats({ session }: { session: any }): Promise<string> {
        if (!session.guildId) {
            return '请在群聊中使用此命令哦！';
        }

        const { userId, channelId, username } = session;
        const userRecord = await this.getUserRecord(userId, channelId);
        const today = formatDate(new Date());

        if (!userRecord) {
            return `@${username} 还没有参加过百科问答，快来试试吧！`;
        }

        // 计算今日剩余答题次数
        const todayAttempts = userRecord.lastAttemptDate === today ? userRecord.dailyAttempts : 0;
        const remainingAttempts = this.MAX_DAILY_ATTEMPTS - todayAttempts;

        // 计算总答题数和正确率
        const totalAttempts = userRecord.correctAnswers + userRecord.wrongAnswers;
        const accuracyRate = totalAttempts > 0 ? Math.round((userRecord.correctAnswers / totalAttempts) * 100) : 0;

        return [
            `📊 @${username} 的百科问答统计`,
            `✅ 正确答案：${userRecord.correctAnswers} 题`,
            `❌ 错误答案：${userRecord.wrongAnswers} 题`,
            `🎯 正确率：${accuracyRate}%`,
            `📅 今日已答：${todayAttempts}/${this.MAX_DAILY_ATTEMPTS} 题`,
            `⏳ 今日剩余：${remainingAttempts} 次答题机会`
        ].join('\n');
    }
}

export default BaikeQuizPlugin;