import { _decorator, Component, sys } from 'cc';
import { RunState, RunStats } from '../types/RunTypes';
import { Faction, GameNodeType } from '../types/Enums';
import { SeededRandom } from '../core/utils/SeededRandom';
import { generateBaseProperty, calcMaxHp } from '../core/character/AttributeGenerator';

const { ccclass, property } = _decorator;

const SAVE_KEY = 'shadow_fight_run';

/**
 * 全局游戏管理器（单例）。
 * 职责：管理单局状态（RunState）、存档/读档、场景切换调度。
 */
@ccclass('GameManager')
export class GameManager extends Component {
    private static _instance: GameManager | null = null;
    static get instance(): GameManager | null { return GameManager._instance; }

    /** 当前局状态 */
    private _runState: RunState | null = null;
    get runState(): RunState | null { return this._runState; }

    /** 当前局随机数生成器 */
    private _rng: SeededRandom | null = null;
    get rng(): SeededRandom | null { return this._rng; }

    onLoad() {
        if (GameManager._instance && GameManager._instance !== this) {
            this.destroy();
            return;
        }
        GameManager._instance = this;
    }

    onDestroy() {
        if (GameManager._instance === this) {
            GameManager._instance = null;
        }
    }

    /** 开始新的一局 */
    startNewRun(seed?: number): RunState {
        const actualSeed = seed ?? (Date.now() ^ (Math.random() * 0xFFFFFFFF));
        this._rng = new SeededRandom(actualSeed);

        const baseProperty = generateBaseProperty(this._rng);
        const maxHp = calcMaxHp(baseProperty.CON);

        // 随机选 2 个流派
        const allFactions = [
            Faction.ICE, Faction.FIRE, Faction.POISON, Faction.HEX, Faction.BLOOD,
            Faction.ASSASSIN, Faction.BERSERKER, Faction.GUARDIAN, Faction.MONK, Faction.GAMBLER,
        ];
        const picked = this._rng.sample(allFactions, 2) as [Faction, Faction];

        const emptyStats: RunStats = {
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

        this._runState = {
            seed: actualSeed,
            baseProperty,
            currentHp: maxHp,
            maxHp,
            deck: [],
            relics: [],
            factionPool: picked,
            gold: 0,
            currentFloor: 1,
            currentCycle: 1,
            currentNode: GameNodeType.EVENT,
            tempBuffs: [],
            encounteredGhosts: [],
            stats: emptyStats,
        };

        return this._runState;
    }

    /** 保存当前局到本地 */
    saveRun(): boolean {
        if (!this._runState) return false;
        try {
            const json = JSON.stringify(this._runState);
            sys.localStorage.setItem(SAVE_KEY, json);
            return true;
        } catch {
            return false;
        }
    }

    /** 从本地加载存档 */
    loadRun(): RunState | null {
        try {
            const json = sys.localStorage.getItem(SAVE_KEY);
            if (!json) return null;
            this._runState = JSON.parse(json) as RunState;
            this._rng = new SeededRandom(this._runState.seed);
            return this._runState;
        } catch {
            return null;
        }
    }

    /** 清除存档 */
    clearSave(): void {
        sys.localStorage.removeItem(SAVE_KEY);
        this._runState = null;
        this._rng = null;
    }

    /** 检查是否有存档 */
    hasSave(): boolean {
        return !!sys.localStorage.getItem(SAVE_KEY);
    }
}
