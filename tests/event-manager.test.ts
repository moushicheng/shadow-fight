/**
 * Phase 2.4 事件系统框架 — EventManager 关键验证点测试
 *
 * 验证点：
 * 1. 按层数概率抽取事件类别
 * 2. 事件过滤（层数范围、类别、去重）
 * 3. 事件效果正确执行：HP 回复/扣除、金币增减、属性修改、卡牌移除、升级
 * 4. 概率型效果（probability + fallback）
 * 5. 属性永久 -1 应修改 RunState 基础属性
 * 6. CON 修改后 maxHp 同步更新
 */
import { describe, it, expect } from 'vitest';
import { EventManager } from '../game/assets/scripts/core/event/EventManager';
import { GameEventDef, EventOption, EventEffectType } from '../game/assets/scripts/types/EventTypes';
import { EventCategory, Attribute, RunStatus, TempBuffType } from '../game/assets/scripts/types/Enums';
import { RunState } from '../game/assets/scripts/types/RunTypes';
import { SeededRandom } from '../game/assets/scripts/core/utils/SeededRandom';

function makeRunState(overrides: Partial<RunState> = {}): RunState {
    return {
        seed: 42,
        baseProperty: { STR: 10, CON: 10, SPD: 10, MANA: 10 },
        currentHp: 180,
        maxHp: 180, // CON 10 × 15 + 30 = 180
        deck: [],
        relics: [],
        factionPool: [],
        gold: 100,
        currentFloor: 1,
        currentCycle: 1,
        currentNode: 'event' as any,
        nodeIndex: 0,
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
            highestFloor: 1,
        },
        ...overrides,
    };
}

function makeSampleEvents(): GameEventDef[] {
    return [
        {
            id: 'hot_spring',
            name: '温泉休憩',
            description: '你发现了一处温泉...',
            category: EventCategory.POSITIVE,
            floorMin: 1,
            floorMax: 9,
            options: [{
                text: '泡温泉',
                effects: [{ type: EventEffectType.HEAL_HP_PERCENT, value: 0.3 }],
            }],
        },
        {
            id: 'gold_chest',
            name: '金币宝箱',
            description: '路边有一个宝箱...',
            category: EventCategory.POSITIVE,
            floorMin: 1,
            floorMax: 9,
            options: [{
                text: '打开宝箱',
                effects: [{ type: EventEffectType.GAIN_GOLD, value: 50 }],
            }],
        },
        {
            id: 'gambler_dice',
            name: '赌徒的骰子',
            description: '一个神秘赌徒出现...',
            category: EventCategory.NEUTRAL,
            floorMin: 1,
            floorMax: 9,
            options: [{
                text: '掷骰子',
                effects: [{
                    type: EventEffectType.GAIN_GOLD,
                    value: 60,
                    probability: 0.5,
                    fallback: { type: EventEffectType.LOSE_GOLD, value: 30 },
                }],
            }, {
                text: '离开',
                effects: [],
            }],
        },
        {
            id: 'cursed_land',
            name: '诅咒之地',
            description: '你踏入了一片诅咒之地...',
            category: EventCategory.NEGATIVE,
            floorMin: 1,
            floorMax: 9,
            options: [{
                text: '硬闯',
                effects: [{
                    type: EventEffectType.MODIFY_ATTRIBUTE,
                    value: -1,
                    params: { attribute: 'STR' },
                }],
            }],
        },
        {
            id: 'deep_curse',
            name: '深渊诅咒',
            description: '深层才会出现...',
            category: EventCategory.NEGATIVE,
            floorMin: 5,
            floorMax: 9,
            options: [{
                text: '承受',
                effects: [{
                    type: EventEffectType.DAMAGE_HP,
                    value: 30,
                }],
            }],
        },
        {
            id: 'training_ground',
            name: '训练场',
            description: '你找到了一个训练场...',
            category: EventCategory.NEUTRAL,
            floorMin: 1,
            floorMax: 9,
            options: [{
                text: '训练',
                effects: [{
                    type: EventEffectType.MODIFY_ATTRIBUTE,
                    value: 1,
                    params: { attribute: 'SPD' },
                }],
            }],
        },
    ];
}

