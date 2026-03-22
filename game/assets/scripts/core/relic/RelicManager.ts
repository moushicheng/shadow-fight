import { RelicRarity, RelicTrigger, Faction } from '../../types/Enums';
import { RelicDef, RelicCustomEffect } from '../../types/RelicTypes';
import { CardEffect } from '../../types/CardTypes';
import { RunState } from '../../types/RunTypes';
import { RelicDefLookup } from '../battle/BattleInitializer';
import { SeededRandom } from '../utils/SeededRandom';
import { FloorManager } from '../run/FloorManager';

// ─── 品质掉落权重 ─────────────────────────────────────

const RARITY_WEIGHTS: { rarity: RelicRarity; weight: number }[] = [
    { rarity: RelicRarity.NORMAL, weight: 0.60 },
    { rarity: RelicRarity.RARE, weight: 0.30 },
    { rarity: RelicRarity.LEGENDARY, weight: 0.10 },
];

const RARITY_ORDER: Record<RelicRarity, number> = {
    [RelicRarity.NORMAL]: 0,
    [RelicRarity.RARE]: 1,
    [RelicRarity.LEGENDARY]: 2,
};

// ─── 触发结果 ──────────────────────────────────────────

/** 遗物触发结果（用于 UI 展示和日志） */
export interface RelicTriggerResult {
    relicId: string;
    relicName: string;
    description: string;
    applied: boolean;
}

// ─── 主类 ──────────────────────────────────────────────

/**
 * RelicManager —— 遗物系统。
 *
 * 职责：
 * - 遗物注册表（实现 RelicDefLookup，供 BattleInitializer 查询）
 * - 品质随机（普通 60% / 稀有 30% / 传说 10%）
 * - 可用遗物过滤（层数、已拥有、品质、流派）
 * - 掉落判定（战斗后 20% 基础概率 / 精英 25% / 高星残影 +10%）
 * - 奖励生成（三选一候选列表）
 * - 获取与去重（加入 RunState.relics）
 * - 非战斗触发（ON_ENTER_SHOP 等作用于 RunState）
 * - 战斗触发支持（按触发时机查询持有遗物）
 *
 * 实例持有遗物定义注册表，纯逻辑层，不依赖引擎 API。
 */
export class RelicManager implements RelicDefLookup {
    private readonly _registry: Map<string, RelicDef>;

    constructor(allRelics: RelicDef[]) {
        this._registry = new Map(allRelics.map(r => [r.id, r]));
    }

    // ─── 注册表 / 查询 ────────────────────────────────

    /** 实现 RelicDefLookup 接口 */
    getRelicDef(relicId: string): RelicDef | undefined {
        return this._registry.get(relicId);
    }

    /** 获取所有遗物定义 */
    getAllRelics(): RelicDef[] {
        return Array.from(this._registry.values());
    }

    /** 注册表中遗物总数 */
    get size(): number {
        return this._registry.size;
    }

    // ─── 品质随机 ──────────────────────────────────────

    /**
     * 随机掷出遗物品质。
     * 普通 60% / 稀有 30% / 传说 10%。
     */
    static rollRarity(rng: SeededRandom): RelicRarity {
        const roll = rng.next();
        let cumulative = 0;
        for (const { rarity, weight } of RARITY_WEIGHTS) {
            cumulative += weight;
            if (roll < cumulative) return rarity;
        }
        return RelicRarity.NORMAL;
    }

    // ─── 过滤 ──────────────────────────────────────────

    /**
     * 过滤出当前可获取的遗物列表。
     * 排除已拥有的、不满足层数的，可选按品质下限和流派过滤。
     */
    filterAvailable(
        floor: number,
        ownedRelicIds: string[],
        options?: { minRarity?: RelicRarity; faction?: Faction },
    ): RelicDef[] {
        const owned = new Set(ownedRelicIds);
        const minOrder = options?.minRarity !== undefined
            ? RARITY_ORDER[options.minRarity]
            : 0;

        return this.getAllRelics().filter(r => {
            if (owned.has(r.id)) return false;
            if (floor < r.floorMin) return false;
            if (RARITY_ORDER[r.rarity] < minOrder) return false;
            if (options?.faction !== undefined && r.faction !== undefined && r.faction !== options.faction) {
                return false;
            }
            return true;
        });
    }

