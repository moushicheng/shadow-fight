/**
 * Phase 2.8 遗物系统 — RelicManager 关键验证点测试
 *
 * 验证点（对应 plan.md §2.8）：
 * 1. 遗物持有无上限
 * 2. 遗物品质掉落概率：普通 60% / 稀有 30% / 传说 10%（大量抽样 ±5%）
 * 3. 遗物效果在正确时机触发（ON_ENTER_SHOP 等）
 * 4. 同一遗物不重复获取
 * 5. 掉落判定概率正确（20% 基础 / 25% 精英 / +10% 高星残影）
 * 6. 奖励三选一生成（品质分布、不重复、不选已拥有）
 * 7. 按触发时机查询持有遗物
 * 8. 种子确定性
 */
import { describe, it, expect } from 'vitest';
import { RelicManager, RelicTriggerResult } from '../game/assets/scripts/core/relic/RelicManager';
import { SeededRandom } from '../game/assets/scripts/core/utils/SeededRandom';
import { RunState } from '../game/assets/scripts/types/RunTypes';
import { RelicDef } from '../game/assets/scripts/types/RelicTypes';
import {
    RelicRarity, RelicTrigger, Faction, RunStatus, EffectTarget,
} from '../game/assets/scripts/types/Enums';

// ─── 测试用遗物定义 ──────────────────────────────────────

function makeRelic(overrides: Partial<RelicDef> & { id: string }): RelicDef {
    return {
        name: overrides.id,
        description: `${overrides.id} 效果`,
        rarity: RelicRarity.NORMAL,
        trigger: RelicTrigger.PASSIVE,
        effect: { type: 'test', params: {} },
        shopPrice: { min: 100, max: 200 },
        floorMin: 1,
        ...overrides,
    };
}

const TEST_RELICS: RelicDef[] = [
    // 普通品质
    makeRelic({ id: 'iron_kettle', rarity: RelicRarity.NORMAL, trigger: RelicTrigger.BATTLE_START,
        effect: { target: EffectTarget.SELF, armor: { gain: 5 } },
        description: '每场战斗开始获得 5 护甲' }),
    makeRelic({ id: 'herb_pouch', rarity: RelicRarity.NORMAL, trigger: RelicTrigger.ON_ENTER_SHOP,
        effect: { type: 'HEAL_HP', params: { amount: 10 } },
        description: '每次进入商店恢复 10 HP' }),
    makeRelic({ id: 'gold_ring', rarity: RelicRarity.NORMAL, trigger: RelicTrigger.ON_ENTER_SHOP,
        effect: { type: 'GAIN_GOLD', params: { amount: 15 } },
        description: '每次进入商店获得 15 金币' }),
    makeRelic({ id: 'leather_belt', rarity: RelicRarity.NORMAL, trigger: RelicTrigger.PASSIVE }),
    makeRelic({ id: 'worn_boots', rarity: RelicRarity.NORMAL, trigger: RelicTrigger.PASSIVE }),

    // 稀有品质
    makeRelic({ id: 'ruby_ring', rarity: RelicRarity.RARE, trigger: RelicTrigger.ON_ENTER_SHOP,
        effect: { target: EffectTarget.SELF, heal: { hp: 20 } },
        description: '每次进入商店恢复 20 HP' }),
    makeRelic({ id: 'war_drum', rarity: RelicRarity.RARE, trigger: RelicTrigger.BATTLE_START,
        effect: { type: 'ATK_BONUS', params: { amount: 3 } } }),
    makeRelic({ id: 'ice_shard', rarity: RelicRarity.RARE, trigger: RelicTrigger.ON_ACTION,
        faction: Faction.ICE }),
    makeRelic({ id: 'flame_core', rarity: RelicRarity.RARE, trigger: RelicTrigger.ON_DEAL_DAMAGE,
        faction: Faction.FIRE }),

    // 传说品质
    makeRelic({ id: 'crown_of_kings', rarity: RelicRarity.LEGENDARY, trigger: RelicTrigger.BATTLE_START,
        effect: { type: 'HP_BONUS', params: { amount: 30 } }, floorMin: 5 }),
    makeRelic({ id: 'gambler_dice', rarity: RelicRarity.LEGENDARY, trigger: RelicTrigger.PASSIVE,
        faction: Faction.GAMBLER, floorMin: 3 }),

    // 高层才出现
    makeRelic({ id: 'late_game_shield', rarity: RelicRarity.NORMAL, trigger: RelicTrigger.PASSIVE,
        floorMin: 7 }),
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
        ],
        relics: [],
        factionPool: [Faction.ICE, Faction.FIRE],
        hearts: 5,
        gold: 200,
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
            monstersDefeated: 0, ghostsDefeated: 0,
            cardsObtained: 0, cardsRemoved: 0,
            goldEarned: 0, goldSpent: 0,
            damageDealt: 0, damageTaken: 0,
            highestFloor: 5,
        },
        ...overrides,
    };
}

