import {
    BattleState, BattleFighter, BattleConfig, DEFAULT_BATTLE_CONFIG,
} from '../../types/BattleTypes';
import { CardDef, CardEffect, CardInstance } from '../../types/CardTypes';
import { RuntimeCombatant } from '../../types/CharacterTypes';
import { CardType, PowerTrigger } from '../../types/Enums';
import {
    getEffectiveSpeed, isFrozen, spendMp,
} from '../character/EffectiveStats';
import {
    CardEffectResolver, ResolveContext,
} from '../card/CardEffectResolver';
import { SeededRandom } from '../utils/SeededRandom';
import { StatusManager } from './StatusManager';
import { CycleResolver } from './CycleResolver';
import { BattleEndChecker, BattleEndReason } from './BattleEndChecker';
import { DeckRunner, DeckActionType } from '../deck/DeckRunner';
import {
    BattleInitializer, BattleSetup, RelicDefLookup,
} from './BattleInitializer';
import { BattleLogger } from './BattleLogger';

// ─── 外部依赖接口 ────────────────────────────────────────

/** 卡牌定义查询接口，由外部提供（如静态数据表） */
export interface CardRegistry {
    getCardDef(defId: string): CardDef | undefined;
}

// ─── 战斗引擎 ────────────────────────────────────────────

/**
 * ATB 战斗引擎。
 *
 * 以 tick 为最小时间单位推进战斗：每 tick 双方行动槽各加有效速度，
 * 行动槽 ≥ 阈值时触发行动（出牌），每 100 tick 触发周期结算。
 *
 * 引擎是纯逻辑层，不依赖引擎 API。UI 层通过 getState() 读取状态渲染画面。
 *
 * 创建方式：
 * - `new BattleEngine(player, opponent, ...)` — 简单模式，跳过初始化流程（测试用）
 * - `BattleEngine.createWithSetup(setup, ...)` — 完整模式，经 BattleInitializer 处理遗物/Buff/清零
 *
 * @see battle-base.md §二 ATB 系统
 */
export class BattleEngine {
    private readonly state: BattleState;
    private readonly config: BattleConfig;
    private readonly rng: SeededRandom;
    private readonly cardRegistry: CardRegistry;
    private readonly statusManager: StatusManager;
    private readonly cycleResolver: CycleResolver;
    private readonly endChecker: BattleEndChecker;
    private readonly deckRunner: DeckRunner;
    private readonly logger: BattleLogger;

    private cardsPlayedThisAction = 0;
    private mpSpentThisAction = 0;

    /**
     * 简单构造：直接用传入的 Fighter 数据创建战斗（深拷贝）。
     * 不执行遗物触发、临时 Buff 应用等初始化流程。
     * 适用于测试和已手动初始化的场景。
     */
    constructor(
        player: BattleFighter,
        opponent: BattleFighter,
        cardRegistry: CardRegistry,
        config: BattleConfig = DEFAULT_BATTLE_CONFIG,
        seed: number = Date.now(),
    ) {
        this.config = config;
        this.rng = new SeededRandom(seed);
        this.cardRegistry = cardRegistry;
        this.statusManager = new StatusManager(config);
        this.cycleResolver = new CycleResolver(this.statusManager, config);
        this.endChecker = new BattleEndChecker(config);
        this.deckRunner = new DeckRunner(cardRegistry);

        this.state = {
            player: cloneFighter(player),
            opponent: cloneFighter(opponent),
            tickCount: 0,
            cycleCount: 0,
            isFinished: false,
            winner: null,
            log: [],
        };
        this.logger = new BattleLogger(this.state.log);
    }

    /**
     * 从已初始化的 BattleState 创建引擎（私有）。
     * 由静态工厂方法 createWithSetup 调用。
     */
    private static fromState(
        state: BattleState,
        cardRegistry: CardRegistry,
        config: BattleConfig,
        seed: number,
    ): BattleEngine {
        const engine = Object.create(BattleEngine.prototype) as BattleEngine;

        // 手动赋值 readonly 字段（绕过 constructor）
        (engine as any).config = config;
        (engine as any).rng = new SeededRandom(seed);
        (engine as any).cardRegistry = cardRegistry;
        (engine as any).statusManager = new StatusManager(config);
        (engine as any).cycleResolver = new CycleResolver(
            (engine as any).statusManager, config,
        );
        (engine as any).endChecker = new BattleEndChecker(config);
        (engine as any).deckRunner = new DeckRunner(cardRegistry);
        (engine as any).state = state;
        (engine as any).logger = new BattleLogger(state.log);
        (engine as any).cardsPlayedThisAction = 0;
        (engine as any).mpSpentThisAction = 0;

        return engine;
    }

