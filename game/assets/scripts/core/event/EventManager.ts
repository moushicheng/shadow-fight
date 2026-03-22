import { EventCategory, Attribute } from '../../types/Enums';
import { GameEventDef, EventOption, EventEffect, EventEffectType } from '../../types/EventTypes';
import { RunState } from '../../types/RunTypes';
import { SeededRandom } from '../utils/SeededRandom';
import { FloorManager } from '../run/FloorManager';
import { calcMaxHp } from '../character/AttributeGenerator';

/** 事件执行结果（全路径模式） */
export interface EventResult {
    /** 执行的事件定义 */
    event: GameEventDef;
    /** 玩家选择路径（如 [0, 1] 表示选第 1 个选项后再选第 2 个子选项） */
    choicePath: number[];
    /** 全部步骤的执行日志（按路径顺序） */
    stepLogs: EventStepLog[];
}

/** 单步执行结果（分步模式） */
export interface EventStepResult {
    /** 本步选择的选项 */
    option: EventOption;
    /** 本步执行的效果日志 */
    effectLogs: EffectLog[];
    /** 是否还有下一层选项（true = 分支节点，需要继续选择） */
    hasNextOptions: boolean;
    /** 下一段叙事文本（分支节点才有） */
    nextDescription?: string;
    /** 下一段叙事插图（分支节点才有） */
    nextIllustration?: string;
    /** 下一层可选项列表（分支节点才有） */
    nextOptions?: EventOption[];
}

/** 单步的日志（包含步骤信息） */
export interface EventStepLog {
    /** 本步选择的选项文本 */
    optionText: string;
    /** 本步的效果日志 */
    effectLogs: EffectLog[];
}

/** 单个效果的执行日志 */
export interface EffectLog {
    type: EventEffectType;
    applied: boolean;
    description: string;
    /** 实际变化的数值（如 HP 变化量、金币变化量） */
    delta?: number;
}

/**
 * EventManager —— 事件系统核心逻辑。
 *
 * 职责：
 * - 管理事件定义池
 * - 按层数概率抽取事件类别（正面/中性/负面）
 * - 从对应类别中随机抽取具体事件
 * - 执行事件效果（修改 RunState）
 * - 记录已触发事件避免同局重复
 *
 * 不依赖引擎 API，可独立单元测试。
 */
export class EventManager {
    private readonly _eventPool: Map<string, GameEventDef> = new Map();
    private readonly _usedEventIds: Set<string> = new Set();

    /** 注册一批事件定义到事件池 */
    registerEvents(events: GameEventDef[]): void {
        for (const evt of events) {
            this._eventPool.set(evt.id, evt);
        }
    }

    /** 获取事件池大小 */
    get poolSize(): number {
        return this._eventPool.size;
    }

    /** 获取已使用的事件数 */
    get usedCount(): number {
        return this._usedEventIds.size;
    }

    /** 清空已使用记录（新局开始时调用） */
    resetUsedEvents(): void {
        this._usedEventIds.clear();
    }

    /** 清空事件池和已使用记录 */
    clear(): void {
        this._eventPool.clear();
        this._usedEventIds.clear();
    }

    /**
     * 为指定层抽取一个事件。
     *
     * 流程：
     * 1. 按层数概率 roll 事件类别
     * 2. 从该类别的可用事件中过滤（层数范围、未使用过、流派匹配）
     * 3. 随机选取一个
     *
     * @param floor 当前层数
     * @param rng 种子随机
     * @param factions 当前流派池（可选，用于筛选流派事件）
     * @returns 抽中的事件，若无可用事件则返回 null
     */
    drawEvent(
        floor: number,
        rng: SeededRandom,
        factions?: string[],
    ): GameEventDef | null {
        const category = FloorManager.rollEventCategory(floor, rng);
        return this.drawEventByCategory(category, floor, rng, factions);
    }

