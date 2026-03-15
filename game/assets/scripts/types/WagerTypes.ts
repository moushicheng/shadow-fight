import { TempBuffEffect } from './RunTypes';

/**
 * 赌约定义（赌徒流派专属）。
 * 当流派池包含 GAMBLER 时，每场战斗前触发赌约选择界面（可跳过）。
 * 系统随机展示 2 个赌约，玩家可接受 0-1 个。
 *
 * 赌约 = 正面效果（战斗增益）+ 负面代价（HP/金币/规则惩罚）。
 */
export interface WagerDef {
    /** 赌约唯一 ID */
    id: string;
    /** 赌约名称，如「自信一击」「玻璃之躯」 */
    name: string;
    /** 正面效果描述 —— 如"本场战斗 ATK +3" */
    positiveDesc: string;
    /** 负面代价描述 —— 如"初始 HP -20" */
    negativeDesc: string;
    /** 正面效果列表（作为 TempBuff 应用到战斗初始化） */
    positiveEffects: TempBuffEffect[];
    /** 负面效果列表 */
    negativeEffects: WagerNegativeEffect[];
}

/** 赌约负面效果 */
export interface WagerNegativeEffect {
    /** 负面效果类型 */
    type: WagerNegativeType;
    /** 效果数值 */
    value?: number;
    /** 触发概率（0-1，1 = 必定触发）—— 如"命运硬币：50% 失去 50 金" */
    probability: number;
}

/** 赌约负面效果类型 */
export enum WagerNegativeType {
    /** 立即扣除固定 HP */
    HP_LOSS = 'HP_LOSS',
    /** 立即扣除最大 HP 百分比 */
    HP_LOSS_PERCENT = 'HP_LOSS_PERCENT',
    /** 失去金币 */
    GOLD_LOSS = 'GOLD_LOSS',
    /** 战斗奖励削减（如卡牌 3 选 1 变 2 选 1） */
    REWARD_REDUCTION = 'REWARD_REDUCTION',
    /** 覆盖加时阈值（如速战速决：30 周期未结束判负） */
    OVERTIME_LIMIT = 'OVERTIME_LIMIT',
    /** 战败时额外扣除最大 HP 百分比 */
    EXTRA_HP_LOSS_ON_DEFEAT = 'EXTRA_HP_LOSS_ON_DEFEAT',
}
