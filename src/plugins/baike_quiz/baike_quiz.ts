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

// 申诉记录接口
export interface BaikeQuizAppeal {
    id: number; // 自增主键
    userId: string; // 用户QQ号
    channelId: string; // 频道ID（群号）
    question: string; // 问题内容
    userAnswer: string; // 用户答案
    correctAnswer: string; // 系统正确答案
    reason: string; // 申诉理由
    createTime: string; // 申诉时间
    status: 'pending' | 'approved' | 'rejected'; // 申诉状态
}

// 历史问答记录接口
export interface BaikeQuizHistory {
    id: number; // 自增主键
    channelId: string; // 频道ID
    userId: string; // 用户ID
    question: string; // 问题内容
    answerA: string; // 答案A
    answerB: string; // 答案B
    answerC: string; // 答案C
    answerD: string; // 答案D
    correctAnswer: string; // 正确答案
    analytic: string; // 答案解析
    createTime: number; // 创建时间戳
    completionTime: number; // 完成时间戳
    userAnswer: string; // 用户答案
    isCorrect: boolean; // 是否正确
}

export interface BaikeQuizState {
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
    // 存储用户答题信息，用于申诉功能
    userAnswers: Map<string, string>; // userId -> answer
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
        baike_quiz_appeal: BaikeQuizAppeal;
        baike_quiz_history: BaikeQuizHistory;
    }
}

class BaikeQuizPlugin {
    private readonly API_URL = 'https://apis.tianapi.com/baiketiku/index';
    private readonly activeTimeouts = new Map<string, NodeJS.Timeout>();

    constructor(private ctx: Context, private config: any) {
        // 扩展数据库，创建baike_quiz_record表
        ctx.model.extend('baike_quiz_record', {
            id: 'unsigned',
            userId: 'string',
            channelId: 'string',
            dailyAttempts: 'unsigned',
            lastAttemptDate: 'string',
            correctAnswers: 'unsigned',
            wrongAnswers: 'unsigned',
        }, {
            primary: 'id',
            autoInc: true,
            unique: [['userId', 'channelId']]
        });

        // 扩展数据库，创建baike_quiz_history表，用于存储历史问答状态
        ctx.model.extend('baike_quiz_history', {
            id: 'unsigned',
            channelId: 'string',
            userId: 'string',
            question: 'text',
            answerA: 'text',
            answerB: 'text',
            answerC: 'text',
            answerD: 'text',
            correctAnswer: 'string',
            analytic: 'text',
            createTime: 'unsigned',
            completionTime: 'unsigned',
            userAnswer: 'string',
            isCorrect: 'boolean',
        }, {
            primary: 'id',
            autoInc: true
        });

        // 扩展数据库，创建baike_quiz_appeal表
        ctx.model.extend('baike_quiz_appeal', {
            id: 'unsigned',
            userId: 'string',
            channelId: 'string',
            question: 'string',
            userAnswer: 'string',
            correctAnswer: 'string',
            reason: 'string',
            createTime: 'string',
            status: 'string'
        }, {
            primary: 'id',
            autoInc: true
        });

        this.registerCommands();
        this.registerMessageListener();

        // 设置每7天定时清理30天以前的历史记录
        this.setupCleanupTask();
    }