    // ─── 掉落判定 ──────────────────────────────────────

    /**
     * 判断战斗后是否掉落遗物。
     * 基础概率 20%，精英 25%，高星残影额外 +10%。
     */
    static shouldDropRelic(
        rng: SeededRandom,
        floor: number,
        isElite: boolean,
        isHighStarGhost: boolean,
    ): boolean {
        const config = FloorManager.getRewardConfig(floor);
        let chance = isElite ? config.eliteRelicDropChance : config.relicDropChance;
        if (isHighStarGhost) chance += config.highStarGhostRelicBonus;
        return rng.chance(chance);
    }

    // ─── 奖励生成 ──────────────────────────────────────

    /**
     * 生成遗物候选列表（如战斗后三选一）。
     * 每个候选独立掷品质，然后从该品质池中随机选取（不重复）。
     * 如果掷出品质无可用遗物，向下降级寻找。
     */
    generateChoices(
        floor: number,
        ownedRelicIds: string[],
        count: number,
        rng: SeededRandom,
    ): RelicDef[] {
        const allAvailable = this.filterAvailable(floor, ownedRelicIds);
        if (allAvailable.length === 0) return [];
        if (allAvailable.length <= count) return [...allAvailable];

        const result: RelicDef[] = [];
        const used = new Set<string>();

        for (let i = 0; i < count; i++) {
            const rarity = RelicManager.rollRarity(rng);
            const picked = this._pickByRarityWithFallback(allAvailable, rarity, used, rng);
            if (!picked) break;
            result.push(picked);
            used.add(picked.id);
        }

        return result;
    }

    // ─── 获取与去重 ────────────────────────────────────

    /**
     * 将遗物加入 RunState。
     * 同一遗物不重复获取，返回是否成功。
     */
    static acquireRelic(runState: RunState, relicId: string): boolean {
        if (runState.relics.includes(relicId)) return false;
        runState.relics.push(relicId);
        return true;
    }

    /** 检查遗物是否已持有 */
    static isOwned(runState: RunState, relicId: string): boolean {
        return runState.relics.includes(relicId);
    }

    // ─── 非战斗触发 ────────────────────────────────────

    /**
     * 触发进入商店时的遗物效果（ON_ENTER_SHOP）。
     * 按遗物获取顺序依次触发，修改 RunState。
     */
    triggerOnEnterShop(runState: RunState): RelicTriggerResult[] {
        return this._triggerNonBattleRelics(
            runState,
            RelicTrigger.ON_ENTER_SHOP,
        );
    }

    /**
     * 触发战斗结束时遗物效果（BATTLE_END，非战斗属性部分）。
     * 如"每场战斗后恢复 5 HP"等对 RunState 生效的效果。
     */
    triggerOnBattleEnd(runState: RunState): RelicTriggerResult[] {
        return this._triggerNonBattleRelics(
            runState,
            RelicTrigger.BATTLE_END,
        );
    }

    // ─── 战斗触发支持 ──────────────────────────────────

    /**
     * 按触发时机收集持有的遗物定义列表。
     * 供战斗引擎在对应时机调用效果执行。
     */
    getRelicsByTrigger(
        ownedRelicIds: string[],
        trigger: RelicTrigger,
    ): RelicDef[] {
        const result: RelicDef[] = [];
        for (const id of ownedRelicIds) {
            const def = this._registry.get(id);
            if (def && def.trigger === trigger) {
                result.push(def);
            }
        }
        return result;
    }

    // ─── 私有方法 ──────────────────────────────────────

