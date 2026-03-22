import { CardRarity, TempBuffType } from '../../types/Enums';
import { CardDef } from '../../types/CardTypes';
import { RelicDef } from '../../types/RelicTypes';
import { RunState } from '../../types/RunTypes';
import {
    ShopState, ShopCardItem, ShopPotionItem, ShopRelicItem,
    ShopService, ShopItemType, ShopServiceType, PotionType,
} from '../../types/ShopTypes';
import { FactionPool, CardSource } from '../faction/FactionPool';
import { SeededRandom } from '../utils/SeededRandom';

const CARD_SLOT_COUNT = 5;
const POTION_MIN = 1;
const POTION_MAX = 2;
const RELIC_CHANCE = 0.5;
const SERVICE_PICK_COUNT = 2;

const ALL_SERVICES: ShopServiceType[] = [
    ShopServiceType.REMOVE_CARD,
    ShopServiceType.UPGRADE_CARD,
    ShopServiceType.REORDER_DECK,
];

const CARD_PRICE_RANGE: Record<CardRarity, { min: number; max: number }> = {
    [CardRarity.NORMAL]: { min: 30, max: 50 },
    [CardRarity.RARE]: { min: 80, max: 120 },
    [CardRarity.EPIC]: { min: 150, max: 200 },
    [CardRarity.LEGENDARY]: { min: 300, max: 400 },
};

const RELIC_PRICE_RANGE = { min: 100, max: 250 };

const SERVICE_BASE_PRICE = 50;
const SERVICE_PRICE_INCREMENT = 25;

interface PotionConfig {
    potionType: PotionType;
    name: string;
    description: string;
    value: number;
    priceRange: { min: number; max: number };
}

const POTION_CONFIGS: PotionConfig[] = [
    { potionType: PotionType.HEAL_HP, name: '小治疗药水', description: '回复 30 HP', value: 30, priceRange: { min: 25, max: 40 } },
    { potionType: PotionType.HEAL_HP_PERCENT, name: '大治疗药水', description: '回复 30% 最大 HP', value: 0.3, priceRange: { min: 40, max: 60 } },
    { potionType: PotionType.BUFF_ATK, name: '力量药水', description: '下场战斗 ATK +3', value: 3, priceRange: { min: 30, max: 50 } },
    { potionType: PotionType.BUFF_SPD, name: '敏捷药水', description: '下场战斗 SPD +2', value: 2, priceRange: { min: 35, max: 55 } },
    { potionType: PotionType.BUFF_MP, name: '魔力药水', description: '下场战斗 MP +3', value: 3, priceRange: { min: 30, max: 50 } },
];

export type ShopResult =
    | { success: true }
    | { success: false; reason: string };

/**
 * ShopManager —— 商店系统。
 *
 * 职责：
 * - 商品生成（5 卡牌 + 1-2 药水 + 0-1 遗物 + 2 服务）
 * - 购买商品（卡牌/药水/遗物）
 * - 使用服务（移除/升级/调序，每次进店限用 1 次）
 * - 价格计算（服务价格递增：50 + 使用次数 × 25）
 *
 * 纯静态方法，不持有可变状态，不依赖引擎 API。
 */
export class ShopManager {

    // ─── 商品生成 ──────────────────────────────────────

    /**
     * 生成一个完整的商店状态。
     * 卡牌从流派池 + 通用中按权重抽取，价格按品质区间随机。
     * 遗物 50% 概率出现，排除已拥有的。
     * 服务从 3 种中随机抽 2 种。
     */
    static generateShop(
        runState: RunState,
        factionPool: FactionPool,
        allCards: CardDef[],
        allRelics: RelicDef[],
        rng: SeededRandom,
    ): ShopState {
        const cards = ShopManager._generateCards(runState, factionPool, allCards, rng);
        const potions = ShopManager._generatePotions(rng);
        const relics = ShopManager._generateRelics(runState, allRelics, rng);
        const services = ShopManager._generateServices(runState, rng);

        return { cards, potions, relics, services };
    }

    // ─── 购买商品 ──────────────────────────────────────

    /** 购买卡牌：扣金币、标记售出、加入卡组末尾 */
    static buyCard(
        shopState: ShopState,
        runState: RunState,
        cardIndex: number,
    ): ShopResult {
        if (cardIndex < 0 || cardIndex >= shopState.cards.length) {
            return { success: false, reason: 'invalid_index' };
        }
        const item = shopState.cards[cardIndex];
        if (item.sold) {
            return { success: false, reason: 'already_sold' };
        }
        if (runState.gold < item.price) {
            return { success: false, reason: 'insufficient_gold' };
        }

        runState.gold -= item.price;
        runState.stats.goldSpent += item.price;
        item.sold = true;
        runState.deck.push({ ...item.card });
        runState.stats.cardsObtained += 1;

        return { success: true };
    }

