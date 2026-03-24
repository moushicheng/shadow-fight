import {
    StatusType, ConditionType, ConditionOperator,
    CurseInsertPosition, DrainAttribute, BuffType, EffectTarget, CardType,
} from '../../types/Enums';
import {
    CardEffect, EffectCondition, DamageEffect, CardDef, CardInstance,
} from '../../types/CardTypes';
import { RuntimeCombatant } from '../../types/CharacterTypes';
import { BattleConfig } from '../../types/BattleTypes';
import { getHpPercent, getEffectiveAttack, healHp, recoverMp, gainArmor, isFrozen } from '../character/EffectiveStats';
import { DamageCalculator } from '../battle/DamageCalculator';
import { StatusManager } from '../battle/StatusManager';
import { SeededRandom } from '../utils/SeededRandom';

// ─── 解析结果 ──────────────────────────────────────────

/** 单个效果执行后的结果记录，供日志和 UI 使用 */
export interface EffectResult {
    type: EffectResultType;
    value?: number;
    detail?: string;
}

export enum EffectResultType {
    DAMAGE = 'DAMAGE',
    ARMOR_GAIN = 'ARMOR_GAIN',
    HEAL_HP = 'HEAL_HP',
    HEAL_MP = 'HEAL_MP',
    STATUS_APPLY = 'STATUS_APPLY',
    DRAIN = 'DRAIN',
    CURSE_INSERT = 'CURSE_INSERT',
    BUFF_APPLY = 'BUFF_APPLY',
    SPECIAL = 'SPECIAL',
    SKIP_CONDITION = 'SKIP_CONDITION',
}

// ─── 战斗上下文 ────────────────────────────────────────

/** 解析器执行时需要的上下文 */
export interface ResolveContext {
    /** 效果发起者 */
    caster: RuntimeCombatant;
    /** 效果承受者 */
    target: RuntimeCombatant;
    /** 施法者的有序卡组（洁净等自身卡组操作用） */
    casterDeck: CardInstance[];
    /** 目标的有序卡组（诅咒插入用） */
    targetDeck: CardInstance[];
    /** 触发此效果的卡牌定义 */
    cardDef: CardDef;
    /** 随机数生成器 */
    rng: SeededRandom;
    /** 战斗配置 */
    config: BattleConfig;
    /** 状态效果管理器 */
    statusManager: StatusManager;
    /** 当前周期数（用于条件判断） */
    cycleCount: number;
    /** 本回合已出牌数（用于条件判断） */
    cardsPlayedThisTurn: number;
    /** 本回合已消耗 MP（用于条件判断） */
    mpSpentThisTurn: number;
    /** 可用卡牌 ID 池（变化效果用，基于当前流派池生成） */
    cardPool?: string[];
}

// ─── 主类 ──────────────────────────────────────────────

/**
 * 卡牌效果解析器。
 * 每次结算一张卡牌时创建实例，传入上下文后调用 resolve()。
 */
export class CardEffectResolver {
    private readonly ctx: ResolveContext;

    constructor(ctx: ResolveContext) {
        this.ctx = ctx;
    }

    // ─── 主入口 ────────────────────────────────────────

    /**
     * 解析并执行一张卡牌的所有效果。
     * 按 effects 数组顺序依次结算，返回所有执行结果。
     */
    resolve(effects: CardEffect[]): EffectResult[] {
        const results: EffectResult[] = [];
        for (const effect of effects) {
            results.push(...this.resolveSingle(effect));
        }
        return results;
    }

    /**
     * 解析并执行单个 CardEffect 节点。
     * 先判条件，再按子效果类型依次执行。
     */
    resolveSingle(effect: CardEffect): EffectResult[] {
        if (effect.condition) {
            const met = this.evaluateCondition(effect.condition);
            if (!met) {
                if (effect.condition.fallback) {
                    return this.resolveSingle(effect.condition.fallback);
                }
                return [{ type: EffectResultType.SKIP_CONDITION, detail: 'condition not met' }];
            }
        }

        const receiver = effect.target === EffectTarget.SELF ? this.ctx.caster : this.ctx.target;
        const results: EffectResult[] = [];

        if (effect.damage) {
            results.push(this.resolveDamage(effect.damage, receiver));
        }
        if (effect.armor) {
            results.push(this.resolveArmor(effect));
        }
        if (effect.heal) {
            results.push(...this.resolveHeal(effect));
        }
        if (effect.status) {
            results.push(...this.resolveStatus(effect, receiver));
        }
        if (effect.drain) {
            results.push(this.resolveDrain(effect));
        }
        if (effect.curse) {
            results.push(this.resolveCurse(effect));
        }
        if (effect.buff) {
            results.push(this.resolveBuff(effect));
        }
        if (effect.special) {
            results.push(this.resolveSpecial(effect));
        }

        return results;
    }

