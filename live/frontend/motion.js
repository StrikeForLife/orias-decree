// Motion never delays an API request or changes gameplay state.
const activeMotions = new WeakMap();
function animateSurface(element, frames, options = {}) {
  if (!element || matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  activeMotions.get(element)?.cancel();
  const animation = element.animate(frames, {
    duration: 300,
    easing: 'cubic-bezier(.2,.7,.3,1)',
    ...options,
  });
  activeMotions.set(element, animation);
}
function animateResourceFeedback(kind) {
  if (kind === 'damage' || kind === 'settle') {
    animateSurface(
      $('#status .vitality-chamber'),
      [
        { transform: 'translateX(0)', boxShadow: 'inset 0 0 0 3px #ff9c87,0 0 24px #df554b99' },
        { transform: 'translateX(-9px)', offset: 0.16 },
        { transform: 'translateX(8px)', offset: 0.32 },
        { transform: 'translateX(-6px)', offset: 0.48 },
        { transform: 'translateX(4px)', offset: 0.64 },
        { transform: 'translateX(0)', boxShadow: 'inset 0 0 0 3px #141e2255' },
      ],
      { duration: 680 },
    );
    // The health card may be partly outside the independently scrolling folio.
    // Light its visible frame too, without scrolling away from the action.
    animateSurface(
      $('#status'),
      [
        { outline: '2px solid #ff9c87', outlineOffset: '-5px' },
        { outline: '2px solid transparent', outlineOffset: '-5px' },
      ],
      { duration: 800 },
    );
  }
  if (kind === 'pray') {
    prayerSparks();
    animateSurface(
      $('#status .will-chamber'),
      [
        { boxShadow: 'inset 0 0 0 1px #c9a5ed55', filter: 'brightness(1)' },
        {
          boxShadow: 'inset 0 0 28px #be9ae455,0 0 18px #e3c78c55',
          filter: 'brightness(1.25)',
          offset: 0.4,
        },
        { boxShadow: 'inset 0 0 0 3px #141e2255', filter: 'brightness(1)' },
      ],
      { duration: 720 },
    );
  }
}
function prayerSparks() {
  if (matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  const chamber = $('#status .will-chamber');
  if (!chamber) return;
  const button = chamber.querySelector('#pray');
  // Keep the origin beside the button the player just used, rather than below
  // the visible portion of a long resource folio. Do not inherit disabled opacity.
  const origin = button ? button.offsetTop + button.offsetHeight / 2 : chamber.clientHeight / 2;
  const halo = document.createElement('span');
  halo.className = 'prayer-halo';
  halo.style.top = origin + 'px';
  halo.setAttribute('aria-hidden', 'true');
  chamber.append(halo);
  const wave = halo.animate(
    [
      { opacity: 0, transform: 'translate(-50%,-50%) scale(.25)' },
      { opacity: 0.9, transform: 'translate(-50%,-50%) scale(.9)', offset: 0.25 },
      { opacity: 0, transform: 'translate(-50%,-50%) scale(1.5)' },
    ],
    { duration: 1100, easing: 'ease-out' },
  );
  wave.finished.then(
    () => halo.remove(),
    () => halo.remove(),
  );
  for (let i = 0; i < 18; i++) {
    const spark = document.createElement('span');
    spark.className = 'prayer-spark';
    spark.style.top = origin + 'px';
    spark.textContent = i % 3 ? '✦' : '✧';
    spark.setAttribute('aria-hidden', 'true');
    chamber.append(spark);
    const angle = (i / 18) * Math.PI * 2,
      distance = 44 + (i % 4) * 12;
    const animation = spark.animate(
      [
        { opacity: 0, transform: 'translate(-50%,-50%) scale(.2)' },
        {
          opacity: 1,
          transform: `translate(calc(-50% + ${Math.cos(angle) * distance * 0.45}px),calc(-50% + ${Math.sin(angle) * distance * 0.45}px)) scale(1.1)`,
          offset: 0.18,
        },
        {
          opacity: 1,
          transform: `translate(calc(-50% + ${Math.cos(angle) * distance * 0.75}px),calc(-50% + ${Math.sin(angle) * distance * 0.75}px)) scale(.9)`,
          offset: 0.65,
        },
        {
          opacity: 0,
          transform: `translate(calc(-50% + ${Math.cos(angle) * distance}px),calc(-50% + ${Math.sin(angle) * distance}px)) scale(.3) rotate(${i * 37}deg)`,
        },
      ],
      { duration: 1100, delay: (i % 4) * 45, easing: 'ease-out', fill: 'both' },
    );
    animation.finished.then(
      () => spark.remove(),
      () => spark.remove(),
    );
  }
}

// Observe content replacement, not form typing or style changes.
new MutationObserver(() =>
  animateSurface($('#detail'), [
    { opacity: 0.35, transform: 'translateY(7px)' },
    { opacity: 1, transform: 'translateY(0)' },
  ]),
).observe($('#detail'), { childList: true });
document.querySelector('header nav').addEventListener('click', (event) => {
  const button = event.target.closest('[data-page]');
  if (!button) return;
  animateSurface($('#content'), [
    { opacity: 0.4, transform: 'translateY(5px)' },
    { opacity: 1, transform: 'translateY(0)' },
  ]);
});
document.addEventListener('click', (event) => {
  if (
    !event.target.closest('[data-view],[data-archive],#teamStats,#teamBackground,#growthCharacter')
  )
    return;
  animateSurface($('#content'), [
    { opacity: 0.4, transform: 'translateY(5px)' },
    { opacity: 1, transform: 'translateY(0)' },
  ]);
});
