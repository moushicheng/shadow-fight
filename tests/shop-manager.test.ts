/**
 * Phase 2.7 商店系统 — ShopManager 关键验证点测试
 *
 * 验证点（对应 plan.md §2.7）：
 * 1. 商品栏位：5 张卡牌 + 1-2 瓶药水 + 0-1 个遗物(50%) + 2 个服务
 * 2. 卡牌来自流派池 + COMMON，价格按品质区间
 * 3. 服务从 3 种中随机出现 2 种
 * 4. 每次进商店只能使用 1 次服务
 * 5. 服务价格递增：首次 50 金，每使用 1 次永久 +25 金
 * 6. 移除卡牌后卡组张数 -1
 * 7. 调整卡序后卡组内容不变
 * 8. 购买的卡牌追加到卡组末尾
 * 9. 药水立即生效（HP 回复 / 战斗增益）
 * 10. 遗物不重复获取
 * 11. 种子确定性
 */
import { describe, it, expect } from 'vitest';
import { ShopManager, ShopResult } from '../game/assets/scripts/core/shop/ShopManager';
import { SeededRandom } from '../game/assets/scripts/core/utils/SeededRandom';
import { FactionPool } from '../game/assets/scripts/core/faction/FactionPool';
import { RunState } from '../game/assets/scripts/types/RunTypes';
import { CardDef, CardInstance } from '../game/assets/scripts/types/CardTypes';
import { RelicDef } from '../game/assets/scripts/types/RelicTypes';
import {
    ShopState, ShopServiceType, ShopItemType, PotionType,
} from '../game/assets/scripts/types/ShopTypes';
import {
    Faction, CardRarity, CardType, CardTag, EffectTarget,
    RelicRarity, RelicTrigger, RunStatus, TempBuffType,
} from '../game/assets/scripts/types/Enums';

// ─── 测试用数据工厂 ─────────────────────────────────────

function makeCardDef(overrides: Partial<CardDef> & { id: string; faction: Faction; rarity: CardRarity }): CardDef {
    return {
        name: overrides.id,
        description: '',
        cardType: CardType.ATTACK,
        tags: [],
        manaCost: 1,
        effects: [{ target: EffectTarget.ENEMY }],
        floorMin: 1,
        floorMax: 10,
        dropWeight: 1.0,
        droppable: true,
        buyable: true,
        eventObtainable: true,
        starterOnly: false,
        upgrade: {
            name: `${overrides.id}+`,
            costReduction: 1,
            enhancedDescription: '',
            enhancedEffects: [],
        },
        ...overrides,
    };
}

function makeRelicDef(overrides: Partial<RelicDef> & { id: string }): RelicDef {
    return {
        name: overrides.id,
        description: '',
        rarity: RelicRarity.NORMAL,
        trigger: RelicTrigger.PASSIVE,
        effect: { type: 'test', params: {} },
        shopPrice: { min: 100, max: 200 },
        floorMin: 1,
        ...overrides,
    };
}

const TEST_CARDS: CardDef[] = [
    makeCardDef({ id: 'common_slash', faction: Faction.COMMON, rarity: CardRarity.NORMAL }),
    makeCardDef({ id: 'common_guard', faction: Faction.COMMON, rarity: CardRarity.NORMAL }),
    makeCardDef({ id: 'common_heal', faction: Faction.COMMON, rarity: CardRarity.RARE }),
    makeCardDef({ id: 'ice_bolt', faction: Faction.ICE, rarity: CardRarity.NORMAL }),
    makeCardDef({ id: 'ice_blizzard', faction: Faction.ICE, rarity: CardRarity.RARE }),
    makeCardDef({ id: 'ice_frost_nova', faction: Faction.ICE, rarity: CardRarity.EPIC }),
    makeCardDef({ id: 'fire_strike', faction: Faction.FIRE, rarity: CardRarity.NORMAL }),
    makeCardDef({ id: 'fire_inferno', faction: Faction.FIRE, rarity: CardRarity.RARE }),
    makeCardDef({ id: 'fire_meteor', faction: Faction.FIRE, rarity: CardRarity.LEGENDARY }),
    makeCardDef({ id: 'poison_dart', faction: Faction.POISON, rarity: CardRarity.NORMAL, buyable: false }),
    makeCardDef({ id: 'hex_curse', faction: Faction.HEX, rarity: CardRarity.NORMAL }),
];

