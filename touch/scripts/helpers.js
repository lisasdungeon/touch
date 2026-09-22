/**
 * Touch — template helpers registered for Handlebars.
 */
export function registerHelpers() {
  Handlebars.registerHelper("eq", (a, b) => a === b);
  Handlebars.registerHelper("gt", (a, b) => a > b);
  Handlebars.registerHelper("capitalize", (s) => String(s ?? "").charAt(0).toUpperCase() + String(s ?? "").slice(1));
  Handlebars.registerHelper("concat", (...args) => {
    args.pop(); // drop the options object
    return args.join("");
  });
  Handlebars.registerHelper("kindIcon", (kind) => {
    switch (kind) {
      case "token": return "fa-solid fa-user";
      case "light": return "fa-solid fa-lightbulb";
      case "sound": return "fa-solid fa-volume-high";
      case "wall": return "fa-solid fa-border-all";
      default: return "fa-solid fa-circle";
    }
  });
}