    /**
     * 完整初始化模式：经 BattleInitializer 执行战斗开始流程后创建引擎。
     *
     * 包含完整的初始化流程：
     * 1. 深拷贝双方数据
     * 2. 应用临时 Buff（事件/赌约）
     * 3. 触发 BATTLE_START 遗物
     *
     * @see battle-base.md §四 战斗初始化
     */
    static createWithSetup(
        setup: BattleSetup,
        cardRegistry: CardRegistry,
        relicLookup: RelicDefLookup,
        config: BattleConfig = DEFAULT_BATTLE_CONFIG,
        seed: number = Date.now(),
    ): BattleEngine {
        const initializer = new BattleInitializer(relicLookup);
        const { state } = initializer.initialize(setup);
        return BattleEngine.fromState(state, cardRegistry, config, seed);
    }

    getState(): Readonly<BattleState> {
        return this.state;
    }

    /** 推进一个 tick。返回 true 表示战斗已结束。 */
    runTick(): boolean {
        if (this.state.isFinished) return true;

        this.state.tickCount++;
        this.logger.setTime(this.state.tickCount, this.state.cycleCount);

        this.fillGauges();

        const actors = this.collectActors();
        for (const side of actors) {
            if (this.state.isFinished) break;
            this.executeAction(side);
            if (this.checkBattleEnd()) break;
        }

        if (!this.state.isFinished && this.state.tickCount % this.config.ticksPerCycle === 0) {
            this.resolveCycleEnd();
            this.checkBattleEnd();
        }

        return this.state.isFinished;
    }

    /** 运行至战斗结束，返回最终状态。 */
    runToEnd(maxTicks: number = 100_000): BattleState {
        while (!this.state.isFinished && this.state.tickCount < maxTicks) {
            this.runTick();
        }
        if (!this.state.isFinished) {
            this.applyBattleEnd('draw', BattleEndReason.TICK_LIMIT);
        }
        return this.state;
    }

    // ─── 行动槽 ──────────────────────────────────────────

    private fillGauges(): void {
        const pc = this.state.player.combatant;
        const oc = this.state.opponent.combatant;

        if (!isFrozen(pc, this.config)) {
            pc.actionGauge += getEffectiveSpeed(pc, this.config);
        }
        if (!isFrozen(oc, this.config)) {
            oc.actionGauge += getEffectiveSpeed(oc, this.config);
        }
    }

    /**
     * 收集本 tick 可行动的角色，按速度降序排列（同速攻方优先）。
     * @see battle-base.md §2.2 — 同 tick 先手规则
     */
    private collectActors(): ('player' | 'opponent')[] {
        const threshold = this.config.gaugeThreshold;
        const actors: { side: 'player' | 'opponent'; speed: number }[] = [];

        if (this.state.player.combatant.actionGauge >= threshold) {
            actors.push({ side: 'player', speed: getEffectiveSpeed(this.state.player.combatant, this.config) });
        }
        if (this.state.opponent.combatant.actionGauge >= threshold) {
            actors.push({ side: 'opponent', speed: getEffectiveSpeed(this.state.opponent.combatant, this.config) });
        }

        actors.sort((a, b) => {
            if (b.speed !== a.speed) return b.speed - a.speed;
            return a.side === 'player' ? -1 : 1;
        });

        return actors.map(a => a.side);
    }

    // ─── 行动执行 ────────────────────────────────────────

    /**
     * 执行一次完整行动：扣行动槽 → 触发 TURN_START → 出牌/跳过 → 触发 TURN_END → Buff 递减。
     * @see battle-base.md §五 行动解析
     */
    private executeAction(side: 'player' | 'opponent'): void {
        const fighter = this.getFighter(side);
        const combatant = fighter.combatant;

        combatant.actionGauge -= this.config.gaugeThreshold;

        this.cardsPlayedThisAction = 0;
        this.mpSpentThisAction = 0;

        this.triggerPowers(side, PowerTrigger.TURN_START);
        if (this.state.isFinished) return;

        this.processCard(side);

        if (!this.state.isFinished) {
            this.triggerPowers(side, PowerTrigger.TURN_END);
        }

        this.tickBuffDurations(combatant);
    }