// ─── 注册表 / 查询 ────────────────────────────────────

describe('RelicManager — 注册表', () => {

    it('正确注册所有遗物', () => {
        const mgr = new RelicManager(TEST_RELICS);
        expect(mgr.size).toBe(TEST_RELICS.length);
    });

    it('getRelicDef 返回正确的定义', () => {
        const mgr = new RelicManager(TEST_RELICS);
        const def = mgr.getRelicDef('iron_kettle');
        expect(def).toBeDefined();
        expect(def!.id).toBe('iron_kettle');
        expect(def!.rarity).toBe(RelicRarity.NORMAL);
    });

    it('getRelicDef 不存在时返回 undefined', () => {
        const mgr = new RelicManager(TEST_RELICS);
        expect(mgr.getRelicDef('nonexistent')).toBeUndefined();
    });

    it('getAllRelics 返回完整列表', () => {
        const mgr = new RelicManager(TEST_RELICS);
        const all = mgr.getAllRelics();
        expect(all.length).toBe(TEST_RELICS.length);
    });

    it('空注册表不报错', () => {
        const mgr = new RelicManager([]);
        expect(mgr.size).toBe(0);
        expect(mgr.getAllRelics()).toEqual([]);
        expect(mgr.getRelicDef('any')).toBeUndefined();
    });
});

// ─── 品质随机 ──────────────────────────────────────────

describe('RelicManager — 品质随机', () => {

    it('rollRarity 只返回三种品质之一', () => {
        const rng = new SeededRandom(42);
        for (let i = 0; i < 100; i++) {
            const r = RelicManager.rollRarity(rng);
            expect([RelicRarity.NORMAL, RelicRarity.RARE, RelicRarity.LEGENDARY]).toContain(r);
        }
    });

    it('品质概率分布正确（普通 ~60% / 稀有 ~30% / 传说 ~10%，±5% 误差）', () => {
        const rng = new SeededRandom(12345);
        const counts: Record<RelicRarity, number> = {
            [RelicRarity.NORMAL]: 0,
            [RelicRarity.RARE]: 0,
            [RelicRarity.LEGENDARY]: 0,
        };
        const total = 10000;

        for (let i = 0; i < total; i++) {
            counts[RelicManager.rollRarity(rng)]++;
        }

        expect(counts[RelicRarity.NORMAL] / total).toBeCloseTo(0.60, 1);
        expect(counts[RelicRarity.RARE] / total).toBeCloseTo(0.30, 1);
        expect(counts[RelicRarity.LEGENDARY] / total).toBeCloseTo(0.10, 1);
    });

    it('种子确定性：相同种子产生相同品质序列', () => {
        const seq1: RelicRarity[] = [];
        const seq2: RelicRarity[] = [];
        for (let i = 0; i < 50; i++) {
            seq1.push(RelicManager.rollRarity(new SeededRandom(999 + i)));
            seq2.push(RelicManager.rollRarity(new SeededRandom(999 + i)));
        }
        expect(seq1).toEqual(seq2);
    });
});