const TEST_RELICS: RelicDef[] = [
    makeRelicDef({ id: 'relic_armor', rarity: RelicRarity.NORMAL }),
    makeRelicDef({ id: 'relic_sword', rarity: RelicRarity.RARE }),
    makeRelicDef({ id: 'relic_crown', rarity: RelicRarity.LEGENDARY, floorMin: 5 }),
    makeRelicDef({ id: 'relic_shield', rarity: RelicRarity.NORMAL }),
];

function createRunState(overrides: Partial<RunState> = {}): RunState {
    return {
        seed: 42,
        baseProperty: { STR: 10, CON: 10, SPD: 10, MANA: 10 },
        currentHp: 180,
        maxHp: 180,
        deck: [
            { defId: 'common_slash', upgraded: false },
            { defId: 'common_guard', upgraded: false },
            { defId: 'ice_bolt', upgraded: false },
        ],
        relics: [],
        factionPool: [Faction.ICE, Faction.FIRE],
        hearts: 5,
        gold: 500,
        currentFloor: 5,
        currentCycle: 2,
        currentNode: 'shop' as any,
        nodeIndex: 5,
        rerollUsed: false,
        serviceUseCount: 0,
        runStatus: RunStatus.ONGOING,
        tempBuffs: [],
        encounteredGhosts: [],
        stats: {
            monstersDefeated: 0,
            ghostsDefeated: 0,
            cardsObtained: 0,
            cardsRemoved: 0,
            goldEarned: 0,
            goldSpent: 0,
            damageDealt: 0,
            damageTaken: 0,
            highestFloor: 5,
        },
        ...overrides,
    };
}

function generateTestShop(seed = 12345, runOverrides: Partial<RunState> = {}): {
    shop: ShopState;
    runState: RunState;
    rng: SeededRandom;
} {
    const rng = new SeededRandom(seed);
    const runState = createRunState(runOverrides);
    const factionPool = new FactionPool(runState.factionPool);
    const shop = ShopManager.generateShop(runState, factionPool, TEST_CARDS, TEST_RELICS, rng);
    return { shop, runState, rng };
}

// ─── 商品生成测试 ─────────────────────────────────────