describe('EventManager — 事件注册与池管理', () => {
    it('注册事件后池大小正确', () => {
        const mgr = new EventManager();
        mgr.registerEvents(makeSampleEvents());
        expect(mgr.poolSize).toBe(6);
    });

    it('清空后池为空', () => {
        const mgr = new EventManager();
        mgr.registerEvents(makeSampleEvents());
        mgr.clear();
        expect(mgr.poolSize).toBe(0);
        expect(mgr.usedCount).toBe(0);
    });
});

describe('EventManager — 事件抽取', () => {
    it('抽取的事件在层数范围内', () => {
        const mgr = new EventManager();
        mgr.registerEvents(makeSampleEvents());
        const rng = new SeededRandom(42);

        for (let i = 0; i < 20; i++) {
            mgr.resetUsedEvents();
            const evt = mgr.drawEvent(1, rng);
            expect(evt).not.toBeNull();
            expect(evt!.floorMin).toBeLessThanOrEqual(1);
            expect(evt!.floorMax).toBeGreaterThanOrEqual(1);
        }
    });

    it('深层事件不会在浅层出现', () => {
        const mgr = new EventManager();
        mgr.registerEvents(makeSampleEvents());
        const rng = new SeededRandom(42);

        for (let i = 0; i < 50; i++) {
            mgr.resetUsedEvents();
            const evt = mgr.drawEvent(2, rng);
            if (evt) {
                expect(evt.id).not.toBe('deep_curse');
            }
        }
    });

    it('已使用事件不会再次被抽到', () => {
        const mgr = new EventManager();
        mgr.registerEvents(makeSampleEvents());
        const rng = new SeededRandom(42);

        const used = new Set<string>();
        for (let i = 0; i < 10; i++) {
            const evt = mgr.drawEvent(3, rng);
            if (!evt) break;
            expect(used.has(evt.id)).toBe(false);
            used.add(evt.id);
        }
    });

    it('事件池耗尽后返回 null', () => {
        const mgr = new EventManager();
        mgr.registerEvents([makeSampleEvents()[0]]);
        const rng = new SeededRandom(42);

        const first = mgr.drawEvent(1, rng);
        expect(first).not.toBeNull();

        const second = mgr.drawEvent(1, rng);
        expect(second).toBeNull();
    });

    it('resetUsedEvents 后可以重新抽取', () => {
        const mgr = new EventManager();
        mgr.registerEvents([makeSampleEvents()[0]]);
        const rng = new SeededRandom(42);

        mgr.drawEvent(1, rng);
        mgr.resetUsedEvents();
        const evt = mgr.drawEvent(1, rng);
        expect(evt).not.toBeNull();
    });
});

describe('EventManager — 效果执行：HP', () => {
    it('HEAL_HP 回复固定 HP（不超上限）', () => {
        const mgr = new EventManager();
        const state = makeRunState({ currentHp: 100, maxHp: 180 });
        const rng = new SeededRandom(42);

        const evt: GameEventDef = {
            id: 'test_heal',
            name: '测试回复',
            description: '',
            category: EventCategory.POSITIVE,
            floorMin: 1, floorMax: 10,
            options: [{
                text: '回复',
                effects: [{ type: EventEffectType.HEAL_HP, value: 50 }],
            }],
        };

        const result = mgr.executeEvent(evt, 0, state, rng);
        expect(state.currentHp).toBe(150);
        expect(result.stepLogs[0].effectLogs[0].applied).toBe(true);
        expect(result.stepLogs[0].effectLogs[0].delta).toBe(50);
    });

    it('HEAL_HP_PERCENT 回复百分比 HP', () => {
        const mgr = new EventManager();
        const state = makeRunState({ currentHp: 100, maxHp: 180 });
        const rng = new SeededRandom(42);

        const evt: GameEventDef = {
            id: 'test',
            name: '测试',
            description: '',
            category: EventCategory.POSITIVE,
            floorMin: 1, floorMax: 10,
            options: [{
                text: '回复',
                effects: [{ type: EventEffectType.HEAL_HP_PERCENT, value: 0.3 }],
            }],
        };

        mgr.executeEvent(evt, 0, state, rng);
        // 180 × 0.3 = 54，100 + 54 = 154
        expect(state.currentHp).toBe(154);
    });

    it('DAMAGE_HP 扣除 HP（不低于 1）', () => {
        const mgr = new EventManager();
        const state = makeRunState({ currentHp: 20, maxHp: 180 });
        const rng = new SeededRandom(42);

        const evt: GameEventDef = {
            id: 'test',
            name: '测试',
            description: '',
            category: EventCategory.NEGATIVE,
            floorMin: 1, floorMax: 10,
            options: [{
                text: '受伤',
                effects: [{ type: EventEffectType.DAMAGE_HP, value: 50 }],
            }],
        };

        mgr.executeEvent(evt, 0, state, rng);
        expect(state.currentHp).toBe(1);
    });
});

