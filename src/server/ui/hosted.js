// Hosted business page: scroll to the embedded intake.
(function () {
  "use strict";
  function ready(fn) {
    if (document.readyState !== "loading") fn();
    else document.addEventListener("DOMContentLoaded", fn);
  }
  ready(function () {
    var b = document.getElementById("start");
    if (!b) return;
    b.addEventListener("click", function () {
      var t = document.querySelector("[data-intake-inline]");
      if (t) t.scrollIntoView();
      else window.scrollTo(0, document.body.scrollHeight);
    });
  });
})();
