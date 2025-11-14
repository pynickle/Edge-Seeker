import { Context } from 'koishi';

export interface ProbabilityRecord {
    id: number;
    userId: string;
    userName: string;
    channelId: string;
    probability: number;
}

export interface MessageRecord {
    id: number;
    userId: string;
    userName: string;
    channelId: string;
    content: string;
    timestamp: number;
    starsUsed: number;
}

export function apply(ctx: Context) {
    ctx.model.extend(
        'probability',
        {
            id: 'unsigned',
            userId: 'string',
            userName: 'string',
            channelId: 'string',
            probability: 'float',
        },
        { primary: 'id', autoInc: true }
    );

    ctx.model.extend(
        'messages',
        {
            id: 'unsigned',
            userId: 'string',
            userName: 'string',
            channelId: 'string',
            content: 'string',
            timestamp: 'unsigned',
            starsUsed: 'integer',
        },
        { primary: 'id', autoInc: true }
    );
}
