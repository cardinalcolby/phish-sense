// Fish cursor: on the home screen, the mouse pointer becomes a little fish
// that turns to face where it's swimming, wags its tail, and blows bubbles.
// Only runs with a real mouse (not touch) and stays off for reduced motion.
(() => {
  const fine = window.matchMedia("(pointer: fine)").matches;
  const calm = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  if (!fine || calm) return;

  const home = document.getElementById("start-screen");

  // Fish faces right; its nose (the click point) is at (46, 18).
  const fish = document.createElement("div");
  fish.className = "fish-cursor";
  fish.setAttribute("aria-hidden", "true");
  fish.innerHTML = `
    <svg viewBox="0 0 50 36" width="50" height="36">
      <g class="fish-tail">
        <path d="M14 18 L2 7 Q5 18 2 29 Z" fill="#1fb8a0" />
      </g>
      <path d="M22 9 Q27 1 33 8 Z" fill="#1fb8a0" />
      <ellipse cx="29" cy="18" rx="17" ry="11" fill="#2de0c4" />
      <path d="M17 21 Q29 31 43 22 Q30 26 17 21 Z" fill="#b8fff1" opacity="0.8" />
      <path d="M26 20 Q30 25 32 20" fill="#1fb8a0" />
      <circle cx="37" cy="15" r="4" fill="#fff" />
      <circle cx="38" cy="15.5" r="2.4" fill="#0a1a33" />
      <circle cx="38.8" cy="14.5" r="0.9" fill="#fff" />
      <ellipse cx="36" cy="21" rx="2.2" ry="1.3" fill="#ff8fa3" opacity="0.7" />
      <path d="M43 20 Q45 21 44 22" stroke="#0a1a33" stroke-width="1" fill="none" stroke-linecap="round" />
    </svg>`;
  document.body.appendChild(fish);

  let x = -100, y = -100;     // pointer position
  let lastX = x, lastY = y;
  let facing = 1;             // 1 = right, -1 = left
  let tilt = 0;
  let speed = 0;
  let lastBubble = 0;
  let active = false;

  const onHome = () => !home.classList.contains("hidden");

  const bubble = (bx, by, size, burst) => {
    const b = document.createElement("span");
    b.className = "fish-bubble" + (burst ? " burst" : "");
    b.style.left = bx + "px";
    b.style.top = by + "px";
    b.style.width = b.style.height = size + "px";
    b.style.setProperty("--drift", (Math.random() * 30 - 15).toFixed(1) + "px");
    b.addEventListener("animationend", () => b.remove());
    document.body.appendChild(b);
  };

  window.addEventListener("mousemove", (e) => { x = e.clientX; y = e.clientY; });
  document.addEventListener("mouseleave", () => { fish.style.opacity = "0"; });
  document.addEventListener("mouseenter", () => { if (active) fish.style.opacity = "1"; });

  // Clicking makes the fish gulp and puff out a ring of bubbles.
  window.addEventListener("mousedown", () => {
    if (!active) return;
    fish.classList.remove("gulp");
    void fish.offsetWidth; // restart the animation
    fish.classList.add("gulp");
    for (let i = 0; i < 6; i++) bubble(x + facing * 4, y, 5 + Math.random() * 7, true);
  });

  const frame = (t) => {
    const nowActive = onHome();
    if (nowActive !== active) {
      active = nowActive;
      document.body.classList.toggle("fish-mode", active);
      fish.style.opacity = active ? "1" : "0";
    }

    if (active) {
      const dx = x - lastX, dy = y - lastY;
      speed = speed * 0.85 + Math.hypot(dx, dy) * 0.15;
      if (Math.abs(dx) > 1.5) facing = dx > 0 ? 1 : -1;
      // Nose tips up or down with vertical motion.
      const targetTilt = Math.max(-30, Math.min(30, dy * 2.5)) * facing;
      tilt += (targetTilt - tilt) * 0.2;

      fish.style.transform =
        `translate(${x - 46}px, ${y - 18}px) scaleX(${facing}) rotate(${tilt.toFixed(1)}deg)`;
      // Tail wags faster the faster the fish swims.
      fish.style.setProperty("--wag", Math.max(0.12, 0.6 - speed * 0.03).toFixed(2) + "s");

      if (speed > 3 && t - lastBubble > 90) {
        lastBubble = t;
        bubble(x - facing * 40, y + (Math.random() * 8 - 4), 4 + Math.random() * 6, false);
      }
    }

    lastX = x; lastY = y;
    requestAnimationFrame(frame);
  };
  requestAnimationFrame(frame);
})();