    // ─── 条件判定 ──────────────────────────────────────

    private evaluateCondition(cond: EffectCondition): boolean {
        const actual = this.getConditionValue(cond.type);
        return CardEffectResolver.compare(actual, cond.operator, cond.value);
    }

    private getConditionValue(type: ConditionType): number {
        const { caster, target } = this.ctx;
        switch (type) {
            case ConditionType.HP_PERCENT:
                return getHpPercent(caster);
            case ConditionType.CURRENT_MP:
                return caster.currentMp;
            case ConditionType.CURRENT_ARMOR:
                return caster.armor;
            case ConditionType.ENEMY_STATUS:
                return target.frostStacks + target.burnStacks + target.poisonStacks;
            case ConditionType.TURN_COUNT:
                return this.ctx.cycleCount;
            case ConditionType.CARDS_PLAYED_THIS_TURN:
                return this.ctx.cardsPlayedThisTurn;
            case ConditionType.MP_SPENT_THIS_TURN:
                return this.ctx.mpSpentThisTurn;
            default:
                return 0;
        }
    }

    private static compare(actual: number, op: ConditionOperator, threshold: number): boolean {
        switch (op) {
            case ConditionOperator.GTE: return actual >= threshold;
            case ConditionOperator.LTE: return actual <= threshold;
            case ConditionOperator.GT: return actual > threshold;
            case ConditionOperator.LT: return actual < threshold;
            case ConditionOperator.EQ: return actual === threshold;
            default: return false;
        }
    }

    // ─── 伤害解析 ──────────────────────────────────────

    private resolveDamage(dmg: DamageEffect, receiver: RuntimeCombatant): EffectResult {
        const formulaVars = DamageCalculator.buildFormulaVars(this.ctx.caster, this.ctx.target, {
            mpSpentThisTurn: this.ctx.mpSpentThisTurn,
        });
        let baseDamage = DamageCalculator.evaluateBaseDamage(dmg, this.ctx.caster, formulaVars);

        if (this.ctx.cardDef.cardType === CardType.ATTACK) {
            baseDamage += getEffectiveAttack(this.ctx.caster);
        }

        const burnPercent = this.getEffectiveBurnPercent();

        const result = DamageCalculator.applyDamage(
            baseDamage, this.ctx.caster, receiver,
            this.ctx.target.burnStacks, burnPercent,
            dmg.ignoreArmor ?? false,
        );

        return {
            type: EffectResultType.DAMAGE,
            value: result.actualHpDamage,
            detail: dmg.ignoreArmor ? 'ignore_armor' : undefined,
        };
    }

    // ─── 护甲解析 ──────────────────────────────────────

    private resolveArmor(effect: CardEffect): EffectResult {
        const armorEff = effect.armor!;
        const receiver = effect.target === EffectTarget.SELF ? this.ctx.caster : this.ctx.target;
        let amount = armorEff.gain ?? 0;

        if (armorEff.scaling) {
            const attrValue = DamageCalculator.getAttributeValue(armorEff.scaling.attribute, this.ctx.caster);
            amount += Math.floor(attrValue * armorEff.scaling.multiplier);
        }

        const bonus = CardEffectResolver.sumBuffValue(receiver, BuffType.ARMOR_BONUS);
        amount += bonus;

        gainArmor(receiver, amount);
        return { type: EffectResultType.ARMOR_GAIN, value: amount };
    }

    // ─── 回复解析 ──────────────────────────────────────

    private resolveHeal(effect: CardEffect): EffectResult[] {
        const healEff = effect.heal!;
        const receiver = effect.target === EffectTarget.SELF ? this.ctx.caster : this.ctx.target;
        const results: EffectResult[] = [];

        if (healEff.hp != null && healEff.hp > 0) {
            const healed = healHp(receiver, healEff.hp);
            results.push({ type: EffectResultType.HEAL_HP, value: healed });
        }
        if (healEff.hpPercent != null && healEff.hpPercent > 0) {
            const amount = Math.floor(receiver.maxHp * healEff.hpPercent);
            const healed = healHp(receiver, amount);
            results.push({ type: EffectResultType.HEAL_HP, value: healed });
        }
        if (healEff.mp != null && healEff.mp > 0) {
            const recovered = recoverMp(receiver, healEff.mp);
            results.push({ type: EffectResultType.HEAL_MP, value: recovered });
        }

        return results;
    }