describe('ShopManager — 商品生成', () => {

    it('生成正确数量的卡牌（最多 5 张）', () => {
        const { shop } = generateTestShop();
        expect(shop.cards.length).toBeGreaterThan(0);
        expect(shop.cards.length).toBeLessThanOrEqual(5);
        for (const c of shop.cards) {
            expect(c.type).toBe(ShopItemType.CARD);
            expect(c.sold).toBe(false);
        }
    });

    it('卡牌全部来自流派池 + COMMON', () => {
        const allowedCardIds = TEST_CARDS
            .filter(c => [Faction.ICE, Faction.FIRE, Faction.COMMON].includes(c.faction) && c.buyable)
            .map(c => c.id);

        for (let seed = 0; seed < 50; seed++) {
            const { shop } = generateTestShop(seed);
            for (const c of shop.cards) {
                expect(allowedCardIds).toContain(c.card.defId);
            }
        }
    });

    it('不包含 buyable=false 的卡牌', () => {
        for (let seed = 0; seed < 50; seed++) {
            const { shop } = generateTestShop(seed);
            for (const c of shop.cards) {
                expect(c.card.defId).not.toBe('poison_dart');
            }
        }
    });

    it('卡牌价格在品质区间内', () => {
        for (let seed = 0; seed < 30; seed++) {
            const { shop } = generateTestShop(seed);
            for (const c of shop.cards) {
                const cardDef = TEST_CARDS.find(d => d.id === c.card.defId)!;
                const range = ShopManager.getCardPriceRange(cardDef.rarity);
                expect(c.price).toBeGreaterThanOrEqual(range.min);
                expect(c.price).toBeLessThanOrEqual(range.max);
            }
        }
    });

    it('生成 1-2 瓶药水', () => {
        const counts = new Set<number>();
        for (let seed = 0; seed < 100; seed++) {
            const { shop } = generateTestShop(seed);
            expect(shop.potions.length).toBeGreaterThanOrEqual(1);
            expect(shop.potions.length).toBeLessThanOrEqual(2);
            counts.add(shop.potions.length);
            for (const p of shop.potions) {
                expect(p.type).toBe(ShopItemType.POTION);
                expect(p.sold).toBe(false);
                expect(p.price).toBeGreaterThan(0);
            }
        }
        expect(counts.has(1)).toBe(true);
        expect(counts.has(2)).toBe(true);
    });

    it('遗物约 50% 概率出现（大量抽样 ±15% 误差）', () => {
        let hasRelic = 0;
        const total = 1000;
        for (let seed = 0; seed < total; seed++) {
            const { shop } = generateTestShop(seed);
            if (shop.relics.length > 0) hasRelic++;
        }
        const rate = hasRelic / total;
        expect(rate).toBeGreaterThan(0.35);
        expect(rate).toBeLessThan(0.65);
    });

    it('遗物不包含已拥有的', () => {
        for (let seed = 0; seed < 100; seed++) {
            const { shop } = generateTestShop(seed, { relics: ['relic_armor', 'relic_sword'] });
            for (const r of shop.relics) {
                expect(r.relicId).not.toBe('relic_armor');
                expect(r.relicId).not.toBe('relic_sword');
            }
        }
    });

    it('遗物价格在定义的范围内', () => {
        for (let seed = 0; seed < 200; seed++) {
            const { shop } = generateTestShop(seed);
            for (const r of shop.relics) {
                const relicDef = TEST_RELICS.find(d => d.id === r.relicId)!;
                expect(r.price).toBeGreaterThanOrEqual(relicDef.shopPrice.min);
                expect(r.price).toBeLessThanOrEqual(relicDef.shopPrice.max);
            }
        }
    });

    it('遗物遵守 floorMin 限制', () => {
        for (let seed = 0; seed < 100; seed++) {
            const { shop } = generateTestShop(seed, { currentFloor: 3 });
            for (const r of shop.relics) {
                expect(r.relicId).not.toBe('relic_crown');
            }
        }
    });

    it('生成恰好 2 个服务，且类型不同', () => {
        for (let seed = 0; seed < 50; seed++) {
            const { shop } = generateTestShop(seed);
            expect(shop.services.length).toBe(2);
            const types = shop.services.map(s => s.serviceType);
            expect(new Set(types).size).toBe(2);
            for (const s of shop.services) {
                expect(s.available).toBe(true);
            }
        }
    });

    it('服务从 3 种中抽取（大量抽样验证覆盖所有类型）', () => {
        const seen = new Set<ShopServiceType>();
        for (let seed = 0; seed < 200; seed++) {
            const { shop } = generateTestShop(seed);
            shop.services.forEach(s => seen.add(s.serviceType));
        }
        expect(seen.has(ShopServiceType.REMOVE_CARD)).toBe(true);
        expect(seen.has(ShopServiceType.UPGRADE_CARD)).toBe(true);
        expect(seen.has(ShopServiceType.REORDER_DECK)).toBe(true);
    });

    it('调序服务价格为 0，其他服务使用递增价格', () => {
        for (let seed = 0; seed < 50; seed++) {
            const { shop } = generateTestShop(seed);
            for (const s of shop.services) {
                if (s.serviceType === ShopServiceType.REORDER_DECK) {
                    expect(s.price).toBe(0);
                } else {
                    expect(s.price).toBe(50);
                }
            }
        }
    });

    it('服务价格随 serviceUseCount 递增', () => {
        const { shop } = generateTestShop(42, { serviceUseCount: 3 });
        for (const s of shop.services) {
            if (s.serviceType !== ShopServiceType.REORDER_DECK) {
                expect(s.price).toBe(50 + 3 * 25);
            }
        }
    });
});

// ─── 购买卡牌测试 ─────────────────────────────────────

