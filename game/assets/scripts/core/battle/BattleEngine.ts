import {
    BattleState, BattleFighter, BattleConfig, DEFAULT_BATTLE_CONFIG,
    BattleLogType,
} from '../../types/BattleTypes';
import { CardDef, CardEffect, CardInstance } from '../../types/CardTypes';
import { RuntimeCombatant } from '../../types/CharacterTypes';
import { CardType, PowerTrigger, BuffType } from '../../types/Enums';
import {
    getEffectiveSpeed, isFrozen, isAlive, spendMp, recoverMp,
    applyHpDamage,
} from '../character/EffectiveStats';
import {
    CardEffectResolver, ResolveContext, EffectResult, EffectResultType,
} from '../card/CardEffectResolver';
import { SeededRandom } from '../utils/SeededRandom';

// ─── 外部依赖接口 ────────────────────────────────────────

/** 卡牌定义查询接口，由外部提供（如静态数据表） */
export interface CardRegistry {
    getCardDef(defId: string): CardDef | undefined;
}

// ─── 工具函数 ────────────────────────────────────────────

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

// ─── 战斗引擎 ────────────────────────────────────────────

/**
 * ATB 战斗引擎。
 *
 * 以 tick 为最小时间单位推进战斗：每 tick 双方行动槽各加有效速度，
 * 行动槽 ≥ 阈值时触发行动（出牌），每 100 tick 触发周期结算。
 *
 * 引擎是纯逻辑层，不依赖引擎 API。UI 层通过 getState() 读取状态渲染画面。
 *
 * @see battle-base.md §二 ATB 系统
 */
export class BattleEngine {
    private readonly state: BattleState;
    private readonly config: BattleConfig;
    private readonly rng: SeededRandom;
    private readonly cardRegistry: CardRegistry;

    private cardsPlayedThisAction = 0;
    private mpSpentThisAction = 0;

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

