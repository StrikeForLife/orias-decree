/** Resolve one hit: temporary HP absorbs first; qualifying HP damage defers a rounded-up third. */
export function damage(hp, temp, max, amount, exempt = false) {
  const absorbed = Math.min(temp, amount),
    health = amount - absorbed;
  const deferred = !exempt && health * 5 >= max ? Math.ceil(health / 3) : 0;
  return {
    hp: hp - health + deferred,
    temp: temp - absorbed,
    deferred,
    absorbed,
    immediate: health - deferred,
  };
}