    /**
     * 处理当前卡组指针位置的卡牌：委托 DeckRunner 解析动作 → 出牌/跳过 → 推进指针。
     */
    private processCard(side: 'player' | 'opponent'): void {
        const fighter = this.getFighter(side);
        const enemy = this.getEnemy(side);
        const combatant = fighter.combatant;
        const deck = fighter.deck;

        const action = this.deckRunner.resolveCurrentCard(combatant, deck);

        switch (action.type) {
            case DeckActionType.EMPTY_DECK:
                return;

            case DeckActionType.INVALID_DEF:
                this.deckRunner.advanceDeckIndex(combatant, deck);
                return;

            case DeckActionType.SKIP_NO_MP:
                this.logger.logSkipCard(side, fighter.name, action.cardDef!.name, action.cardDef!.id, action.effectiveManaCost, combatant.currentMp);
                this.deckRunner.advanceDeckIndex(combatant, deck);
                return;

            case DeckActionType.PLAY:
            case DeckActionType.FORCE_PLAY:
                this.playCard(side, fighter, enemy, action.cardDef!, action.cardInstance!, action.effectiveManaCost);
                return;
        }
    }

    private playCard(
        side: 'player' | 'opponent',
        fighter: BattleFighter,
        enemy: BattleFighter,
        cardDef: CardDef,
        cardInstance: CardInstance,
        manaCost: number,
    ): void {
        const combatant = fighter.combatant;
        const deck = fighter.deck;

        const actualCost = Math.min(combatant.currentMp, manaCost);
        spendMp(combatant, actualCost);
        this.mpSpentThisAction += actualCost;
        this.cardsPlayedThisAction++;

        this.logger.logPlayCard(side, fighter.name, cardDef.name, cardDef.id, actualCost);

        const targetWasFrozen = this.statusManager.isFrozen(enemy.combatant);

        const ctx: ResolveContext = {
            caster: combatant,
            target: enemy.combatant,
            targetDeck: enemy.deck,
            cardDef,
            rng: this.rng,
            config: this.config,
            statusManager: this.statusManager,
            cycleCount: this.state.cycleCount,
            cardsPlayedThisTurn: this.cardsPlayedThisAction,
            mpSpentThisTurn: this.mpSpentThisAction,
        };
        const resolver = new CardEffectResolver(ctx);
        const results = resolver.resolve(cardDef.effects);
        this.logger.logEffectResults(side, results, fighter.name, enemy.name);

        if (!targetWasFrozen && this.statusManager.isFrozen(enemy.combatant)) {
            this.logger.logFreeze(side, enemy.name, enemy.combatant.frostStacks);
        }

        this.triggerPowers(side, PowerTrigger.ON_PLAY_CARD);

        if (cardDef.cardType === CardType.POWER && cardDef.power) {
            this.activatePower(combatant, cardDef);
        }

        if (this.deckRunner.shouldRemoveAfterPlay(cardDef)) {
            this.deckRunner.removeCurrentCard(combatant, deck);
            return;
        }

        this.deckRunner.advanceDeckIndex(combatant, deck);
    }

    // ─── POWER 卡牌 ──────────────────────────────────────

    private activatePower(combatant: RuntimeCombatant, cardDef: CardDef): void {
        if (!cardDef.power) return;

        const existing = combatant.activePowers.find(p => p.cardId === cardDef.id);
        if (existing) {
            if (cardDef.power.stackable && existing.currentStacks < existing.maxStacks) {
                existing.currentStacks++;
            }
            return;
        }

        combatant.activePowers.push({
            cardId: cardDef.id,
            trigger: cardDef.power.trigger,
            effect: cardDef.power.effect,
            currentStacks: 1,
            maxStacks: cardDef.power.maxStacks,
        });
    }

    /**
     * 触发指定时机的所有已激活 POWER 效果。
     */
    private triggerPowers(side: 'player' | 'opponent', trigger: PowerTrigger): void {
        const fighter = this.getFighter(side);
        const enemy = this.getEnemy(side);
        const combatant = fighter.combatant;

        for (const power of combatant.activePowers) {
            if (power.trigger !== trigger) continue;
            if (this.state.isFinished) break;

            const cardDef = this.cardRegistry.getCardDef(power.cardId);
            if (!cardDef) continue;

            const effect = power.effect as CardEffect;
            if (!effect) continue;

            const ctx: ResolveContext = {
                caster: combatant,
                target: enemy.combatant,
                targetDeck: enemy.deck,
                cardDef,
                rng: this.rng,
                config: this.config,
                statusManager: this.statusManager,
                cycleCount: this.state.cycleCount,
                cardsPlayedThisTurn: this.cardsPlayedThisAction,
                mpSpentThisTurn: this.mpSpentThisAction,
            };
            const resolver = new CardEffectResolver(ctx);
            const results = resolver.resolve([effect]);

            this.logger.logPowerTrigger(side, fighter.name, cardDef.name, power.cardId, trigger, power.currentStacks);
            this.logger.logEffectResults(side, results, fighter.name, enemy.name);
        }
    }