    // ─── 状态效果解析 ──────────────────────────────────

    private resolveStatus(effect: CardEffect, receiver: RuntimeCombatant): EffectResult[] {
        const statusEff = effect.status!;

        if (statusEff.type === StatusType.FROST && isFrozen(receiver)) {
            const multiplier = this.getEternalWinterMultiplier();
            const shatter = this.ctx.statusManager.applyFrostDuringFreeze(
                receiver, statusEff.stacks, multiplier,
            );
            return [{
                type: EffectResultType.SPECIAL,
                value: shatter.actualHpDamage,
                detail: 'FROST_SHATTER',
            }];
        }

        const result = this.ctx.statusManager.applyStatus(
            receiver, statusEff.type, statusEff.stacks, this.ctx.cycleCount,
        );

        const results: EffectResult[] = [{
            type: EffectResultType.STATUS_APPLY,
            value: result.stacksApplied,
            detail: statusEff.type,
        }];

        if (result.frozenTransition === 'frozen' && result.frostConsumed) {
            results.push({
                type: EffectResultType.SPECIAL,
                value: result.frostConsumed,
                detail: 'FREEZE_TRIGGER',
            });
        }

        return results;
    }

    // ─── 汲取解析 ──────────────────────────────────────

    private resolveDrain(effect: CardEffect): EffectResult {
        const drainEff = effect.drain!;
        const amount = drainEff.amount;
        const { caster, target, cardDef } = this.ctx;

        switch (drainEff.attribute) {
            case DrainAttribute.ATK: {
                CardEffectResolver.addBuff(target, BuffType.ATK_DEBUFF, amount, -1, cardDef.id);
                CardEffectResolver.addBuff(caster, BuffType.DAMAGE_BONUS, amount, -1, cardDef.id);
                break;
            }
            case DrainAttribute.SPD: {
                CardEffectResolver.addBuff(target, BuffType.SPEED_DEBUFF, amount, -1, cardDef.id);
                CardEffectResolver.addBuff(caster, BuffType.SPEED_BONUS, amount, -1, cardDef.id);
                break;
            }
            case DrainAttribute.ARMOR: {
                const stolen = Math.min(target.armor, amount);
                target.armor -= stolen;
                gainArmor(caster, stolen);
                break;
            }
        }

        return {
            type: EffectResultType.DRAIN,
            value: amount,
            detail: drainEff.attribute,
        };
    }

    // ─── 诅咒插入解析 ──────────────────────────────────

    private resolveCurse(effect: CardEffect): EffectResult {
        const curseEff = effect.curse!;
        const { target, targetDeck, rng } = this.ctx;

        for (let i = 0; i < curseEff.count; i++) {
            const curseCard: CardInstance = { defId: curseEff.cardId, upgraded: false };
            const insertIdx = CardEffectResolver.calcCurseInsertIndex(
                curseEff.insertPosition, target.deckIndex, targetDeck.length, rng,
            );
            targetDeck.splice(insertIdx, 0, curseCard);

            if (insertIdx <= target.deckIndex) {
                target.deckIndex++;
            }
        }

        return {
            type: EffectResultType.CURSE_INSERT,
            value: curseEff.count,
            detail: curseEff.cardId,
        };
    }

    private static calcCurseInsertIndex(
        position: CurseInsertPosition,
        currentIdx: number,
        deckLength: number,
        rng: SeededRandom,
    ): number {
        switch (position) {
            case CurseInsertPosition.NEXT:
                return Math.min(currentIdx + 1, deckLength);
            case CurseInsertPosition.TOP:
                return 0;
            case CurseInsertPosition.RANDOM:
            default: {
                const min = currentIdx + 1;
                const max = deckLength;
                if (min >= max) return deckLength;
                return rng.nextInt(min, max);
            }
        }
    }

    // ─── Buff 施加解析 ─────────────────────────────────