    /**
     * 从指定类别中抽取事件。
     * 若该类别无可用事件，尝试从其他类别 fallback。
     */
    drawEventByCategory(
        category: EventCategory,
        floor: number,
        rng: SeededRandom,
        factions?: string[],
    ): GameEventDef | null {
        const candidates = this.getCandidates(category, floor, factions);
        if (candidates.length > 0) {
            return this.pickAndMark(candidates, rng);
        }

        const fallbackOrder = [
            EventCategory.NEUTRAL,
            EventCategory.POSITIVE,
            EventCategory.NEGATIVE,
        ].filter(c => c !== category);

        for (const fb of fallbackOrder) {
            const fbCandidates = this.getCandidates(fb, floor, factions);
            if (fbCandidates.length > 0) {
                return this.pickAndMark(fbCandidates, rng);
            }
        }

        return null;
    }

    /**
     * 【分步模式】执行一步选择。
     *
     * UI 流程：
     * 1. 展示事件描述 + 选项列表
     * 2. 玩家选择 → 调用 executeStep(options, chosenIndex, state, rng)
     * 3. 如果 result.hasNextOptions === true，展示 nextDescription + nextOptions，回到步骤 2
     * 4. 如果 result.hasNextOptions === false，事件结束
     *
     * @param options 当前层的选项列表（首次传 event.options，后续传 result.nextOptions）
     * @param chosenIndex 玩家选择的选项索引
     */
    executeStep(
        options: EventOption[],
        chosenIndex: number,
        state: RunState,
        rng: SeededRandom,
    ): EventStepResult {
        const option = options[chosenIndex];
        if (!option) {
            return {
                option: { text: '', effects: [] },
                effectLogs: [],
                hasNextOptions: false,
            };
        }

        const effectLogs: EffectLog[] = [];
        for (const effect of option.effects) {
            effectLogs.push(this.applyEffect(effect, state, rng));
        }

        const hasNext = !!(option.nextOptions && option.nextOptions.length > 0);

        return {
            option,
            effectLogs,
            hasNextOptions: hasNext,
            nextDescription: hasNext ? option.nextDescription : undefined,
            nextIllustration: hasNext ? option.nextIllustration : undefined,
            nextOptions: hasNext ? option.nextOptions : undefined,
        };
    }

    /**
     * 【全路径模式】一次性按完整选择路径执行事件。
     *
     * 适用于测试 / AI 自动推进 / 回放。
     *
     * @param event 事件定义
     * @param choicePath 选择路径，如 [0, 2] = 选第 1 个选项 → 再选第 3 个子选项
     *                   路径长度 1 = 直接叶子选项，长度 N = N 层嵌套
     */
    executeEventByPath(
        event: GameEventDef,
        choicePath: number[],
        state: RunState,
        rng: SeededRandom,
    ): EventResult {
        const stepLogs: EventStepLog[] = [];
        let currentOptions: EventOption[] = event.options;

        for (const choiceIdx of choicePath) {
            const step = this.executeStep(currentOptions, choiceIdx, state, rng);
            stepLogs.push({
                optionText: step.option.text,
                effectLogs: step.effectLogs,
            });

            if (step.hasNextOptions && step.nextOptions) {
                currentOptions = step.nextOptions;
            } else {
                break;
            }
        }

        return { event, choicePath, stepLogs };
    }

    /**
     * 【兼容模式】单层选项快捷执行（无嵌套时等价于 executeEventByPath(event, [index], ...)）。
     */
    executeEvent(
        event: GameEventDef,
        optionIndex: number,
        state: RunState,
        rng: SeededRandom,
    ): EventResult {
        return this.executeEventByPath(event, [optionIndex], state, rng);
    }

