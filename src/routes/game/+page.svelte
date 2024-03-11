<script lang="ts">
    import { goto } from "$app/navigation";
    import { type Questable } from "./quest";
    // import "../app.css";

class RRange {
  readonly start: number;
  readonly end: number;
  constructor(start: number, end: number) {
    if (start > end) {
      throw new Error("Start should be less than end");
    }
    this.start = start;
    this.end = end;
  }

  get value(): number {
    return Math.random() * (this.end - this.start) + this.start;
  }
}

class Freeze<T> {
  private inner: T;
  private isFrozen: boolean;
  private ticks: number;
  // Time to freeze (in ticks)
  private readonly timeToFreeze: number;
  constructor(value: T, timeToFreeze: number, ticks: number) {
    this.inner = value;
    this.isFrozen = false;
    this.timeToFreeze = timeToFreeze * ticks;
    this.ticks = 0;
  }

  freeze() {
    this.ticks = 0;
    this.isFrozen = true;
  }

  get value(): T {
    return this.inner;
  }

  set value(inner: T) {
    if (this.isFrozen) {
      throw new Error("The Construct is Frozen, try after sometime");
    }
    this.inner = inner;
    this.freeze();
  }

  tick() {
    if (this.ticks >= this.timeToFreeze) {
      this.isFrozen = false;
      this.ticks = 0;
    } else {
      this.ticks += 1;
    }
  }
}

class WindowArray<T> {
  private data: T[];
  private size: number;
  constructor(size: number) {
    this.data = [];
    this.size = size;
  }

  push(value: T): T | undefined {
    if (this.data.length == this.size) {
      let removedValue = this.data.shift();
      this.data.push(value);
      return removedValue;
    } else {
      this.data.push(value);
      return undefined;
    }
  }

  get inner(): T[] {
    return this.data;
  }

  last(): T | undefined {
    if (this.data.length !== 0) {
      return this.data[this.data.length - 1];
    } else {
      return undefined;
    }
  }
}

type EngineConfiguration = {
  // The amount of time for which the engine will run the game (in secs)
  time: number;
  // Number of ticks that are being run in one second
  ticks: number;
  // The amount of budget with with the game will start
  startBudget: number;
  // The number of orders received (per secs)
  orderRate: number;
  // Max number of connector allowed
  maxConnectorCount: number;
  // cooldown time after adding a connector
  addConnectorCooldownTime: RRange;
  // interval of time after which a new quest will be triggered
  newQuestInterval: RRange;
  // The duration of the new quest triggered
  QuestDuration: RRange;
  // Connector cost per txn
  connectorCostPerTxn: RRange;
  // Threshold below which the game enters end game
  successRateThreshold: number;
  // Tolerance time for which the SR can stay below threshold before game end
  toleranceTimeForSRDrop: number;
  // general drop-off rate per secs
  baseDropOffPercentage: number;
  // cooldown time after changing the checkout experience
  checkoutExperienceChangeCooldownTime: number;
  // success rate window length
  successRateWindowLength: number;
  // focus that should be added to routing payment methods efficiently ( 0 < x < 1 )
  focusDeltaForPM: number;
  // focus to be reduced per tick (this should be less than focusDelta) ( 0 < x < 1 )
  autoFocusForPM: number;
  // Loaded Quests
  quests: [Questable, number][];
};

type Connector = {
  enabled: boolean;
  name: string;
  cost: number;
  metadata?: any;
  state?: "banned";
};

enum CheckoutExperience {
  SDK,
  Redirect,
}

enum GameState {
  Initialized,
  Started,
  Paused,
  Ended,
}

type EventCallbacks = {
  questTriggered?: (quest: Questable) => void;
  successRateTicker?: (successRates: number[]) => void;
  endGameEvent?: () => void;
};

class Engine {
  readonly configuration: EngineConfiguration;
  private timeLeft: number;
  private budget: number;
  private connectors: Freeze<Connector[]>;
  private orders: number;
  private currentQuest: Questable | null;
  private dropoutFactor: number;
  private currentCheckoutExperience: Freeze<CheckoutExperience>;
  private gameState: GameState;
  private successRateWindow: WindowArray<number>;
  private successRateDropTick: number;
  private callbacks: EventCallbacks;
  private paymentDistribution: number;
  private questList: [Questable, number][];

  constructor(config: EngineConfiguration) {
    this.configuration = config;
    this.budget = config.startBudget;
    this.connectors = new Freeze(
      [],
      config.addConnectorCooldownTime.value,
      config.ticks,
    );
    this.orders = 0;
    this.currentQuest = null;
    this.dropoutFactor = 1;
    this.timeLeft = config.time;
    this.currentCheckoutExperience = new Freeze(
      CheckoutExperience.SDK,
      config.checkoutExperienceChangeCooldownTime,
      config.ticks,
    );

    this.gameState = GameState.Started;

    this.successRateWindow = new WindowArray(config.successRateWindowLength);
    this.successRateDropTick = 0;
    this.callbacks = {};
    this.paymentDistribution = 0;

    this.questList = this.configuration.quests.reverse();
  }

  /* Controls */

