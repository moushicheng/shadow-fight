import { EventCategory, Faction } from './Enums';

/**
 * 事件选项（支持无限嵌套的分支叙事树）。
 *
 * 两种模式：
 * - **叶子节点**：只有 effects，选择后直接结算效果，事件结束。
 * - **分支节点**：有 nextDescription + nextOptions，选择后推进故事，
 *   展示新叙事文本，再呈现新一层选项。effects 也会在进入分支时立即结算
 *   （可为空数组表示"无即时效果，仅推进故事"）。
 *
 * 示例：
 * ```
 * 「神秘商人」—— "你在暗巷遇到一个神秘商人..."
 *  ├─ "查看商品"  → nextDescription: "商人展开一块布..."
 *  │   ├─ "买下匕首" → effects: [GAIN_CARD]
 *  │   ├─ "买下药水" → effects: [HEAL_HP]
 *  │   └─ "离开"     → effects: []
 *  ├─ "威胁他"    → effects: [GAIN_GOLD(50%), DAMAGE_HP(50%)]
 *  └─ "无视走开"  → effects: []
 * ```
 */
export interface EventOption {
    /** 选项按钮文本，如"打开箱子" */
    text: string;
    /** 选项提示/描述，如"（可能获得卡牌/金币）" */
    hint?: string;
    /** 选择后执行的效果列表（分支节点也可带即时效果，选中即结算） */
    effects: EventEffect[];
    /** 选择此选项后展示的下一段叙事文本（有此字段说明是分支节点） */
    nextDescription?: string;
    /** 下一段叙事的插图资源路径（可选） */
    nextIllustration?: string;
    /** 下一层选项列表（递归结构，支持无限嵌套） */
    nextOptions?: EventOption[];
}

/**
 * 事件效果。
 * 支持概率型效果（如 50% 得 60 金 / 50% 失 30 金）。
 */
export interface EventEffect {
    /** 效果类型 */
    type: EventEffectType;
    /** 效果数值（含义取决于 type） */
    value?: number;
    /** 概率（0-1）—— 设为 1 或不设表示必定触发 */
    probability?: number;
    /** 概率不满足时的替代效果 */
    fallback?: EventEffect;
    /** 附加参数（如 MODIFY_ATTRIBUTE 需指定哪个属性） */
    params?: Record<string, unknown>;
}

/** 事件效果类型 */
export enum EventEffectType {
    /** 回复固定 HP */
    HEAL_HP = 'HEAL_HP',
    /** 回复最大 HP 的百分比 */
    HEAL_HP_PERCENT = 'HEAL_HP_PERCENT',
    /** 扣除固定 HP */
    DAMAGE_HP = 'DAMAGE_HP',
    /** 扣除最大 HP 的百分比 */
    DAMAGE_HP_PERCENT = 'DAMAGE_HP_PERCENT',
    /** 获得金币 */
    GAIN_GOLD = 'GAIN_GOLD',
    /** 失去金币 */
    LOSE_GOLD = 'LOSE_GOLD',
    /** 获得卡牌（从流派池 + 通用中随机） */
    GAIN_CARD = 'GAIN_CARD',
    /** 移除卡组中的一张卡 */
    REMOVE_CARD = 'REMOVE_CARD',
    /** 获得遗物 */
    GAIN_RELIC = 'GAIN_RELIC',
    /** 永久修改基础属性（如 STR -1） */
    MODIFY_ATTRIBUTE = 'MODIFY_ATTRIBUTE',
    /** 获得临时增益（下场战斗生效） */
    TEMP_BUFF = 'TEMP_BUFF',
    /** 随机升级卡组中的一张卡 */
    UPGRADE_RANDOM_CARD = 'UPGRADE_RANDOM_CARD',
}

/**
 * 事件定义。
 * 每个循环首节点随机抽取 1 个事件。
 * 事件概率随层数变化：浅层正面多，深层负面多。
 */
export interface GameEventDef {
    /** 事件唯一 ID */
    id: string;
    /** 事件名称，如「温泉休憩」 */
    name: string;
    /** 事件描述文本，如"你在路边发现了一个闪烁着微光的箱子..." */
    description: string;
    /** 事件插图资源路径（可选） */
    illustration?: string;
    /** 事件分类（正面/中性/负面） */
    category: EventCategory;
    /** 可出现的最低层数 */
    floorMin: number;
    /** 可出现的最高层数 */
    floorMax: number;
    /** 关联流派 —— 空表示通用事件 */
    faction?: Faction;
    /** 事件选项列表 */
    options: EventOption[];
}
