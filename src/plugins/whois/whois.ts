import { Context, Schema } from 'koishi';
import whoiser from 'whoiser';
import dayjs from 'dayjs';
import utc from 'dayjs/plugin/utc';
import timezone from 'dayjs/plugin/timezone';
import {stickEmoji} from "../../utils/emoji/emoji_helper";

// 启用 UTC 和时区插件
dayjs.extend(utc);
dayjs.extend(timezone);

function formatDateToChinese(isoDate: string): string {
    return dayjs(isoDate)
        .tz('Asia/Shanghai') // 设置为 UTC+8（北京时间）
        .format('YYYY 年 MM 月 DD 日 HH:mm:ss (UTC+8)');
}

export const name = 'whois';

export interface Config {
    // 可以在这里添加配置选项，例如自定义 whois 服务器
}

export const schema: Schema<Config> = Schema.object({
    // 如果需要配置，可以在这里定义
});

export function whois(ctx: Context, config: Config) {
    ctx.command('whois <domain:string>', '查询域名 whois 信息')
        .action(async ({ session }, domain) => {
            try {
                if (session.onebot) {
                    await stickEmoji(session, ctx, ["元宝"]);
                }
                // 使用 whoiser 查询域名信息
                const result = await whoiser(domain); // follow: 2 表示查询注册局和注册商
                // 提取主要 whois 服务器的结果（通常是注册商的）
                const mainWhois = Object.values(result)[0] || {}; // 取第一个服务器的结果

                // 格式化输出关键信息
                let output = `域名: ${mainWhois['Domain Name'].toLocaleLowerCase() || '未知'}\n`;

                output += `注册商: ${mainWhois['Registrar'] || '未知'}\n`;
                output += mainWhois['Registrar IANA ID'] ? `注册商 IANA ID: ${mainWhois['Registrar IANA ID']}\n` : '';
                output += mainWhois['registrar organization-loc'] ? `注册商本地化组织名称: ${mainWhois['registrar organization-loc']}\n` : '';
                output += mainWhois['Registrar WHOIS Server'] ? `WHOIS 服务器: ${mainWhois['Registrar WHOIS Server']}\n` : '';

                output += `注册日期: ${formatDateToChinese(mainWhois['Creation Date']) || '未知'}\n`;
                output += `过期日期: ${formatDateToChinese(mainWhois['Expiry Date']) || '未知'}\n`;
                output += `更新日期: ${formatDateToChinese(mainWhois['Updated Date']) || '未知'}\n`;
                output += `DNS 服务器: ${Array.isArray(mainWhois['Name Server']) ? mainWhois['Name Server'].join(', ').toLocaleLowerCase() : mainWhois['Name Server'].toLocaleLowerCase() || '未知'}\n`;

                output += mainWhois['Registrant Email'] ? `注册人邮箱: ${mainWhois['Registrant Email']}\n`: '';
                output += mainWhois['Registrant Name'] ? `注册人: ${mainWhois['Registrant Name']}\n` : '';
                output += mainWhois['Registrant Organization'] ? `注册人组织: ${mainWhois['Registrant Organization']}\n` : '';
                output += mainWhois['Registrant Country'] ? `注册人国家: ${mainWhois['Registrant Country']}\n` : '';

                output += mainWhois['Registry Domain ID'] ? `注册局域名 ID: ${mainWhois['Registry Domain ID']}\n` : '';

                output += mainWhois['DNSSEC'] ? `DNSSEC: ${mainWhois['DNSSEC']}\n` : '';

                return output;
            } catch (error) {
                return '域名查询失败';
            }
        });
}