describe('ShopManager — 购买卡牌', () => {

    it('成功购买：金币扣除、卡牌加入卡组末尾、标记售出', () => {
        const { shop, runState } = generateTestShop();
        const item = shop.cards[0];
        const goldBefore = runState.gold;
        const deckSizeBefore = runState.deck.length;

        const result = ShopManager.buyCard(shop, runState, 0);

        expect(result.success).toBe(true);
        expect(runState.gold).toBe(goldBefore - item.price);
        expect(runState.deck.length).toBe(deckSizeBefore + 1);
        expect(runState.deck[runState.deck.length - 1].defId).toBe(item.card.defId);
        expect(item.sold).toBe(true);
        expect(runState.stats.cardsObtained).toBe(1);
        expect(runState.stats.goldSpent).toBe(item.price);
    });

    it('金币不足时拒绝购买', () => {
        const { shop, runState } = generateTestShop(42, { gold: 0 });

        const result = ShopManager.buyCard(shop, runState, 0);

        expect(result.success).toBe(false);
        expect((result as any).reason).toBe('insufficient_gold');
        expect(runState.deck.length).toBe(3);
    });

    it('已售出商品不能重复购买', () => {
        const { shop, runState } = generateTestShop();
        ShopManager.buyCard(shop, runState, 0);

        const result = ShopManager.buyCard(shop, runState, 0);

        expect(result.success).toBe(false);
        expect((result as any).reason).toBe('already_sold');
    });

    it('非法索引被拒绝', () => {
        const { shop, runState } = generateTestShop();

        expect(ShopManager.buyCard(shop, runState, -1).success).toBe(false);
        expect(ShopManager.buyCard(shop, runState, 99).success).toBe(false);
    });

    it('购买的卡牌是独立副本（不共享引用）', () => {
        const { shop, runState } = generateTestShop();
        ShopManager.buyCard(shop, runState, 0);

        const shopCard = shop.cards[0].card;
        const deckCard = runState.deck[runState.deck.length - 1];
        expect(deckCard).not.toBe(shopCard);
        expect(deckCard.defId).toBe(shopCard.defId);
    });
});

// ─── 购买药水测试 ─────────────────────────────────────

describe('ShopManager — 购买药水', () => {

    it('购买 HEAL_HP 药水：HP 回复且不超过最大值', () => {
        const { shop, runState } = generateTestShop();
        runState.currentHp = 100;
        const healPotion = shop.potions.find(p => p.potionType === PotionType.HEAL_HP);
        if (!healPotion) return;
        const idx = shop.potions.indexOf(healPotion);

        const result = ShopManager.buyPotion(shop, runState, idx);

        expect(result.success).toBe(true);
        expect(runState.currentHp).toBeLessThanOrEqual(runState.maxHp);
        expect(runState.currentHp).toBeGreaterThan(100);
        expect(healPotion.sold).toBe(true);
    });

    it('购买 HEAL_HP_PERCENT 药水：按百分比回复', () => {
        const { shop, runState } = generateTestShop();
        runState.currentHp = 50;
        const potion = shop.potions.find(p => p.potionType === PotionType.HEAL_HP_PERCENT);
        if (!potion) return;
        const idx = shop.potions.indexOf(potion);

        const hpBefore = runState.currentHp;
        ShopManager.buyPotion(shop, runState, idx);

        const expected = Math.min(runState.maxHp, hpBefore + Math.round(runState.maxHp * potion.value));
        expect(runState.currentHp).toBe(expected);
    });

    it('购买 BUFF_ATK 药水：添加临时增益', () => {
        const { shop, runState } = generateTestShop();
        const potion = shop.potions.find(p => p.potionType === PotionType.BUFF_ATK);
        if (!potion) return;
        const idx = shop.potions.indexOf(potion);

        ShopManager.buyPotion(shop, runState, idx);

        const buff = runState.tempBuffs.find(b => b.id === 'potion_atk');
        expect(buff).toBeDefined();
        expect(buff!.effects[0].type).toBe(TempBuffType.ATK_ADD);
        expect(buff!.effects[0].value).toBe(potion.value);
    });

    it('购买 BUFF_SPD 药水：添加临时增益', () => {
        const { shop, runState } = generateTestShop();
        const potion = shop.potions.find(p => p.potionType === PotionType.BUFF_SPD);
        if (!potion) return;
        const idx = shop.potions.indexOf(potion);

        ShopManager.buyPotion(shop, runState, idx);

        const buff = runState.tempBuffs.find(b => b.id === 'potion_spd');
        expect(buff).toBeDefined();
        expect(buff!.effects[0].type).toBe(TempBuffType.SPD_ADD);
    });

    it('购买 BUFF_MP 药水：添加临时增益', () => {
        const { shop, runState } = generateTestShop();
        const potion = shop.potions.find(p => p.potionType === PotionType.BUFF_MP);
        if (!potion) return;
        const idx = shop.potions.indexOf(potion);

        ShopManager.buyPotion(shop, runState, idx);

        const buff = runState.tempBuffs.find(b => b.id === 'potion_mp');
        expect(buff).toBeDefined();
        expect(buff!.effects[0].type).toBe(TempBuffType.MP_ADD);
    });

    it('金币不足时拒绝', () => {
        const { shop, runState } = generateTestShop(42, { gold: 0 });
        const result = ShopManager.buyPotion(shop, runState, 0);
        expect(result.success).toBe(false);
        expect((result as any).reason).toBe('insufficient_gold');
    });
});

