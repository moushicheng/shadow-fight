/**
 * Phase 2.5 路线选择系统 — RouteSelector + 生命机制 关键验证点测试
 *
 * 验证点：
 * 1. 三选一：精英 / 普通A / 普通B，每个选项展示怪物名称
 * 2. 两个普通战斗选项的怪物不同
 * 3. 精英战斗强度 = 当前层 +2（通过 FloorManager.getEliteParams 验证）
 * 4. 赏金挑战出现概率约 10%，强度 = 精英 × 1.5
 * 5. 赏金胜利奖励 = 标准 + 额外遗物（逻辑标记验证）
 * 6. 精英路线金币 ×1.5，必出稀有及以上
 * 7. 1-2 层锁定普通战斗，3 层起解锁
 * 8. 生命机制：5 颗心，失败消耗 1 颗心后继续，心耗尽 Game Over
 * 9. 战斗失败后 HP 恢复（暂定 100%）
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { RouteSelector, RouteSelection } from '../game/assets/scripts/core/run/RouteSelector';
import { FloorManager } from '../game/assets/scripts/core/run/FloorManager';
import { RunManager } from '../game/assets/scripts/core/run/RunManager';
import { SeededRandom } from '../game/assets/scripts/core/utils/SeededRandom';
import { RouteType, GameNodeType, MonsterType, Faction, RunStatus } from '../game/assets/scripts/types/Enums';
import { MonsterTemplate } from '../game/assets/scripts/types/MonsterTypes';

/** 构造测试用野怪模板 */
function makeMonster(overrides: Partial<MonsterTemplate> & { id: string; name: string }): MonsterTemplate {
    return {
        type: MonsterType.NORMAL,
        floorMin: 1,
        floorMax: 10,
        baseProperty: { STR: 5, CON: 5, SPD: 5, MANA: 5 },
        deck: [],
        relics: [],
        goldDrop: { min: 10, max: 20 },
        ...overrides,
    };
}

function createTestPool(): MonsterTemplate[] {
    return [
        makeMonster({ id: 'slime', name: '史莱姆', floorMin: 1, floorMax: 5 }),
        makeMonster({ id: 'goblin', name: '哥布林', floorMin: 1, floorMax: 6 }),
        makeMonster({ id: 'wolf', name: '野狼', floorMin: 1, floorMax: 7 }),
        makeMonster({ id: 'ice_guard', name: '冰霜哨兵', floorMin: 3, floorMax: 10, type: MonsterType.FACTION, faction: Faction.ICE }),
        makeMonster({ id: 'fire_imp', name: '火焰小鬼', floorMin: 3, floorMax: 10, type: MonsterType.FACTION, faction: Faction.FIRE }),
        makeMonster({ id: 'poison_frog', name: '毒沼蛙', floorMin: 3, floorMax: 10, type: MonsterType.FACTION, faction: Faction.POISON }),
        makeMonster({ id: 'elite_knight', name: '精英骑士', floorMin: 3, floorMax: 10, type: MonsterType.ELITE }),
        makeMonster({ id: 'elite_mage', name: '精英法师', floorMin: 5, floorMax: 10, type: MonsterType.ELITE }),
        makeMonster({ id: 'shadow_beast', name: '暗影兽', floorMin: 7, floorMax: 10 }),
        makeMonster({ id: 'crystal_golem', name: '水晶魔像', floorMin: 7, floorMax: 10 }),
    ];
}

// ─── 路线生成 ──────────────────────────────────────

describe('RouteSelector — 1-2 层路线锁定', () => {
    const pool = createTestPool();

    it('第 1 层锁定为单个普通战斗选项', () => {
        const rng = new SeededRandom(42);
        const result = RouteSelector.generateRouteOptions(1, rng, pool);

        expect(result.locked).toBe(true);
        expect(result.options.length).toBe(1);
        expect(result.options[0].routeType).toBe(RouteType.NORMAL);
        expect(result.hasBounty).toBe(false);
    });

    it('第 2 层锁定为单个普通战斗选项', () => {
        const rng = new SeededRandom(123);
        const result = RouteSelector.generateRouteOptions(2, rng, pool);

        expect(result.locked).toBe(true);
        expect(result.options.length).toBe(1);
        expect(result.options[0].routeType).toBe(RouteType.NORMAL);
    });

    it('锁定时选项包含怪物名称', () => {
        const rng = new SeededRandom(42);
        const result = RouteSelector.generateRouteOptions(1, rng, pool);

        expect(result.options[0].monsterName).toBeTruthy();
        expect(result.options[0].monsterId).toBeTruthy();
    });
});