    // ─── 周期结算 ────────────────────────────────────────

    /**
     * 周期结算：委托 CycleResolver 执行全部阶段，然后根据结果写日志和判定胜负。
     * @see battle-base.md §三 周期与状态结算
     */
    private resolveCycleEnd(): void {
        this.state.cycleCount++;
        const cycle = this.state.cycleCount;
        this.logger.setTime(this.state.tickCount, cycle);

        const result = this.cycleResolver.resolve(
            this.state.player.combatant,
            this.state.opponent.combatant,
            cycle,
        );

        this.logger.logPoisonDamage('player', this.state.player.name, result.playerPoison);
        this.logger.logPoisonDamage('opponent', this.state.opponent.name, result.opponentPoison);

        if (result.deathAfterPoison) {
            this.checkBattleEnd();
            return;
        }

        this.logger.logDecays('player', this.state.player.name, result.playerDecays);
        this.logger.logDecays('opponent', this.state.opponent.name, result.opponentDecays);

        if (result.overtime) {
            this.logger.logOvertime(
                result.overtime.damage,
                result.overtime.playerActual,
                result.overtime.opponentActual,
            );

            if (result.deathAfterOvertime) {
                this.checkBattleEnd();
                return;
            }
        }

        if (result.forceEnd) {
            this.applyBattleEnd('draw', BattleEndReason.FORCE_DRAW);
            return;
        }

        this.logger.logCycleEnd(cycle);
    }

    // ─── 战斗结束判定 ────────────────────────────────────

    /**
     * 检查 HP 死亡条件，委托 BattleEndChecker 判定。
     * @see battle-base.md §八 战斗结束条件
     */
    private checkBattleEnd(): boolean {
        if (this.state.isFinished) return true;

        const result = this.endChecker.checkDeath(
            this.state.player.combatant,
            this.state.opponent.combatant,
        );

        if (result.ended) {
            this.applyBattleEnd(result.winner!, result.reason!);
            return true;
        }

        return false;
    }

    /**
     * 应用战斗结束状态并写日志。
     */
    private applyBattleEnd(
        winner: 'player' | 'opponent' | 'draw',
        reason: BattleEndReason,
    ): void {
        this.state.isFinished = true;
        this.state.winner = winner;

        this.logger.logBattleEnd(
            { ended: true, winner, reason },
            this.state.player.name,
            this.state.opponent.name,
        );
    }

    // ─── 卡组管理（委托 DeckRunner）─────────────────────

    /** 暴露 DeckRunner 供外部查询（如 UI 层预览接下来的卡牌） */
    getDeckRunner(): DeckRunner {
        return this.deckRunner;
    }

    // ─── Buff 持续时间递减 ───────────────────────────────

    private tickBuffDurations(combatant: RuntimeCombatant): void {
        combatant.buffs = combatant.buffs.filter(buff => {
            if (buff.remaining === -1) return true;
            buff.remaining--;
            return buff.remaining > 0;
        });
    }

    // ─── 基础工具 ────────────────────────────────────────

    private getFighter(side: 'player' | 'opponent'): BattleFighter {
        return side === 'player' ? this.state.player : this.state.opponent;
    }

    private getEnemy(side: 'player' | 'opponent'): BattleFighter {
        return side === 'player' ? this.state.opponent : this.state.player;
    }

    // ─── 日志（委托 BattleLogger）─────────────────────────

    /** 暴露 BattleLogger 供外部查询（UI 层/回放系统） */
    getLogger(): BattleLogger {
        return this.logger;
    }
}

// ─── 模块工具函数 ────────────────────────────────────────

function cloneFighter(f: BattleFighter): BattleFighter {
    return {
        name: f.name,
        combatant: {
            ...f.combatant,
            activePowers: f.combatant.activePowers.map(p => ({ ...p })),
            buffs: f.combatant.buffs.map(b => ({ ...b })),
        },
        deck: f.deck.map(c => ({ ...c })),
        relics: [...f.relics],
    };
}
