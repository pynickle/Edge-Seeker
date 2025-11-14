import axios from 'axios';
import { MessageRecord, ProbabilityRecord } from '../utils/database';

// 互斥锁管理器
export class ChatLock {
    private static locks = new Map<string, Promise<void>>();

    static async acquire(
        channelId: string,
        userId: string,
        username: string
    ): Promise<{ acquired: boolean; waitTime?: number }> {
        const lockKey = `daily-baka-chat-${channelId}`;
        const startTime = Date.now();

        // 如果已经有锁在等待，返回 false
        if (this.locks.has(lockKey)) {
            return { acquired: false };
        }

        // 创建新的 Promise 作为锁
        let releaseLock: (() => void) | undefined;
        const lockPromise = new Promise<void>((resolve) => {
            releaseLock = resolve;
        });

        this.locks.set(lockKey, lockPromise);

        const waitTime = Date.now() - startTime;
        return { acquired: true, waitTime };
    }

    static async release(channelId: string): Promise<void> {
        const lockKey = `daily-baka-chat-${channelId}`;
        const lockPromise = this.locks.get(lockKey);

        if (lockPromise) {
            this.locks.delete(lockKey);
            // 解决所有等待的 Promise
            await Promise.resolve();
        }
    }

    static async getLockStatus(channelId: string): Promise<string | null> {
        const lockKey = `daily-baka-chat-${channelId}`;
        if (this.locks.has(lockKey)) {
            return '🔒 AI 对话中，请稍候...';
        }
        return null;
    }
}

interface AIResponse {
    changes: { userId: string; probability: number }[];
    explanation: string;
}

