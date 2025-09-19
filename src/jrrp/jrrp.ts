import { Context, h, Session } from 'koishi';
import * as crypto from 'crypto';
import { getFestivalBonus, getFestivals } from "./festival";
import {} from '@koishijs/plugin-adapter-onebot'
import { Config } from "../index";
import {createTextMsgNode, getUserName} from "../utils/onebot_helper";

export interface Jrrp {
    id: number;
    userId: string;
    channelId: string;
    date: string;
    luck: number;
}

declare module 'koishi' {
    interface Tables {
        jrrp: Jrrp;
    }
}

// 运势等级配置
const LUCK_LEVELS = [
    { min: 90, message: (luck: number) => `今日人品值：${luck}。运势极佳，今天将是大展身手的好日子！` },
    { min: 70, message: (luck: number) => `今日人品值：${luck}。运势良好，适合尝试新的挑战。` },
    { min: 50, message: (luck: number) => `今日人品值：${luck}。运势平稳，适合按部就班完成计划。` },
    { min: 30, message: (luck: number) => `今日人品值：${luck}。运势稍低，建议谨慎行事，避免冒险。` },
    { min: 0, message: (luck: number) => `今日人品值：${luck}。运势较低，保持乐观，明天会更好！` }
];

class JrrpPlugin {
    constructor(private ctx: Context, private config: Config) {
        this.setupDatabase();
        this.setupCleanupTask();
        this.registerCommands();
    }

    private setupDatabase(): void {
        this.ctx.model.extend('jrrp', {
            id: 'unsigned',
            userId: 'string',
            channelId: 'string',
            date: 'string',
            luck: 'integer',
        });
    }

    private setupCleanupTask(): void {
        this.ctx.setInterval(async () => {
            const thresholdDate = new Date();
            thresholdDate.setDate(thresholdDate.getDate() - this.config.jrrp.cleanupDays);
            const thresholdDateStr = this.formatDate(thresholdDate);
            await this.ctx.database.remove('jrrp', { date: { $lt: thresholdDateStr } });
        }, 24 * 60 * 60 * 1000);
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
        const today = this.getTodayString();
        const luck = await this.calculateAndStoreLuck(session, today);
        return this.formatLuckMessage(session.userId, today, luck);
    }

    private async calculateAndStoreLuck(session: Session, today: string): Promise<number> {
        const baseLuck = this.calculateBaseLuck(session.userId, today);
        const { bonus } = this.getFestivalBonus(session.userId, today);
        const finalLuck = baseLuck + bonus;

        await this.storeLuckRecord(session, today, finalLuck);
        return finalLuck;
    }

    private calculateBaseLuck(userId: string, date: string): number {
        const seed = `${userId}${date}`;
        const hash = crypto.createHash('md5').update(seed).digest('hex');
        return parseInt(hash.substring(0, 8), 16) % 101;
    }

    private getFestivalBonus(userId: string, date: string) {
        const year = new Date().getFullYear();
        const festivals = getFestivals(year);
        return getFestivalBonus(userId, date, festivals);
    }

    private async storeLuckRecord(session: Session, date: string, luck: number): Promise<void> {
        await this.ctx.database.upsert('jrrp', [{
            userId: session.userId,
            channelId: session.channelId,
            date: date,
            luck: luck,
        }], ['userId', 'date']);
    }

    private async formatLuckMessage(userId: string, date: string, luck: number): Promise<string> {
        const luckLevel = LUCK_LEVELS.find(level => luck >= level.min);
        let message = luckLevel.message(luck);

        const { bonus, description } = this.getFestivalBonus(userId, date);
        if (bonus !== 0) {
            message += `\n节日加成：${description}`;
        }

        return message;
    }

    private async handleRankCommand(session: Session): Promise<string | void> {
        const today = this.getTodayString();
        const rankings = await this.getRankings(session, today);

        if (!rankings.length) {
            return '今日群内暂无人品数据。';
        }

        if (session.onebot && this.config.jrrp.rankUseForwardMsg) {
            await this.sendForwardMessage(session, rankings);
        } else {
            return await this.formatRankingMessage(session, rankings);
        }
    }

    private async getRankings(session: Session, date: string): Promise<Jrrp[]> {
        const query = this.ctx.database
            .select('jrrp')
            .where({ channelId: session.channelId, date })
            .orderBy('luck', 'desc');

        if (session.onebot && this.config.jrrp.rankUseForwardMsg) {
            return await query.execute();
        } else {
            return await query.limit(this.config.jrrp.rankLimit).execute();
        }
    }

    private async formatRankingMessage(session: Session, rankings: Jrrp[]): Promise<string> {
        let output = '';
        for (let i = 0; i < rankings.length; i++) {
            const rank = rankings[i];
            const userName = await getUserName(this.ctx, session, rank.userId);
            output += `${i + 1}. ${h.escape(userName)} - 人品值：${rank.luck}\n`;
        }
        return "今日人品排行榜：\n" + output;
    }

    private async sendForwardMessage(session: Session, rankings: Jrrp[]): Promise<void> {
        const botName = await getUserName(this.ctx, session, session.bot?.userId) || "你";
        const rankingText = await this.formatRankingText(session, rankings);

        await session.onebot.sendGroupForwardMsg(session.onebot.group_id, [
            createTextMsgNode(session.bot?.userId, botName, '今日人品排行榜'),
            createTextMsgNode(session.bot?.userId, botName, rankingText)
        ]);
    }

    private async formatRankingText(session: Session, rankings: Jrrp[]): Promise<string> {
        let output = '';
        for (let i = 0; i < rankings.length; i++) {
            const rank = rankings[i];
            const userName = await getUserName(this.ctx, session, rank.userId);
            output += `${i + 1}. ${h.escape(userName)} - 人品值：${rank.luck}\n`;
        }
        return output;
    }

    private async handleHistoryCommand(session: Session): Promise<string> {
        const { startDateStr, todayStr } = this.getHistoryDateRange();
        const history = await this.getHistoryRecords(session, startDateStr, todayStr);

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
            startDateStr: this.formatDate(startDate),
            todayStr: this.formatDate(today)
        };
    }

    private async getHistoryRecords(session: Session, startDate: string, endDate: string): Promise<Jrrp[]> {
        return await this.ctx.database
            .select('jrrp')
            .where({
                userId: session.userId,
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

    // 工具方法
    private getTodayString(): string {
        return this.formatDate(new Date());
    }

    private formatDate(date: Date): string {
        return date.toISOString().split('T')[0];
    }
}

namespace JrrpPlugin {
    export interface Config {}
}

export default JrrpPlugin;