// ─── 过滤 ──────────────────────────────────────────────

describe('RelicManager — 过滤', () => {

    it('排除已拥有的遗物', () => {
        const mgr = new RelicManager(TEST_RELICS);
        const result = mgr.filterAvailable(5, ['iron_kettle', 'ruby_ring']);
        const ids = result.map(r => r.id);
        expect(ids).not.toContain('iron_kettle');
        expect(ids).not.toContain('ruby_ring');
    });

    it('排除不满足 floorMin 的遗物', () => {
        const mgr = new RelicManager(TEST_RELICS);
        const result = mgr.filterAvailable(2, []);
        const ids = result.map(r => r.id);
        expect(ids).not.toContain('crown_of_kings');
        expect(ids).not.toContain('gambler_dice');
        expect(ids).not.toContain('late_game_shield');
    });

    it('按品质下限过滤', () => {
        const mgr = new RelicManager(TEST_RELICS);
        const result = mgr.filterAvailable(10, [], { minRarity: RelicRarity.RARE });
        for (const r of result) {
            expect([RelicRarity.RARE, RelicRarity.LEGENDARY]).toContain(r.rarity);
        }
    });

    it('流派过滤：保留通用遗物（无 faction）+ 指定流派', () => {
        const mgr = new RelicManager(TEST_RELICS);
        const result = mgr.filterAvailable(10, [], { faction: Faction.ICE });
        for (const r of result) {
            if (r.faction !== undefined) {
                expect(r.faction).toBe(Faction.ICE);
            }
        }
    });

    it('全部已拥有或不满足条件时返回空列表', () => {
        const mgr = new RelicManager(TEST_RELICS);
        const allIds = TEST_RELICS.map(r => r.id);
        expect(mgr.filterAvailable(10, allIds)).toEqual([]);
    });
});

// ─── 掉落判定 ──────────────────────────────────────────

describe('RelicManager — 掉落判定', () => {

    it('普通战斗 ~20% 掉落率（±5% 误差）', () => {
        let drops = 0;
        const total = 10000;
        for (let i = 0; i < total; i++) {
            const rng = new SeededRandom(i);
            if (RelicManager.shouldDropRelic(rng, 5, false, false)) drops++;
        }
        expect(drops / total).toBeCloseTo(0.20, 1);
    });

    it('精英战斗 ~25% 掉落率（±5% 误差）', () => {
        let drops = 0;
        const total = 10000;
        for (let i = 0; i < total; i++) {
            const rng = new SeededRandom(i);
            if (RelicManager.shouldDropRelic(rng, 5, true, false)) drops++;
        }
        expect(drops / total).toBeCloseTo(0.25, 1);
    });

    it('高星残影 +10%：普通 → ~30%', () => {
        let drops = 0;
        const total = 10000;
        for (let i = 0; i < total; i++) {
            const rng = new SeededRandom(i);
            if (RelicManager.shouldDropRelic(rng, 5, false, true)) drops++;
        }
        expect(drops / total).toBeCloseTo(0.30, 1);
    });

    it('精英 + 高星残影 → ~35%', () => {
        let drops = 0;
        const total = 10000;
        for (let i = 0; i < total; i++) {
            const rng = new SeededRandom(i);
            if (RelicManager.shouldDropRelic(rng, 5, true, true)) drops++;
        }
        expect(drops / total).toBeCloseTo(0.35, 1);
    });
});

// ─── 奖励生成（三选一）──────────────────────────────────