describe('EventManager — 效果执行：金币', () => {
    it('GAIN_GOLD 获得金币并计入统计', () => {
        const mgr = new EventManager();
        const state = makeRunState({ gold: 100 });
        const rng = new SeededRandom(42);

        const evt: GameEventDef = {
            id: 'test',
            name: '测试',
            description: '',
            category: EventCategory.POSITIVE,
            floorMin: 1, floorMax: 10,
            options: [{
                text: '获得',
                effects: [{ type: EventEffectType.GAIN_GOLD, value: 60 }],
            }],
        };

        mgr.executeEvent(evt, 0, state, rng);
        expect(state.gold).toBe(160);
        expect(state.stats.goldEarned).toBe(60);
    });

    it('LOSE_GOLD 不会扣到负数', () => {
        const mgr = new EventManager();
        const state = makeRunState({ gold: 20 });
        const rng = new SeededRandom(42);

        const evt: GameEventDef = {
            id: 'test',
            name: '测试',
            description: '',
            category: EventCategory.NEGATIVE,
            floorMin: 1, floorMax: 10,
            options: [{
                text: '失去',
                effects: [{ type: EventEffectType.LOSE_GOLD, value: 50 }],
            }],
        };

        mgr.executeEvent(evt, 0, state, rng);
        expect(state.gold).toBe(0);
        expect(state.stats.goldSpent).toBe(20);
    });
});

describe('EventManager — 效果执行：属性修改', () => {
    it('MODIFY_ATTRIBUTE 永久修改基础属性', () => {
        const mgr = new EventManager();
        const state = makeRunState();
        const rng = new SeededRandom(42);

        const evt: GameEventDef = {
            id: 'test',
            name: '测试',
            description: '',
            category: EventCategory.NEGATIVE,
            floorMin: 1, floorMax: 10,
            options: [{
                text: '承受',
                effects: [{
                    type: EventEffectType.MODIFY_ATTRIBUTE,
                    value: -1,
                    params: { attribute: 'STR' },
                }],
            }],
        };

        expect(state.baseProperty.STR).toBe(10);
        mgr.executeEvent(evt, 0, state, rng);
        expect(state.baseProperty.STR).toBe(9);
    });

    it('CON 修改后 maxHp 同步更新', () => {
        const mgr = new EventManager();
        const state = makeRunState({
            baseProperty: { STR: 10, CON: 10, SPD: 10, MANA: 10 },
            currentHp: 180,
            maxHp: 180,
        });
        const rng = new SeededRandom(42);

        const evt: GameEventDef = {
            id: 'test',
            name: '测试',
            description: '',
            category: EventCategory.NEGATIVE,
            floorMin: 1, floorMax: 10,
            options: [{
                text: '承受',
                effects: [{
                    type: EventEffectType.MODIFY_ATTRIBUTE,
                    value: -2,
                    params: { attribute: 'CON' },
                }],
            }],
        };

        mgr.executeEvent(evt, 0, state, rng);
        expect(state.baseProperty.CON).toBe(8);
        // 新 maxHp = 8 × 15 + 30 = 150
        expect(state.maxHp).toBe(150);
        // currentHp 不超过新 maxHp
        expect(state.currentHp).toBe(150);
    });

    it('SPD 不会被降到 1 以下', () => {
        const mgr = new EventManager();
        const state = makeRunState({
            baseProperty: { STR: 10, CON: 10, SPD: 1, MANA: 19 },
        });
        const rng = new SeededRandom(42);

        const evt: GameEventDef = {
            id: 'test',
            name: '测试',
            description: '',
            category: EventCategory.NEGATIVE,
            floorMin: 1, floorMax: 10,
            options: [{
                text: '承受',
                effects: [{
                    type: EventEffectType.MODIFY_ATTRIBUTE,
                    value: -3,
                    params: { attribute: 'SPD' },
                }],
            }],
        };

        mgr.executeEvent(evt, 0, state, rng);
        expect(state.baseProperty.SPD).toBe(1);
    });
});

