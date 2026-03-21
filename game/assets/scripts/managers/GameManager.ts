import { _decorator, Component, sys } from 'cc';
import { RunState } from '../types/RunTypes';
import { RunManager } from '../core/run/RunManager';

const { ccclass } = _decorator;

const SAVE_KEY = 'shadow_fight_run';

/**
 * 全局游戏管理器（Cocos Creator 单例组件）。
 * 职责：承载 RunManager 实例 + 对接 Cocos 本地存储。
 * 所有局状态逻辑由 RunManager 处理，GameManager 只做存储桥接。
 */
@ccclass('GameManager')
export class GameManager extends Component {
    private static _instance: GameManager | null = null;
    static get instance(): GameManager | null { return GameManager._instance; }

    private _runManager = new RunManager();
    get runManager(): RunManager { return this._runManager; }
    get runState(): RunState | null { return this._runManager.state; }

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
        return this._runManager.createRun(seed);
    }

    /** 保存当前局到本地存储 */
    saveRun(): boolean {
        const json = this._runManager.serialize();
        if (!json) return false;
        try {
            sys.localStorage.setItem(SAVE_KEY, json);
            return true;
        } catch {
            return false;
        }
    }

    /** 从本地存储加载存档 */
    loadRun(): RunState | null {
        try {
            const json = sys.localStorage.getItem(SAVE_KEY);
            if (!json) return null;
            return this._runManager.deserialize(json);
        } catch {
            return null;
        }
    }

    /** 清除存档 */
    clearSave(): void {
        sys.localStorage.removeItem(SAVE_KEY);
        this._runManager.clear();
    }

    /** 检查是否有存档 */
    hasSave(): boolean {
        return !!sys.localStorage.getItem(SAVE_KEY);
    }
}