    private registerCommands(): void {
        // 开始百科问答
        this.ctx.command('quiz', '开始一次百科知识问答')
            .action(this.handleStartQuiz.bind(this));

        // 查看百科问答统计
        this.ctx.command('quiz.stats', '查看个人百科问答统计信息')
            .action(this.handleQuizStats.bind(this));
            
        // 申诉功能
        this.ctx.command('quiz.appeal <reason:text>', '当你认为题目答案不正确时可以申诉')
            .action(this.handleAppeal.bind(this));
        
        // 管理员审核申诉命令
        this.ctx.command('quiz.admin.appeal <action:string> [id:number]', '管理员审核用户申诉 (action: list/approve/reject)')
            .action(this.handleAdminAppeal.bind(this));
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
            const quizState = this.getQuizState(channelId);
            if (!quizState) return;
            
            // 检查是否是开启问答的用户在回答
            if (userId !== quizState.questionerId) {
                return;
            }
            
            // 保存用户答案，用于可能的申诉
            if (!quizState.userAnswers) {
                quizState.userAnswers = new Map();
            }
            quizState.userAnswers.set(userId, cleanContent);
            
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

    // 内存存储当前活跃的问答状态
    private activeQuizStates: Map<string, BaikeQuizState> = new Map();

    /**
     * 获取当前群的问答状态
     */
    private getQuizState(channelId: string): BaikeQuizState | null {
        const state = this.activeQuizStates.get(channelId);
        // 检查是否已过期（10分钟）
        if (state && state.createTime < Date.now() - 10 * 60 * 1000) {
            this.activeQuizStates.delete(channelId);
            return null;
        }
        return state || null;
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

        return userRecord.dailyAttempts >= this.config.baike_quiz.maxDailyAttempts;
    }

    /**
     * 从API获取百科问答题目
     */
    private async fetchQuizQuestion(): Promise<QuizResult | null> {
        if (!this.config.baike_quiz.apiKey) {
            console.error('百科题库 API 密钥未配置，请在配置文件中设置 baike_quiz.apiKey');
            return null;
        }

        try {
            // 最多尝试获取题目5次
            const maxRetries = 5;
            for (let i = 0; i < maxRetries; i++) {
                const response = await axios.get<QuizResult>(this.API_URL, {
                    params: {
                        key: this.config.baike_quiz.apiKey
                    }
                });

                // 检查是否获取到有效数据
                if (!response.data || !response.data.result) {
                    console.error('获取题库信息失败，返回数据不完整');
                    continue;
                }

                const quizResult = response.data;
                const question = quizResult.result.title;

                // 检查题目是否在已批准的申诉列表中
                const isQuestionInApprovedAppeals = await this.checkIfQuestionInApprovedAppeals(question);
                
                // 如果题目不在已批准的申诉列表中，则返回该题目
                if (!isQuestionInApprovedAppeals) {
                    return quizResult;
                }
                
                console.log(`获取到已批准申诉的题目，正在重新请求新题目...`);
            }
            
            // 超过最大重试次数仍未获取到合适题目
            console.error(`已尝试${maxRetries}次获取题库信息，仍未获取到不在申诉成功列表中的题目`);
            return null;
        } catch (error) {
            console.error('获取题库信息失败', error);
            return null;
        }
    }

    /**
     * 检查题目是否在已批准的申诉列表中
     */
    private async checkIfQuestionInApprovedAppeals(question: string): Promise<boolean> {
        try {
            const appeals = await this.ctx.database
                .select('baike_quiz_appeal')
                .where({
                    question: question,
                    status: 'approved'
                })
                .execute();
            
            return appeals.length > 0;
        } catch (error) {
            console.error('检查题目是否在已批准申诉列表中失败:', error);
            return false; // 出错时默认返回false，避免影响正常使用
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
    private setupQuestionTimeout(platform: string, channelId: string): void {
        // 清除之前的超时计时器
        if (this.activeTimeouts.has(channelId)) {
            clearTimeout(this.activeTimeouts.get(channelId)!);
        }

        // 设置新的计时器
        const timeout = setTimeout(async () => {
            try {
                const quizState = this.getQuizState(channelId);
                if (quizState) {
                    // 通知用户问题已超时
                    await this.ctx.broadcast([`${platform}:${channelId}`],
                        `⏰ 百科问答题目已超时！正确答案是：${quizState.correctAnswer}`
                    );
                    
                    // 删除当前问答状态
                    this.activeQuizStates.delete(channelId);
                }
                
                // 移除超时计时器
                this.activeTimeouts.delete(channelId);
            } catch (error) {
                console.error('处理问题超时失败:', error);
            }
        }, this.config.baike_quiz.questionTimeout * 1000);

        this.activeTimeouts.set(channelId, timeout);
    }

    /**
     * 处理回答逻辑
     */
    private async handleAnswer(channelId: string, userId: string, username: string, userAnswer: string): Promise<string | null> {
        // 检查当日答题次数是否已达上限
        const reachedLimit = await this.checkDailyLimit(userId, channelId);
        if (reachedLimit) {
            return `你今日已用完${this.config.baike_quiz.maxDailyAttempts}次答题机会，请明天再来吧！`;
        }

        // 获取当前问答状态
        const quizState = this.getQuizState(channelId);
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
        const starCoinAmount = isCorrect ? this.config.baike_quiz.rewardStarCoin : -this.config.baike_quiz.penaltyStarCoin;
        await this.updateStarCoin(userId, channelId, starCoinAmount);
        
        // 保存问答状态到历史记录
        await this.saveQuizStateToHistory(quizState, userAnswer, isCorrect);

        // 删除当前问答状态
        this.activeQuizStates.delete(channelId);
        
        // 清除超时计时器
        if (this.activeTimeouts.has(channelId)) {
            clearTimeout(this.activeTimeouts.get(channelId)!);
            this.activeTimeouts.delete(channelId);
        }

        // 获取用户当日剩余答题次数
        const userRecord = await this.getUserRecord(userId, channelId);
        const remainingAttempts = userRecord ? this.config.baike_quiz.maxDailyAttempts - userRecord.dailyAttempts : this.config.baike_quiz.maxDailyAttempts - 1;

        // 生成回答结果
        if (isCorrect) {
            return [
                `🎉 恭喜 @${username} 回答正确！`,
                `获得 ${this.config.baike_quiz.rewardStarCoin} 星币奖励！`,
                `📝 解析：${analytic || '暂无解析信息'}`,
                `你今日还剩 ${remainingAttempts} 次答题机会。`
            ].join('\n');
        } else {
            return [
                `😔 很遗憾 @${username} 回答错误！`,
                `扣除 ${this.config.baike_quiz.penaltyStarCoin} 星币...`,
                `正确答案是：${correctAnswer}`,
                `📝 解析：${analytic || '暂无解析信息'}`,
                `你今日还剩 ${remainingAttempts} 次答题机会。`,
                `如果你认为答案不正确，可以使用\`quiz.appeal 理由\`命令进行申诉。`
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
            return `你今日已用完${this.config.baike_quiz.maxDailyAttempts}次答题机会，请明天再来吧！`;
        }

        // 检查是否已有活跃的问答
        const currentState = this.getQuizState(channelId);
        if (currentState) {
            // 检查是否是自己开启的问答
            if (currentState.questionerId === userId) {
                return `你当前已有活跃的问答题目，请先回答完再继续！\n问题：${currentState.currentQuestion}`;
            } else {
                return `当前已有其他用户开启的活跃问答题目，请等待其完成或超时后再继续！`;
            }
        }

        // 获取新的问答题目
        const quizResult = await this.fetchQuizQuestion();
        if (!quizResult || quizResult.code !== 200 || !quizResult.result) {
            const errorMsg = quizResult?.msg || '获取题目失败';
            return `❌ 获取百科题目失败：${errorMsg}`;
        }

        const { title, answerA, answerB, answerC, answerD, answer: correctAnswer, analytic } = quizResult.result;

        // 保存问答状态到内存
        this.activeQuizStates.set(channelId, {
            channelId,
            currentQuestion: title,
            answerA,
            answerB,
            answerC,
            answerD,
            correctAnswer,
            analytic,
            questionerId: userId,
            createTime: Date.now(),
            userAnswers: new Map()
        });

        // 设置问题超时处理
        this.setupQuestionTimeout(session.platform, channelId);

        // 格式化问题和选项
        return [
            `📚 百科知识问答 - 问题来了！`,
            `❓ ${title}`,
            `A. ${answerA}`,
            `B. ${answerB}`,
            `C. ${answerC}`,
            `D. ${answerD}`,
            `⏰ 答题时间：${this.config.baike_quiz.questionTimeout} 秒`,
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
        const remainingAttempts = this.config.baike_quiz.maxDailyAttempts - todayAttempts;

        // 计算总答题数和正确率
        const totalAttempts = userRecord.correctAnswers + userRecord.wrongAnswers;
        const accuracyRate = totalAttempts > 0 ? Math.round((userRecord.correctAnswers / totalAttempts) * 100) : 0;

        return [
            `📊 @${username} 的百科问答统计`,
            `✅ 正确答案：${userRecord.correctAnswers} 题`,
            `❌ 错误答案：${userRecord.wrongAnswers} 题`,
            `🎯 正确率：${accuracyRate}%`,
            `📅 今日已答：${todayAttempts}/${this.config.baike_quiz.maxDailyAttempts} 题`,
            `⏳ 今日剩余：${remainingAttempts} 次答题机会`
        ].join('\n');
    }
    
    /**
     * 处理申诉功能
     */
    private async handleAppeal({ session }: { session: any }, reason: string): Promise<string> {
        if (!session.guildId) {
            return '请在群聊中使用此命令哦！';
        }
        
        const { userId, channelId, username } = session;
        
        // 验证申诉理由是否为空
        if (!reason || reason.trim().length === 0) {
            return '请提供申诉理由！格式：\`quiz.appeal 你的理由\`';
        }
        
        // 获取最近一次的问答记录
        const recentQuizState = await this.getRecentQuizStateForUser(channelId, userId);
        
        if (!recentQuizState) {
            return '未找到你最近的答题记录，无法申诉！';
        }
        
        // 获取用户在该题目上的答案
        const userAnswer = recentQuizState.userAnswers?.get(userId);
        
        if (!userAnswer) {
            return '未找到你在该题的答案记录，无法申诉！';
        }
        
        // 保存申诉记录到数据库
        await this.ctx.database.create('baike_quiz_appeal', {
            userId,
            channelId,
            question: recentQuizState.currentQuestion,
            userAnswer,
            correctAnswer: recentQuizState.correctAnswer,
            reason: reason.trim(),
            createTime: formatDate(new Date()),
            status: 'pending'
        });
        
        // 向管理员发送通知
        await this.notifyAdminsAboutAppeal(session.platform, userId, username, channelId,
            recentQuizState.currentQuestion, userAnswer, recentQuizState.correctAnswer, reason.trim());
        
        return '✅ 申诉已提交！管理员将尽快处理你的申诉，请耐心等待。';
    }
    
    /**
     * 获取用户最近一次的问答状态
     */
    private async getRecentQuizStateForUser(channelId: string, userId: string): Promise<BaikeQuizState | null> {
        // 首先检查当前活跃的问答状态
        const quizState = this.getQuizState(channelId);
        if (quizState && quizState.questionerId === userId) {
            return quizState;
        }
        
        // 从历史记录中查找用户最近的答题记录
        try {
            const recentHistory = await this.ctx.database.select('baike_quiz_history')
                .where({ channelId, userId })
                .orderBy('completionTime', 'desc')
                .limit(1)
                .execute();
            
            if (recentHistory && recentHistory.length > 0) {
                const history = recentHistory[0];
                return {
                    channelId: history.channelId,
                    currentQuestion: history.question,
                    answerA: history.answerA,
                    answerB: history.answerB,
                    answerC: history.answerC,
                    answerD: history.answerD,
                    correctAnswer: history.correctAnswer,
                    analytic: history.analytic,
                    questionerId: history.userId,
                    createTime: history.createTime,
                    userAnswers: new Map<string, string>([[history.userId, history.userAnswer]])
                };
            }
        } catch (error) {
            console.error('获取历史问答记录失败:', error);
        }
        
        return null;
    }
    
    /**
     * 向管理员发送申诉通知
     */
    private async notifyAdminsAboutAppeal(platform: string, userId: string, username: string, 
                                       channelId: string, question: string, userAnswer: string, 
                                       correctAnswer: string, reason: string): Promise<void> {
        if (this.config.baike_quiz.adminQQs.length === 0) {
            console.warn('没有配置管理员QQ，无法发送申诉通知');
            return;
        }
        
        const notification = [
            '🚨 百科问答申诉通知',
            `用户：@${username} (${userId})`,
            `频道：${channelId}`,
            `问题：${question}`,
            `用户答案：${userAnswer}`,
            `系统答案：${correctAnswer}`,
            `申诉理由：${reason}`,
            `时间：${formatDate(new Date())}`,
            '请及时处理该申诉！'
        ].join('\n');
        
        try {
            // 向每个管理员发送私信
            for (const adminQQ of this.config.baike_quiz.adminQQs) {
                await this.ctx.broadcast([`${platform}:${adminQQ}`], notification);
            }
        } catch (error) {
            console.error('发送申诉通知失败:', error);
        }
    }
    
    /**
     * 管理员审核申诉
     */
    private async handleAdminAppeal({ session }: { session: any }, action: string, id?: number): Promise<string> {
        const { userId} = session;
        
        // 检查是否是管理员
        if (!this.isAdmin(userId)) {
            return '❌ 你没有权限执行此操作！';
        }
        
        // 标准化操作指令
        action = action.toLowerCase();
        
        switch (action) {
            case 'list':
                return await this.listAppeals();
            case 'approve':
                if (!id) {
                    return '❌ 请指定要批准的申诉ID！\n使用方法：\`quiz.admin.appeal approve <申诉ID>\`';
                }
                return await this.approveAppeal(session, id);
            case 'reject':
                if (!id) {
                    return '❌ 请指定要拒绝的申诉ID！\n使用方法：\`quiz.admin.appeal reject <申诉ID>\`';
                }
                return await this.rejectAppeal(id);
            default:
                return '❌ 无效的操作！\n可用操作：list, approve, reject';
        }
    }
    
    /**
     * 检查用户是否是管理员
     */
    private isAdmin(userId: string): boolean {
        return this.config.baike_quiz.adminQQs.includes(userId);
    }
    
    /**
      * 列出所有待处理的申诉
      */
     private async listAppeals(): Promise<string> {
         try {
             const appeals = await this.ctx.database
                 .select('baike_quiz_appeal')
                 .where({ status: 'pending' })
                 .orderBy('createTime', 'desc')
                 .execute();
              
             if (appeals.length === 0) {
                 return '✅ 当前没有待处理的申诉！';
             }
              
             const messages = ['📋 待处理的申诉列表：'];
              
             for (const appeal of appeals) {
                 messages.push(`\n${appeal.id}. 用户：${appeal.userId}`);
                 messages.push(`   问题：${this.truncateText(appeal.question, 20)}`);
                 
                 // 尝试从历史记录中获取完整的题目信息（包括四个选项）
                 try {
                     const history = await this.ctx.database.select('baike_quiz_history')
                         .where({ channelId: appeal.channelId, userId: appeal.userId, question: appeal.question })
                         .orderBy('completionTime', 'desc')
                         .limit(1)
                         .execute();
                       
                     if (history && history.length > 0) {
                         const quiz = history[0];
                         messages.push(`   选项A：${this.truncateText(quiz.answerA, 15)}`);
                         messages.push(`   选项B：${this.truncateText(quiz.answerB, 15)}`);
                         messages.push(`   选项C：${this.truncateText(quiz.answerC, 15)}`);
                         messages.push(`   选项D：${this.truncateText(quiz.answerD, 15)}`);
                     }
                 } catch (error) {
                     console.error('获取题目详情失败:', error);
                 }
                 
                 messages.push(`   用户答案：${appeal.userAnswer}`);
                 messages.push(`   正确答案：${appeal.correctAnswer}`);
                 messages.push(`   时间：${appeal.createTime}`);
                 messages.push(`   状态：${this.getStatusText(appeal.status)}`);
             }
              
             messages.push('\n使用 \`quiz.admin.appeal approve/reject <申诉ID>\` 来处理申诉。');
             return messages.join('\n');
         } catch (error) {
             console.error('获取申诉列表失败:', error);
             return '❌ 获取申诉列表失败，请稍后重试！';
         }
     }
    
    /**
      * 批准申诉并退还星币
      */
     private async approveAppeal(session: any, appealId: number): Promise<string> {
         try {
             // 查找申诉记录
             const appeals = await this.ctx.database
                 .select('baike_quiz_appeal')
                 .where({ id: appealId, status: 'pending' })
                 .execute();
              
             if (appeals.length === 0) {
                 return `❌ 未找到ID为 ${appealId} 的待处理申诉！`;
             }
              
             const appeal = appeals[0];
              
             // 更新申诉状态为已批准
             await this.ctx.database.set('baike_quiz_appeal', 
                 { id: appealId }, 
                 { status: 'approved' }
             );
              
             // 退还用户扣除的星币加上赢得的星币（默认5+10）
             const refundAmount = this.config.baike_quiz.penaltyStarCoin + this.config.baike_quiz.rewardStarCoin;
             await this.updateStarCoin(appeal.userId, appeal.channelId, refundAmount);
              
             // 通知用户申诉已通过
             await this.ctx.broadcast([`${session.platform}:${appeal.channelId}`],
                 `🎉 @${await this.getUserName(appeal.userId)}，你的申诉已通过！\n已退还你 ${refundAmount} 星币！`
             );
              
             return `✅ 已批准ID为 ${appealId} 的申诉，并退还用户 ${refundAmount} 星币！`;
         } catch (error) {
             console.error('批准申诉失败:', error);
             return `❌ 处理申诉失败，请稍后重试！`;
         }
     }
    
    /**
     * 拒绝申诉
     */
    private async rejectAppeal(appealId: number): Promise<string> {
        try {
            // 查找申诉记录
            const appeals = await this.ctx.database
                .select('baike_quiz_appeal')
                .where({ id: appealId, status: 'pending' })
                .execute();
            
            if (appeals.length === 0) {
                return `❌ 未找到ID为 ${appealId} 的待处理申诉！`;
            }
            
            // 更新申诉状态为已拒绝
            await this.ctx.database.set('baike_quiz_appeal', 
                { id: appealId }, 
                { status: 'rejected' }
            );
            
            return `✅ 已拒绝ID为 ${appealId} 的申诉！`;
        } catch (error) {
            console.error('拒绝申诉失败:', error);
            return `❌ 处理申诉失败，请稍后重试！`;
        }
    }
    
    /**
     * 获取状态的文本表示
     */
    private getStatusText(status: string): string {
        const statusMap: Record<string, string> = {
            'pending': '⏳ 待处理',
            'approved': '✅ 已批准',
            'rejected': '❌ 已拒绝'
        };
        return statusMap[status] || status;
    }
    
    /**
     * 截断文本
     */
    private truncateText(text: string, maxLength: number): string {
        if (text.length <= maxLength) {
            return text;
        }
        return text.substring(0, maxLength) + '...';
    }
    
    /**
     * 获取用户名称（简化版，实际可能需要根据平台API获取）
     */
    private async getUserName(userId: string): Promise<string> {
        // 这里简化处理，实际可能需要调用平台API获取用户名称
        return userId;
    }
    
    /**
     * 保存问答状态到历史记录
     */
    private async saveQuizStateToHistory(quizState: BaikeQuizState, userAnswer: string, isCorrect: boolean): Promise<void> {
        try {
            await this.ctx.database.create('baike_quiz_history', {
                channelId: quizState.channelId,
                userId: quizState.questionerId,
                question: quizState.currentQuestion,
                answerA: quizState.answerA,
                answerB: quizState.answerB,
                answerC: quizState.answerC,
                answerD: quizState.answerD,
                correctAnswer: quizState.correctAnswer,
                analytic: quizState.analytic,
                createTime: quizState.createTime,
                completionTime: Date.now(),
                userAnswer: userAnswer,
                isCorrect: isCorrect
            });
        } catch (error) {
            console.error('保存问答历史记录失败:', error);
        }
    }

    /**
     * 设置定时清理任务，每7天清理30天以前的历史记录
     */
    private setupCleanupTask(): void {
        // 每7天执行一次清理任务
        const sevenDaysInMs = 7 * 24 * 60 * 60 * 1000;
        
        // 设置定时任务
        setInterval(() => {
            this.cleanupOldHistoryRecords().catch(error => {
                console.error('清理历史记录任务失败:', error);
            });
        }, sevenDaysInMs);
    }

    /**
     * 清理30天以前的历史记录
     */
    private async cleanupOldHistoryRecords(): Promise<void> {
        try {
            const thirtyDaysAgo = Date.now() - 30 * 24 * 60 * 60 * 1000;
            
            await this.ctx.database.remove('baike_quiz_history', {
                completionTime: {
                    $lt: thirtyDaysAgo
                }
            });
            
            console.log(`成功清理30天以前的历史问答记录`);
        } catch (error) {
            console.error('清理历史记录失败:', error);
        }
    }
}

export default BaikeQuizPlugin;