describe('EventManager — 概率型效果', () => {
    it('概率触发时执行主效果，不触发时执行 fallback', () => {
        const mgr = new EventManager();
        const rng = new SeededRandom(42);
        const SAMPLES = 1000;

        let gainCount = 0;
        let loseCount = 0;

        for (let i = 0; i < SAMPLES; i++) {
            const state = makeRunState({ gold: 100 });
            const evt: GameEventDef = {
                id: 'test',
                name: '测试',
                description: '',
                category: EventCategory.NEUTRAL,
                floorMin: 1, floorMax: 10,
                options: [{
                    text: '赌',
                    effects: [{
                        type: EventEffectType.GAIN_GOLD,
                        value: 60,
                        probability: 0.5,
                        fallback: { type: EventEffectType.LOSE_GOLD, value: 30 },
                    }],
                }],
            };

            mgr.executeEvent(evt, 0, state, rng);
            if (state.gold > 100) gainCount++;
            else loseCount++;
        }

        const gainRatio = gainCount / SAMPLES;
        expect(Math.abs(gainRatio - 0.5)).toBeLessThan(0.06);
    });
});

describe('EventManager — 卡牌操作', () => {
    it('REMOVE_CARD 移除随机卡牌', () => {
        const mgr = new EventManager();
        const state = makeRunState({
            deck: [
                { defId: 'card_a', upgraded: false },
                { defId: 'card_b', upgraded: false },
                { defId: 'card_c', upgraded: false },
            ],
        });
        const rng = new SeededRandom(42);

        const evt: GameEventDef = {
            id: 'test',
            name: '测试',
            description: '',
            category: EventCategory.NEUTRAL,
            floorMin: 1, floorMax: 10,
            options: [{
                text: '移除',
                effects: [{ type: EventEffectType.REMOVE_CARD }],
            }],
        };

        mgr.executeEvent(evt, 0, state, rng);
        expect(state.deck.length).toBe(2);
        expect(state.stats.cardsRemoved).toBe(1);
    });

    it('UPGRADE_RANDOM_CARD 随机升级一张未升级的卡', () => {
        const mgr = new EventManager();
        const state = makeRunState({
            deck: [
                { defId: 'card_a', upgraded: true },
                { defId: 'card_b', upgraded: false },
                { defId: 'card_c', upgraded: false },
            ],
        });
        const rng = new SeededRandom(42);

        const evt: GameEventDef = {
            id: 'test',
            name: '测试',
            description: '',
            category: EventCategory.POSITIVE,
            floorMin: 1, floorMax: 10,
            options: [{
                text: '升级',
                effects: [{ type: EventEffectType.UPGRADE_RANDOM_CARD }],
            }],
        };

        const upgradedBefore = state.deck.filter(c => c.upgraded).length;
        mgr.executeEvent(evt, 0, state, rng);
        const upgradedAfter = state.deck.filter(c => c.upgraded).length;
        expect(upgradedAfter).toBe(upgradedBefore + 1);
    });

    it('全部已升级时升级效果不生效', () => {
        const mgr = new EventManager();
        const state = makeRunState({
            deck: [
                { defId: 'card_a', upgraded: true },
            ],
        });
        const rng = new SeededRandom(42);

        const evt: GameEventDef = {
            id: 'test',
            name: '测试',
            description: '',
            category: EventCategory.POSITIVE,
            floorMin: 1, floorMax: 10,
            options: [{
                text: '升级',
                effects: [{ type: EventEffectType.UPGRADE_RANDOM_CARD }],
            }],
        };

        const result = mgr.executeEvent(evt, 0, state, rng);
        expect(result.stepLogs[0].effectLogs[0].applied).toBe(false);
    });
});