  registerCallbacks(callbacks: EventCallbacks) {
    this.callbacks = callbacks;
  }

  addConnector(name: string, metadata?: any) {
    if (this.gameState == GameState.Paused) return;
    const newConnector: Connector = {
      enabled: true,
      name,
      metadata,
      cost: this.configuration.connectorCostPerTxn.value,
    };
    this.connectors.value.push(newConnector);
    console.log(this.connectors);
  }

  removeConnector(idx: number) {
    if (this.gameState == GameState.Paused) return;
    if (idx >= this.connectors.value.length) return;

    let connectors = this.connectors.value;
    let temp = connectors[idx];
    connectors[idx] = connectors[connectors.length - 1];
    connectors[connectors.length - 1] = temp;
    connectors.pop();
    this.connectors.value = connectors;
    console.log(connectors);
  }

  toggleConnector(idx: number) {
    if (this.gameState == GameState.Paused) return;
    if (this.connectors.value.length < idx) {
      return;
    }
    this.connectors.value[idx].enabled = !this.connectors.value[idx].enabled;
  }

  changeCheckoutExperience(exp: CheckoutExperience) {
    if (this.gameState == GameState.Paused) return;
    this.currentCheckoutExperience.value = exp;
    console.log(this.currentCheckoutExperience);
  }

  focusPaymentDistribution() {
    if (this.gameState == GameState.Paused) return;
    this.paymentDistribution += this.configuration.focusDeltaForPM;

    if (this.paymentDistribution >= 1) {
      this.paymentDistribution = 1;
    }
  }

  /* Statistics */

  getCurrentSuccessRate(): number | undefined {
    return this.successRateWindow.last();
  }

  getTimeLeft(): number {
    return this.timeLeft;
  }

  getSuccessRateWindow(): number[] {
    return this.successRateWindow.inner;
  }

  getCurrentBudget(): number {
    return this.budget;
  }

  getTotalOrders(): number {
    return this.orders;
  }

  getConnectors(): Connector[] {
    return this.connectors.value;
  }

  /* Engine Logic */

  tick() {
    console.log(this.timeLeft);
    switch (this.gameState) {
      case GameState.Initialized:
        return;
      case GameState.Paused:
        return;
      case GameState.Started:
        return this.step();
      case GameState.Ended:
        clearInterval(current_frame); // removes tick
        return;
    }
  }

  private stateTicker() {
    this.connectors.tick();
    this.currentCheckoutExperience.tick();

    if (this.currentQuest === null) {
      if (this.questList.length < 1) {
        return;
      }
      this.questList[this.questList.length - 1][1] -= 1;
      if (this.questList[this.questList.length - 1][1] <= 0) {
        this.currentQuest = this.questList.pop()![0];
        this.currentQuest.start({}, (_) => {});
      }
    } else {
      this.currentQuest.tick({});
    }

  }

  private successRateDropController(successRate: number) {
    if (successRate < this.configuration.successRateThreshold) {
      this.successRateDropTick += 1;

      if (
        this.successRateDropTick >=
        this.configuration.toleranceTimeForSRDrop * this.configuration.ticks
      ) {
        this.gameState = GameState.Ended;

        this.callbacks.endGameEvent !== undefined
          ? this.callbacks.endGameEvent()
          : {};
      }
    } else {
      this.successRateDropTick = 0;
    }
  }

  private budgetController() {
    if (this.budget <= 0) {
      this.gameState = GameState.Ended;

      this.callbacks.endGameEvent !== undefined
        ? this.callbacks.endGameEvent()
        : {};
    }
  }

  private timeController() {
    this.timeLeft -= 1 / this.configuration.ticks;

    if (this.timeLeft <= 0) {
      this.gameState = GameState.Ended;
      (current_frame); // remove setInterval

      this.callbacks.endGameEvent !== undefined
        ? this.callbacks.endGameEvent()
        : {};
    }
  }

  private distortFocusDistribution() {
    this.paymentDistribution -= this.configuration.autoFocusForPM;

    if (this.paymentDistribution < 0) {
      this.paymentDistribution = 0;
    }
  }

  private step() {
    // tick states
    this.stateTicker();
    this.distortFocusDistribution();

    // Quest Effects (Initial State Effect)

    // Processing
    const totalOrders = this.configuration.orderRate / this.configuration.ticks;
    const ordersPostDropOff =
      totalOrders *
      (1 -
        (this.configuration.baseDropOffPercentage * this.dropoutFactor) / 100) *
      (this.connectors.value.length == 0 ? 0 : 1);
    const costIncured = this.distributeOrders(ordersPostDropOff);
    const successRate = (ordersPostDropOff / totalOrders) * 100;
    

    // Affected States
    this.successRateWindow.push(successRate);
    this.budget -= costIncured;
    this.orders += ordersPostDropOff;
    this.successRateDropController(successRate);
    this.budgetController();
    this.timeController();

    // update states
    successRateValue=successRate; 
    if(this.timeLeft>=0) {
      daysLeft = Math.floor(this.timeLeft);
    } 
    orderValue = Math.floor(this.orders);
    // console.log(this);
  }

