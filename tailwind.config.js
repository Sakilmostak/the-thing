/** @type {import('tailwindcss').Config} */
export default {
  content: ["./src/**/*.{html,js,svelte,ts}"],
  theme: {
    extend: {
      colors: {
        "hyperswitch-blue": "#016Df9",
        "hyperswitch-bg": "#212632",
      },
    },
  },
  plugins: [require("daisyui")],
};