    private resolveBuff(effect: CardEffect): EffectResult {
        const buffEff = effect.buff!;
        const receiver = effect.target === EffectTarget.SELF ? this.ctx.caster : this.ctx.target;
        CardEffectResolver.addBuff(receiver, buffEff.type, buffEff.value, buffEff.duration, this.ctx.cardDef.id);

        return {
            type: EffectResultType.BUFF_APPLY,
            value: buffEff.value,
            detail: buffEff.type,
        };
    }

    // ─── 特殊效果解析 ──────────────────────────────────

    private resolveSpecial(effect: CardEffect): EffectResult {
        const specialEff = effect.special!;
        const { caster, target } = this.ctx;

        switch (specialEff.type) {
            case 'DETONATE': {
                const multiplier = (specialEff.params['multiplier'] as number) ?? 1.5;
                const result = this.ctx.statusManager.detonate(target, multiplier);
                return { type: EffectResultType.SPECIAL, value: result.actualHpDamage, detail: 'DETONATE' };
            }

            case 'DETONATE_BURN': {
                const multiplier = (specialEff.params['multiplier'] as number) ?? 1.0;
                const stacks = target.burnStacks;
                target.burnStacks = 0;
                const rawDmg = Math.floor(stacks * multiplier);
                if (rawDmg > 0) {
                    const dmgResult = DamageCalculator.applyRawDamage(rawDmg, target, false);
                    return { type: EffectResultType.SPECIAL, value: dmgResult.actualHpDamage, detail: 'DETONATE_BURN' };
                }
                return { type: EffectResultType.SPECIAL, value: 0, detail: 'DETONATE_BURN' };
            }

            case 'PARTIAL_DETONATE': {
                const consumeStacks = (specialEff.params['consumeStacks'] as number) ?? 5;
                const consumed = Math.min(target.burnStacks, consumeStacks);
                target.burnStacks -= consumed;
                return { type: EffectResultType.SPECIAL, value: consumed, detail: 'PARTIAL_DETONATE' };
            }

            case 'FROST_SCALING': {
                const perStack = (specialEff.params['perStack'] as number) ?? 0.5;
                const bonusDmg = Math.floor(target.frostStacks * perStack);
                if (bonusDmg > 0) {
                    const dmgResult = DamageCalculator.applyRawDamage(bonusDmg, target, false);
                    return { type: EffectResultType.SPECIAL, value: dmgResult.actualHpDamage, detail: 'FROST_SCALING' };
                }
                return { type: EffectResultType.SPECIAL, value: 0, detail: 'FROST_SCALING' };
            }

            case 'FROZEN_BONUS_DAMAGE': {
                const bonusDamage = (specialEff.params['bonusDamage'] as number) ?? 0;
                if (isFrozen(target) && bonusDamage > 0) {
                    const dmgResult = DamageCalculator.applyRawDamage(bonusDamage, target, false);
                    return { type: EffectResultType.SPECIAL, value: dmgResult.actualHpDamage, detail: 'FROZEN_BONUS_DAMAGE' };
                }
                return { type: EffectResultType.SPECIAL, value: 0, detail: 'FROZEN_BONUS_DAMAGE' };
            }

            case 'FROST_NO_DECAY': {
                return { type: EffectResultType.SPECIAL, value: 0, detail: 'FROST_NO_DECAY' };
            }

            case 'CONVERT_ATTRIBUTE': {
                const from = specialEff.params['from'] as string;
                const to = specialEff.params['to'] as string;
                const maxAmount = (specialEff.params['maxAmount'] as number) ?? 8;
                CardEffectResolver.convertAttribute(caster, from, to, maxAmount);
                return { type: EffectResultType.SPECIAL, value: maxAmount, detail: 'CONVERT_ATTRIBUTE' };
            }

            case 'REMOVE_NEXT_CARDS': {
                const count = (specialEff.params['count'] as number) ?? 3;
                const removed = CardEffectResolver.removeNextCards(
                    caster, this.ctx.casterDeck, count,
                );
                return { type: EffectResultType.SPECIAL, value: removed, detail: 'REMOVE_NEXT_CARDS' };
            }

            case 'TRANSFORM_CARDS': {
                const transformCount = (specialEff.params['count'] as number) ?? 1;
                const upgraded = (specialEff.params['upgraded'] as boolean) ?? false;
                const transformed = CardEffectResolver.transformCards(
                    caster, this.ctx.casterDeck, this.ctx.cardPool ?? [],
                    transformCount, upgraded, this.ctx.rng,
                );
                return { type: EffectResultType.SPECIAL, value: transformed, detail: 'TRANSFORM_CARDS' };
            }

            default:
                return { type: EffectResultType.SPECIAL, detail: specialEff.type };
        }
    }

