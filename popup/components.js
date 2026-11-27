import { h } from './dom.js';
import { LOGO, icon } from './icons.js';

export function iconButton({ name, label, onClick, danger = false, disabled = false }) {
  return h('button', {
    class: `icon-btn${danger ? ' danger' : ''}`,
    type: 'button',
    title: label,
    'aria-label': label,
    html: icon(name),
    onClick,
    disabled,
  });
}

/** Header for the main list: logo, name, settings. */
export function brandHeader({ onSettings }) {
  return h(
    'header',
    { class: 'top' },
    h('div', { class: 'brand' }, h('span', { class: 'brand-mark', html: LOGO }), h('span', { class: 'brand-name' }, 'AutoMeet')),
    iconButton({ name: 'sliders', label: 'Settings', onClick: onSettings }),
  );
}

/** Header for the form and settings: back arrow and a title. */
export function backHeader({ title, onBack }) {
  return h(
    'header',
    { class: 'top' },
    h('div', { class: 'brand' }, iconButton({ name: 'back', label: 'Back', onClick: onBack }), h('h1', { class: 'view-title' }, title)),
  );
}

export function field({ label, input, hint, error, extra }) {
  const errEl = h('p', { class: 'field-error', hidden: true, role: 'alert' });
  const wrap = h('div', { class: 'field' }, h('label', {}, h('span', { class: 'field-label' }, label), input), extra, hint ? h('p', { class: 'hint' }, hint) : null, errEl);
  return {
    el: wrap,
    setError(message) {
      errEl.textContent = message || '';
      errEl.hidden = !message;
      input.classList.toggle('invalid', !!message);
    },
  };
}
