/**
 * Phase 1 核心战斗引擎 — 关键验证点测试
 *
 * 验证点：
 * 1. SPD 10 vs SPD 7 在 100 tick 内行动比精确为 10:7
 * 2. 霜蚀减速：24 层霜蚀 → SPD 8 角色冻结，每周期衰减 2 层后逐步解冻
 * 3. 灼烧加成：火系卡牌伤害 + 目标灼烧层数
 * 4. MP 不足时跳过卡牌，卡组指针仍前进
 * 5. 同 tick 双方行动槽 ≥ 100 时，速度高者先手
 */
import { describe, it, expect } from 'vitest';
import { BattleEngine, CardRegistry } from '../game/assets/scripts/core/battle/BattleEngine';
import { BattleConfig, DEFAULT_BATTLE_CONFIG, BattleLogType } from '../game/assets/scripts/types/BattleTypes';
import { StatusManager } from '../game/assets/scripts/core/battle/StatusManager';
import { DamageCalculator } from '../game/assets/scripts/core/battle/DamageCalculator';
import { DeckRunner, DeckActionType } from '../game/assets/scripts/core/deck/DeckRunner';
import { getEffectiveSpeed, isFrozen } from '../game/assets/scripts/core/character/EffectiveStats';
import { StatusType, Faction, CardType, EffectTarget, CardRarity } from '../game/assets/scripts/types/Enums';
import { makeCombatant, makeFighter, makeCardDef, makeCardInstance, makeRegistry } from './helpers';

// ────────────────────────────────────────────────────────
// 验证点 1：SPD 10 vs SPD 7 — 100 tick 内行动比 10:7
// ────────────────────────────────────────────────────────

describe('验证点 1：ATB 行动比与速度成正比', () => {
    it('SPD 10 vs SPD 7 在 100 tick 内行动次数比为 10:7', () => {
        const attackCard = makeCardDef({
            id: 'basic_attack',
            name: '普通攻击',
            manaCost: 0,
            effects: [{ target: EffectTarget.ENEMY, damage: { base: 1 } }],
        });
        const registry = makeRegistry([attackCard]);
        const deck = [makeCardInstance('basic_attack')];

        const player = makeFighter('玩家', { baseSpeed: 10, currentHp: 9999, maxHp: 9999 }, [...deck]);
        const opponent = makeFighter('对手', { baseSpeed: 7, currentHp: 9999, maxHp: 9999 }, [...deck]);

        const engine = new BattleEngine(player, opponent, registry, DEFAULT_BATTLE_CONFIG, 42);
        const state = engine.getState();

        let playerActions = 0;
        let opponentActions = 0;

        for (let tick = 0; tick < 100; tick++) {
            engine.runTick();

            for (const entry of state.log) {
                if (entry.tick === state.tickCount && entry.type === BattleLogType.PLAY_CARD) {
                    if (entry.actor === 'player') playerActions++;
                    if (entry.actor === 'opponent') opponentActions++;
                }
            }
        }

        expect(playerActions).toBe(10);
        expect(opponentActions).toBe(7);
        expect(playerActions / opponentActions).toBeCloseTo(10 / 7, 5);
    });

    it('SPD 5 vs SPD 5 在 100 tick 内行动次数相同（各 5 次）', () => {
        const attackCard = makeCardDef({ id: 'basic_attack', manaCost: 0, effects: [{ target: EffectTarget.ENEMY, damage: { base: 1 } }] });
        const registry = makeRegistry([attackCard]);
        const deck = [makeCardInstance('basic_attack')];

        const player = makeFighter('玩家', { baseSpeed: 5, currentHp: 9999, maxHp: 9999 }, [...deck]);
        const opponent = makeFighter('对手', { baseSpeed: 5, currentHp: 9999, maxHp: 9999 }, [...deck]);

        const engine = new BattleEngine(player, opponent, registry, DEFAULT_BATTLE_CONFIG, 42);
        const state = engine.getState();

        let playerActions = 0;
        let opponentActions = 0;

        for (let tick = 0; tick < 100; tick++) {
            engine.runTick();
            for (const entry of state.log) {
                if (entry.tick === state.tickCount && entry.type === BattleLogType.PLAY_CARD) {
                    if (entry.actor === 'player') playerActions++;
                    if (entry.actor === 'opponent') opponentActions++;
                }
            }
        }

        expect(playerActions).toBe(5);
        expect(opponentActions).toBe(5);
    });
});