describe('EventManager — 完整流程', () => {
    it('注册事件 → 抽取 → 执行选项 → 状态变化', () => {
        const mgr = new EventManager();
        mgr.registerEvents(makeSampleEvents());

        const state = makeRunState({ currentHp: 100, maxHp: 180, gold: 50 });
        const rng = new SeededRandom(42);

        const evt = mgr.drawEvent(3, rng);
        expect(evt).not.toBeNull();

        const result = mgr.executeEvent(evt!, 0, state, rng);
        expect(result.event.id).toBe(evt!.id);
        expect(result.stepLogs.length).toBeGreaterThan(0);
        expect(result.stepLogs[0].effectLogs.length).toBeGreaterThan(0);
    });

    it('选择第二个选项（如"离开"）不执行任何效果', () => {
        const mgr = new EventManager();
        const state = makeRunState({ gold: 100 });
        const rng = new SeededRandom(42);

        const gamblerEvent = makeSampleEvents().find(e => e.id === 'gambler_dice')!;
        const result = mgr.executeEvent(gamblerEvent, 1, state, rng);

        expect(result.stepLogs[0].effectLogs.length).toBe(0);
        expect(state.gold).toBe(100);
    });
});

// ────────────────────────────────────────────────────────
// 嵌套分支叙事测试
// ────────────────────────────────────────────────────────

/**
 * 构建一个嵌套事件用于测试：
 *
 * 「神秘商人」—— "你在暗巷遇到一个神秘商人..."
 *  ├─ "查看商品"  → (无即时效果) → "商人展开一块布，上面摆着几样东西..."
 *  │   ├─ "买下匕首" → MODIFY_ATTRIBUTE STR+1
 *  │   ├─ "买下药水" → HEAL_HP 40
 *  │   └─ "离开"     → (无效果)
 *  ├─ "威胁他"    → 50% GAIN_GOLD 80 / 50% DAMAGE_HP 30
 *  └─ "无视走开"  → (无效果)
 */
function makeNestedEvent(): GameEventDef {
    return {
        id: 'mysterious_merchant',
        name: '神秘商人',
        description: '你在暗巷遇到一个神秘商人，他朝你露出一个意味深长的笑容...',
        category: EventCategory.NEUTRAL,
        floorMin: 1,
        floorMax: 9,
        options: [
            {
                text: '查看商品',
                hint: '（看看他在卖什么）',
                effects: [],
                nextDescription: '商人展开一块布，上面摆着几样东西——一把泛着寒光的匕首，和一瓶暗红色的药水。',
                nextIllustration: 'merchant_goods',
                nextOptions: [
                    {
                        text: '买下匕首',
                        hint: '（感觉握在手里很趁手）',
                        effects: [
                            { type: EventEffectType.LOSE_GOLD, value: 30 },
                            { type: EventEffectType.MODIFY_ATTRIBUTE, value: 1, params: { attribute: 'STR' } },
                        ],
                    },
                    {
                        text: '买下药水',
                        hint: '（闻起来有股草药味）',
                        effects: [
                            { type: EventEffectType.LOSE_GOLD, value: 20 },
                            { type: EventEffectType.HEAL_HP, value: 40 },
                        ],
                    },
                    {
                        text: '离开',
                        effects: [],
                    },
                ],
            },
            {
                text: '威胁他',
                hint: '（看起来不太结实...）',
                effects: [{
                    type: EventEffectType.GAIN_GOLD,
                    value: 80,
                    probability: 0.5,
                    fallback: { type: EventEffectType.DAMAGE_HP, value: 30 },
                }],
            },
            {
                text: '无视走开',
                effects: [],
            },
        ],
    };
}