describe('RelicManager — 奖励生成', () => {

    it('生成指定数量的候选（不超过可用数量）', () => {
        const mgr = new RelicManager(TEST_RELICS);
        const rng = new SeededRandom(42);
        const choices = mgr.generateChoices(5, [], 3, rng);
        expect(choices.length).toBe(3);
    });

    it('候选不重复', () => {
        const mgr = new RelicManager(TEST_RELICS);
        for (let seed = 0; seed < 100; seed++) {
            const rng = new SeededRandom(seed);
            const choices = mgr.generateChoices(5, [], 3, rng);
            const ids = choices.map(r => r.id);
            expect(new Set(ids).size).toBe(ids.length);
        }
    });

    it('不包含已拥有的遗物', () => {
        const mgr = new RelicManager(TEST_RELICS);
        const owned = ['iron_kettle', 'herb_pouch', 'gold_ring'];
        for (let seed = 0; seed < 50; seed++) {
            const rng = new SeededRandom(seed);
            const choices = mgr.generateChoices(5, owned, 3, rng);
            for (const c of choices) {
                expect(owned).not.toContain(c.id);
            }
        }
    });

    it('可用遗物不足时返回全部可用', () => {
        const mgr = new RelicManager(TEST_RELICS);
        const allButTwo = TEST_RELICS.slice(2).map(r => r.id);
        const rng = new SeededRandom(42);
        const choices = mgr.generateChoices(10, allButTwo, 3, rng);
        expect(choices.length).toBeLessThanOrEqual(2);
    });

    it('无可用遗物时返回空列表', () => {
        const mgr = new RelicManager(TEST_RELICS);
        const allIds = TEST_RELICS.map(r => r.id);
        const rng = new SeededRandom(42);
        expect(mgr.generateChoices(10, allIds, 3, rng)).toEqual([]);
    });

    it('品质分布趋向权重（大量抽样）', () => {
        const mgr = new RelicManager(TEST_RELICS);
        const counts: Record<RelicRarity, number> = {
            [RelicRarity.NORMAL]: 0,
            [RelicRarity.RARE]: 0,
            [RelicRarity.LEGENDARY]: 0,
        };
        const total = 3000;

        for (let seed = 0; seed < total; seed++) {
            const rng = new SeededRandom(seed);
            const choices = mgr.generateChoices(10, [], 1, rng);
            if (choices.length > 0) counts[choices[0].rarity]++;
        }

        const sum = counts[RelicRarity.NORMAL] + counts[RelicRarity.RARE] + counts[RelicRarity.LEGENDARY];
        expect(counts[RelicRarity.NORMAL] / sum).toBeGreaterThan(0.4);
        expect(counts[RelicRarity.RARE] / sum).toBeGreaterThan(0.15);
        expect(counts[RelicRarity.LEGENDARY] / sum).toBeGreaterThan(0.02);
    });

    it('种子确定性', () => {
        const mgr = new RelicManager(TEST_RELICS);
        const c1 = mgr.generateChoices(5, [], 3, new SeededRandom(777));
        const c2 = mgr.generateChoices(5, [], 3, new SeededRandom(777));
        expect(c1.map(r => r.id)).toEqual(c2.map(r => r.id));
    });
});

// ─── 获取与去重 ────────────────────────────────────────

describe('RelicManager — 获取与去重', () => {

    it('首次获取成功', () => {
        const run = createRunState();
        expect(RelicManager.acquireRelic(run, 'iron_kettle')).toBe(true);
        expect(run.relics).toContain('iron_kettle');
    });

    it('重复获取被拒绝', () => {
        const run = createRunState({ relics: ['iron_kettle'] });
        expect(RelicManager.acquireRelic(run, 'iron_kettle')).toBe(false);
        expect(run.relics.filter(r => r === 'iron_kettle').length).toBe(1);
    });

    it('持有无上限', () => {
        const run = createRunState();
        for (const r of TEST_RELICS) {
            RelicManager.acquireRelic(run, r.id);
        }
        expect(run.relics.length).toBe(TEST_RELICS.length);
    });

    it('isOwned 正确判断', () => {
        const run = createRunState({ relics: ['iron_kettle'] });
        expect(RelicManager.isOwned(run, 'iron_kettle')).toBe(true);
        expect(RelicManager.isOwned(run, 'ruby_ring')).toBe(false);
    });
});