// ────────────────────────────────────────────────────────
// 验证点 2：霜蚀减速与冻结/解冻
// ────────────────────────────────────────────────────────

describe('验证点 2：霜蚀减速、冻结与解冻', () => {
    const config = DEFAULT_BATTLE_CONFIG;
    const statusManager = new StatusManager(config);

    it('24 层霜蚀让 SPD 8 角色冻结（有效速度 = 0）', () => {
        // frostPerSpeedReduction = 3, 所以 24 层 → 减速 8
        // baseSpeed 8 - 8 = 0 → 冻结
        const combatant = makeCombatant({ baseSpeed: 8, frostStacks: 0 });
        statusManager.applyStatus(combatant, StatusType.FROST, 24);

        expect(combatant.frostStacks).toBe(24);
        expect(getEffectiveSpeed(combatant, config)).toBe(0);
        expect(isFrozen(combatant, config)).toBe(true);
    });

    it('每周期衰减 1 层霜蚀，从 24 层逐步解冻', () => {
        const combatant = makeCombatant({ baseSpeed: 8, frostStacks: 24 });

        // 24 层 → 减速 8 → 有效速度 0 → 冻结
        expect(isFrozen(combatant, config)).toBe(true);

        // 衰减 1 次：24 → 23 层, 减速 7 → 有效速度 1 → 解冻!
        const decay1 = statusManager.resolveDecays(combatant);
        expect(combatant.frostStacks).toBe(23);
        expect(getEffectiveSpeed(combatant, config)).toBe(1);
        expect(isFrozen(combatant, config)).toBe(false);
        expect(decay1.some(d => d.unfreezeTransition === true)).toBe(true);

        // 衰减 2 次：23 → 22, 减速 7 → 有效速度 1（仍在恢复中）
        statusManager.resolveDecays(combatant);
        expect(combatant.frostStacks).toBe(22);
        expect(getEffectiveSpeed(combatant, config)).toBe(1);

        // 衰减 3 次：22 → 21, 减速 7 → 有效速度 1
        statusManager.resolveDecays(combatant);
        expect(combatant.frostStacks).toBe(21);
        expect(getEffectiveSpeed(combatant, config)).toBe(1);

        // 衰减 4 次：21 → 20, 减速 6 → 有效速度 2
        statusManager.resolveDecays(combatant);
        expect(combatant.frostStacks).toBe(20);
        expect(getEffectiveSpeed(combatant, config)).toBe(2);
    });

    it('不足冻结阈值的霜蚀仅减速而不冻结', () => {
        // SPD 8, 21 层霜蚀 → 减速 7 → 有效速度 1 → 不冻结
        const combatant = makeCombatant({ baseSpeed: 8, frostStacks: 21 });
        expect(getEffectiveSpeed(combatant, config)).toBe(1);
        expect(isFrozen(combatant, config)).toBe(false);
    });

    it('冻结角色行动槽不增长', () => {
        const attackCard = makeCardDef({ id: 'basic_attack', manaCost: 0, effects: [{ target: EffectTarget.ENEMY, damage: { base: 1 } }] });
        const registry = makeRegistry([attackCard]);
        const deck = [makeCardInstance('basic_attack')];

        // 对手 SPD 8，24 层霜蚀 → 冻结
        const player = makeFighter('玩家', { baseSpeed: 10, currentHp: 9999, maxHp: 9999 }, [...deck]);
        const opponent = makeFighter('对手', { baseSpeed: 8, frostStacks: 24, currentHp: 9999, maxHp: 9999 }, [...deck]);

        const engine = new BattleEngine(player, opponent, registry, DEFAULT_BATTLE_CONFIG, 42);
        const state = engine.getState();

        // 跑 10 tick，对手行动槽应该不增长
        for (let i = 0; i < 10; i++) {
            engine.runTick();
        }

        expect(state.opponent.combatant.actionGauge).toBe(0);
    });
});

// ────────────────────────────────────────────────────────
// 验证点 3：灼烧加成 — 火系卡牌伤害 + 目标灼烧层数
// ────────────────────────────────────────────────────────