    /**
     * 按品质选取遗物，无匹配则逐级降级。
     * 全部品质都无可用时从所有可用中随机选。
     */
    private _pickByRarityWithFallback(
        available: RelicDef[],
        targetRarity: RelicRarity,
        excluded: Set<string>,
        rng: SeededRandom,
    ): RelicDef | null {
        const candidates = available.filter(r => !excluded.has(r.id));
        if (candidates.length === 0) return null;

        const byRarity = candidates.filter(r => r.rarity === targetRarity);
        if (byRarity.length > 0) return rng.pick(byRarity);

        const order = RARITY_ORDER[targetRarity];
        for (let o = order - 1; o >= 0; o--) {
            const rarity = Object.entries(RARITY_ORDER)
                .find(([, v]) => v === o)?.[0] as RelicRarity | undefined;
            if (!rarity) continue;
            const fallback = candidates.filter(r => r.rarity === rarity);
            if (fallback.length > 0) return rng.pick(fallback);
        }

        return rng.pick(candidates);
    }

    /**
     * 执行非战斗触发的遗物效果，作用于 RunState。
     * 支持 CardEffect（护甲→无意义，回复→HP/金币）和 RelicCustomEffect。
     */
    private _triggerNonBattleRelics(
        runState: RunState,
        trigger: RelicTrigger,
    ): RelicTriggerResult[] {
        const results: RelicTriggerResult[] = [];

        for (const relicId of runState.relics) {
            const def = this._registry.get(relicId);
            if (!def || def.trigger !== trigger) continue;

            const applied = this._applyNonBattleEffect(runState, def);
            results.push({
                relicId: def.id,
                relicName: def.name,
                description: def.description,
                applied,
            });
        }

        return results;
    }

    /**
     * 应用单个遗物效果到 RunState（非战斗场景）。
     * 返回是否实际生效。
     */
    private _applyNonBattleEffect(runState: RunState, relicDef: RelicDef): boolean {
        const effect = relicDef.effect;

        if (isCardEffect(effect)) {
            return this._applyCardEffectToRunState(runState, effect);
        }
        return this._applyCustomEffectToRunState(runState, effect);
    }

    /** 将 CardEffect 格式的遗物效果应用到 RunState */
    private _applyCardEffectToRunState(runState: RunState, effect: CardEffect): boolean {
        let applied = false;

        if (effect.heal) {
            if (effect.heal.hp != null && effect.heal.hp > 0) {
                const before = runState.currentHp;
                runState.currentHp = Math.min(runState.maxHp, runState.currentHp + effect.heal.hp);
                if (runState.currentHp > before) applied = true;
            }
            if (effect.heal.hpPercent != null && effect.heal.hpPercent > 0) {
                const before = runState.currentHp;
                const amount = Math.round(runState.maxHp * effect.heal.hpPercent);
                runState.currentHp = Math.min(runState.maxHp, runState.currentHp + amount);
                if (runState.currentHp > before) applied = true;
            }
        }

        return applied;
    }

    /** 将自定义遗物效果应用到 RunState */
    private _applyCustomEffectToRunState(runState: RunState, effect: RelicCustomEffect): boolean {
        switch (effect.type) {
            case 'HEAL_HP': {
                const amount = (effect.params['amount'] as number) ?? 0;
                const before = runState.currentHp;
                runState.currentHp = Math.min(runState.maxHp, runState.currentHp + amount);
                return runState.currentHp > before;
            }
            case 'HEAL_HP_PERCENT': {
                const percent = (effect.params['percent'] as number) ?? 0;
                const before = runState.currentHp;
                const amount = Math.round(runState.maxHp * percent);
                runState.currentHp = Math.min(runState.maxHp, runState.currentHp + amount);
                return runState.currentHp > before;
            }
            case 'GAIN_GOLD': {
                const amount = (effect.params['amount'] as number) ?? 0;
                runState.gold += amount;
                runState.stats.goldEarned += amount;
                return amount > 0;
            }
            case 'DISCOUNT': {
                return true;
            }
            default:
                return false;
        }
    }
}

// ─── 模块工具函数 ──────────────────────────────────────

function isCardEffect(effect: CardEffect | RelicCustomEffect): effect is CardEffect {
    return 'target' in effect;
}
