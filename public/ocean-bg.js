// Background fish schools: each time a school finishes crossing the screen,
// it starts its next pass at a new random height, so the pattern doesn't repeat.
// The swimming itself is pure CSS (see "Fish schools" in style.css).
(() => {
  const schools = [...document.querySelectorAll(".fish-school")];
  const MIN_Y = 4, MAX_Y = 84, GAP = 12; // in vh: top of screen to just above the waves

  function pickHeight(school) {
    // Try to stay clear of the other schools' heights so they don't bunch up
    const others = schools.filter((s) => s !== school).map((s) => parseFloat(getComputedStyle(s).getPropertyValue("--y")));
    let y;
    for (let i = 0; i < 10; i++) {
      y = MIN_Y + Math.random() * (MAX_Y - MIN_Y);
      if (others.every((o) => Number.isNaN(o) || Math.abs(o - y) >= GAP)) break;
    }
    return y;
  }

  for (const school of schools) {
    school.addEventListener("animationiteration", (e) => {
      if (e.target !== school) return; // ignore the inner up-and-down drift
      school.style.setProperty("--y", pickHeight(school).toFixed(1) + "vh");
    });
  }
})();