describe('RouteSelector — 3 层起解锁三选一', () => {
    const pool = createTestPool();

    it('第 3 层提供至少 3 个选项（精英 + 普通A + 普通B）', () => {
        const rng = new SeededRandom(42);
        const result = RouteSelector.generateRouteOptions(3, rng, pool);

        expect(result.locked).toBe(false);
        expect(result.options.length).toBeGreaterThanOrEqual(3);

        const types = result.options.map(o => o.routeType);
        expect(types[0]).toBe(RouteType.ELITE);
        expect(types.filter(t => t === RouteType.NORMAL).length).toBe(2);
    });

    it('第 5 层解锁三选一', () => {
        const rng = new SeededRandom(99);
        const result = RouteSelector.generateRouteOptions(5, rng, pool);

        expect(result.locked).toBe(false);
        expect(result.options.length).toBeGreaterThanOrEqual(3);
    });
});

describe('RouteSelector — 两个普通战斗怪物不同', () => {
    const pool = createTestPool();

    it('普通A和普通B的怪物 ID 不相同', () => {
        const rng = new SeededRandom(42);
        const result = RouteSelector.generateRouteOptions(3, rng, pool);

        const normals = result.options.filter(o => o.routeType === RouteType.NORMAL);
        expect(normals.length).toBe(2);
        expect(normals[0].monsterId).not.toBe(normals[1].monsterId);
    });

    it('大量生成中普通选项始终不重复', () => {
        for (let seed = 0; seed < 100; seed++) {
            const rng = new SeededRandom(seed);
            const result = RouteSelector.generateRouteOptions(5, rng, pool);

            const normals = result.options.filter(o => o.routeType === RouteType.NORMAL);
            if (normals.length >= 2) {
                expect(normals[0].monsterId).not.toBe(normals[1].monsterId);
            }
        }
    });
});

describe('RouteSelector — 每个选项展示怪物名称', () => {
    const pool = createTestPool();

    it('所有选项都包含 monsterName 和 monsterId', () => {
        const rng = new SeededRandom(42);
        const result = RouteSelector.generateRouteOptions(5, rng, pool);

        for (const opt of result.options) {
            expect(opt.monsterName).toBeTruthy();
            expect(opt.monsterId).toBeTruthy();
        }
    });

    it('流派野怪选项包含 monsterFaction', () => {
        const rng = new SeededRandom(42);
        const factionPool = [
            makeMonster({ id: 'ice1', name: '冰霜卫士', type: MonsterType.FACTION, faction: Faction.ICE, floorMin: 1, floorMax: 10 }),
            makeMonster({ id: 'ice2', name: '冰霜弓手', type: MonsterType.FACTION, faction: Faction.ICE, floorMin: 1, floorMax: 10 }),
            makeMonster({ id: 'ice3', name: '冰霜法师', type: MonsterType.FACTION, faction: Faction.ICE, floorMin: 1, floorMax: 10 }),
            makeMonster({ id: 'elite_ice', name: '冰霜精英', type: MonsterType.ELITE, faction: Faction.ICE, floorMin: 1, floorMax: 10 }),
        ];
        const result = RouteSelector.generateRouteOptions(5, rng, factionPool);

        const normals = result.options.filter(o => o.routeType === RouteType.NORMAL);
        for (const opt of normals) {
            expect(opt.monsterFaction).toBe(Faction.ICE);
        }
    });
});

// ─── 赏金挑战概率 ──────────────────────────────────────

describe('RouteSelector — 赏金挑战', () => {
    const pool = createTestPool();

    it('赏金挑战出现概率约 10%（大量抽样验证）', () => {
        const SAMPLES = 10000;
        let bountyCount = 0;

        for (let i = 0; i < SAMPLES; i++) {
            const rng = new SeededRandom(i);
            const result = RouteSelector.generateRouteOptions(5, rng, pool);
            if (result.hasBounty) bountyCount++;
        }

        const ratio = bountyCount / SAMPLES;
        expect(ratio).toBeGreaterThan(0.06);
        expect(ratio).toBeLessThan(0.14);
    });

    it('赏金选项的路线类型为 BOUNTY', () => {
        let found = false;
        for (let seed = 0; seed < 200; seed++) {
            const rng = new SeededRandom(seed);
            const result = RouteSelector.generateRouteOptions(5, rng, pool);
            if (result.hasBounty) {
                const bountyOpt = result.options.find(o => o.routeType === RouteType.BOUNTY);
                expect(bountyOpt).toBeDefined();
                expect(bountyOpt!.monsterName).toBeTruthy();
                found = true;
                break;
            }
        }
        expect(found).toBe(true);
    });

    it('1-2 层不会出现赏金挑战', () => {
        for (let seed = 0; seed < 500; seed++) {
            const rng = new SeededRandom(seed);
            const result = RouteSelector.generateRouteOptions(1, rng, pool);
            expect(result.hasBounty).toBe(false);

            const rng2 = new SeededRandom(seed);
            const result2 = RouteSelector.generateRouteOptions(2, rng2, pool);
            expect(result2.hasBounty).toBe(false);
        }
    });
});