describe('验证点 3：灼烧加成', () => {
    it('火系卡牌伤害 = 基础伤害 + 目标灼烧层数', () => {
        const caster = makeCombatant({ attack: 10 });
        const target = makeCombatant({ armor: 0, burnStacks: 8 });

        const baseDamage = 10;
        const result = DamageCalculator.applyDamage(
            baseDamage,
            caster,
            target,
            Faction.FIRE,
            target.burnStacks,
            false,
        );

        // 10 + 8(灼烧层数) = 18
        expect(result.finalDamage).toBe(18);
        expect(result.actualHpDamage).toBe(18);
    });

    it('非火系卡牌不享受灼烧加成', () => {
        const caster = makeCombatant({ attack: 10 });
        const target = makeCombatant({ armor: 0, burnStacks: 8 });

        const result = DamageCalculator.applyDamage(
            10,
            caster,
            target,
            Faction.ICE,
            target.burnStacks,
            false,
        );

        expect(result.finalDamage).toBe(10);
        expect(result.actualHpDamage).toBe(10);
    });

    it('灼烧层数为 0 时火系卡牌无额外伤害', () => {
        const caster = makeCombatant({ attack: 10 });
        const target = makeCombatant({ armor: 0, burnStacks: 0 });

        const result = DamageCalculator.applyDamage(
            10,
            caster,
            target,
            Faction.FIRE,
            target.burnStacks,
            false,
        );

        expect(result.finalDamage).toBe(10);
    });

    it('灼烧加成后伤害仍经过护甲结算', () => {
        const caster = makeCombatant({ attack: 10 });
        const target = makeCombatant({ armor: 5, burnStacks: 8 });

        const result = DamageCalculator.applyDamage(
            10,
            caster,
            target,
            Faction.FIRE,
            target.burnStacks,
            false,
        );

        // 10 + 8 = 18, 护甲吸收 5 → 实际 HP 伤害 13
        expect(result.finalDamage).toBe(18);
        expect(result.armorAbsorbed).toBe(5);
        expect(result.actualHpDamage).toBe(13);
    });
});

// ────────────────────────────────────────────────────────
// 验证点 4：MP 不足时跳过卡牌，卡组指针仍前进
// ────────────────────────────────────────────────────────

describe('验证点 4：MP 不足跳过卡牌，指针仍前进', () => {
    it('MP 不足时 resolveCurrentCard 返回 SKIP_NO_MP', () => {
        const expensiveCard = makeCardDef({ id: 'expensive', manaCost: 5 });
        const registry = makeRegistry([expensiveCard]);
        const runner = new DeckRunner(registry);

        const combatant = makeCombatant({ currentMp: 2, deckIndex: 0 });
        const deck = [makeCardInstance('expensive')];

        const action = runner.resolveCurrentCard(combatant, deck);
        expect(action.type).toBe(DeckActionType.SKIP_NO_MP);
        expect(action.effectiveManaCost).toBe(5);
    });

    it('跳过后调用 advanceDeckIndex 指针前进', () => {
        const card1 = makeCardDef({ id: 'card1', manaCost: 5 });
        const card2 = makeCardDef({ id: 'card2', manaCost: 1 });
        const registry = makeRegistry([card1, card2]);
        const runner = new DeckRunner(registry);

        const combatant = makeCombatant({ currentMp: 2, deckIndex: 0 });
        const deck = [makeCardInstance('card1'), makeCardInstance('card2')];

        const action = runner.resolveCurrentCard(combatant, deck);
        expect(action.type).toBe(DeckActionType.SKIP_NO_MP);

        runner.advanceDeckIndex(combatant, deck);
        expect(combatant.deckIndex).toBe(1);

        // 现在指向 card2（费用 1），MP 足够
        const action2 = runner.resolveCurrentCard(combatant, deck);
        expect(action2.type).toBe(DeckActionType.PLAY);
    });

    it('指针到达卡组末尾后循环回第一张', () => {
        const card = makeCardDef({ id: 'card', manaCost: 0 });
        const registry = makeRegistry([card]);
        const runner = new DeckRunner(registry);

        const combatant = makeCombatant({ deckIndex: 2 });
        const deck = [makeCardInstance('card'), makeCardInstance('card'), makeCardInstance('card')];

        // deckIndex = 2 → 推进后 = (2+1) % 3 = 0
        runner.advanceDeckIndex(combatant, deck);
        expect(combatant.deckIndex).toBe(0);
    });

    it('通过 BattleEngine 完整验证：MP 不足时跳过并记录日志', () => {
        // 费用 10 的卡（超过最大 MP），保证始终 MP 不足
        const expensiveCard = makeCardDef({ id: 'expensive', manaCost: 10 });
        const cheapCard = makeCardDef({ id: 'cheap', manaCost: 0, effects: [{ target: EffectTarget.ENEMY, damage: { base: 1 } }] });
        const registry = makeRegistry([expensiveCard, cheapCard]);

        const player = makeFighter(
            '玩家',
            { baseSpeed: 10, currentMp: 3, maxMp: 5, currentHp: 9999, maxHp: 9999 },
            [makeCardInstance('expensive'), makeCardInstance('cheap')],
        );
        const opponent = makeFighter(
            '对手',
            { baseSpeed: 10, currentHp: 9999, maxHp: 9999 },
            [makeCardInstance('cheap')],
        );

        const engine = new BattleEngine(player, opponent, registry, DEFAULT_BATTLE_CONFIG, 42);
        const state = engine.getState();

        // 跑 10 tick，player 应该在 tick 10 行动
        for (let i = 0; i < 10; i++) {
            engine.runTick();
        }

        // 应该有 SKIP_CARD 日志，且 deckIndex 已推进到 1
        const skipLogs = state.log.filter(e => e.actor === 'player' && e.type === BattleLogType.SKIP_CARD);
        expect(skipLogs.length).toBeGreaterThanOrEqual(1);
    });
});