// ─── 非战斗触发 ────────────────────────────────────────

describe('RelicManager — ON_ENTER_SHOP 触发', () => {

    it('触发 HEAL_HP 效果：恢复 HP', () => {
        const mgr = new RelicManager(TEST_RELICS);
        const run = createRunState({ currentHp: 100, relics: ['herb_pouch'] });

        const results = mgr.triggerOnEnterShop(run);

        expect(results.length).toBe(1);
        expect(results[0].relicId).toBe('herb_pouch');
        expect(results[0].applied).toBe(true);
        expect(run.currentHp).toBe(110);
    });

    it('触发 GAIN_GOLD 效果：获得金币', () => {
        const mgr = new RelicManager(TEST_RELICS);
        const run = createRunState({ gold: 50, relics: ['gold_ring'] });

        mgr.triggerOnEnterShop(run);

        expect(run.gold).toBe(65);
        expect(run.stats.goldEarned).toBe(15);
    });

    it('触发 CardEffect 格式的回复效果', () => {
        const mgr = new RelicManager(TEST_RELICS);
        const run = createRunState({ currentHp: 150, relics: ['ruby_ring'] });

        const results = mgr.triggerOnEnterShop(run);

        expect(results.length).toBe(1);
        expect(results[0].applied).toBe(true);
        expect(run.currentHp).toBe(170);
    });

    it('HP 不超过最大值', () => {
        const mgr = new RelicManager(TEST_RELICS);
        const run = createRunState({ currentHp: 175, maxHp: 180, relics: ['herb_pouch'] });

        mgr.triggerOnEnterShop(run);

        expect(run.currentHp).toBe(180);
    });

    it('HP 已满时 applied=false', () => {
        const mgr = new RelicManager(TEST_RELICS);
        const run = createRunState({ currentHp: 180, maxHp: 180, relics: ['herb_pouch'] });

        const results = mgr.triggerOnEnterShop(run);

        expect(results[0].applied).toBe(false);
    });

    it('多个 ON_ENTER_SHOP 遗物按获取顺序依次触发', () => {
        const mgr = new RelicManager(TEST_RELICS);
        const run = createRunState({
            currentHp: 100, gold: 50,
            relics: ['herb_pouch', 'gold_ring', 'ruby_ring'],
        });

        const results = mgr.triggerOnEnterShop(run);

        expect(results.length).toBe(3);
        expect(results[0].relicId).toBe('herb_pouch');
        expect(results[1].relicId).toBe('gold_ring');
        expect(results[2].relicId).toBe('ruby_ring');
        expect(run.currentHp).toBe(130);
        expect(run.gold).toBe(65);
    });

    it('不持有 ON_ENTER_SHOP 遗物时返回空', () => {
        const mgr = new RelicManager(TEST_RELICS);
        const run = createRunState({ relics: ['iron_kettle', 'leather_belt'] });

        const results = mgr.triggerOnEnterShop(run);

        expect(results).toEqual([]);
    });
});

// ─── 战斗触发支持 ──────────────────────────────────────

describe('RelicManager — 战斗触发支持', () => {

    it('按触发时机正确查询持有遗物', () => {
        const mgr = new RelicManager(TEST_RELICS);
        const owned = ['iron_kettle', 'war_drum', 'herb_pouch', 'leather_belt'];

        const battleStart = mgr.getRelicsByTrigger(owned, RelicTrigger.BATTLE_START);
        expect(battleStart.map(r => r.id)).toEqual(['iron_kettle', 'war_drum']);

        const shop = mgr.getRelicsByTrigger(owned, RelicTrigger.ON_ENTER_SHOP);
        expect(shop.map(r => r.id)).toEqual(['herb_pouch']);

        const passive = mgr.getRelicsByTrigger(owned, RelicTrigger.PASSIVE);
        expect(passive.map(r => r.id)).toEqual(['leather_belt']);
    });

    it('未持有对应触发的遗物时返回空列表', () => {
        const mgr = new RelicManager(TEST_RELICS);
        const result = mgr.getRelicsByTrigger(['leather_belt'], RelicTrigger.BATTLE_START);
        expect(result).toEqual([]);
    });

    it('遗物 ID 不在注册表中时跳过', () => {
        const mgr = new RelicManager(TEST_RELICS);
        const result = mgr.getRelicsByTrigger(['nonexistent', 'iron_kettle'], RelicTrigger.BATTLE_START);
        expect(result.length).toBe(1);
        expect(result[0].id).toBe('iron_kettle');
    });

    it('保持获取顺序', () => {
        const mgr = new RelicManager(TEST_RELICS);
        const owned = ['war_drum', 'iron_kettle'];
        const result = mgr.getRelicsByTrigger(owned, RelicTrigger.BATTLE_START);
        expect(result[0].id).toBe('war_drum');
        expect(result[1].id).toBe('iron_kettle');
    });
});