/**
 * 构建三层深度嵌套事件：
 *
 * 「古老遗迹」—— "你发现了一处古老遗迹的入口..."
 *  └─ "进入遗迹" → "遗迹内部有两条通道..."
 *      ├─ "走左边" → "你找到一个上锁的宝箱..."
 *      │   ├─ "强行撬锁" → GAIN_GOLD 100 + DAMAGE_HP 15
 *      │   └─ "放弃宝箱" → (无效果)
 *      └─ "走右边" → HEAL_HP_PERCENT 0.2
 */
function makeDeepNestedEvent(): GameEventDef {
    return {
        id: 'ancient_ruins',
        name: '古老遗迹',
        description: '你发现了一处古老遗迹的入口，隐约能听到里面传来回声...',
        category: EventCategory.NEUTRAL,
        floorMin: 1,
        floorMax: 9,
        options: [
            {
                text: '进入遗迹',
                effects: [],
                nextDescription: '遗迹内部有两条通道，左边隐约发出金光，右边传来泉水声。',
                nextOptions: [
                    {
                        text: '走左边通道',
                        hint: '（金光闪闪的...）',
                        effects: [],
                        nextDescription: '你找到一个上锁的宝箱，锁看起来已经锈蚀了。',
                        nextOptions: [
                            {
                                text: '强行撬锁',
                                hint: '（可能会受伤）',
                                effects: [
                                    { type: EventEffectType.GAIN_GOLD, value: 100 },
                                    { type: EventEffectType.DAMAGE_HP, value: 15 },
                                ],
                            },
                            {
                                text: '放弃宝箱',
                                effects: [],
                            },
                        ],
                    },
                    {
                        text: '走右边通道',
                        hint: '（泉水声让人放松）',
                        effects: [{ type: EventEffectType.HEAL_HP_PERCENT, value: 0.2 }],
                    },
                ],
            },
            {
                text: '不进去',
                effects: [],
            },
        ],
    };
}

describe('EventManager — 嵌套分支叙事：分步模式', () => {
    it('第一步选择分支节点时返回 hasNextOptions = true 和下一层信息', () => {
        const mgr = new EventManager();
        const state = makeRunState();
        const rng = new SeededRandom(42);
        const evt = makeNestedEvent();

        const step1 = mgr.executeStep(evt.options, 0, state, rng);

        expect(step1.hasNextOptions).toBe(true);
        expect(step1.nextDescription).toBe('商人展开一块布，上面摆着几样东西——一把泛着寒光的匕首，和一瓶暗红色的药水。');
        expect(step1.nextIllustration).toBe('merchant_goods');
        expect(step1.nextOptions).toHaveLength(3);
        expect(step1.effectLogs).toHaveLength(0);
    });

    it('第二步选择叶子节点后 hasNextOptions = false', () => {
        const mgr = new EventManager();
        const state = makeRunState({ currentHp: 100, maxHp: 180, gold: 50 });
        const rng = new SeededRandom(42);
        const evt = makeNestedEvent();

        const step1 = mgr.executeStep(evt.options, 0, state, rng);
        expect(step1.hasNextOptions).toBe(true);

        const step2 = mgr.executeStep(step1.nextOptions!, 1, state, rng);
        expect(step2.hasNextOptions).toBe(false);
        // 买药水：-20 金 + 回复 40 HP
        expect(state.gold).toBe(30);
        expect(state.currentHp).toBe(140);
    });

    it('直接选择叶子选项（如"威胁他"）无嵌套', () => {
        const mgr = new EventManager();
        const state = makeRunState({ gold: 100 });
        const rng = new SeededRandom(42);
        const evt = makeNestedEvent();

        const step = mgr.executeStep(evt.options, 1, state, rng);
        expect(step.hasNextOptions).toBe(false);
        expect(step.effectLogs.length).toBe(1);
    });

    it('选择"无视走开"不触发任何效果', () => {
        const mgr = new EventManager();
        const state = makeRunState({ gold: 100, currentHp: 180 });
        const rng = new SeededRandom(42);
        const evt = makeNestedEvent();

        const step = mgr.executeStep(evt.options, 2, state, rng);
        expect(step.hasNextOptions).toBe(false);
        expect(step.effectLogs).toHaveLength(0);
        expect(state.gold).toBe(100);
        expect(state.currentHp).toBe(180);
    });
});