  distributeOrders(orders: number): number {
    const connectors = this.connectors.value.filter(
      (value) => value.enabled && value.state != "banned",
    );

    const connectorCount = connectors.length;

    if (connectorCount == 0) {
      return 0;
    } else if (connectorCount == 1) {
      return orders * connectors[0].cost;
    } else {
      let current = 0;
      let jump = 1 / (connectors.length - 1);
      let total = 0;

      let distribution = connectors.map(() => {
        let distence = Math.abs(this.paymentDistribution - current);
        total += distence;
        current += jump;
        return distence;
      });

      return distribution
        .map((value: number, index: number) => {
          return ((value * orders) / total) * connectors[index].cost;
        })
        .reduce((prev, cur) => prev + cur);
    }
  }
}

let default_config: EngineConfiguration = {
    time: 10,
    ticks: 10,
    startBudget: 10000,
    orderRate: 1,
    maxConnectorCount: 10,
    addConnectorCooldownTime: new RRange(0,5),
    newQuestInterval: new RRange(0,5),
    QuestDuration: new RRange(0,10),
    connectorCostPerTxn: new RRange(0,10),
    successRateThreshold: 0,
    toleranceTimeForSRDrop: 0,
    baseDropOffPercentage: 5,
    checkoutExperienceChangeCooldownTime: 5,
    successRateWindowLength: 10,
    focusDeltaForPM: 0,
    autoFocusForPM: 0,
    quests: []
}

let curEngine = new Engine(default_config);

let current_frame = setInterval(curEngine.tick.bind(curEngine), 100);
// states
let successRateValue = 0;
let daysLeft = Math.floor(curEngine.getTimeLeft());
let orderValue = 0;

</script>

<div class="mainContainer">
    <div
      class="stats w-2/5 min-w-fit stats-horizontal lg:stats-horizontal shadow bg-hyperswitch-bg text-white"
    >
      <div class="stat">
        <div class="stat-title">Orders</div>
        <div class="stat-value">{orderValue}</div>
      </div>
  
      <div class="stat">
        <div class="stat-title">Success Rate</div>
        <div class="stat-value">{successRateValue}</div>
      </div>
  
      <div class="stat">
        <div class="stat-title">Days Left</div>
        <div class="stat-value">{daysLeft}</div>
      </div>
    </div>
  
    <div class="chatContainer w-2/5 min-w-fit flex flex-col">
      <div class="chat chat-start">
        <div class="chat-bubble bg-hyperswitch-blue text-white">
          That's never been done in Jedi history. It's insulting!
        </div>
      </div>
      <div class="chat chat-end">
        <div class="chat-bubble chat-bubble-info bg-hyperswitch-blue text-white">
          Calm down, Anakin.
        </div>
      </div>
    </div>
  
    <button class="btn btn-outlin btn-info">User Action</button>
  
    <div class="card w-2/5 min-w-fit bg-hyperswitch-bg shadow-xl text-white">
      <div class="card-body">
        <h2 class="card-title">Graph</h2>
      </div>
    </div>
  
    <div class="overflow-x-auto text-white w-2/5 min-w-fit">
      <table class="table">
        <!-- head -->
  
        <tbody>
          <!-- row 1 -->
          <tr>
            <td>Connectors</td>
            <td class="text-center">
              <button class="btn btn-sm bg-hyperswitch-blue text-white w-full"
              on:click={() => {
                curEngine.addConnector("default");
              }}
                >Add</button
              >
            </td>
            <td class="text-center"
              ><button class="btn btn-sm bg-hyperswitch-blue text-white w-full"
              on:click={() => {
                curEngine.removeConnector(0);
              }}
                >Remove</button
              >
            </td>
          </tr>
          <!-- row 2 -->
          <tr>
            <td>Payment Routing</td>
            <td class="text-center">
              <button class="btn btn-sm bg-hyperswitch-blue text-white w-full"
                >Cost Based</button
              >
            </td>
            <td class="text-center">
              <button class="btn btn-sm bg-hyperswitch-blue text-white w-full"
                >Volume Based</button
              >
            </td>
          </tr>
          <!-- row 3 -->
          <tr>
            <td>Checkout Experience</td>
            <td class="text-center">
              <button class="btn btn-sm bg-hyperswitch-blue text-white w-full"
              on:click={() => {
                curEngine.changeCheckoutExperience(CheckoutExperience.SDK);
              }}
                >SDK</button
              >
            </td>
            <td class="text-center">
              <button class="btn btn-sm bg-hyperswitch-blue text-white w-full"
              on:click={() => {
                curEngine.changeCheckoutExperience(CheckoutExperience.Redirect);
              }}
                >Redirect</button
              >
            </td>
          </tr>
        </tbody>
      </table>
    </div>
  </div>
  
  <style>
    .card {
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
    }
    .mainContainer {
      min-height: 100vh;
      background-color: black;
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      flex: 1;
      padding: 24px;
      gap: 10px;
    }
  
    .mainContainer button {
      background-color: #016df9;
      color: white;
    }
  
    .mainContainer button:hover {
      opacity: 0.7;
    }
  </style>