        this.state = {
            player: cloneFighter(player),
            opponent: cloneFighter(opponent),
            tickCount: 0,
            cycleCount: 0,
            isFinished: false,
            winner: null,
            log: [],
        };
    }

    getState(): Readonly<BattleState> {
        return this.state;
    }

    /** 推进一个 tick。返回 true 表示战斗已结束。 */
    runTick(): boolean {
        if (this.state.isFinished) return true;

        this.state.tickCount++;

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
            this.endBattle('draw');
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
     * 处理当前卡组指针位置的卡牌：判定 MP → 出牌/跳过 → 处理 POWER/CURSE 特殊逻辑 → 推进指针。
     */
    private processCard(side: 'player' | 'opponent'): void {
        const fighter = this.getFighter(side);
        const enemy = this.getEnemy(side);
        const combatant = fighter.combatant;
        const deck = fighter.deck;

        if (deck.length === 0) return;

        const cardInstance = deck[combatant.deckIndex];
        const cardDef = this.cardRegistry.getCardDef(cardInstance.defId);
        if (!cardDef) {
            this.advanceDeckIndex(combatant, deck);
            return;
        }

        const manaCost = this.getEffectiveManaCost(cardDef, cardInstance, combatant);
        const isForced = cardDef.cardType === CardType.CURSE && cardDef.forcePlay;

        if (combatant.currentMp >= manaCost || isForced) {
            this.playCard(side, fighter, enemy, cardDef, cardInstance, manaCost);
        } else {
            this.addLog(side, BattleLogType.SKIP_CARD,
                `${fighter.name} MP不足(${combatant.currentMp}/${manaCost})，跳过「${cardDef.name}」`,
                { cardId: cardDef.id, required: manaCost, current: combatant.currentMp });
            this.advanceDeckIndex(combatant, deck);
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

        this.addLog(side, BattleLogType.PLAY_CARD,
            `${fighter.name} 打出「${cardDef.name}」(${actualCost}MP)`,
            { cardId: cardDef.id, manaCost: actualCost });

        const targetWasFrozen = isFrozen(enemy.combatant, this.config);

        const ctx: ResolveContext = {
            caster: combatant,
            target: enemy.combatant,
            targetDeck: enemy.deck,
            cardDef,
            rng: this.rng,
            config: this.config,
            cycleCount: this.state.cycleCount,
            cardsPlayedThisTurn: this.cardsPlayedThisAction,
            mpSpentThisTurn: this.mpSpentThisAction,
        };
        const resolver = new CardEffectResolver(ctx);
        const results = resolver.resolve(cardDef.effects);
        this.logEffectResults(side, results, fighter.name);

        if (!targetWasFrozen && isFrozen(enemy.combatant, this.config)) {
            this.addLog(side, BattleLogType.FREEZE,
                `${enemy.name} 被冻结`,
                { frostStacks: enemy.combatant.frostStacks });
        }

        this.triggerPowers(side, PowerTrigger.ON_PLAY_CARD);

        if (cardDef.cardType === CardType.POWER && cardDef.power) {
            this.activatePower(combatant, cardDef);
            this.removeCurrentCard(combatant, deck);
            return;
        }

        if (cardDef.cardType === CardType.CURSE && cardDef.removeAfterPlay) {
            this.removeCurrentCard(combatant, deck);
            return;
        }

        this.advanceDeckIndex(combatant, deck);
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
                cycleCount: this.state.cycleCount,
                cardsPlayedThisTurn: this.cardsPlayedThisAction,
                mpSpentThisTurn: this.mpSpentThisAction,
            };
            const resolver = new CardEffectResolver(ctx);
            const results = resolver.resolve([effect]);

            this.addLog(side, BattleLogType.POWER_TRIGGER,
                `${fighter.name}「${cardDef.name}」效果触发`,
                { cardId: power.cardId, trigger, stacks: power.currentStacks });
            this.logEffectResults(side, results, fighter.name);
        }
    }

    // ─── 周期结算 ────────────────────────────────────────

    /**
     * 周期结算：毒伤 → 状态衰减 → MP 回复 → 加时伤害 → 超时判定。
     * @see battle-base.md §三 周期与状态结算
     */
    private resolveCycleEnd(): void {
        this.state.cycleCount++;
        const cycle = this.state.cycleCount;

        this.resolvePoisonDamage('player');
        this.resolvePoisonDamage('opponent');
        if (this.checkBattleEnd()) return;

        this.decayStatuses('player');
        this.decayStatuses('opponent');

        recoverMp(this.state.player.combatant, this.config.mpRecoveryPerCycle);
        recoverMp(this.state.opponent.combatant, this.config.mpRecoveryPerCycle);

        if (cycle >= this.config.overtimeStartCycle) {
            const damage = 1 + (cycle - this.config.overtimeStartCycle) * 2;
            const pActual = applyHpDamage(this.state.player.combatant, damage);
            const oActual = applyHpDamage(this.state.opponent.combatant, damage);

            this.addLog('system', BattleLogType.OVERTIME_DAMAGE,
                `加时伤害：双方各受${damage}点伤害`,
                { damage, playerActual: pActual, opponentActual: oActual });

            if (this.checkBattleEnd()) return;
        }

        if (cycle >= this.config.forceEndCycle) {
            this.endBattle('draw');
            return;
        }

        this.addLog('system', BattleLogType.CYCLE_END,
            `第${cycle}周期结算完成`,
            { cycle });
    }

    private resolvePoisonDamage(side: 'player' | 'opponent'): void {
        const fighter = this.getFighter(side);
        const combatant = fighter.combatant;
        if (combatant.poisonStacks <= 0) return;

        const actual = applyHpDamage(combatant, combatant.poisonStacks);
        this.addLog('system', BattleLogType.DAMAGE,
            `${fighter.name} 受到${actual}点毒药伤害(${combatant.poisonStacks}层)`,
            { damage: actual, source: 'poison' });
    }

    /** 霜蚀和毒药衰减。灼烧不自然衰减。 */
    private decayStatuses(side: 'player' | 'opponent'): void {
        const fighter = this.getFighter(side);
        const combatant = fighter.combatant;

        if (combatant.frostStacks > 0) {
            const wasFrozen = isFrozen(combatant, this.config);
            const decay = Math.min(combatant.frostStacks, this.config.frostDecayPerCycle);
            combatant.frostStacks -= decay;

            this.addLog('system', BattleLogType.STATUS_DECAY,
                `${fighter.name} 霜蚀-${decay}(剩余${combatant.frostStacks})`,
                { status: 'frost', decay, remaining: combatant.frostStacks });

            if (wasFrozen && !isFrozen(combatant, this.config)) {
                combatant.actionGauge = 0;
                this.addLog('system', BattleLogType.UNFREEZE,
                    `${fighter.name} 解除冻结`, {});
            }
        }

        if (combatant.poisonStacks > 0) {
            const decay = Math.min(combatant.poisonStacks, this.config.poisonDecayPerCycle);
            combatant.poisonStacks -= decay;

            this.addLog('system', BattleLogType.STATUS_DECAY,
                `${fighter.name} 毒药-${decay}(剩余${combatant.poisonStacks})`,
                { status: 'poison', decay, remaining: combatant.poisonStacks });
        }
    }

    // ─── 战斗结束判定 ────────────────────────────────────

    /**
     * 检查战斗结束条件。双方同时死亡时攻方（玩家）判定胜利。
     * @see battle-base.md §八 战斗结束条件
     */
    private checkBattleEnd(): boolean {
        if (this.state.isFinished) return true;

        const pAlive = isAlive(this.state.player.combatant);
        const oAlive = isAlive(this.state.opponent.combatant);

        if (!pAlive && !oAlive) {
            this.endBattle('player');
            return true;
        }
        if (!oAlive) {
            this.endBattle('player');
            return true;
        }
        if (!pAlive) {
            this.endBattle('opponent');
            return true;
        }

        return false;
    }

    private endBattle(winner: 'player' | 'opponent' | 'draw'): void {
        this.state.isFinished = true;
        this.state.winner = winner;

        const msg = winner === 'draw'
            ? '战斗超时，平局'
            : `${this.getFighter(winner).name} 获胜`;
        this.addLog('system', BattleLogType.BATTLE_END, msg, { winner });
    }

    // ─── 卡组管理 ────────────────────────────────────────

    private advanceDeckIndex(combatant: RuntimeCombatant, deck: CardInstance[]): void {
        if (deck.length === 0) return;
        combatant.deckIndex = (combatant.deckIndex + 1) % deck.length;
    }

    /** 移除当前指针位置的卡牌（POWER 打出后 / CURSE 打出后移除）。 */
    private removeCurrentCard(combatant: RuntimeCombatant, deck: CardInstance[]): void {
        deck.splice(combatant.deckIndex, 1);
        if (deck.length > 0 && combatant.deckIndex >= deck.length) {
            combatant.deckIndex = 0;
        }
    }

    private getEffectiveManaCost(
        cardDef: CardDef, cardInstance: CardInstance, combatant: RuntimeCombatant,
    ): number {
        let cost = cardDef.manaCost;

        if (cardInstance.upgraded && cardInstance.upgradePath === 'cost') {
            cost = Math.max(0, cost - cardDef.upgrade.costReduction);
        }

        let reduction = 0;
        for (const buff of combatant.buffs) {
            if (buff.type === BuffType.COST_REDUCTION) {
                reduction += buff.value;
            }
        }
        return Math.max(0, cost - reduction);
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

    // ─── 日志 ────────────────────────────────────────────

    private addLog(
        actor: 'player' | 'opponent' | 'system',
        type: BattleLogType,
        message: string,
        details?: Record<string, unknown>,
    ): void {
        this.state.log.push({
            tick: this.state.tickCount,
            cycle: this.state.cycleCount,
            actor,
            type,
            message,
            details,
        });
    }

    private logEffectResults(
        side: 'player' | 'opponent',
        results: EffectResult[],
        actorName: string,
    ): void {
        const enemyName = this.getEnemy(side).name;

        for (const r of results) {
            switch (r.type) {
                case EffectResultType.DAMAGE:
                    if (r.value != null && r.value > 0) {
                        this.addLog(side, BattleLogType.DAMAGE,
                            `${enemyName} 受到${r.value}点伤害${r.detail === 'ignore_armor' ? '(无视护甲)' : ''}`,
                            { damage: r.value, ignoreArmor: r.detail === 'ignore_armor' });
                    }
                    break;
                case EffectResultType.ARMOR_GAIN:
                    if (r.value != null && r.value > 0) {
                        this.addLog(side, BattleLogType.ARMOR_GAIN,
                            `${actorName} 获得${r.value}点护甲`, { armor: r.value });
                    }
                    break;
                case EffectResultType.HEAL_HP:
                    if (r.value != null && r.value > 0) {
                        this.addLog(side, BattleLogType.HEAL,
                            `${actorName} 回复${r.value}HP`, { hp: r.value });
                    }
                    break;
                case EffectResultType.HEAL_MP:
                    if (r.value != null && r.value > 0) {
                        this.addLog(side, BattleLogType.HEAL,
                            `${actorName} 回复${r.value}MP`, { mp: r.value });
                    }
                    break;
                case EffectResultType.STATUS_APPLY:
                    this.addLog(side, BattleLogType.STATUS_APPLY,
                        `${enemyName} 被施加${r.value}层${r.detail}`,
                        { status: r.detail, stacks: r.value });
                    break;
                case EffectResultType.DRAIN:
                    this.addLog(side, BattleLogType.DRAIN,
                        `${actorName} 汲取${r.value}点${r.detail}`,
                        { attribute: r.detail, amount: r.value });
                    break;
                case EffectResultType.CURSE_INSERT:
                    this.addLog(side, BattleLogType.CURSE_INSERT,
                        `向${enemyName}卡组插入${r.value}张诅咒卡`,
                        { count: r.value, curseId: r.detail });
                    break;
                default:
                    break;
            }
        }
    }
}