// ─── BATTLE_END 非战斗触发 ──────────────────────────────

describe('RelicManager — BATTLE_END 触发', () => {

    it('无 BATTLE_END 遗物时返回空', () => {
        const mgr = new RelicManager(TEST_RELICS);
        const run = createRunState({ relics: ['iron_kettle'] });

        const results = mgr.triggerOnBattleEnd(run);
        expect(results).toEqual([]);
    });

    it('BATTLE_END 遗物正确触发', () => {
        const healAfterBattle = makeRelic({
            id: 'heal_after_battle',
            trigger: RelicTrigger.BATTLE_END,
            effect: { type: 'HEAL_HP', params: { amount: 5 } },
        });
        const mgr = new RelicManager([...TEST_RELICS, healAfterBattle]);
        const run = createRunState({ currentHp: 100, relics: ['heal_after_battle'] });

        const results = mgr.triggerOnBattleEnd(run);

        expect(results.length).toBe(1);
        expect(results[0].applied).toBe(true);
        expect(run.currentHp).toBe(105);
    });
});

// ─── 综合场景 ──────────────────────────────────────────

describe('RelicManager — 综合场景', () => {

    it('完整流程：获取 → 进入商店触发 → 战斗掉落 → 三选一', () => {
        const mgr = new RelicManager(TEST_RELICS);
        const run = createRunState({ currentHp: 100, gold: 50 });

        RelicManager.acquireRelic(run, 'herb_pouch');
        RelicManager.acquireRelic(run, 'gold_ring');
        expect(run.relics.length).toBe(2);

        mgr.triggerOnEnterShop(run);
        expect(run.currentHp).toBe(110);
        expect(run.gold).toBe(65);

        const rng = new SeededRandom(42);
        const shouldDrop = RelicManager.shouldDropRelic(rng, 5, false, false);

        if (shouldDrop) {
            const choices = mgr.generateChoices(5, run.relics, 3, new SeededRandom(99));
            expect(choices.length).toBeGreaterThan(0);
            for (const c of choices) {
                expect(c.id).not.toBe('herb_pouch');
                expect(c.id).not.toBe('gold_ring');
            }
            RelicManager.acquireRelic(run, choices[0].id);
            expect(run.relics.length).toBe(3);
        }
    });

    it('与 BattleInitializer 接口兼容（RelicDefLookup）', () => {
        const mgr = new RelicManager(TEST_RELICS);
        const lookup: { getRelicDef(id: string): RelicDef | undefined } = mgr;
        expect(lookup.getRelicDef('iron_kettle')).toBeDefined();
        expect(lookup.getRelicDef('nonexistent')).toBeUndefined();
    });

    it('大量获取遗物无上限', () => {
        const manyRelics: RelicDef[] = [];
        for (let i = 0; i < 100; i++) {
            manyRelics.push(makeRelic({ id: `relic_${i}` }));
        }
        const run = createRunState();
        for (const r of manyRelics) {
            RelicManager.acquireRelic(run, r.id);
        }
        expect(run.relics.length).toBe(100);
    });
});
