import { RunState, RunStats } from '../../types/RunTypes';
import { GameNodeType, RunStatus } from '../../types/Enums';
import { PlayerBaseProperty } from '../../types/CharacterTypes';
import { SeededRandom } from '../utils/SeededRandom';
import { generateBaseProperty, calcMaxHp } from '../character/AttributeGenerator';
import { FactionPool } from '../faction/FactionPool';

const MAX_FLOOR = 10;
const BOSS_HP_MULTIPLIER = 1.5;

/**
 * 普通层的节点序列（6 个节点）。
 * 第 1 循环(PvE)：事件 → 路线选择 → 事件
 * 第 2 循环(PvP)：事件 → 残影选择 → 商店
 */
const NORMAL_FLOOR_NODES: { cycle: 1 | 2; node: GameNodeType }[] = [
    { cycle: 1, node: GameNodeType.EVENT },
    { cycle: 1, node: GameNodeType.ROUTE_CHOICE },
    { cycle: 1, node: GameNodeType.EVENT },
    { cycle: 2, node: GameNodeType.EVENT },
    { cycle: 2, node: GameNodeType.GHOST_CHOICE },
    { cycle: 2, node: GameNodeType.SHOP },
];

/**
 * Boss 层（第 10 层）的节点序列：仅残影战斗。
 * 无事件、无商店，直接进入 Boss 残影对决。
 */
const BOSS_FLOOR_NODES: { cycle: 1 | 2; node: GameNodeType }[] = [
    { cycle: 2, node: GameNodeType.GHOST_CHOICE },
];

function createEmptyStats(): RunStats {
    return {
        monstersDefeated: 0,
        ghostsDefeated: 0,
        cardsObtained: 0,
        cardsRemoved: 0,
        goldEarned: 0,
        goldSpent: 0,
        damageDealt: 0,
        damageTaken: 0,
        highestFloor: 1,
    };
}

/**
 * RunManager —— 纯逻辑层的单局状态管理器。
 *
 * 职责：
 * - 创建新局（属性生成、流派抽取、初始状态）
 * - 属性重摇（每局限 1 次）
 * - 节点推进（层内 6 节点流转、层间推进）
 * - 序列化/反序列化（不依赖引擎 API，由上层决定存储方式）
 *
 * 不依赖 Cocos Creator，可直接在 Node.js 环境下单元测试。
 */
export class RunManager {
    private _state: RunState | null = null;
    private _rng: SeededRandom | null = null;
    private _factionPool: FactionPool | null = null;

    get state(): RunState | null { return this._state; }
    get rng(): SeededRandom | null { return this._rng; }
    get factionPool(): FactionPool | null { return this._factionPool; }

    /**
     * 获取指定层的节点序列。
     * 第 10 层是 Boss 层，只有残影选择节点。
     */
    getFloorNodes(floor: number): { cycle: 1 | 2; node: GameNodeType }[] {
        return floor >= MAX_FLOOR ? BOSS_FLOOR_NODES : NORMAL_FLOOR_NODES;
    }

    /**
     * 创建新的一局。
     * 生成随机种子、四维属性、流派池，初始化所有状态字段。
     */
    createRun(seed?: number): RunState {
        const actualSeed = seed ?? (Date.now() ^ (Math.random() * 0xFFFFFFFF));
        this._rng = new SeededRandom(actualSeed);

        const baseProperty = generateBaseProperty(this._rng);
        const maxHp = calcMaxHp(baseProperty.CON);
        const factionPool = FactionPool.rollFactions(this._rng);
        this._factionPool = new FactionPool(factionPool);

        const firstNode = NORMAL_FLOOR_NODES[0];

        this._state = {
            seed: actualSeed,
            baseProperty,
            currentHp: maxHp,
            maxHp,
            deck: [],
            relics: [],
            factionPool,
            gold: 0,
            currentFloor: 1,
            currentCycle: firstNode.cycle,
            currentNode: firstNode.node,
            nodeIndex: 0,
            rerollUsed: false,
            serviceUseCount: 0,
            runStatus: RunStatus.ONGOING,
            tempBuffs: [],
            encounteredGhosts: [],
            stats: createEmptyStats(),
        };

        return this._state;
    }

    /**
     * 重摇四维属性（每局仅允许 1 次免费重摇）。
     * @returns 新的属性，若已用过重摇则返回 null
     */
    rerollAttributes(): PlayerBaseProperty | null {
        if (!this._state || !this._rng) return null;
        if (this._state.rerollUsed) return null;

        this._state.rerollUsed = true;
        const newProp = generateBaseProperty(this._rng);
        this._state.baseProperty = newProp;

        const newMaxHp = calcMaxHp(newProp.CON);
        this._state.maxHp = newMaxHp;
        this._state.currentHp = newMaxHp;

        return newProp;
    }