describe('EventManager — 嵌套分支叙事：全路径模式', () => {
    it('路径 [0, 0] = 查看商品 → 买匕首：STR+1 且扣金币', () => {
        const mgr = new EventManager();
        const state = makeRunState({ gold: 100 });
        const rng = new SeededRandom(42);
        const evt = makeNestedEvent();

        const result = mgr.executeEventByPath(evt, [0, 0], state, rng);

        expect(result.choicePath).toEqual([0, 0]);
        expect(result.stepLogs).toHaveLength(2);
        expect(result.stepLogs[0].optionText).toBe('查看商品');
        expect(result.stepLogs[0].effectLogs).toHaveLength(0);
        expect(result.stepLogs[1].optionText).toBe('买下匕首');
        expect(result.stepLogs[1].effectLogs).toHaveLength(2);
        expect(state.baseProperty.STR).toBe(11);
        expect(state.gold).toBe(70);
    });

    it('路径 [0, 1] = 查看商品 → 买药水：回复 HP 且扣金币', () => {
        const mgr = new EventManager();
        const state = makeRunState({ currentHp: 100, maxHp: 180, gold: 100 });
        const rng = new SeededRandom(42);
        const evt = makeNestedEvent();

        mgr.executeEventByPath(evt, [0, 1], state, rng);

        expect(state.currentHp).toBe(140);
        expect(state.gold).toBe(80);
    });

    it('路径 [0, 2] = 查看商品 → 离开：无状态变化', () => {
        const mgr = new EventManager();
        const state = makeRunState({ gold: 100, currentHp: 180 });
        const rng = new SeededRandom(42);
        const evt = makeNestedEvent();

        mgr.executeEventByPath(evt, [0, 2], state, rng);

        expect(state.gold).toBe(100);
        expect(state.currentHp).toBe(180);
    });

    it('路径 [1] = 威胁他：概率型效果执行', () => {
        const mgr = new EventManager();
        const state = makeRunState({ gold: 100, currentHp: 180 });
        const rng = new SeededRandom(42);
        const evt = makeNestedEvent();

        mgr.executeEventByPath(evt, [1], state, rng);

        // 要么得金要么受伤
        expect(state.gold !== 100 || state.currentHp !== 180).toBe(true);
    });

    it('路径 [2] = 无视走开：无变化', () => {
        const mgr = new EventManager();
        const state = makeRunState({ gold: 100, currentHp: 180 });
        const rng = new SeededRandom(42);
        const evt = makeNestedEvent();

        const result = mgr.executeEventByPath(evt, [2], state, rng);

        expect(result.stepLogs).toHaveLength(1);
        expect(result.stepLogs[0].effectLogs).toHaveLength(0);
        expect(state.gold).toBe(100);
    });
});