    /**
     * 从施法者卡组中移除当前指针之后的 N 张卡。
     * 处理循环卡组的 wrap-around，保证至少保留 1 张卡。
     * 返回实际移除的张数。
     */
    private static removeNextCards(
        caster: RuntimeCombatant, deck: CardInstance[], count: number,
    ): number {
        let removed = 0;
        for (let i = 0; i < count; i++) {
            if (deck.length <= 1) break;

            const removeIdx = (caster.deckIndex + 1) % deck.length;
            deck.splice(removeIdx, 1);
            removed++;

            if (removeIdx <= caster.deckIndex) {
                caster.deckIndex--;
            }
            if (caster.deckIndex >= deck.length) {
                caster.deckIndex = deck.length > 0 ? deck.length - 1 : 0;
            }
        }
        return removed;
    }

    /**
     * 变化卡组中的卡牌。
     * count = -1 表示变化所有卡牌，正数则随机选 N 张变化。
     * 跳过当前正在打出的卡牌（即触发变化的那张）。
     * 返回实际变化的张数。
     */
    private static transformCards(
        caster: RuntimeCombatant, deck: CardInstance[], cardPool: string[],
        count: number, upgraded: boolean, rng: SeededRandom,
    ): number {
        if (cardPool.length === 0 || deck.length === 0) return 0;

        const currentIdx = caster.deckIndex;
        const transformAll = count === -1;
        let indices: number[];

        if (transformAll) {
            indices = [];
            for (let i = 0; i < deck.length; i++) {
                if (i !== currentIdx) indices.push(i);
            }
        } else {
            const candidates: number[] = [];
            for (let i = 0; i < deck.length; i++) {
                if (i !== currentIdx) candidates.push(i);
            }
            indices = [];
            const n = Math.min(count, candidates.length);
            for (let i = 0; i < n; i++) {
                const pick = rng.nextInt(0, candidates.length);
                indices.push(candidates[pick]);
                candidates.splice(pick, 1);
            }
        }

        for (const idx of indices) {
            const newDefId = cardPool[rng.nextInt(0, cardPool.length)];
            deck[idx] = {
                defId: newDefId,
                upgraded,
                upgradePath: upgraded ? 'enhance' : undefined,
            };
        }

        return indices.length;
    }

    private static convertAttribute(
        c: RuntimeCombatant, from: string, to: string, maxAmount: number,
    ): void {
        let available = 0;
        if (from === 'STR' || from === 'ATK') available = c.attack;
        else if (from === 'SPD') available = c.baseSpeed;

        const amount = Math.min(available, maxAmount);
        if (amount <= 0) return;

        if (from === 'STR' || from === 'ATK') c.attack -= amount;
        else if (from === 'SPD') c.baseSpeed -= amount;

        if (to === 'SPD') c.baseSpeed += amount;
        else if (to === 'STR' || to === 'ATK') c.attack += amount;
    }

    /** 检查施法者是否激活了永冬（ice_eternal_winter），返回霜蚀转伤害倍率 */
    private getEternalWinterMultiplier(): number {
        const hasEternalWinter = this.ctx.caster.activePowers.some(
            p => p.cardId === 'ice_eternal_winter',
        );
        return hasEternalWinter ? 2 : 1;
    }

    /**
     * 获取当前攻击的灼烧增伤系数。
     * 基础值来自 BattleConfig，激活永燃之心时翻倍。
     */
    private getEffectiveBurnPercent(): number {
        let percent = this.ctx.config.burnDamagePercentPerStack;
        const hasEternalFlame = this.ctx.caster.activePowers.some(
            p => p.cardId === 'fire_eternal_flame',
        );
        if (hasEternalFlame) {
            percent *= 2;
        }
        return percent;
    }

    // ─── 工具方法 ──────────────────────────────────────

    private static addBuff(
        target: RuntimeCombatant, type: BuffType, value: number,
        duration: number, sourceCardId: string,
    ): void {
        target.buffs.push({ type, value, remaining: duration, sourceCardId });
    }

    private static sumBuffValue(c: RuntimeCombatant, buffType: BuffType): number {
        let total = 0;
        for (const buff of c.buffs) {
            if (buff.type === buffType) {
                total += buff.value;
            }
        }
        return total;
    }
}