    /**
     * 应用单个事件效果到 RunState。
     * 支持概率型效果（probability + fallback）。
     */
    applyEffect(
        effect: EventEffect,
        state: RunState,
        rng: SeededRandom,
    ): EffectLog {
        const prob = effect.probability ?? 1;
        if (!rng.chance(prob)) {
            if (effect.fallback) {
                return this.applyEffect(effect.fallback, state, rng);
            }
            return { type: effect.type, applied: false, description: '概率未触发' };
        }

        const value = effect.value ?? 0;

        switch (effect.type) {
            case EventEffectType.HEAL_HP:
                return this.applyHealHp(state, value);

            case EventEffectType.HEAL_HP_PERCENT:
                return this.applyHealHpPercent(state, value);

            case EventEffectType.DAMAGE_HP:
                return this.applyDamageHp(state, value);

            case EventEffectType.DAMAGE_HP_PERCENT:
                return this.applyDamageHpPercent(state, value);

            case EventEffectType.GAIN_GOLD:
                return this.applyGainGold(state, value);

            case EventEffectType.LOSE_GOLD:
                return this.applyLoseGold(state, value);

            case EventEffectType.MODIFY_ATTRIBUTE:
                return this.applyModifyAttribute(state, effect);

            case EventEffectType.GAIN_CARD:
                return {
                    type: effect.type,
                    applied: true,
                    description: '需要上层系统配合实现卡牌获取',
                };

            case EventEffectType.REMOVE_CARD:
                return this.applyRemoveCard(state, rng);

            case EventEffectType.GAIN_RELIC:
                return {
                    type: effect.type,
                    applied: true,
                    description: '需要上层系统配合实现遗物获取',
                };

            case EventEffectType.TEMP_BUFF:
                return this.applyTempBuff(state, effect);

            case EventEffectType.UPGRADE_RANDOM_CARD:
                return this.applyUpgradeRandomCard(state, rng);

            default:
                return {
                    type: effect.type,
                    applied: false,
                    description: `未知效果类型: ${effect.type}`,
                };
        }
    }

    // ─── 具体效果实现 ──────────────────────────────────────

    private applyHealHp(state: RunState, value: number): EffectLog {
        const before = state.currentHp;
        state.currentHp = Math.min(state.currentHp + value, state.maxHp);
        const delta = state.currentHp - before;
        return {
            type: EventEffectType.HEAL_HP,
            applied: true,
            description: `回复 ${delta} HP`,
            delta,
        };
    }

    private applyHealHpPercent(state: RunState, percent: number): EffectLog {
        const healAmount = Math.round(state.maxHp * percent);
        return this.applyHealHp(state, healAmount);
    }

    private applyDamageHp(state: RunState, value: number): EffectLog {
        const before = state.currentHp;
        state.currentHp = Math.max(state.currentHp - value, 1);
        const delta = before - state.currentHp;
        return {
            type: EventEffectType.DAMAGE_HP,
            applied: true,
            description: `失去 ${delta} HP`,
            delta: -delta,
        };
    }

    private applyDamageHpPercent(state: RunState, percent: number): EffectLog {
        const damageAmount = Math.round(state.maxHp * percent);
        return this.applyDamageHp(state, damageAmount);
    }

    private applyGainGold(state: RunState, value: number): EffectLog {
        state.gold += value;
        state.stats.goldEarned += value;
        return {
            type: EventEffectType.GAIN_GOLD,
            applied: true,
            description: `获得 ${value} 金币`,
            delta: value,
        };
    }

    private applyLoseGold(state: RunState, value: number): EffectLog {
        const actual = Math.min(value, state.gold);
        state.gold -= actual;
        state.stats.goldSpent += actual;
        return {
            type: EventEffectType.LOSE_GOLD,
            applied: true,
            description: `失去 ${actual} 金币`,
            delta: -actual,
        };
    }

