import {
    Attribute, StatusType, ConditionType, ConditionOperator,
    CurseInsertPosition, DrainAttribute, BuffType, Faction, EffectTarget,
} from '../../types/Enums';
import {
    CardEffect, EffectCondition, DamageEffect, CardDef, CardInstance,
} from '../../types/CardTypes';
import { RuntimeCombatant, ActiveBuff } from '../../types/CharacterTypes';
import { BattleConfig, DEFAULT_BATTLE_CONFIG } from '../../types/BattleTypes';
import {
    getEffectiveAttack, getHpPercent, getLostHp,
    applyHpDamage, healHp, recoverMp, gainArmor, absorbByArmor,
} from '../character/EffectiveStats';
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
    /** 目标的有序卡组（诅咒插入用） */
    targetDeck: CardInstance[];
    /** 触发此效果的卡牌定义 */
    cardDef: CardDef;
    /** 随机数生成器 */
    rng: SeededRandom;
    /** 战斗配置 */
    config: BattleConfig;
    /** 当前周期数（用于条件判断） */
    cycleCount: number;
    /** 本回合已出牌数（用于条件判断） */
    cardsPlayedThisTurn: number;
    /** 本回合已消耗 MP（用于条件判断） */
    mpSpentThisTurn: number;
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
            results.push(this.resolveStatus(effect, receiver));
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
            case ConditionOperator.GT:  return actual > threshold;
            case ConditionOperator.LT:  return actual < threshold;
            case ConditionOperator.EQ:  return actual === threshold;
            default: return false;
        }
    }

    // ─── 伤害解析 ──────────────────────────────────────

    private resolveDamage(dmg: DamageEffect, receiver: RuntimeCombatant): EffectResult {
        let baseDamage = this.calcBaseDamage(dmg);

        // 灼烧加成：仅火系卡牌享受，额外伤害 = 目标灼烧层数
        if (this.ctx.cardDef.faction === Faction.FIRE) {
            baseDamage += this.ctx.target.burnStacks;
        }

        const damageMult = 1.0 + CardEffectResolver.sumBuffValue(this.ctx.caster, BuffType.DAMAGE_MULTIPLY);
        const damageBonus = CardEffectResolver.sumBuffValue(this.ctx.caster, BuffType.DAMAGE_BONUS);
        let finalDamage = Math.floor(baseDamage * damageMult + damageBonus);
        finalDamage = Math.max(0, finalDamage);

        // 易伤（目标身上的 VULNERABILITY buff）
        const vuln = CardEffectResolver.sumBuffValue(receiver, BuffType.VULNERABILITY);
        if (vuln > 0) {
            finalDamage = Math.floor(finalDamage * (1.0 + vuln));
        }

        // 减伤（目标身上的 DAMAGE_REDUCTION buff）
        const reduction = CardEffectResolver.sumBuffValue(receiver, BuffType.DAMAGE_REDUCTION);
        finalDamage = Math.max(0, finalDamage - reduction);

        let actualHpDamage: number;
        if (dmg.ignoreArmor) {
            actualHpDamage = applyHpDamage(receiver, finalDamage);
        } else {
            const afterArmor = absorbByArmor(receiver, finalDamage);
            actualHpDamage = applyHpDamage(receiver, afterArmor);
        }

        return {
            type: EffectResultType.DAMAGE,
            value: actualHpDamage,
            detail: dmg.ignoreArmor ? 'ignore_armor' : undefined,
        };
    }

    private calcBaseDamage(dmg: DamageEffect): number {
        let total = 0;

        if (dmg.base != null) {
            total += dmg.base;
        }
        if (dmg.scaling) {
            const attrValue = CardEffectResolver.getAttributeValue(dmg.scaling.attribute, this.ctx.caster);
            total += Math.floor(attrValue * dmg.scaling.multiplier);
        }
        if (dmg.formula) {
            total += this.evaluateFormula(dmg.formula);
        }

        return total;
    }

    private static getAttributeValue(attr: Attribute, c: RuntimeCombatant): number {
        switch (attr) {
            case Attribute.STR: return getEffectiveAttack(c);
            case Attribute.CON: return c.maxHp;
            case Attribute.SPD: return c.baseSpeed;
            case Attribute.MANA: return c.maxMp;
            default: return 0;
        }
    }

    /**
     * 简易公式求值器。
     * 支持预定义变量：lostHp, currentHp, maxHp, armor, currentMp, burnStacks 等。
     * 仅支持 "变量 * 数字" 或 "变量" 的简单表达式。
     */
    private evaluateFormula(formula: string): number {
        const { caster, target } = this.ctx;
        const vars: Record<string, number> = {
            lostHp: getLostHp(caster),
            currentHp: caster.currentHp,
            maxHp: caster.maxHp,
            armor: caster.armor,
            currentMp: caster.currentMp,
            atk: getEffectiveAttack(caster),
            spd: caster.baseSpeed,
            burnStacks: target.burnStacks,
            frostStacks: target.frostStacks,
            poisonStacks: target.poisonStacks,
            mpSpentThisTurn: this.ctx.mpSpentThisTurn,
        };

        const mulMatch = formula.match(/^\s*(\w+)\s*\*\s*([\d.]+)\s*$/);
        if (mulMatch) {
            const varName = mulMatch[1];
            const multiplier = parseFloat(mulMatch[2]);
            return Math.floor((vars[varName] ?? 0) * multiplier);
        }
        const mulMatch2 = formula.match(/^\s*([\d.]+)\s*\*\s*(\w+)\s*$/);
        if (mulMatch2) {
            const multiplier = parseFloat(mulMatch2[1]);
            const varName = mulMatch2[2];
            return Math.floor(multiplier * (vars[varName] ?? 0));
        }
        const trimmed = formula.trim();
        if (trimmed in vars) {
            return vars[trimmed];
        }

        return 0;
    }

    // ─── 护甲解析 ──────────────────────────────────────

    private resolveArmor(effect: CardEffect): EffectResult {
        const armorEff = effect.armor!;
        const receiver = effect.target === EffectTarget.SELF ? this.ctx.caster : this.ctx.target;
        let amount = armorEff.gain ?? 0;

        if (armorEff.scaling) {
            const attrValue = CardEffectResolver.getAttributeValue(armorEff.scaling.attribute, this.ctx.caster);
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

    private resolveStatus(effect: CardEffect, receiver: RuntimeCombatant): EffectResult {
        const statusEff = effect.status!;
        switch (statusEff.type) {
            case StatusType.FROST:
                receiver.frostStacks += statusEff.stacks;
                break;
            case StatusType.BURN:
                receiver.burnStacks += statusEff.stacks;
                break;
            case StatusType.POISON:
                receiver.poisonStacks += statusEff.stacks;
                break;
        }
        return {
            type: EffectResultType.STATUS_APPLY,
            value: statusEff.stacks,
            detail: statusEff.type,
        };
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
                const stacks = target.burnStacks;
                target.burnStacks = 0;
                const damage = Math.floor(stacks * multiplier);
                const afterArmor = absorbByArmor(target, damage);
                const actualDmg = applyHpDamage(target, afterArmor);
                return { type: EffectResultType.SPECIAL, value: actualDmg, detail: 'DETONATE' };
            }

            case 'CONVERT_ATTRIBUTE': {
                const from = specialEff.params['from'] as string;
                const to = specialEff.params['to'] as string;
                const maxAmount = (specialEff.params['maxAmount'] as number) ?? 8;
                CardEffectResolver.convertAttribute(caster, from, to, maxAmount);
                return { type: EffectResultType.SPECIAL, value: maxAmount, detail: 'CONVERT_ATTRIBUTE' };
            }

            default:
                return { type: EffectResultType.SPECIAL, detail: specialEff.type };
        }
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
