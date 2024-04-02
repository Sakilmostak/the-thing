<script lang="ts">
    import { goto } from "$app/navigation";
    import { onDestroy } from "svelte";
    import { type Questable } from "./quest";
    import { scaleLinear } from 'd3-scale'; // for adding animation


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
  // cooldown time after changing the routing strategy
  routingStrategyChangeCooldownTime: number;
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

enum RoutingStrategy {
  Cost,
  Volume,
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
  private currentRoutingStrategy: Freeze<RoutingStrategy>;
  private gameState: GameState;
  private successRateWindow: WindowArray<number>;
  private successRateDropTick: number;
  private dropDerivative: number; // controls the rate of drop with each connector addition
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

    this.currentRoutingStrategy = new Freeze(
      RoutingStrategy.Cost,
      config.routingStrategyChangeCooldownTime,
      config.ticks,
    );

    this.gameState = GameState.Started;

    this.successRateWindow = new WindowArray(config.successRateWindowLength);
    this.successRateDropTick = 1;
    this.callbacks = {};
    this.paymentDistribution = 1;
    this.dropDerivative = 0;

    this.questList = this.configuration.quests.reverse();
  }

  /* Controls */

  registerCallbacks(callbacks: EventCallbacks) {
    this.callbacks = callbacks;
  }

  addConnector(name: string, metadata?: any) {
    if (this.gameState == GameState.Paused) return;
    if (this.budget < 1000) return;
    const newConnector: Connector = {
      enabled: true,
      name,
      metadata,
      cost: this.configuration.connectorCostPerTxn.value,
    };
    this.budget-=1000; // cost of adding connector
    this.dropDerivative+=0.02;
    this.connectors.value.push(newConnector);
    if(this.connectors.value.length>1) {
      this.successRateDropTick-=Math.min(100-successRateValue,20)
    }
  }

  removeConnector(idx: number) {
    if (this.gameState == GameState.Paused) return;
    if (idx >= this.connectors.value.length) return;

    this.dropDerivative-=0.02;

    let connectors = this.connectors.value;
    let temp = connectors[idx];
    connectors[idx] = connectors[connectors.length - 1];
    connectors[connectors.length - 1] = temp;
    connectors.pop();
    this.connectors.value = connectors;
  }

  toggleConnector(idx: number) {
    if (this.gameState == GameState.Paused) return;
    if (this.connectors.value.length < idx) {
      return;
    }
    this.connectors.value[idx].enabled = !this.connectors.value[idx].enabled;
  }

  changeCheckoutExperience(exp: CheckoutExperience) {
    if (this.gameState === GameState.Paused) return;
    if (this.budget < 500) return;
    this.budget-=500;
    this.currentCheckoutExperience.value = exp;
  }

  changeRoutingStrategy(strategy: RoutingStrategy) {
    if (this.gameState === GameState.Paused) return;
    this.currentRoutingStrategy.value = strategy;
  }

  focusPaymentDistribution() {
    if (this.gameState === GameState.Paused) return;
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
    this.currentRoutingStrategy.tick();

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
    if (successRate - this.successRateDropTick> this.configuration.successRateThreshold) {
      this.successRateDropTick += 0.1;
      this.successRateDropTick -= this.dropDerivative;

      if (
        this.successRateDropTick >=
        this.configuration.toleranceTimeForSRDrop * this.configuration.ticks
      ) {
        this.gameState = GameState.Ended;

        this.callbacks.endGameEvent !== undefined
          ? this.callbacks.endGameEvent()
          : {};
      }
    } 
  }

  private budgetController() {
    if (this.budget < 0) {
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

  private distortDropoutFactor() {
    switch (this.currentCheckoutExperience.value) {
      case CheckoutExperience.SDK:
        this.dropoutFactor = 0.9;
        break;
      case CheckoutExperience.Redirect:
        this.dropoutFactor = 0.8;
        break;
    }
  }

  /// ## Description
  //
  // - This function is used to distort the payment distribution
  // - It is called every tick
  // - It is responsible for distorting the payment distribution
  //
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
    this.distortDropoutFactor();

    // Quest Effects (Initial State Effect)

    // Processing
    const totalOrders = this.configuration.orderRate / this.configuration.ticks;
    const ordersPostDropOff =
      totalOrders *
      (1 -
        (this.configuration.baseDropOffPercentage * this.dropoutFactor) / 100) *
      (this.connectors.value.length == 0 ? 0 : 1);
    const costIncured = this.distributeOrders(ordersPostDropOff);
    let successRate = (ordersPostDropOff / totalOrders) * 100;
    this.successRateDropController(successRate);
    successRate-= this.successRateDropTick;
    

    // Affected States
    this.successRateWindow.push(successRate);
    this.budget -= costIncured;
    this.orders += ordersPostDropOff;
    connectorAvaiable = this.connectors.value.length;
    
    this.budgetController();
    this.timeController();

    // update states
    if(successRate>=0){
      successRateValue=Math.floor(successRate); 
    }
    if(this.timeLeft>=0) {
      daysLeft = Math.floor(this.timeLeft);
    }
    orderValue = Math.floor(this.orders);
    if(this.budget>=0) {
      amountValue = Math.floor(this.budget);
    }
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

      switch (this.currentRoutingStrategy.value) {
        /// Cost Based routing, will leverage paymentDistribution, to sort connectors in the order of least cost
        case RoutingStrategy.Cost:
          connectors.sort((a, b) => a.cost - b.cost);
          break;
        case RoutingStrategy.Volume:
          this.focusPaymentDistribution();
          break;
      }

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

// to remove setInterval once removed from the frame
onDestroy(() => {
  clearInterval(current_frame);
})

let default_config: EngineConfiguration = {
    time: 90,
    ticks: 10,
    startBudget: 10000,
    orderRate: 70,
    maxConnectorCount: 10,
    addConnectorCooldownTime: new RRange(0,10),
    newQuestInterval: new RRange(1,10),
    QuestDuration: new RRange(1,10),
    connectorCostPerTxn: new RRange(1,3),
    routingStrategyChangeCooldownTime: 5,
    successRateThreshold: 60,
    toleranceTimeForSRDrop: 20,
    baseDropOffPercentage: 5,
    checkoutExperienceChangeCooldownTime: 5,
    successRateWindowLength: 10,
    focusDeltaForPM: 5,
    autoFocusForPM: 5,
    quests: []
}

let curEngine = new Engine(default_config);

let current_frame = setInterval(curEngine.tick.bind(curEngine), 100);
// states
let successRateValue = 0;
let daysLeft = Math.floor(curEngine.getTimeLeft());
let orderValue = 0;
let amountValue = curEngine.getCurrentBudget();
let connectorAvaiable = 0;

</script>

<div class="mainContainer">
    <div
      class="stats w-2/5 min-w-fit stats-horizontal lg:stats-horizontal shadow bg-hyperswitch-bg text-white"
    >
      <div class="stat">
        <div class="stat-title">Amount</div>
        <div class="stat-value">{amountValue}</div>
      </div>

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
  
    <div class="overflow-x-auto text-white w-2/5 min-w-fit">
      <table class="table">
        <!-- head -->
  
        <tbody>
          <!-- row 1 -->
          <tr>
            <td>Connectors</td>
            <td>{connectorAvaiable}</td>
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
              on:click={() => {
                curEngine.changeRoutingStrategy(RoutingStrategy.Cost);
              }}
                >Cost Based</button
              >
            </td>
            <td class="text-center">
              <button class="btn btn-sm bg-hyperswitch-blue text-white w-full"
              on:click={() => {
                curEngine.changeRoutingStrategy(RoutingStrategy.Volume);
              }}
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

    .chart,
	h2,
	p {
		width: 100%;
		max-width: 500px;
		margin-left: auto;
		margin-right: auto;
	}

	svg {
		position: relative;
		width: 100%;
		height: 200px;
		overflow: visible;
	}

	.tick {
		font-size: 0.725em;
		font-weight: 200;
	}

	.tick line {
		stroke: #888;
		stroke-dasharray: 2;
	}

	.tick text {
		fill: #888;
		text-anchor: start;
	}

	.tick.tick-0 line {
		stroke-dasharray: 0;
	}

	.x-axis .tick text {
		text-anchor: middle;
	}

	.path-line {
		fill: none;
		stroke: rgb(0, 100, 100);
		stroke-linejoin: round;
		stroke-linecap: round;
		stroke-width: 2;
	}

	.path-area {
		fill: rgba(0, 100, 100, 0.2);
	}
  </style>