    private applyModifyAttribute(state: RunState, effect: EventEffect): EffectLog {
        const attr = effect.params?.attribute as string | undefined;
        const value = effect.value ?? 0;

        if (!attr || !(attr in state.baseProperty)) {
            return {
                type: EventEffectType.MODIFY_ATTRIBUTE,
                applied: false,
                description: `无效属性: ${attr}`,
            };
        }

        const key = attr as keyof typeof state.baseProperty;
        const before = state.baseProperty[key];
        state.baseProperty[key] += value;

        if (key === Attribute.SPD && state.baseProperty[key] < 1) {
            state.baseProperty[key] = 1;
        }

        if (key === Attribute.CON) {
            const newMaxHp = calcMaxHp(state.baseProperty.CON);
            state.maxHp = newMaxHp;
            if (state.currentHp > newMaxHp) {
                state.currentHp = newMaxHp;
            }
        }

        const actual = state.baseProperty[key] - before;
        return {
            type: EventEffectType.MODIFY_ATTRIBUTE,
            applied: true,
            description: `${attr} ${actual >= 0 ? '+' : ''}${actual}`,
            delta: actual,
        };
    }

    private applyRemoveCard(state: RunState, rng: SeededRandom): EffectLog {
        if (state.deck.length === 0) {
            return {
                type: EventEffectType.REMOVE_CARD,
                applied: false,
                description: '卡组为空，无法移除',
            };
        }
        const idx = rng.nextInt(0, state.deck.length - 1);
        const removed = state.deck.splice(idx, 1)[0];
        state.stats.cardsRemoved += 1;
        return {
            type: EventEffectType.REMOVE_CARD,
            applied: true,
            description: `移除卡牌: ${removed.defId}`,
        };
    }

    private applyTempBuff(state: RunState, effect: EventEffect): EffectLog {
        const buffId = (effect.params?.buffId as string) ?? `event_buff_${Date.now()}`;
        const buffDesc = (effect.params?.description as string) ?? '临时增益';
        const buffType = effect.params?.buffType as string;
        const buffValue = effect.value ?? 0;

        if (!buffType) {
            return {
                type: EventEffectType.TEMP_BUFF,
                applied: false,
                description: '缺少 buffType 参数',
            };
        }

        state.tempBuffs.push({
            id: buffId,
            description: buffDesc,
            effects: [{ type: buffType as any, value: buffValue }],
        });

        return {
            type: EventEffectType.TEMP_BUFF,
            applied: true,
            description: `获得临时增益: ${buffDesc}`,
        };
    }

    private applyUpgradeRandomCard(state: RunState, rng: SeededRandom): EffectLog {
        const upgradable = state.deck.filter(c => !c.upgraded);
        if (upgradable.length === 0) {
            return {
                type: EventEffectType.UPGRADE_RANDOM_CARD,
                applied: false,
                description: '无可升级的卡牌',
            };
        }
        const card = rng.pick(upgradable);
        card.upgraded = true;
        return {
            type: EventEffectType.UPGRADE_RANDOM_CARD,
            applied: true,
            description: `升级卡牌: ${card.defId}`,
        };
    }

    // ─── 内部工具方法 ──────────────────────────────────────

    /**
     * 获取指定类别在当前层的候选事件列表。
     * 过滤条件：类别匹配、层数范围、未使用过、流派匹配（如有）。
     */
    private getCandidates(
        category: EventCategory,
        floor: number,
        factions?: string[],
    ): GameEventDef[] {
        const factionSet = factions ? new Set(factions) : null;
        const result: GameEventDef[] = [];

        for (const evt of this._eventPool.values()) {
            if (evt.category !== category) continue;
            if (floor < evt.floorMin || floor > evt.floorMax) continue;
            if (this._usedEventIds.has(evt.id)) continue;
            if (evt.faction && factionSet && !factionSet.has(evt.faction)) continue;
            result.push(evt);
        }

        return result;
    }

    private pickAndMark(candidates: GameEventDef[], rng: SeededRandom): GameEventDef {
        const picked = rng.pick(candidates);
        this._usedEventIds.add(picked.id);
        return picked;
    }
}