// ─── 购买遗物测试 ─────────────────────────────────────

describe('ShopManager — 购买遗物', () => {

    function findShopWithRelic(startSeed = 0): { shop: ShopState; runState: RunState } | null {
        for (let s = startSeed; s < startSeed + 500; s++) {
            const result = generateTestShop(s);
            if (result.shop.relics.length > 0) return result;
        }
        return null;
    }

    it('成功购买：金币扣除、加入遗物列表、标记售出', () => {
        const data = findShopWithRelic()!;
        expect(data).not.toBeNull();
        const { shop, runState } = data;
        const relic = shop.relics[0];
        const goldBefore = runState.gold;

        const result = ShopManager.buyRelic(shop, runState, 0);

        expect(result.success).toBe(true);
        expect(runState.gold).toBe(goldBefore - relic.price);
        expect(runState.relics).toContain(relic.relicId);
        expect(relic.sold).toBe(true);
    });

    it('已拥有的遗物不能重复购买', () => {
        const data = findShopWithRelic()!;
        const { shop, runState } = data;
        const relicId = shop.relics[0].relicId;
        runState.relics.push(relicId);

        const result = ShopManager.buyRelic(shop, runState, 0);

        expect(result.success).toBe(false);
        expect((result as any).reason).toBe('already_owned');
    });

    it('金币不足时拒绝', () => {
        const data = findShopWithRelic()!;
        const { shop, runState } = data;
        runState.gold = 0;

        const result = ShopManager.buyRelic(shop, runState, 0);

        expect(result.success).toBe(false);
        expect((result as any).reason).toBe('insufficient_gold');
    });

    it('无遗物商品时索引越界被拒绝', () => {
        const { shop, runState } = generateTestShop();
        shop.relics = [];
        const result = ShopManager.buyRelic(shop, runState, 0);
        expect(result.success).toBe(false);
    });
});

// ─── 服务：移除卡牌 ──────────────────────────────────

describe('ShopManager — 移除卡牌服务', () => {

    function shopWithRemoveService(seed = 0): { shop: ShopState; runState: RunState } | null {
        for (let s = seed; s < seed + 200; s++) {
            const result = generateTestShop(s);
            if (result.shop.services.some(sv => sv.serviceType === ShopServiceType.REMOVE_CARD)) {
                return result;
            }
        }
        return null;
    }

    it('移除卡牌后卡组张数 -1', () => {
        const data = shopWithRemoveService()!;
        expect(data).not.toBeNull();
        const { shop, runState } = data;
        const deckBefore = runState.deck.length;
        const removedId = runState.deck[1].defId;

        const result = ShopManager.useServiceRemoveCard(shop, runState, 1);

        expect(result.success).toBe(true);
        expect(runState.deck.length).toBe(deckBefore - 1);
        expect(runState.deck.map(c => c.defId)).not.toContain(removedId);
        expect(runState.stats.cardsRemoved).toBe(1);
    });

    it('扣除正确的金币', () => {
        const data = shopWithRemoveService()!;
        const { shop, runState } = data;
        const service = shop.services.find(s => s.serviceType === ShopServiceType.REMOVE_CARD)!;
        const goldBefore = runState.gold;

        ShopManager.useServiceRemoveCard(shop, runState, 0);

        expect(runState.gold).toBe(goldBefore - service.price);
    });

    it('不允许移除最后一张牌', () => {
        const data = shopWithRemoveService()!;
        const { shop, runState } = data;
        runState.deck = [{ defId: 'common_slash', upgraded: false }];

        const result = ShopManager.useServiceRemoveCard(shop, runState, 0);

        expect(result.success).toBe(false);
        expect((result as any).reason).toBe('deck_too_small');
    });

    it('serviceUseCount 递增', () => {
        const data = shopWithRemoveService()!;
        const { shop, runState } = data;
        expect(runState.serviceUseCount).toBe(0);

        ShopManager.useServiceRemoveCard(shop, runState, 0);

        expect(runState.serviceUseCount).toBe(1);
    });

    it('金币不足时拒绝', () => {
        const data = shopWithRemoveService()!;
        const { shop, runState } = data;
        runState.gold = 0;

        const result = ShopManager.useServiceRemoveCard(shop, runState, 0);

        expect(result.success).toBe(false);
        expect((result as any).reason).toBe('insufficient_gold');
    });
});

