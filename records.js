const fs = require("fs");
const path = require("path");

function loadOrders() {
  try { return JSON.parse(fs.readFileSync(path.join(__dirname, "data", "orders.json"), "utf8")); }
  catch { return {}; }
}
const getRecord = (txnId) => {
  if (typeof txnId !== "string") return null;
  const orders = loadOrders();
  return Object.hasOwn(orders, txnId) ? orders[txnId] : null;
};

module.exports = { getRecord };