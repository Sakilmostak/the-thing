interface Questable {
  readonly name: string;
  readonly maxTicks: number;
  readonly currentState: QuestState;
  start(view: EngineView, updateCallback: (view: EngineView) => void): void;
  tick(view: EngineView): void;
}

enum QuestState {
  New,
  InProgress,
  Ended,
  Resolved,
}

type EngineView = {
  // connectors: Freeze<Connector[]>;
  // dropoutFactor: number;
};

class ConnectorBan {
  readonly name: string;
  private ticks: number;
  maxTicks: number;
  private state: QuestState;
  private updateCallback?: (view: EngineView) => void;
  constructor(duration: number, tps: number) {
    this.maxTicks = duration * tps;
    this.ticks = 0;
    this.name = "connector ban";
    this.state = QuestState.New;
  }

  start(view: EngineView, updateCallback: (view: EngineView) => void) {
    if (this.state !== QuestState.New) return;
    this.state = QuestState.InProgress;
    this.updateCallback = updateCallback;
    // change the view
    this.updateCallback(view);
  }
  tick(view: EngineView) {
    if (this.state != QuestState.InProgress) return;

    this.ticks += 1;
    if (this.ticks >= this.maxTicks) {
      this.state = QuestState.Ended;
    }

    this.resolve(view);
  }

  private resolve(view: EngineView) {}

  get currentState() {
    return this.state;
  }
}

export { type Questable, QuestState, type EngineView, ConnectorBan } 