<script lang="ts">
import { goto } from "$app/navigation";
    
function gotoPGDetails() {
    goto('./src/routes/components/game.svelte');
  }
// export { Engine, EngineConfiguration, CheckoutExperience, GameState, Connector, RRange, Freeze, WindowArray, Questable };
</script>

<div class="mainContainer">
    <div class="card w-96 bg-hyperswitch-bg shadow-xl text-white">
      <div class="card-body">
        <h2 class="card-title">Hyperswitch Payment Simulator</h2>
        <p>
          You are going to run the payment operations of your online store for the
          next 90 days
        </p>
        <div class="card-actions justify-end">
            <a href="/game"><button class="btn bg-hyperswitch-blue text-white" >Start</button></a>
        </div>
      </div>
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
    }
  </style>