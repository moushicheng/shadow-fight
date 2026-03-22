import { _decorator, Component, ProgressBar, Label, Color, color, tween, UIOpacity } from 'cc';
const { ccclass, property } = _decorator;

@ccclass('HPBar')
export class HPBar extends Component {

    @property(ProgressBar)
    bar: ProgressBar = null!;

    @property(Label)
    hpLabel: Label = null!;

    @property({ type: Color, tooltip: '血量充足时的颜色' })
    healthyColor: Color = color(76, 175, 80, 255);

    @property({ type: Color, tooltip: '血量危险时的颜色' })
    dangerColor: Color = color(244, 67, 54, 255);

    @property({ type: Number, range: [0, 1, 0.05], slide: true, tooltip: '低于此比例显示危险色' })
    dangerThreshold: number = 0.3;

    private _maxHp: number = 100;

    start() {
        this.init(100);
        this.updateDisplay(100);
    }

    init(maxHp: number) {
        this._maxHp = maxHp;
        this.updateDisplay(maxHp);
    }

    updateDisplay(currentHp: number) {
        const ratio = Math.max(0, currentHp / this._maxHp);
        console.log(this.bar.progress, ratio, '@@@');
        this.bar.progress = ratio;
        this.hpLabel.string = `${currentHp}/${this._maxHp}`;
    }
}