// ─── 服务：升级卡牌 ──────────────────────────────────

describe('ShopManager — 升级卡牌服务', () => {

    function shopWithUpgradeService(seed = 0): { shop: ShopState; runState: RunState } | null {
        for (let s = seed; s < seed + 200; s++) {
            const result = generateTestShop(s);
            if (result.shop.services.some(sv => sv.serviceType === ShopServiceType.UPGRADE_CARD)) {
                return result;
            }
        }
        return null;
    }

    it('升级卡牌（费用路线）：标记 upgraded + upgradePath', () => {
        const data = shopWithUpgradeService()!;
        expect(data).not.toBeNull();
        const { shop, runState } = data;

        const result = ShopManager.useServiceUpgradeCard(shop, runState, 0, 'cost');

        expect(result.success).toBe(true);
        expect(runState.deck[0].upgraded).toBe(true);
        expect(runState.deck[0].upgradePath).toBe('cost');
    });

    it('升级卡牌（增强路线）：标记 upgraded + upgradePath', () => {
        const data = shopWithUpgradeService()!;
        const { shop, runState } = data;

        const result = ShopManager.useServiceUpgradeCard(shop, runState, 1, 'enhance');

        expect(result.success).toBe(true);
        expect(runState.deck[1].upgraded).toBe(true);
        expect(runState.deck[1].upgradePath).toBe('enhance');
    });

    it('已升级的卡牌不能再次升级', () => {
        const data = shopWithUpgradeService()!;
        const { shop, runState } = data;
        runState.deck[0].upgraded = true;

        const result = ShopManager.useServiceUpgradeCard(shop, runState, 0, 'cost');

        expect(result.success).toBe(false);
        expect((result as any).reason).toBe('already_upgraded');
    });

    it('扣除正确的金币并更新统计', () => {
        const data = shopWithUpgradeService()!;
        const { shop, runState } = data;
        const service = shop.services.find(s => s.serviceType === ShopServiceType.UPGRADE_CARD)!;
        const goldBefore = runState.gold;

        ShopManager.useServiceUpgradeCard(shop, runState, 0, 'cost');

        expect(runState.gold).toBe(goldBefore - service.price);
        expect(runState.stats.goldSpent).toBe(service.price);
    });
});

// ─── 服务：调整卡序 ──────────────────────────────────

describe('ShopManager — 调整卡序服务', () => {

    function shopWithReorderService(seed = 0): { shop: ShopState; runState: RunState } | null {
        for (let s = seed; s < seed + 200; s++) {
            const result = generateTestShop(s);
            if (result.shop.services.some(sv => sv.serviceType === ShopServiceType.REORDER_DECK)) {
                return result;
            }
        }
        return null;
    }

    it('调序后卡组内容不变，仅位置改变', () => {
        const data = shopWithReorderService()!;
        expect(data).not.toBeNull();
        const { shop, runState } = data;
        const idsBefore = runState.deck.map(c => c.defId).sort();

        const result = ShopManager.useServiceReorderDeck(shop, runState, 0, 2);

        expect(result.success).toBe(true);
        const idsAfter = runState.deck.map(c => c.defId).sort();
        expect(idsAfter).toEqual(idsBefore);
    });

    it('目标卡牌移动到正确位置', () => {
        const data = shopWithReorderService()!;
        const { shop, runState } = data;
        const movedCard = runState.deck[0].defId;

        ShopManager.useServiceReorderDeck(shop, runState, 0, 2);

        expect(runState.deck[2].defId).toBe(movedCard);
    });

    it('调序免费（不扣金币）', () => {
        const data = shopWithReorderService()!;
        const { shop, runState } = data;
        const goldBefore = runState.gold;

        ShopManager.useServiceReorderDeck(shop, runState, 0, 1);

        expect(runState.gold).toBe(goldBefore);
    });

    it('相同位置移动被拒绝', () => {
        const data = shopWithReorderService()!;
        const { shop, runState } = data;

        const result = ShopManager.useServiceReorderDeck(shop, runState, 1, 1);

        expect(result.success).toBe(false);
        expect((result as any).reason).toBe('same_position');
    });

    it('非法索引被拒绝', () => {
        const data = shopWithReorderService()!;
        const { shop, runState } = data;

        expect(ShopManager.useServiceReorderDeck(shop, runState, -1, 0).success).toBe(false);
        expect(ShopManager.useServiceReorderDeck(shop, runState, 0, 99).success).toBe(false);
    });
});

