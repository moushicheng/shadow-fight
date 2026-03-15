import { RelicRarity, RelicTrigger, Faction } from './Enums';
import { CardEffect } from './CardTypes';

/**
 * 遗物定义。
 * 遗物是局内持续生效的被动道具，获得后效果持续到本局结束。
 * 获取途径：战斗掉落(20%)、事件奖励、商店购买(100-250 金)、Boss 必掉。
 */
export interface RelicDef {
    /** 遗物唯一 ID */
    id: string;
    /** 显示名称，如「铁皮水壶」 */
    name: string;
    /** 效果描述，如"每场战斗开始时获得 5 护甲" */
    description: string;
    /** 品质（普通 60% / 稀有 30% / 传说 10%） */
    rarity: RelicRarity;
    /** 触发时机（战斗开始/行动时/受伤时/进入商店时等） */
    trigger: RelicTrigger;
    /** 触发时执行的效果 —— 可复用 CardEffect 结构或使用自定义效果 */
    effect: CardEffect | RelicCustomEffect;
    /** 关联流派（空表示通用遗物，如赌徒专属遗物：赌神骰子） */
    faction?: Faction;
    /** 商店价格范围 */
    shopPrice: { min: number; max: number };
    /** 最低出现层数 */
    floorMin: number;
}

/**
 * 遗物自定义效果。
 * 当 CardEffect 的结构不足以描述遗物效果时使用。
 * 如"元素共鸣：当卡组中同流派卡牌 ≥ 5 张时，该流派所有卡牌费用 -1"。
 */
export interface RelicCustomEffect {
    /** 自定义效果标识 */
    type: string;
    /** 具体参数 */
    params: Record<string, unknown>;
}
