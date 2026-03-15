import { CardInstance } from './CardTypes';

/** 商店商品类型 */
export enum ShopItemType {
    /** 卡牌 */
    CARD = 'CARD',
    /** 药水（消耗品） */
    POTION = 'POTION',
    /** 遗物（局内永久生效） */
    RELIC = 'RELIC',
}

/**
 * 商店服务类型。
 * 商店除了出售商品外，还提供三种服务。
 */
export enum ShopServiceType {
    /** 移除卡牌（50 金） —— 精简卡组是核心策略 */
    REMOVE_CARD = 'REMOVE_CARD',
    /** 升级卡牌（80 金） —— 费用 -1 或效果 +30% 二选一 */
    UPGRADE_CARD = 'UPGRADE_CARD',
    /** 调整卡序（免费） —— 重排卡组出牌顺序，只在商店可用 */
    REORDER_DECK = 'REORDER_DECK',
}

/** 商店卡牌商品 */
export interface ShopCardItem {
    type: ShopItemType.CARD;
    /** 可购买的卡牌（来自流派池 + 通用） */
    card: CardInstance;
    /** 价格（根据品质：普通 30-50 / 稀有 80-120 / 史诗 150-200 / 传说 300-400） */
    price: number;
    /** 是否已售出 */
    sold: boolean;
}

/**
 * 药水类型。
 * 药水是一次性消耗品，购买后立即生效。
 */
export enum PotionType {
    /** 回复固定 HP */
    HEAL_HP = 'HEAL_HP',
    /** 回复最大 HP 百分比 */
    HEAL_HP_PERCENT = 'HEAL_HP_PERCENT',
    /** 下场战斗 ATK 增益 */
    BUFF_ATK = 'BUFF_ATK',
    /** 下场战斗 SPD 增益 */
    BUFF_SPD = 'BUFF_SPD',
    /** 下场战斗 MP 增益 */
    BUFF_MP = 'BUFF_MP',
}

/** 商店药水商品 */
export interface ShopPotionItem {
    type: ShopItemType.POTION;
    /** 药水种类 */
    potionType: PotionType;
    /** 显示名称 */
    name: string;
    /** 效果描述 */
    description: string;
    /** 效果数值 */
    value: number;
    /** 价格 */
    price: number;
    /** 是否已售出 */
    sold: boolean;
}

/** 商店遗物商品 */
export interface ShopRelicItem {
    type: ShopItemType.RELIC;
    /** 遗物 ID（通过 RelicDef 查询详情） */
    relicId: string;
    /** 价格（100-250 金） */
    price: number;
    /** 是否已售出 */
    sold: boolean;
}

/** 商店商品联合类型 */
export type ShopItem = ShopCardItem | ShopPotionItem | ShopRelicItem;

/** 商店服务项 */
export interface ShopService {
    /** 服务类型 */
    serviceType: ShopServiceType;
    /** 价格（调整卡序 = 0） */
    price: number;
    /** 是否可用（如卡组为空则移除/升级不可用） */
    available: boolean;
}

/**
 * 商店完整状态。
 * 每层第 2 循环残影战斗结束后进入商店（每层仅 1 次机会）。
 * 商品栏位：卡牌 ×3 + 药水 ×1-2 + 遗物 ×0-1 + 服务（常驻）。
 */
export interface ShopState {
    /** 可购买卡牌（3 张） */
    cards: ShopCardItem[];
    /** 可购买药水（1-2 瓶） */
    potions: ShopPotionItem[];
    /** 可购买遗物（0-1 个，50% 概率刷新） */
    relics: ShopRelicItem[];
    /** 可用服务 */
    services: ShopService[];
}
