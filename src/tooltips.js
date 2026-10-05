// Shared hover/focus tooltips, ported from the reference
// unused/uirevamp/base.js:385-442 plus the `.ui-tooltip-portal` rules from
// unused/uirevamp/primitives.css:78-81.
//
// The reference does not use CSS pseudo-elements here: it keeps one fixed
// portal on <body>, fills it from the hovered element's `tooltip` attribute and
// flips the arrow depending on whether it had room above the trigger. That
// matters for the profile page, where role badges and presence dots sit right
// against the viewport edges.
(function () {
  if (window.__bvTooltipsReady) return;
  window.__bvTooltipsReady = true;

  window.setupTooltips = function setupTooltips() {
    const existing = document.getElementById('ui-tooltip');
    if (existing) return;

    const tooltip = document.createElement('div');
    tooltip.className = 'ui-tooltip-portal';
    tooltip.id = 'ui-tooltip';
    tooltip.setAttribute('role', 'tooltip');
    tooltip.hidden = true;
    document.body.appendChild(tooltip);

    let trigger = null;

    const findTrigger = target => (target instanceof Element ? target.closest('[tooltip]') : null);

    const position = () => {
      if (!trigger || tooltip.hidden) return;
      const rect = trigger.getBoundingClientRect();
      const gutter = 8;
      const edge = 8;
      const tip = tooltip.getBoundingClientRect();
      const above = rect.top - tip.height - gutter;
      const top = above >= edge ? above : rect.bottom + gutter;
      const left = Math.min(
        Math.max(rect.left + rect.width / 2 - tip.width / 2, edge),
        window.innerWidth - tip.width - edge,
      );
      tooltip.style.setProperty('--tooltip-arrow-x', `${rect.left + rect.width / 2 - left}px`);
      tooltip.style.setProperty('--tooltip-arrow-side', above >= edge ? 'bottom' : 'top');
      tooltip.style.left = `${left}px`;
      tooltip.style.top = `${top}px`;
    };

    const show = next => {
      const text = next?.getAttribute('tooltip')?.trim();
      if (!text) return;
      trigger = next;
      tooltip.textContent = text;
      tooltip.hidden = false;
      tooltip.dataset.side = 'pending';
      position();
      tooltip.dataset.side =
        tooltip.getBoundingClientRect().top < trigger.getBoundingClientRect().top ? 'above' : 'below';
    };

    const hide = next => {
      if (next && next !== trigger) return;
      trigger = null;
      tooltip.hidden = true;
    };

    document.addEventListener('pointerover', event => {
      const next = findTrigger(event.target);
      if (next && !next.contains(event.relatedTarget)) show(next);
    });
    document.addEventListener('pointerout', event => {
      const current = findTrigger(event.target);
      if (current && !current.contains(event.relatedTarget)) hide(current);
    });
    // Keyboard parity: focusing a badge or the report button must explain it too.
    document.addEventListener('focusin', event => show(findTrigger(event.target)));
    document.addEventListener('focusout', event => hide(findTrigger(event.target)));
    document.addEventListener('keydown', event => {
      if (event.key === 'Escape') hide();
    });
    // Capture phase so scrolling any ancestor container repositions the tip.
    window.addEventListener('scroll', position, true);
    window.addEventListener('resize', position);
  };

  if (document.body) window.setupTooltips();
  else document.addEventListener('DOMContentLoaded', () => window.setupTooltips());
})();