    /** 购买药水：扣金币、标记售出、立即应用效果 */
    static buyPotion(
        shopState: ShopState,
        runState: RunState,
        potionIndex: number,
    ): ShopResult {
        if (potionIndex < 0 || potionIndex >= shopState.potions.length) {
            return { success: false, reason: 'invalid_index' };
        }
        const item = shopState.potions[potionIndex];
        if (item.sold) {
            return { success: false, reason: 'already_sold' };
        }
        if (runState.gold < item.price) {
            return { success: false, reason: 'insufficient_gold' };
        }

        runState.gold -= item.price;
        runState.stats.goldSpent += item.price;
        item.sold = true;
        ShopManager._applyPotion(item, runState);

        return { success: true };
    }

    /** 购买遗物：扣金币、标记售出、加入遗物列表 */
    static buyRelic(
        shopState: ShopState,
        runState: RunState,
        relicIndex: number,
    ): ShopResult {
        if (relicIndex < 0 || relicIndex >= shopState.relics.length) {
            return { success: false, reason: 'invalid_index' };
        }
        const item = shopState.relics[relicIndex];
        if (item.sold) {
            return { success: false, reason: 'already_sold' };
        }
        if (runState.gold < item.price) {
            return { success: false, reason: 'insufficient_gold' };
        }
        if (runState.relics.includes(item.relicId)) {
            return { success: false, reason: 'already_owned' };
        }

        runState.gold -= item.price;
        runState.stats.goldSpent += item.price;
        item.sold = true;
        runState.relics.push(item.relicId);

        return { success: true };
    }

    // ─── 商店服务 ──────────────────────────────────────

    /**
     * 移除卡牌服务：从卡组中移除指定位置的卡牌。
     * 不允许移除最后一张牌。
     */
    static useServiceRemoveCard(
        shopState: ShopState,
        runState: RunState,
        deckIndex: number,
    ): ShopResult {
        const check = ShopManager._checkServiceUsable(
            shopState, runState, ShopServiceType.REMOVE_CARD,
        );
        if (!check.success) return check;

        if (deckIndex < 0 || deckIndex >= runState.deck.length) {
            return { success: false, reason: 'invalid_deck_index' };
        }
        if (runState.deck.length <= 1) {
            return { success: false, reason: 'deck_too_small' };
        }

        const price = ShopManager._getServicePrice(shopState, ShopServiceType.REMOVE_CARD);
        runState.gold -= price;
        runState.stats.goldSpent += price;
        runState.deck.splice(deckIndex, 1);
        runState.stats.cardsRemoved += 1;
        runState.serviceUseCount += 1;
        ShopManager._markAllServicesUsed(shopState);

        return { success: true };
    }

    /**
     * 升级卡牌服务：升级卡组中指定位置的卡牌。
     * @param upgradePath 升级路线：'cost' 费用 -1 或 'enhance' 效果 +30%
     */
    static useServiceUpgradeCard(
        shopState: ShopState,
        runState: RunState,
        deckIndex: number,
        upgradePath: 'cost' | 'enhance',
    ): ShopResult {
        const check = ShopManager._checkServiceUsable(
            shopState, runState, ShopServiceType.UPGRADE_CARD,
        );
        if (!check.success) return check;

        if (deckIndex < 0 || deckIndex >= runState.deck.length) {
            return { success: false, reason: 'invalid_deck_index' };
        }
        const card = runState.deck[deckIndex];
        if (card.upgraded) {
            return { success: false, reason: 'already_upgraded' };
        }

        const price = ShopManager._getServicePrice(shopState, ShopServiceType.UPGRADE_CARD);
        runState.gold -= price;
        runState.stats.goldSpent += price;
        card.upgraded = true;
        card.upgradePath = upgradePath;
        runState.serviceUseCount += 1;
        ShopManager._markAllServicesUsed(shopState);

        return { success: true };
    }

    /**
     * 调序服务：将卡组中指定位置的卡牌移动到新位置。
     * 免费服务，但仍计为一次服务使用。
     */
    static useServiceReorderDeck(
        shopState: ShopState,
        runState: RunState,
        fromIndex: number,
        toIndex: number,
    ): ShopResult {
        const check = ShopManager._checkServiceUsable(
            shopState, runState, ShopServiceType.REORDER_DECK,
        );
        if (!check.success) return check;

        if (
            fromIndex < 0 || fromIndex >= runState.deck.length ||
            toIndex < 0 || toIndex >= runState.deck.length
        ) {
            return { success: false, reason: 'invalid_deck_index' };
        }
        if (fromIndex === toIndex) {
            return { success: false, reason: 'same_position' };
        }

        const [card] = runState.deck.splice(fromIndex, 1);
        runState.deck.splice(toIndex, 0, card);
        runState.serviceUseCount += 1;
        ShopManager._markAllServicesUsed(shopState);

        return { success: true };
    }

    // ─── 价格查询 ──────────────────────────────────────

    /** 计算服务价格：50 + 使用次数 × 25，调序固定免费 */
    static calcServicePrice(serviceUseCount: number): number {
        return SERVICE_BASE_PRICE + serviceUseCount * SERVICE_PRICE_INCREMENT;
    }

    /** 卡牌价格范围 */
    static getCardPriceRange(rarity: CardRarity): { min: number; max: number } {
        return CARD_PRICE_RANGE[rarity];
    }

