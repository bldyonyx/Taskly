import { gsap } from 'gsap'

const motionQuery = window.matchMedia('(prefers-reduced-motion: reduce)')

export function prefersReducedMotion() {
  return motionQuery.matches
}

function finishImmediately(onComplete) {
  if (typeof onComplete === 'function') {
    onComplete()
  }
}

export function animateTaskEnter(item) {
  if (!item || prefersReducedMotion()) {
    return
  }

  gsap.fromTo(
    item,
    { autoAlpha: 0, y: -14, scale: 0.96, rotate: -1.5 },
    {
      autoAlpha: 1,
      y: 0,
      scale: 1,
      rotate: 0,
      duration: 0.34,
      ease: 'back.out(1.7)',
      clearProps: 'opacity,visibility,transform',
    },
  )
}

export function animateTaskDelete(item, onComplete) {
  if (!item || prefersReducedMotion()) {
    finishImmediately(onComplete)
    return
  }

  gsap.to(item, {
    autoAlpha: 0,
    x: 34,
    scale: 0.94,
    rotate: 2,
    height: 0,
    minHeight: 0,
    paddingTop: 0,
    paddingBottom: 0,
    marginTop: 0,
    marginBottom: 0,
    duration: 0.24,
    ease: 'power2.in',
    onComplete,
  })
}

export function animateAllTasksDelete(items, onComplete) {
  const taskItems = Array.from(items ?? [])

  if (taskItems.length === 0 || prefersReducedMotion()) {
    finishImmediately(onComplete)
    return
  }

  gsap.to(taskItems, {
    autoAlpha: 0,
    x: 28,
    scale: 0.94,
    rotate: 1.5,
    height: 0,
    minHeight: 0,
    paddingTop: 0,
    paddingBottom: 0,
    marginTop: 0,
    marginBottom: 0,
    duration: 0.22,
    ease: 'power2.in',
    stagger: 0.045,
    onComplete,
  })
}

export function animateTaskChecked(item) {
  if (!item || prefersReducedMotion()) {
    return
  }

  const indicator = item.querySelector('.check-indicator')

  gsap.fromTo(
    item,
    { '--strike-scale': 0 },
    { '--strike-scale': 1, duration: 0.28, ease: 'power2.out' },
  )

  gsap
    .timeline()
    .fromTo(
      item,
      { scale: 0.985 },
      { scale: 1, duration: 0.3, ease: 'elastic.out(1, 0.55)', clearProps: 'transform' },
      0,
    )
    .fromTo(
      indicator,
      { scale: 0.35, rotate: -18 },
      { scale: 1, rotate: 0, duration: 0.36, ease: 'back.out(2.4)', clearProps: 'transform' },
      0,
    )
}

export function animateTaskUnchecked(item) {
  if (!item || prefersReducedMotion()) {
    return
  }

  const indicator = item.querySelector('.check-indicator')

  gsap
    .timeline()
    .fromTo(
      item,
      { x: -3, rotate: -0.8 },
      { x: 0, rotate: 0, duration: 0.24, ease: 'back.out(2)', clearProps: 'transform' },
      0,
    )
    .fromTo(
      indicator,
      { scale: 1.18, rotate: 10 },
      { scale: 1, rotate: 0, duration: 0.24, ease: 'power2.out', clearProps: 'transform' },
      0,
    )
}

export function animateProgressUpdate(elements, progress) {
  if (!elements.fill || !elements.count) {
    return
  }

  const hasPreviousProgress = elements.count.dataset.completed !== undefined
  const previousCompleted = Number(elements.count.dataset.completed ?? progress.completed)
  const previousTotal = Number(elements.count.dataset.total ?? progress.total)
  const previousPercentage = Number(elements.fill.dataset.percentage ?? progress.percentage)

  elements.count.dataset.completed = String(progress.completed)
  elements.count.dataset.total = String(progress.total)
  elements.fill.dataset.percentage = String(progress.percentage)

  if (!hasPreviousProgress || prefersReducedMotion()) {
    elements.count.textContent = `${progress.completed} / ${progress.total}`
    elements.fill.style.width = `${progress.percentage}%`
    return
  }

  gsap.killTweensOf(elements.fill)
  gsap.to(elements.fill, {
    width: `${progress.percentage}%`,
    duration: 0.42,
    ease: previousPercentage < progress.percentage ? 'back.out(1.55)' : 'power2.out',
  })

  if (previousCompleted === progress.completed && previousTotal === progress.total) {
    return
  }

  const counter = { completed: previousCompleted, total: previousTotal }
  const originalLive = elements.count.getAttribute('aria-live')
  elements.count.setAttribute('aria-live', 'off')
  gsap.killTweensOf(counter)
  gsap.to(counter, {
    completed: progress.completed,
    total: progress.total,
    duration: 0.28,
    ease: 'power2.out',
    snap: { completed: 1, total: 1 },
    onUpdate: () => {
      elements.count.textContent = `${counter.completed} / ${counter.total}`
    },
    onComplete: () => {
      elements.count.textContent = `${progress.completed} / ${progress.total}`
      if (originalLive) {
        elements.count.setAttribute('aria-live', originalLive)
      }
    },
  })
}

export function animateModalOpen(overlay, dialog) {
  if (!overlay || !dialog || prefersReducedMotion()) {
    return
  }

  gsap
    .timeline()
    .fromTo(overlay, { autoAlpha: 0 }, { autoAlpha: 1, duration: 0.16, ease: 'power1.out' })
    .fromTo(
      dialog,
      { autoAlpha: 0, y: 18, scale: 0.94, rotate: -1.2 },
      {
        autoAlpha: 1,
        y: 0,
        scale: 1,
        rotate: 0,
        duration: 0.32,
        ease: 'back.out(1.85)',
        clearProps: 'opacity,visibility,transform',
      },
      0.02,
    )
}

export function animateModalClose(overlay, dialog, onComplete) {
  if (!overlay || !dialog || prefersReducedMotion()) {
    finishImmediately(onComplete)
    return
  }

  gsap
    .timeline({ onComplete })
    .to(dialog, { autoAlpha: 0, y: 12, scale: 0.96, duration: 0.16, ease: 'power2.in' })
    .to(overlay, { autoAlpha: 0, duration: 0.12, ease: 'power1.in' }, 0.04)
}

export function animateFinishButton(button) {
  if (!button || prefersReducedMotion()) {
    return
  }

  const sparkle = button.querySelector('svg')

  gsap
    .timeline()
    .fromTo(
      button,
      { y: 0, scale: 1, rotate: -1 },
      {
        keyframes: [
          { y: -6, scale: 1.035, rotate: -2.4, duration: 0.12 },
          { y: 3, scale: 0.985, rotate: 1.4, duration: 0.1 },
          { y: 0, scale: 1, rotate: -1, duration: 0.18 },
        ],
        ease: 'back.out(1.8)',
        clearProps: 'transform',
      },
    )
    .fromTo(
      sparkle,
      { scale: 0.75, rotate: -24 },
      { scale: 1.18, rotate: 16, duration: 0.22, yoyo: true, repeat: 1, ease: 'power2.out' },
      0,
    )
}