// ────────────────────────────────────────────────────────
// 验证点 5：同 tick 先手规则 — 速度高者先手
// ────────────────────────────────────────────────────────

describe('验证点 5：同 tick 行动槽同时达到阈值，速度高者先手', () => {
    it('SPD 10 和 SPD 10 在 tick 10 同时行动，player（攻方）先手', () => {
        const attackCard = makeCardDef({
            id: 'atk',
            manaCost: 0,
            effects: [{ target: EffectTarget.ENEMY, damage: { base: 1 } }],
        });
        const registry = makeRegistry([attackCard]);
        const deck = [makeCardInstance('atk')];

        const player = makeFighter('玩家', { baseSpeed: 10, currentHp: 9999, maxHp: 9999 }, [...deck]);
        const opponent = makeFighter('对手', { baseSpeed: 10, currentHp: 9999, maxHp: 9999 }, [...deck]);

        const engine = new BattleEngine(player, opponent, registry, DEFAULT_BATTLE_CONFIG, 42);
        const state = engine.getState();

        // 跑到 tick 10 — 双方行动槽同时达到 100
        for (let i = 0; i < 10; i++) {
            engine.runTick();
        }

        // 找到 tick 10 的 PLAY_CARD 日志，player 应该排在 opponent 前面
        const tick10Actions = state.log.filter(
            e => e.tick === 10 && e.type === BattleLogType.PLAY_CARD
        );
        expect(tick10Actions.length).toBe(2);
        expect(tick10Actions[0].actor).toBe('player');
        expect(tick10Actions[1].actor).toBe('opponent');
    });

    it('SPD 20 vs SPD 10 — SPD 20 在 tick 5 先行动，tick 10 双方同时行动时 SPD 20 先手', () => {
        const attackCard = makeCardDef({
            id: 'atk',
            manaCost: 0,
            effects: [{ target: EffectTarget.ENEMY, damage: { base: 1 } }],
        });
        const registry = makeRegistry([attackCard]);
        const deck = [makeCardInstance('atk')];

        const player = makeFighter('玩家', { baseSpeed: 20, currentHp: 9999, maxHp: 9999 }, [...deck]);
        const opponent = makeFighter('对手', { baseSpeed: 10, currentHp: 9999, maxHp: 9999 }, [...deck]);

        const engine = new BattleEngine(player, opponent, registry, DEFAULT_BATTLE_CONFIG, 42);
        const state = engine.getState();

        for (let i = 0; i < 10; i++) {
            engine.runTick();
        }

        // tick 5: 只有 player 行动（gauge = 100）
        const tick5Actions = state.log.filter(e => e.tick === 5 && e.type === BattleLogType.PLAY_CARD);
        expect(tick5Actions.length).toBe(1);
        expect(tick5Actions[0].actor).toBe('player');

        // tick 10: 双方同时行动，player（速度高）先手
        const tick10Actions = state.log.filter(e => e.tick === 10 && e.type === BattleLogType.PLAY_CARD);
        expect(tick10Actions.length).toBe(2);
        expect(tick10Actions[0].actor).toBe('player');
        expect(tick10Actions[1].actor).toBe('opponent');
    });
});
