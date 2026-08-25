/** @type {import('tailwindcss').Config} */
module.exports = {
  content: [
    "./app/**/*.{js,jsx}",
    "./components/**/*.{js,jsx}",
    "./lib/**/*.{js,jsx}"
  ],
  theme: {
    extend: {
      colors: {
        ink: "#0b0b0c",
        surface: "#f7f7f5",
        accent: "#2a78d6",
        up: "#008300",
        down: "#e34948",
        // Series colors follow the entity, permanently (design system)
        google: "#2a78d6",
        meta: "#eb6834",
        linkedin: "#1baf7a"
      }
    }
  },
  plugins: []
};