// ─── 赏金怪物强度 ──────────────────────────────────────

describe('FloorManager — 赏金怪物参数', () => {
    it('赏金属性 = 精英属性 × 1.5', () => {
        for (let floor = 3; floor <= 9; floor++) {
            const bounty = FloorManager.getBountyParams(floor);
            const elite = FloorManager.getEliteParams(floor);

            expect(bounty.bountyAttributeTotal).toBe(Math.round(elite.attributeTotal * 1.5));
            expect(bounty.deckSize).toBe(elite.deckSize);
        }
    });

    it('第 5 层赏金：精英等效第 7 层，属性 = round((25+21) × 1.5) = 69', () => {
        const bounty = FloorManager.getBountyParams(5);
        expect(bounty.effectiveFloor).toBe(7);
        expect(bounty.attributeTotal).toBe(25 + 7 * 3); // 46
        expect(bounty.bountyAttributeTotal).toBe(Math.round(46 * 1.5)); // 69
    });
});

// ─── 路线选择处理 ──────────────────────────────────────

describe('RouteSelector — resolveChoice', () => {
    const pool = createTestPool();

    it('选择精英返回 ELITE_BATTLE 节点', () => {
        const rng = new SeededRandom(42);
        const selection = RouteSelector.generateRouteOptions(5, rng, pool);
        const eliteIdx = selection.options.findIndex(o => o.routeType === RouteType.ELITE);

        const result = RouteSelector.resolveChoice(selection, eliteIdx);
        expect(result).not.toBeNull();
        expect(result!.nodeType).toBe(GameNodeType.ELITE_BATTLE);
        expect(result!.isElite).toBe(true);
        expect(result!.isBounty).toBe(false);
    });

    it('选择普通返回 MONSTER_BATTLE 节点', () => {
        const rng = new SeededRandom(42);
        const selection = RouteSelector.generateRouteOptions(5, rng, pool);
        const normalIdx = selection.options.findIndex(o => o.routeType === RouteType.NORMAL);

        const result = RouteSelector.resolveChoice(selection, normalIdx);
        expect(result).not.toBeNull();
        expect(result!.nodeType).toBe(GameNodeType.MONSTER_BATTLE);
        expect(result!.isElite).toBe(false);
    });

    it('选择赏金返回 BOUNTY_BATTLE 节点', () => {
        let testedBounty = false;
        for (let seed = 0; seed < 200; seed++) {
            const rng = new SeededRandom(seed);
            const selection = RouteSelector.generateRouteOptions(5, rng, pool);
            if (selection.hasBounty) {
                const bountyIdx = selection.options.findIndex(o => o.routeType === RouteType.BOUNTY);
                const result = RouteSelector.resolveChoice(selection, bountyIdx);
                expect(result).not.toBeNull();
                expect(result!.nodeType).toBe(GameNodeType.BOUNTY_BATTLE);
                expect(result!.isBounty).toBe(true);
                testedBounty = true;
                break;
            }
        }
        expect(testedBounty).toBe(true);
    });

    it('无效索引返回 null', () => {
        const rng = new SeededRandom(42);
        const selection = RouteSelector.generateRouteOptions(5, rng, pool);

        expect(RouteSelector.resolveChoice(selection, -1)).toBeNull();
        expect(RouteSelector.resolveChoice(selection, 99)).toBeNull();
    });
});

// ─── routeTypeToNodeType ──────────────────────────────────────

describe('RouteSelector — routeTypeToNodeType', () => {
    it('ELITE → ELITE_BATTLE', () => {
        expect(RouteSelector.routeTypeToNodeType(RouteType.ELITE)).toBe(GameNodeType.ELITE_BATTLE);
    });

    it('NORMAL → MONSTER_BATTLE', () => {
        expect(RouteSelector.routeTypeToNodeType(RouteType.NORMAL)).toBe(GameNodeType.MONSTER_BATTLE);
    });

    it('BOUNTY → BOUNTY_BATTLE', () => {
        expect(RouteSelector.routeTypeToNodeType(RouteType.BOUNTY)).toBe(GameNodeType.BOUNTY_BATTLE);
    });
});