// ─── 服务限制：每次进店限 1 次 ──────────────────────

describe('ShopManager — 每次进店限用 1 次服务', () => {

    it('使用 1 次服务后，其他服务全部不可用', () => {
        const { shop, runState } = generateTestShop(42);
        const firstServiceType = shop.services[0].serviceType;

        if (firstServiceType === ShopServiceType.REORDER_DECK) {
            ShopManager.useServiceReorderDeck(shop, runState, 0, 1);
        } else if (firstServiceType === ShopServiceType.REMOVE_CARD) {
            ShopManager.useServiceRemoveCard(shop, runState, 0);
        } else {
            ShopManager.useServiceUpgradeCard(shop, runState, 0, 'cost');
        }

        for (const s of shop.services) {
            expect(s.available).toBe(false);
        }
    });

    it('第二次使用任何服务被拒绝（service_limit_reached）', () => {
        let found = false;
        for (let seed = 0; seed < 200 && !found; seed++) {
            const { shop, runState } = generateTestShop(seed);
            const hasReorder = shop.services.some(s => s.serviceType === ShopServiceType.REORDER_DECK);
            const hasRemove = shop.services.some(s => s.serviceType === ShopServiceType.REMOVE_CARD);

            if (hasReorder && hasRemove) {
                ShopManager.useServiceReorderDeck(shop, runState, 0, 1);

                const result = ShopManager.useServiceRemoveCard(shop, runState, 0);
                expect(result.success).toBe(false);
                expect((result as any).reason).toBe('service_limit_reached');
                found = true;
            }
        }
        expect(found).toBe(true);
    });

    it('商店中不存在的服务类型被拒绝（service_not_available）', () => {
        const { shop, runState } = generateTestShop(42);
        const presentTypes = new Set(shop.services.map(s => s.serviceType));

        for (const st of [ShopServiceType.REMOVE_CARD, ShopServiceType.UPGRADE_CARD, ShopServiceType.REORDER_DECK]) {
            if (!presentTypes.has(st)) {
                let result: ShopResult;
                if (st === ShopServiceType.REMOVE_CARD) {
                    result = ShopManager.useServiceRemoveCard(shop, runState, 0);
                } else if (st === ShopServiceType.UPGRADE_CARD) {
                    result = ShopManager.useServiceUpgradeCard(shop, runState, 0, 'cost');
                } else {
                    result = ShopManager.useServiceReorderDeck(shop, runState, 0, 1);
                }
                expect(result.success).toBe(false);
                expect((result as any).reason).toBe('service_not_available');
            }
        }
    });
});

// ─── 服务价格递增 ──────────────────────────────────

describe('ShopManager — 服务价格递增', () => {

    it('calcServicePrice 正确递增', () => {
        expect(ShopManager.calcServicePrice(0)).toBe(50);
        expect(ShopManager.calcServicePrice(1)).toBe(75);
        expect(ShopManager.calcServicePrice(2)).toBe(100);
        expect(ShopManager.calcServicePrice(3)).toBe(125);
        expect(ShopManager.calcServicePrice(10)).toBe(300);
    });

    it('多次使用服务后价格正确累加', () => {
        const rng1 = new SeededRandom(100);
        const run1 = createRunState({ serviceUseCount: 0 });
        const fp1 = new FactionPool(run1.factionPool);
        const shop1 = ShopManager.generateShop(run1, fp1, TEST_CARDS, TEST_RELICS, rng1);

        const paidService1 = shop1.services.find(s => s.serviceType !== ShopServiceType.REORDER_DECK);
        if (paidService1) {
            expect(paidService1.price).toBe(50);
        }

        const rng2 = new SeededRandom(100);
        const run2 = createRunState({ serviceUseCount: 2 });
        const fp2 = new FactionPool(run2.factionPool);
        const shop2 = ShopManager.generateShop(run2, fp2, TEST_CARDS, TEST_RELICS, rng2);

        const paidService2 = shop2.services.find(s => s.serviceType !== ShopServiceType.REORDER_DECK);
        if (paidService2) {
            expect(paidService2.price).toBe(100);
        }
    });
});

// ─── 种子确定性 ──────────────────────────────────────

