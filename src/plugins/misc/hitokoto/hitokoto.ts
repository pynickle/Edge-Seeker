import { Config } from '../../../index';
import axios from 'axios';
import { Context } from 'koishi';

// 一言类型映射
export const HitokotoTypeMap: Record<string, string> = {
    a: '动画',
    b: '漫画',
    c: '游戏',
    d: '文学',
    e: '原创',
    f: '来自网络',
    g: '其他',
    h: '影视',
    i: '诗词',
    j: '网易云',
    k: '哲学',
    l: '抖机灵',
};

// 一言接口返回数据结构
interface HitokotoResponse {
    id: number;
    hitokoto: string;
    type: string;
    from: string;
    from_who?: string;
    creator: string;
    creator_uid: number;
    reviewer: number;
    uuid: string;
    commit_from: string;
    created_at: string;
    length: number;
}

export const name = 'hitokoto';

export function hitokoto(ctx: Context, config: Config) {
    // 一言命令：获取随机一言
    ctx.command('hitokoto', '获取一句随机的箴言或诗句')
        .option(
            'type',
            '-t <type:string> 句子类型：a 动画/b 漫画/c 游戏/d 文学/e 原创/f 网络/g 其他/h 影视/i 诗词/j 网易云/k 哲学/l 抖机灵'
        )
        .option('min', '-m <min:number> 最小长度')
        .option('max', '-M <max:number> 最大长度')
        .action(async ({ session, options }) => {
            try {
                // 构建请求参数
                const params: Record<string, any> = {
                    encode: 'json',
                    charset: 'utf-8',
                };

                // 添加类型参数
                if (options.type) {
                    params.c = options.type;
                }

                // 添加长度限制参数
                if (options.min) {
                    params.min_length = options.min;
                }
                if (options.max) {
                    params.max_length = options.max;
                }

                // 发送请求到一言 API
                const response = await axios.get<HitokotoResponse>('http://hitokoto_api:8000', {
                    params,
                    timeout: 5000, // 10 秒超时
                });

                const data = response.data;

                // 构建回复消息
                let reply = `「${data.hitokoto}」`;

                // 添加来源信息
                if (data.from_who) {
                    reply += `\n—— ${data.from_who}《${data.from}》`;
                } else if (data.from) {
                    reply += `\n—— 《${data.from}》`;
                }

                // 添加类型信息
                const typeName = HitokotoTypeMap[data.type] || '其他';
                reply += `\n[${typeName}]`;

                return reply;
            } catch (error) {
                ctx.logger.warn('获取一言失败：', error);
                return '获取一言失败，请稍后再试。';
            }
        });

    // 类型列表命令：查看所有支持的一言类型
    ctx.command('hitokoto.categories', '查看所有支持的一言类型').action(() => {
        let types = '支持的一言类型：\n';
        Object.entries(HitokotoTypeMap).forEach(([code, name]) => {
            types += `${code}: ${name}\n`;
        });
        return types.trim();
    });
}