    /**
     * 推进到本层的下一个节点。
     * 如果当前已是本层最后一个节点，则推进到下一层。
     * 如果已通关第 10 层，标记胜利。
     *
     * @returns 推进后的节点信息，若局已结束则返回 null
     */
    advanceNode(): { floor: number; cycle: 1 | 2; node: GameNodeType; nodeIndex: number } | null {
        if (!this._state || this._state.runStatus !== RunStatus.ONGOING) return null;

        const floorNodes = this.getFloorNodes(this._state.currentFloor);
        const nextIndex = this._state.nodeIndex + 1;

        if (nextIndex < floorNodes.length) {
            this._state.nodeIndex = nextIndex;
            this._state.currentCycle = floorNodes[nextIndex].cycle;
            this._state.currentNode = floorNodes[nextIndex].node;
        } else {
            return this.advanceFloor();
        }

        return {
            floor: this._state.currentFloor,
            cycle: this._state.currentCycle,
            node: this._state.currentNode,
            nodeIndex: this._state.nodeIndex,
        };
    }

    /**
     * 推进到下一层。
     * 通关第 10 层后标记胜利。
     */
    advanceFloor(): { floor: number; cycle: 1 | 2; node: GameNodeType; nodeIndex: number } | null {
        if (!this._state || this._state.runStatus !== RunStatus.ONGOING) return null;

        if (this._state.currentFloor >= MAX_FLOOR) {
            this._state.runStatus = RunStatus.VICTORY;
            return null;
        }

        this._state.currentFloor += 1;
        this._state.stats.highestFloor = Math.max(
            this._state.stats.highestFloor,
            this._state.currentFloor,
        );

        const floorNodes = this.getFloorNodes(this._state.currentFloor);
        this._state.nodeIndex = 0;
        this._state.currentCycle = floorNodes[0].cycle;
        this._state.currentNode = floorNodes[0].node;

        return {
            floor: this._state.currentFloor,
            cycle: this._state.currentCycle,
            node: this._state.currentNode,
            nodeIndex: 0,
        };
    }

    /**
     * 将当前节点临时替换为具体战斗节点。
     * 路线选择后调用：ROUTE_CHOICE → MONSTER_BATTLE / ELITE_BATTLE / BOUNTY_BATTLE
     * 残影选择后调用：GHOST_CHOICE → GHOST_BATTLE
     */
    setCurrentNode(node: GameNodeType): void {
        if (!this._state) return;
        this._state.currentNode = node;
    }

    /** 标记本局失败（玩家死亡） */
    markDefeat(): void {
        if (!this._state) return;
        this._state.runStatus = RunStatus.DEFEAT;
    }

    /** 标记本局胜利 */
    markVictory(): void {
        if (!this._state) return;
        this._state.runStatus = RunStatus.VICTORY;
    }

    /** 判断当前是否为 Boss 层 */
    isBossFloor(): boolean {
        return this._state?.currentFloor === MAX_FLOOR;
    }

    /** 获取 Boss 层 HP 倍率 */
    getBossHpMultiplier(): number {
        return BOSS_HP_MULTIPLIER;
    }

    /**
     * 1-2 层路线节点锁定为普通战斗，3 层起解锁三选一。
     */
    isRouteChoiceLocked(): boolean {
        if (!this._state) return true;
        return this._state.currentFloor <= 2;
    }

    /**
     * 获取当前商店服务价格。
     * 基础 50 金，每使用 1 次所有服务永久 +25 金。
     */
    getServicePrice(): number {
        if (!this._state) return 50;
        return 50 + this._state.serviceUseCount * 25;
    }

    /** 记录一次商店服务使用 */
    recordServiceUse(): void {
        if (!this._state) return;
        this._state.serviceUseCount += 1;
    }

    /** 序列化为 JSON 字符串（用于存档） */
    serialize(): string | null {
        if (!this._state) return null;
        return JSON.stringify(this._state);
    }

    /**
     * 从 JSON 字符串反序列化恢复状态。
     * 同时根据种子重建 RNG（注意：RNG 状态不会精确恢复到存档时刻，
     * 但种子保证了同种子同操作序列 = 同结果的确定性）。
     */
    deserialize(json: string): RunState | null {
        try {
            const state = JSON.parse(json) as RunState;
            this._state = state;
            this._rng = new SeededRandom(state.seed);
            this._factionPool = new FactionPool(state.factionPool);
            return state;
        } catch {
            return null;
        }
    }

    /** 获取当前节点在本层序列中的描述（用于调试/日志） */
    describePosition(): string {
        if (!this._state) return 'no active run';
        return `第${this._state.currentFloor}层·第${this._state.currentCycle}循环·${this._state.currentNode}(${this._state.nodeIndex})`;
    }

    /** 清除当前状态 */
    clear(): void {
        this._state = null;
        this._rng = null;
        this._factionPool = null;
    }
}