describe('ShopManager — 种子确定性', () => {

    it('相同种子生成完全相同的商店', () => {
        const { shop: shop1 } = generateTestShop(99999);
        const { shop: shop2 } = generateTestShop(99999);

        expect(shop1.cards.length).toBe(shop2.cards.length);
        for (let i = 0; i < shop1.cards.length; i++) {
            expect(shop1.cards[i].card.defId).toBe(shop2.cards[i].card.defId);
            expect(shop1.cards[i].price).toBe(shop2.cards[i].price);
        }

        expect(shop1.potions.length).toBe(shop2.potions.length);
        for (let i = 0; i < shop1.potions.length; i++) {
            expect(shop1.potions[i].potionType).toBe(shop2.potions[i].potionType);
            expect(shop1.potions[i].price).toBe(shop2.potions[i].price);
        }

        expect(shop1.relics.length).toBe(shop2.relics.length);
        for (let i = 0; i < shop1.relics.length; i++) {
            expect(shop1.relics[i].relicId).toBe(shop2.relics[i].relicId);
            expect(shop1.relics[i].price).toBe(shop2.relics[i].price);
        }

        expect(shop1.services.map(s => s.serviceType)).toEqual(
            shop2.services.map(s => s.serviceType),
        );
    });

    it('不同种子生成不同的商店（至少部分不同）', () => {
        let differ = false;
        for (let s = 0; s < 20; s++) {
            const { shop: a } = generateTestShop(s);
            const { shop: b } = generateTestShop(s + 1000);
            if (
                a.cards[0]?.card.defId !== b.cards[0]?.card.defId ||
                a.cards[0]?.price !== b.cards[0]?.price ||
                a.potions[0]?.potionType !== b.potions[0]?.potionType
            ) {
                differ = true;
                break;
            }
        }
        expect(differ).toBe(true);
    });
});

// ─── 综合场景 ──────────────────────────────────────

describe('ShopManager — 综合场景', () => {

    it('完整购物流程：买卡 + 买药 + 用服务', () => {
        let found = false;
        for (let seed = 0; seed < 200 && !found; seed++) {
            const { shop, runState } = generateTestShop(seed, { gold: 1000 });
            const hasRemove = shop.services.some(s => s.serviceType === ShopServiceType.REMOVE_CARD);
            if (shop.cards.length >= 2 && shop.potions.length >= 1 && hasRemove) {
                const r1 = ShopManager.buyCard(shop, runState, 0);
                expect(r1.success).toBe(true);

                const r2 = ShopManager.buyCard(shop, runState, 1);
                expect(r2.success).toBe(true);

                const r3 = ShopManager.buyPotion(shop, runState, 0);
                expect(r3.success).toBe(true);

                const deckSizeBefore = runState.deck.length;
                const r4 = ShopManager.useServiceRemoveCard(shop, runState, 0);
                expect(r4.success).toBe(true);
                expect(runState.deck.length).toBe(deckSizeBefore - 1);

                expect(runState.stats.cardsObtained).toBe(2);
                expect(runState.stats.cardsRemoved).toBe(1);
                expect(runState.serviceUseCount).toBe(1);
                found = true;
            }
        }
        expect(found).toBe(true);
    });

    it('购买后商品独立性：买完所有可买的不影响其他字段', () => {
        const { shop, runState } = generateTestShop(42, { gold: 10000 });

        for (let i = 0; i < shop.cards.length; i++) {
            ShopManager.buyCard(shop, runState, i);
        }
        for (let i = 0; i < shop.potions.length; i++) {
            ShopManager.buyPotion(shop, runState, i);
        }

        expect(shop.cards.every(c => c.sold)).toBe(true);
        expect(shop.potions.every(p => p.sold)).toBe(true);
        expect(runState.stats.cardsObtained).toBe(shop.cards.length);
    });

    it('卡池为空时优雅降级（空卡牌列表）', () => {
        const rng = new SeededRandom(42);
        const runState = createRunState();
        const factionPool = new FactionPool([Faction.ICE, Faction.FIRE]);
        const shop = ShopManager.generateShop(runState, factionPool, [], TEST_RELICS, rng);

        expect(shop.cards.length).toBe(0);
        expect(shop.potions.length).toBeGreaterThanOrEqual(1);
        expect(shop.services.length).toBe(2);
    });

    it('遗物池为空时优雅降级', () => {
        const rng = new SeededRandom(42);
        const runState = createRunState();
        const factionPool = new FactionPool([Faction.ICE, Faction.FIRE]);
        const shop = ShopManager.generateShop(runState, factionPool, TEST_CARDS, [], rng);

        expect(shop.relics.length).toBe(0);
    });
});