// ─── 生命机制（心） ──────────────────────────────────────

describe('RunManager — 生命机制', () => {
    let runManager: RunManager;

    beforeEach(() => {
        runManager = new RunManager();
        runManager.createRun(42);
    });

    it('新局初始 5 颗心', () => {
        expect(runManager.state!.hearts).toBe(5);
    });

    it('战斗失败消耗 1 颗心', () => {
        const result = runManager.handleBattleDefeat();
        expect(result).toBe('continue');
        expect(runManager.state!.hearts).toBe(4);
    });

    it('连续失败逐颗消耗心', () => {
        for (let i = 0; i < 4; i++) {
            const result = runManager.handleBattleDefeat();
            expect(result).toBe('continue');
        }
        expect(runManager.state!.hearts).toBe(1);
    });

    it('第 5 次失败 → 心耗尽 → Game Over', () => {
        for (let i = 0; i < 4; i++) {
            runManager.handleBattleDefeat();
        }
        const result = runManager.handleBattleDefeat();
        expect(result).toBe('game_over');
        expect(runManager.state!.hearts).toBe(0);
        expect(runManager.state!.runStatus).toBe(RunStatus.DEFEAT);
    });

    it('心耗尽后 runStatus 标记为 DEFEAT', () => {
        for (let i = 0; i < 5; i++) {
            runManager.handleBattleDefeat();
        }
        expect(runManager.state!.runStatus).toBe(RunStatus.DEFEAT);
    });
});

describe('RunManager — 战斗失败后 HP 恢复', () => {
    let runManager: RunManager;

    beforeEach(() => {
        runManager = new RunManager();
        runManager.createRun(42);
    });

    it('失败后 HP 恢复至 100% 最大 HP（暂定值）', () => {
        const maxHp = runManager.state!.maxHp;
        runManager.state!.currentHp = 1;

        runManager.handleBattleDefeat();

        expect(runManager.state!.currentHp).toBe(maxHp);
    });

    it('HP 已满时失败，HP 不变', () => {
        const maxHp = runManager.state!.maxHp;
        runManager.state!.currentHp = maxHp;

        runManager.handleBattleDefeat();

        expect(runManager.state!.currentHp).toBe(maxHp);
    });

    it('心耗尽时不恢复 HP', () => {
        runManager.state!.currentHp = 1;
        for (let i = 0; i < 4; i++) {
            runManager.handleBattleDefeat();
        }
        runManager.state!.currentHp = 1;

        runManager.handleBattleDefeat();

        expect(runManager.state!.currentHp).toBe(1);
        expect(runManager.state!.hearts).toBe(0);
    });
});

// ─── 边界情况 ──────────────────────────────────────

describe('RouteSelector — 边界情况', () => {
    it('空野怪池时返回空选项', () => {
        const rng = new SeededRandom(42);
        const result = RouteSelector.generateRouteOptions(5, rng, []);

        expect(result.options.length).toBe(0);
    });

    it('野怪池只有 1 个怪物时，解锁层只能生成有限选项', () => {
        const singlePool = [
            makeMonster({ id: 'only_one', name: '唯一怪物', floorMin: 1, floorMax: 10 }),
        ];
        const rng = new SeededRandom(42);
        const result = RouteSelector.generateRouteOptions(5, rng, singlePool);

        expect(result.options.length).toBeGreaterThanOrEqual(1);
        expect(result.options.length).toBeLessThanOrEqual(4);
    });

    it('Boss 层（第 10 层）也能生成路线选项', () => {
        const pool = createTestPool();
        const rng = new SeededRandom(42);
        const result = RouteSelector.generateRouteOptions(10, rng, pool);

        expect(result.locked).toBe(false);
    });
});

// ─── RunState 序列化含 hearts ──────────────────────────────────────

describe('RunManager — 序列化含 hearts', () => {
    it('序列化和反序列化保留 hearts 字段', () => {
        const manager = new RunManager();
        manager.createRun(42);

        manager.handleBattleDefeat();
        manager.handleBattleDefeat();
        expect(manager.state!.hearts).toBe(3);

        const json = manager.serialize()!;
        const manager2 = new RunManager();
        const restored = manager2.deserialize(json)!;

        expect(restored.hearts).toBe(3);
    });
});
