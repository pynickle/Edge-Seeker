import {Context} from 'koishi';
import axios from 'axios';

export const name = 'minecraft_notifier';

export interface LatestVersion {
    id: number;
    lastRelease: string;
    lastSnapshot: string;
}

declare module 'koishi' {
    interface Tables {
        minecraft_notifier: LatestVersion;
    }
}

export function minecraft_notifier(ctx: Context) {
    let lastRelease = '';
    let lastSnapshot = '';

    // 如果有数据库，加载持久化数据
    const loadData = async () => {
        if (ctx.database) {
            ctx.database.extend('minecraft_notifier', {
                id: 'integer',
                lastRelease: 'string',
                lastSnapshot: 'string',
            }, { primary: 'id' });

            const record = (await ctx.database.get('minecraft_notifier', 1))[0];
            if (record) {
                lastRelease = record.lastRelease;
                lastSnapshot = record.lastSnapshot;
            }
        }
    };

    const saveData = async () => {
        if (ctx.database) {
            await ctx.database.upsert('minecraft_notifier', [{ id: 1, lastRelease, lastSnapshot }]);
        }
    };

    const getLatestVersions = async () => {
        const response = await axios.get('https://launchermeta.mojang.com/mc/game/version_manifest.json');
        const data = response.data;
        return {
            release: data.latest.release,
            snapshot: data.latest.snapshot,
        };
    };

    ctx.on('ready', async () => {
        await loadData();
        ctx.setInterval(async () => {
            try {
                const latest = await getLatestVersions();
                const messages = [];

                if (lastRelease !== latest.release) {
                    messages.push(`Minecraft 新正式版发布了：${latest.release}`);
                    lastRelease = latest.release;
                }

                if (lastSnapshot !== latest.snapshot) {
                    messages.push(`Minecraft 新快照版发布了：${latest.snapshot}`);
                    lastSnapshot = latest.snapshot;
                }

                if (messages.length > 0) {
                    await saveData();

                    return messages.join('\n');
                }
            } catch (error) {
                ctx.logger('minecraft-notifier').error('检查 Minecraft 版本时出错：', error);
            }
        }, 600000); // 每 10 分钟检查一次
    });
}