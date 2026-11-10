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
  if (kind === 'damage' || kind === 'settle')
    animateSurface(
      $('#status .vitality-chamber'),
      [
        { transform: 'translateX(0)', boxShadow: 'inset 0 0 0 2px #ef857acc,0 0 22px #b63d4055' },
        { transform: 'translateX(-4px)', offset: 0.18 },
        { transform: 'translateX(3px)', offset: 0.36 },
        { transform: 'translateX(-2px)', offset: 0.55 },
        { transform: 'translateX(0)', boxShadow: 'inset 0 0 0 3px #141e2255' },
      ],
      { duration: 520 },
    );
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
  for (let i = 0; i < 14; i++) {
    const spark = document.createElement('span');
    spark.className = 'prayer-spark';
    spark.textContent = i % 3 ? '✦' : '✧';
    spark.setAttribute('aria-hidden', 'true');
    chamber.append(spark);
    const angle = (i / 14) * Math.PI * 2,
      distance = 38 + (i % 4) * 13;
    const animation = spark.animate(
      [
        { opacity: 0, transform: 'translate(-50%,-50%) scale(.2)' },
        { opacity: 1, offset: 0.18 },
        {
          opacity: 0,
          transform: `translate(calc(-50% + ${Math.cos(angle) * distance}px),calc(-50% + ${Math.sin(angle) * distance}px)) scale(.3) rotate(${i * 37}deg)`,
        },
      ],
      { duration: 650, delay: (i % 4) * 35, easing: 'ease-out', fill: 'both' },
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
