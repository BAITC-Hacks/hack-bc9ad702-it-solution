const initiatives = [
  { id: 'transport', icon: '↔', title: 'Выделенные автобусные полосы', description: 'Сокращают время в пути на загруженных коридорах.', price: 24, impact: 8 },
  { id: 'green', icon: '✦', title: 'Зелёные дворы и скверы', description: 'Добавляют доступные зоны отдыха в районах дефицита.', price: 18, impact: 7 },
  { id: 'social', icon: '⌂', title: 'Модульный детский сад', description: 'Расширяет доступность социальной инфраструктуры.', price: 28, impact: 9 },
  { id: 'safety', icon: '◈', title: 'Умное освещение улиц', description: 'Улучшает безопасность вечером и ночью.', price: 15, impact: 6 },
  { id: 'services', icon: '◎', title: 'Единый городской сервис', description: 'Ускоряет обработку обращений и городские услуги.', price: 12, impact: 5 },
];

const budget = 100;
const choices = new Set();
const grid = document.querySelector('#decision-grid');

function render() {
  const spent = initiatives.filter((item) => choices.has(item.id)).reduce((sum, item) => sum + item.price, 0);
  const canSelect = (item) => spent + item.price <= budget;
  grid.innerHTML = initiatives.map((item) => {
    const selected = choices.has(item.id);
    return `<article class="decision-card ${selected ? 'selected' : ''} ${!selected && !canSelect(item) ? 'disabled' : ''}">
      <span class="decision-icon">${item.icon}</span><h3>${item.title}</h3><p>${item.description}</p>
      <div class="decision-footer"><span class="price">${item.price} млн ₸ · +${item.impact} к влиянию</span>
      <button class="select-button" data-id="${item.id}" ${!selected && !canSelect(item) ? 'disabled' : ''}>${selected ? 'Выбрано ✓' : 'Выбрать'}</button></div></article>`;
  }).join('');
  document.querySelector('#budget-left').textContent = budget - spent;
  document.querySelector('#budget-caption').textContent = `${spent} из ${budget} млн ₸ распределено`;
  document.querySelector('#budget-progress').style.width = `${spent}%`;
  document.querySelector('#selection-count').textContent = choices.size;

  const result = document.querySelector('#result-panel');
  result.hidden = choices.size !== initiatives.length;
  if (choices.size === initiatives.length) {
    const impact = initiatives.reduce((sum, item) => sum + item.impact, 0);
    const score = 58 + impact;
    document.querySelector('#score-value').textContent = score;
    document.querySelector('#result-text').textContent = `Сценарий сбалансирован: вы закрыли все пять направлений и сохранили ${budget - spent} млн ₸ резерва.`;
  }
}

grid.addEventListener('click', (event) => {
  const button = event.target.closest('button[data-id]');
  if (!button) return;
  const { id } = button.dataset;
  choices.has(id) ? choices.delete(id) : choices.add(id);
  render();
});
document.querySelector('#reset-button').addEventListener('click', () => { choices.clear(); render(); window.scrollTo({ top: 0, behavior: 'smooth' }); });
render();
