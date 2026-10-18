// BuggyBeans checkout: PayPal JS SDK buttons → our server creates and captures the order.
(function () {
  var body = document.body.dataset;
  var base = body.base || "";
  var status = document.getElementById("status");

  function show(kind, text) {
    status.className = "status " + kind;
    status.textContent = text;
  }

  function post(path, payload) {
    return fetch(base + path, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload || {}),
    }).then(function (res) {
      return res.json();
    });
  }

  if (!window.paypal) {
    show("error", "PayPal could not load. Check your connection and refresh.");
    return;
  }

  window.paypal
    .Buttons({
      style: { layout: "vertical", shape: "rect", label: "pay" },
      createOrder: function () {
        var qty = Number(document.getElementById("qty").value || 1);
        return post("/api/orders", { sku: body.sku, qty: qty }).then(function (data) {
          if (!data.id) throw new Error(data.error || "Could not start checkout");
          return data.id;
        });
      },
      onApprove: function (data, actions) {
        show("pending", "Confirming your payment…");
        return post("/api/orders/" + data.orderID + "/capture").then(function (result) {
          if (result.status === "COMPLETED") {
            var done = body.fulfil === "1" ? post("/api/orders/" + data.orderID + "/fulfil") : Promise.resolve();
            return done.then(function () {
              show("ok", "Thank you! Your coffee is on its way and your credits are in your account.");
            });
          }
          if (result.status === "DECLINED") {
            show("error", result.message);
            return actions.restart();
          }
          show("error", result.message || "Payment failed.");
        });
      },
      onCancel: function () {
        show("info", "Checkout cancelled. Your bag is still waiting.");
      },
      onError: function () {
        show("error", "Something went wrong with PayPal. Please try again.");
      },
    })
    .render("#paypal-buttons");
})();
