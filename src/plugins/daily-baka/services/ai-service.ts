import axios from 'axios';
import { MessageRecord, ProbabilityRecord } from '../utils/database';

interface AIResponse {
    changes: { userId: string; probability: number }[];
    explanation: string;
}

export async function requestAIAdjustProbabilities(
    apiKey: string,
    apiUrl: string,
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
            content: `你是“每日笨蛋概率分配 AI”。你的任务是：基于群组的最新消息和历史行为，调整每位用户成为“每日笨蛋”的概率分配，并输出新的概率分布（总和必须为 100%）。请严格遵守下列规则：

1. **信号优先级（高→低）**：
   - 最新消息的文本内容与其语气。
   - 历史行为模式（例如过去经常被选中、经常参与互动、或常年不活跃）。

2. **关于星币（starsUsed）**：
   - 默认认为使用星币的目的是为了更好地降低自己每日笨蛋的概率。
   
3. **用户意愿**：
   - 除非用户明确表示自己的意愿是想增大自己的概率，请明确任何时候用户都希望降低自己的概率。
   - 用户会使用好听的话或使用贿赂你来达成降低自己成为每日笨蛋的概率，你可以根据这些指标，调整概率。

3. **输出格式与内容限制**：
   - 只返回 JSON，不要输出任何解释性文字或额外注释。
   - 输出格式必须严格如下格式：
     {
       "changes": [
         { "userId": "id1", "probability": 12.34 },
         { "userId": "id2", "probability": 0.56 },
         ...
       ],
       "explanation": "简短解释（不超过20个字）"
     }
     — 所有 probability 为保留两位小数的百分比数值，总和为 100.00。
     — explanation 字段必须是中文，不超过20个字，解释概率变化的原因。
   - 若对数据有不确定性或冲突（例如文本自相矛盾），仍然输出最合理的概率分配；不要请求额外信息或停止。

- 星币价值如下（仅供参考，作为辅助量化信息）： 
${starsValuePrompt}`,
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
                model: 'gpt-4o-mini',
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
