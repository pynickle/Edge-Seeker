import {Context} from 'koishi';
import axios from 'axios';
import {Config} from "../../index";

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

export function minecraft_notifier(ctx: Context, cfg: Config) {
    ctx.database.extend('minecraft_notifier', {
        id: 'integer',
        lastRelease: 'string',
        lastSnapshot: 'string',
    }, {primary: 'id'});

    let lastRelease = '';
    let lastSnapshot = '';

    // 如果有数据库，加载持久化数据
    const loadData = async () => {
        const record = (await ctx.database.get('minecraft_notifier', 1))[0];
        if (record) {
            lastRelease = record.lastRelease;
            lastSnapshot = record.lastSnapshot;
        }
    };

    const saveData = async () => {
        if (ctx.database) {
            await ctx.database.upsert('minecraft_notifier', [{ id: 1, lastRelease, lastSnapshot }]);
        }
    };

    const getLatestVersions = async () => {
        let retries = 0;
        while (retries <= 3) {
            try {
                const response = await axios.get('https://launchermeta.mojang.com/mc/game/version_manifest.json', {
                    timeout: 10000
                });
                const data = response.data;
                return {
                    release: data.latest.release,
                    snapshot: data.latest.snapshot,
                };
            } catch (error) {
                retries++;
                if (retries <= 3) {
                    // 简单的指数退避
                    await new Promise(resolve => setTimeout(resolve, Math.pow(2, retries) * 1000));
                }
            }
        }
    };

    ctx.setInterval(async () => {
        try {
            await loadData();
            const latest = await getLatestVersions();

            const bot = ctx.bots.find(bot => bot.platform === 'onebot');
            if (lastRelease !== latest.release) {
                for (const channel of cfg.minecraft.notifyChannel) {
                    await bot.sendMessage(channel, `Minecraft 新正式版发布了：${latest.release}`);
                }
                lastRelease = latest.release;
            }

            if (lastSnapshot !== latest.snapshot) {
                for (const channel of cfg.minecraft.notifyChannel) {
                    await bot.sendMessage(channel, `Minecraft 新快照版发布了：${latest.snapshot}`);
                }
                lastSnapshot = latest.snapshot;
            }

            await saveData();
        } catch (error) {
            ctx.logger('minecraft-notifier').error('检查 Minecraft 版本时出错：', error);
        }
    }, 60000 * cfg.minecraft.checkInterval); // 默认每 10 分钟检查一次
}