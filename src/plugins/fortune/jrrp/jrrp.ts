import { Context, h, Session } from 'koishi';
import {} from '@koishijs/plugin-adapter-onebot'
import { Config } from "../../../index";
import { createTextMsgNode, getUserName } from "../../../utils/onebot_helper";
import {formatDate, getTodayString} from "../../../utils/time_helper";
import { calculateAndStoreLuck, formatTodayLuckMessage } from '../../../utils/plugins/jrrp/random_luck_helper';

export interface Jrrp {
    id: number; // 自增主键
    userId: string;
    date: string;
    luck: number;
}

declare module 'koishi' {
    interface Tables {
        jrrp: Jrrp;
    }
}

// 运势等级配置
class JrrpPlugin {
    constructor(private ctx: Context, private config: Config) {
        this.setupDatabase();
        this.setupCleanupTask();
        this.registerCommands();
    }

    /**
     * 获取用户的人品记录
     */
    private async getUserLuckRecord(userId: string, date: string): Promise<Jrrp | null> {
        const records = await this.ctx.database
            .select('jrrp')
            .where({ userId, date })
            .execute();
        return records.length > 0 ? records[0] : null;
    }

    private setupDatabase(): void {
        this.ctx.model.extend('jrrp', {
            id: 'unsigned',
            userId: 'string',
            date: 'string',
            luck: 'integer',
        }, {
            primary: 'id',
            autoInc: true,
            // 添加唯一约束以防止重复记录
            unique: [['userId', 'date']]
        });
    }

    private setupCleanupTask(): void {
        this.ctx.setInterval(async () => {
            const thresholdDate = new Date();
            thresholdDate.setDate(thresholdDate.getDate() - this.config.jrrp.cleanupDays);
            const thresholdDateStr = formatDate(thresholdDate);

            // 删除过期记录
            await this.ctx.database.remove('jrrp', { date: { $lt: thresholdDateStr } });
        }, 7 * 24 * 60 * 60 * 1000);
    }

    private registerCommands(): void {
        this.ctx.command('jrrp', '查看今日人品')
            .action(async ({ session }) => this.handleJrrpCommand(session));

        this.ctx.command('jrrp.rank', '查看群内今日人品排行榜')
            .action(async ({ session }) => this.handleRankCommand(session));

        this.ctx.command('jrrp.history', '查看最近7天的人品记录')
            .action(async ({ session }) => this.handleHistoryCommand(session));
    }

    private async handleJrrpCommand(session: Session): Promise<string> {
        const today = getTodayString();
        const { userId } = session;

        // 检查今日是否已经查询过
        const existingRecord = await this.getUserLuckRecord(userId, today);
        if (existingRecord) {
            return formatTodayLuckMessage(userId, today, existingRecord.luck);
        }

        // 计算并存储新的人品值
        const luck = await calculateAndStoreLuck(this.ctx, session, today);
        return formatTodayLuckMessage(userId, today, luck);
    }

    private async handleRankCommand(session: Session): Promise<string | void> {
        if (!session.guildId) {
            return '请在群聊中使用排行榜命令哦！';
        }

        const today = getTodayString();
        const rankings = await this.getRankings(session, today);

        if (!rankings.length) {
            return '今日群内暂无人品数据。';
        }

        try {
            if (session.onebot && this.config.jrrp.rankUseForwardMsg) {
                await this.sendForwardMessage(session, rankings);
            } else {
                return await this.formatRankingMessage(session, rankings);
            }
        } catch (error) {
            return '获取排行榜失败，请稍后重试！';
        }
    }

    private async getRankings(session: Session, date: string): Promise<Jrrp[]> {
        // 获取当前群内所有用户
        let groupMembers = [];
        if (session.onebot && session.guildId) {
            try {
                // 获取群成员列表
                const members = await session.onebot.getGroupMemberList(session.onebot.group_id);
                groupMembers = members.map(member => member.user_id);
            } catch (error) {
                this.ctx.logger.warn('获取群成员列表失败:', error);
            }
        }

        // 查询这些用户的今日人品记录
        const query = this.ctx.database
            .select('jrrp')
            .where({
                userId: { $in: groupMembers },
                date
            })
            .orderBy('luck', 'desc');

        if (session.onebot && this.config.jrrp.rankUseForwardMsg) {
            return await query.limit(50).execute(); // 限制最多50条，避免消息过长
        } else {
            return await query.limit(this.config.jrrp.rankLimit || 10).execute();
        }
    }

    private async formatRankingMessage(session: Session, rankings: Jrrp[]): Promise<string> {
        const rankEntries = await Promise.all(
            rankings.map(async (rank, index) => {
                const userName = await getUserName(this.ctx, session, rank.userId);
                return `${index + 1}. ${h.escape(userName)} - 人品值：${rank.luck}`;
            })
        );

        return "今日人品排行榜：\n" + rankEntries.join('\n');
    }

    private async sendForwardMessage(session: Session, rankings: Jrrp[]): Promise<void> {
        const botName = await getUserName(this.ctx, session, session.bot?.userId) || "Bot";
        const rankingText = await this.formatRankingText(session, rankings);

        await session.onebot.sendGroupForwardMsg(session.onebot.group_id, [
            createTextMsgNode(session.bot?.userId, botName, '今日人品排行榜'),
            createTextMsgNode(session.bot?.userId, botName, rankingText)
        ]);
    }

    private async formatRankingText(session: Session, rankings: Jrrp[]): Promise<string> {
        const rankEntries = await Promise.all(
            rankings.map(async (rank, index) => {
                const userName = await getUserName(this.ctx, session, rank.userId);
                return `${index + 1}. ${h.escape(userName)} - 人品值：${rank.luck}`;
            })
        );

        return rankEntries.join('\n');
    }

    private async handleHistoryCommand(session: Session): Promise<string> {
        const { userId } = session;
        const { startDateStr, todayStr } = this.getHistoryDateRange();
        const history = await this.getHistoryRecords(userId, startDateStr, todayStr);

        if (!history.length) {
            return '最近7天内暂无人品记录。';
        }

        return await this.formatHistoryMessage(session, history);
    }

    private getHistoryDateRange() {
        const today = new Date();
        const startDate = new Date();
        startDate.setDate(today.getDate() - 6);
        return {
            startDateStr: formatDate(startDate),
            todayStr: formatDate(today)
        };
    }

    private async getHistoryRecords(userId: string, startDate: string, endDate: string): Promise<Jrrp[]> {
        return await this.ctx.database
            .select('jrrp')
            .where({
                userId,
                date: { $gte: startDate, $lte: endDate },
            })
            .orderBy('date', 'desc')
            .execute();
    }

    private async formatHistoryMessage(session: Session, history: Jrrp[]): Promise<string> {
        const userName = await getUserName(this.ctx, session, session.userId);
        let output = `${h.escape(userName)} 最近7天的人品记录：\n`;

        for (const record of history) {
            output += `${record.date} - 人品值：${record.luck}\n`;
        }

        return output;
    }
}

export default JrrpPlugin;