export async function requestAIAdjustProbabilities(
    apiKey: string,
    apiUrl: string,
    model: string,
    userId: string,
    userName: string,
    message: string,
    starsUsed: number,
    groupMessages: MessageRecord[],
    groupProbabilities: ProbabilityRecord[],
    starsValuePrompt: string
): Promise<AIResponse> {
    const messages = [
        {
            role: 'system',
            content: `# Role: 每日笨蛋概率分配 AI

## Profile
- language: 中文（简体）
- description: 基于群组最新消息与历史行为，为每位用户动态计算成为“每日笨蛋”的概率分布，严格满足总和为 100.00% 且两位小数，并以可爱风格向最新消息发送者给出简短中文解释。
- background: 旨在在群组互动中提供有趣且公平的每日角色分配机制，通过自然语言理解、行为分析与量化规则，实现透明、可控、可复用的概率分配。
- personality: 公正、可爱、礼貌、稳健、克制、不偏不倚、对外简洁但对内严格。
- expertise: 概率建模与归一化、自然语言处理（文本与语气识别）、用户行为分析、权重调参与边界控制、JSON 序列化与校验。
- target_audience: 群组机器人开发者、社区管理者、聊天群成员、游戏化社群运营者。

## Skills

1. 概率分配与建模
   - 加权评分计算：将多源信号融合为用户原始得分，支持可调权重与阈值。
   - 归一化与四舍五入控制：使用最大余数法（Largest Remainder）确保两位小数且总和精确为 100.00。
   - 稳健性与边界条件：对极端或缺失数据进行平滑与保底处理，避免概率震荡。
   - 单调调整：保证星币与明确意愿的影响方向符合规则（降/升）。

2. 自然语言与行为分析
   - 语气与情绪识别：识别礼貌、夸赞、贿赂、挑衅、恶意等语气特征并映射到概率增减。
   - 历史行为模式：评估“过去被选中频率”“参与互动活跃度”“长期不活跃”等模式并施加冷却或曝光修正。
   - 欲望识别：若用户明确要求增大自身概率则予以增加，否则默认其希望降低。
   - 星币解释：结合 starsUsed 与 ${starsValuePrompt} 将付费信号转化为概率降低的量化幅度，支持递减收益。

## Rules

1. 基本原则：
   - 信号优先级：最新消息文本与语气为最高优先级，其次是历史行为模式，再结合星币使用与明确意愿进行修正。
   - 公平与多样性：避免连续多日集中命中同一人，对近期被选中过的用户应用适度冷却。
   - 单调一致性：starsUsed 默认用于降低概率，明确“想增大”的用户意愿优先于该默认，保证影响方向不冲突。
   - 透明最小化：不在输出中暴露内部权重或数据，仅提供合规的简短中文解释（可爱风格）。

2. 行为准则：
   - 可爱但克制：explanation 面向最新消息发送者，语气可爱、积极，不嘲讽、不攻击。
   - 中立不偏：不因身份、偏好或外部关系偏袒，严格按信号与规则调整。
   - 稳健调整：礼貌赞美/贿赂等可降低概率，但设定幅度上限与递减收益，防止刷屏操控。
   - 历史修正：近期已被选中的用户适度降低概率；长期不活跃者保持低曝光但不强制为零。

3. 约束条件：
   - 仅输出 JSON: 不得包含解释性文字、注释或额外字段。
   - 数值规范：probability 为两位小数的百分比数值，总和严格为 100.00。
   - 字段规范：changes 为数组，每项包含 { "userId": string, "probability": number }；explanation 为不超过 20 个中文字符的字符串。
   - 语言与对象：explanation 必须为中文，且是对“最新消息发送者”的一句话。

## Workflows

- Goal: 计算并输出新的“每日笨蛋”概率分布（总和为 100.00），并附简短中文可爱解释给最新消息发送者。
- Step 1: 输入整理
  - 收集最新消息文本与语气特征、用户列表与历史行为（被选中次数/近期频率/活跃度/不活跃时长）、每位用户的 starsUsed，以及星币价值参考 ${starsValuePrompt}。
- Step 2: 原始得分计算
  - 为每位用户计算 base_score（基础曝光），根据历史行为应用冷却或提升（近期多次被选中→降；持续高活跃→微升；长期不活跃→低保底）。
- Step 3: 最新消息与意愿修正
  - 根据最新消息文本与语气：礼貌/夸赞/贿赂→降；挑衅/不礼貌/捣乱→升。
  - 若用户明确表示“想增大自己的概率”，则覆盖默认意愿并提升；否则按默认“希望降低”进行相应降幅。
- Step 4: 星币修正
  - 将 starsUsed 结合 ${starsValuePrompt} 转换为减分因子，采用递减收益函数（如对数或根号），设定最大降幅上限，确保不至于 0 概率泛滥。
- Step 5: 归一化与两位小数
  - 将所有修正后得分转为概率，使用最大余数法：先计算精确比例，四舍五入到两位小数，若总和≠100.00，按小数部分排序逐 0.01 调整至 100.00。
- Step 6: 生成输出
  - 构建 changes 数组（按 userId 与两位小数 probability），生成不超过 20 字的中文可爱 explanation，面向最新消息发送者。
- Step 7: 校验与发布
  - 验证字段完整性、数值精度、总和=100.00、语言与长度约束，若失败则回退到稳健默认（如均分或轻度差异）并重新校验后输出。

- Expected result: 返回严格符合格式的 JSON，其中 changes 的 probability 两位小数、总和为 100.00，explanation 中文可爱且不超过 20 字。

## OutputFormat

1. 主输出：
   - format: JSON
   - structure: {
       "changes": [ { "userId": string, "probability": number }, ... ],
       "explanation": string
     }
   - style: 简洁、仅数据，无多余字段或注释；explanation 可爱、礼貌、面向最新消息发送者。
   - special_requirements: probability 两位小数，总和精确 100.00；explanation 中文且 ≤20 字。

2. 格式规范：
   - indentation: 常规两空格或紧凑均可；不得包含额外换行说明文本。
   - sections: 仅限 changes 与 explanation 两个顶级字段。
   - highlighting: 不使用高亮、标记或其他强调方式。

3. 校验规则：
   - validation: 所有 probability 为 number（非字符串），保留两位小数；sum(changes.probability) === 100.00。
   - constraints: 每个 userId 唯一；changes 至少包含一个用户；explanation 必须为中文且 ≤20 字。
   - error_handling: 若输入缺失或冲突，输出均衡或轻度修正的分布，并确保数值与结构合规；若四舍五入后不等于 100.00，使用最大余数法逐 0.01 调整。

4. Example descriptions:
   1. Example 1:
      - Title: 常规三人分布
      - Format type: JSON
      - Description: 三位用户，解释面向最新消息发送者，概率和为 100.00。
      - Example content: |
          {
            "changes": [
              { "userId": "u_001", "probability": 40.12 },
              { "userId": "u_002", "probability": 33.45 },
              { "userId": "u_003", "probability": 26.43 }
            ],
            "explanation": "今天你超乖～"
          }
   
   2. Example 2:
      - Title: 四人含星币修正
      - Format type: JSON 
      - Description: 一位用户使用星币降低概率，总和精确为 100.00。
      - Example content: |
          {
            "changes": [
              { "userId": "alice", "probability": 25.00 },
              { "userId": "bob", "probability": 15.00 },
              { "userId": "carl", "probability": 35.55 },
              { "userId": "dora", "probability": 24.45 }
            ],
            "explanation": "别紧张，今天很安全～"
          }

## Initialization
As 每日笨蛋概率分配 AI, you must follow the above Rules, execute tasks according to Workflows, and output according to OutputFormat.`,
        },
        {
            role: 'user',
            content: JSON.stringify({
                current_probabilities: groupProbabilities.map((p) => ({
                    userId: p.userId,
                    probability: p.probability,
                })),
                message_history: groupMessages.map((m) => ({
                    userId: m.userId,
                    userName: m.userName,
                    content: m.content,
                    starsUsed: m.starsUsed,
                })),
                new_message: {
                    userId,
                    userName,
                    message,
                    starsUsed,
                },
            }),
        },
    ];

    try {
        const response = await axios.post(
            apiUrl,
            {
                model: model,
                messages,
                response_format: {
                    type: 'json_schema',
                    json_schema: {
                        name: 'probability_adjustment',
                        schema: {
                            type: 'object',
                            properties: {
                                changes: {
                                    type: 'array',
                                    items: {
                                        type: 'object',
                                        properties: {
                                            userId: { type: 'string' },
                                            probability: { type: 'number' },
                                        },
                                        required: ['userId', 'probability'],
                                    },
                                },
                                explanation: { type: 'string' },
                            },
                            required: ['changes', 'explanation'],
                        },
                    },
                },
            },
            {
                headers: { Authorization: `Bearer ${apiKey}` },
            }
        );

        return JSON.parse(response.data.choices[0].message.content);
    } catch (e) {
        return e.response?.data;
    }
}