describe('EventManager — 三层深度嵌套', () => {
    it('路径 [0, 0, 0] = 进入遗迹 → 左通道 → 撬锁：+100 金 -15 HP', () => {
        const mgr = new EventManager();
        const state = makeRunState({ gold: 50, currentHp: 180, maxHp: 180 });
        const rng = new SeededRandom(42);
        const evt = makeDeepNestedEvent();

        const result = mgr.executeEventByPath(evt, [0, 0, 0], state, rng);

        expect(result.stepLogs).toHaveLength(3);
        expect(result.stepLogs[0].optionText).toBe('进入遗迹');
        expect(result.stepLogs[1].optionText).toBe('走左边通道');
        expect(result.stepLogs[2].optionText).toBe('强行撬锁');
        expect(state.gold).toBe(150);
        expect(state.currentHp).toBe(165);
    });

    it('路径 [0, 0, 1] = 进入遗迹 → 左通道 → 放弃：无变化', () => {
        const mgr = new EventManager();
        const state = makeRunState({ gold: 50, currentHp: 180 });
        const rng = new SeededRandom(42);
        const evt = makeDeepNestedEvent();

        mgr.executeEventByPath(evt, [0, 0, 1], state, rng);

        expect(state.gold).toBe(50);
        expect(state.currentHp).toBe(180);
    });

    it('路径 [0, 1] = 进入遗迹 → 右通道：回复 20% HP', () => {
        const mgr = new EventManager();
        const state = makeRunState({ currentHp: 100, maxHp: 180 });
        const rng = new SeededRandom(42);
        const evt = makeDeepNestedEvent();

        mgr.executeEventByPath(evt, [0, 1], state, rng);

        // 180 × 0.2 = 36，100 + 36 = 136
        expect(state.currentHp).toBe(136);
    });

    it('路径 [1] = 不进去：无变化', () => {
        const mgr = new EventManager();
        const state = makeRunState({ gold: 50, currentHp: 180 });
        const rng = new SeededRandom(42);
        const evt = makeDeepNestedEvent();

        mgr.executeEventByPath(evt, [1], state, rng);

        expect(state.gold).toBe(50);
        expect(state.currentHp).toBe(180);
    });

    it('分步模式走完三层', () => {
        const mgr = new EventManager();
        const state = makeRunState({ gold: 50, currentHp: 180, maxHp: 180 });
        const rng = new SeededRandom(42);
        const evt = makeDeepNestedEvent();

        // 第一步：进入遗迹
        const step1 = mgr.executeStep(evt.options, 0, state, rng);
        expect(step1.hasNextOptions).toBe(true);
        expect(step1.nextDescription).toContain('两条通道');
        expect(step1.nextOptions).toHaveLength(2);

        // 第二步：走左边通道
        const step2 = mgr.executeStep(step1.nextOptions!, 0, state, rng);
        expect(step2.hasNextOptions).toBe(true);
        expect(step2.nextDescription).toContain('上锁的宝箱');
        expect(step2.nextOptions).toHaveLength(2);

        // 第三步：强行撬锁
        const step3 = mgr.executeStep(step2.nextOptions!, 0, state, rng);
        expect(step3.hasNextOptions).toBe(false);
        expect(state.gold).toBe(150);
        expect(state.currentHp).toBe(165);
    });
});

describe('EventManager — 分支节点带即时效果', () => {
    it('进入分支时先结算即时效果，再展示子选项', () => {
        const mgr = new EventManager();
        const state = makeRunState({ currentHp: 180, maxHp: 180 });
        const rng = new SeededRandom(42);

        const evt: GameEventDef = {
            id: 'trap_room',
            name: '陷阱房间',
            description: '你进入一个房间...',
            category: EventCategory.NEGATIVE,
            floorMin: 1, floorMax: 9,
            options: [{
                text: '推开门',
                effects: [{ type: EventEffectType.DAMAGE_HP, value: 10 }],
                nextDescription: '门后是一个岔路...',
                nextOptions: [
                    { text: '左转', effects: [{ type: EventEffectType.GAIN_GOLD, value: 50 }] },
                    { text: '右转', effects: [{ type: EventEffectType.HEAL_HP, value: 20 }] },
                ],
            }],
        };

        // 第一步：推开门 → 先受 10 伤害
        const step1 = mgr.executeStep(evt.options, 0, state, rng);
        expect(state.currentHp).toBe(170);
        expect(step1.hasNextOptions).toBe(true);
        expect(step1.effectLogs).toHaveLength(1);
        expect(step1.effectLogs[0].type).toBe(EventEffectType.DAMAGE_HP);

        // 第二步：右转回血
        const step2 = mgr.executeStep(step1.nextOptions!, 1, state, rng);
        expect(step2.hasNextOptions).toBe(false);
        expect(state.currentHp).toBe(180);
    });
});