    /** 遗物价格范围 */
    static getRelicPriceRange(): { min: number; max: number } {
        return RELIC_PRICE_RANGE;
    }

    // ─── 私有方法 ──────────────────────────────────────

    private static _generateCards(
        runState: RunState,
        factionPool: FactionPool,
        allCards: CardDef[],
        rng: SeededRandom,
    ): ShopCardItem[] {
        const available = factionPool.filterAvailableCards(
            allCards, CardSource.SHOP, runState.currentFloor,
        );
        const picked = factionPool.pickWeightedCards(available, CARD_SLOT_COUNT, rng);

        return picked.map(card => ({
            type: ShopItemType.CARD as const,
            card: { defId: card.id, upgraded: false },
            price: rng.nextInt(
                CARD_PRICE_RANGE[card.rarity].min,
                CARD_PRICE_RANGE[card.rarity].max,
            ),
            sold: false,
        }));
    }

    private static _generatePotions(rng: SeededRandom): ShopPotionItem[] {
        const count = rng.nextInt(POTION_MIN, POTION_MAX);
        const picked = rng.sample(POTION_CONFIGS, count);

        return picked.map(cfg => ({
            type: ShopItemType.POTION as const,
            potionType: cfg.potionType,
            name: cfg.name,
            description: cfg.description,
            value: cfg.value,
            price: rng.nextInt(cfg.priceRange.min, cfg.priceRange.max),
            sold: false,
        }));
    }

    private static _generateRelics(
        runState: RunState,
        allRelics: RelicDef[],
        rng: SeededRandom,
    ): ShopRelicItem[] {
        if (!rng.chance(RELIC_CHANCE)) return [];

        const owned = new Set(runState.relics);
        const available = allRelics.filter(r =>
            !owned.has(r.id) &&
            runState.currentFloor >= r.floorMin,
        );
        if (available.length === 0) return [];

        const relic = rng.pick(available);
        return [{
            type: ShopItemType.RELIC as const,
            relicId: relic.id,
            price: rng.nextInt(relic.shopPrice.min, relic.shopPrice.max),
            sold: false,
        }];
    }

    private static _generateServices(
        runState: RunState,
        rng: SeededRandom,
    ): ShopService[] {
        const picked = rng.sample(ALL_SERVICES, SERVICE_PICK_COUNT);
        const currentPrice = ShopManager.calcServicePrice(runState.serviceUseCount);

        return picked.map(st => ({
            serviceType: st,
            price: st === ShopServiceType.REORDER_DECK ? 0 : currentPrice,
            available: true,
        }));
    }

    private static _applyPotion(item: ShopPotionItem, runState: RunState): void {
        switch (item.potionType) {
            case PotionType.HEAL_HP:
                runState.currentHp = Math.min(
                    runState.maxHp,
                    runState.currentHp + item.value,
                );
                break;
            case PotionType.HEAL_HP_PERCENT:
                runState.currentHp = Math.min(
                    runState.maxHp,
                    runState.currentHp + Math.round(runState.maxHp * item.value),
                );
                break;
            case PotionType.BUFF_ATK:
                runState.tempBuffs.push({
                    id: `potion_atk`,
                    description: item.description,
                    effects: [{ type: TempBuffType.ATK_ADD, value: item.value }],
                });
                break;
            case PotionType.BUFF_SPD:
                runState.tempBuffs.push({
                    id: `potion_spd`,
                    description: item.description,
                    effects: [{ type: TempBuffType.SPD_ADD, value: item.value }],
                });
                break;
            case PotionType.BUFF_MP:
                runState.tempBuffs.push({
                    id: `potion_mp`,
                    description: item.description,
                    effects: [{ type: TempBuffType.MP_ADD, value: item.value }],
                });
                break;
        }
    }

    /**
     * 检查服务是否可用：
     * 1. 该服务类型在本次商店中存在
     * 2. 本次进店尚未使用过任何服务
     * 3. 金币足够（调序免费除外）
     */
    private static _checkServiceUsable(
        shopState: ShopState,
        runState: RunState,
        serviceType: ShopServiceType,
    ): ShopResult {
        const service = shopState.services.find(s => s.serviceType === serviceType);
        if (!service) {
            return { success: false, reason: 'service_not_available' };
        }

        const anyUsed = shopState.services.some(s => !s.available);
        if (anyUsed) {
            return { success: false, reason: 'service_limit_reached' };
        }

        if (serviceType !== ShopServiceType.REORDER_DECK) {
            if (runState.gold < service.price) {
                return { success: false, reason: 'insufficient_gold' };
            }
        }

        return { success: true };
    }

    private static _getServicePrice(
        shopState: ShopState,
        serviceType: ShopServiceType,
    ): number {
        if (serviceType === ShopServiceType.REORDER_DECK) return 0;
        const service = shopState.services.find(s => s.serviceType === serviceType);
        return service?.price ?? 0;
    }

    /** 使用一次服务后，标记所有服务为不可用（每次进店限 1 次） */
    private static _markAllServicesUsed(shopState: ShopState): void {
        for (const s of shopState.services) {
            s.available = false;
        }
    }
}
