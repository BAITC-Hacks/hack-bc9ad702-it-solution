const directions = [
  { id: 'transport', icon: '↔', name: 'Транспорт', options: [
    { id: 'bus-lanes', title: 'Выделенные автобусные полосы', description: 'Сокращают время в пути на ключевых коридорах.', districts: 'Северный, Центральный', price: 24, impact: 8 },
    { id: 'smart-lights', title: 'Умные светофоры', description: 'Адаптируют фазы движения к реальной загрузке.', districts: 'Центральный, Восточный', price: 16, impact: 6 },
    { id: 'bike-network', title: 'Связная велосеть', description: 'Создаёт короткие безопасные маршруты без авто.', districts: 'Южный, Прибрежный', price: 12, impact: 4 },
  ]},
  { id: 'green', icon: '✦', name: 'Озеленение', options: [
    { id: 'courtyard-greening', title: 'Зелёные дворы и скверы', description: 'Добавляют близкие зоны отдыха в жилых кварталах.', districts: 'Северный, Восточный', price: 18, impact: 7 },
    { id: 'green-corridor', title: 'Зелёный пешеходный коридор', description: 'Соединяет парки и общественные пространства.', districts: 'Центральный, Прибрежный', price: 26, impact: 9 },
    { id: 'tree-program', title: 'Программа посадки деревьев', description: 'Увеличивает тень и устойчивость городской среды.', districts: 'Все районы', price: 11, impact: 5 },
  ]},
  { id: 'social', icon: '⌂', name: 'Социальная инфраструктура', options: [
    { id: 'kindergarten', title: 'Модульный детский сад', description: 'Быстро создаёт места для семей с детьми.', districts: 'Северный', price: 28, impact: 9 },
    { id: 'clinic', title: 'Районная поликлиника', description: 'Повышает доступность первичной медицины.', districts: 'Восточный, Южный', price: 25, impact: 8 },
    { id: 'youth-center', title: 'Молодёжный центр', description: 'Даёт пространство для кружков и досуга.', districts: 'Прибрежный', price: 14, impact: 5 },
  ]},
  { id: 'safety', icon: '◈', name: 'Безопасность', options: [
    { id: 'smart-lighting', title: 'Умное освещение улиц', description: 'Улучшает видимость и безопасность вечером.', districts: 'Восточный, Южный', price: 15, impact: 6 },
    { id: 'safe-crossings', title: 'Безопасные переходы', description: 'Снижает риск ДТП возле школ и остановок.', districts: 'Северный, Центральный', price: 10, impact: 5 },
    { id: 'safe-city', title: 'Система «Безопасный город»', description: 'Помогает быстрее реагировать на инциденты.', districts: 'Все районы', price: 22, impact: 8 },
  ]},
  { id: 'services', icon: '◎', name: 'Городской сервис', options: [
    { id: 'service-app', title: 'Единое приложение города', description: 'Ускоряет обращения и получение услуг.', districts: 'Все районы', price: 12, impact: 5 },
    { id: 'smart-waste', title: 'Умный вывоз отходов', description: 'Оптимизирует маршруты и графики уборки.', districts: 'Центральный, Южный', price: 17, impact: 6 },
    { id: 'district-centers', title: 'Районные центры услуг', description: 'Приближают сервисы к жителям.', districts: 'Северный, Восточный', price: 20, impact: 7 },
  ]},
];

const budget = 100;
const choices = new Map();
const grid = document.querySelector('#decision-grid');
const confirmPanel = document.querySelector('#confirm-panel');
const resultPanel = document.querySelector('#result-panel');
const confirmButton = document.querySelector('#confirm-button');
const homeButton = document.querySelector('#home-button');
let resultConfirmed = false;
const selectedOptions = () => [...choices.values()];
const spentBudget = () => selectedOptions().reduce((sum, item) => sum + item.price, 0);

function render() {
  const spent = spentBudget();
  grid.innerHTML = directions.map((direction) => {
    const selected = choices.get(direction.id);
    const options = direction.options.map((option) => {
      const isSelected = selected?.id === option.id;
      const unavailable = !isSelected && spent - (selected?.price ?? 0) + option.price > budget;
      return `<article class="initiative ${isSelected ? 'selected' : ''} ${unavailable ? 'disabled' : ''}">
        <div class="initiative-heading"><h4>${option.title}</h4><span>${option.price} млн ₸</span></div>
        <p>${option.description}</p><small>Районы: ${option.districts}</small><b>Ожидаемый эффект: +${option.impact}</b>
        <button class="select-button" data-direction="${direction.id}" data-option="${option.id}" ${unavailable ? 'disabled' : ''}>${isSelected ? 'Выбрано ✓' : 'Выбрать'}</button>
      </article>`;
    }).join('');
    return `<section class="direction-card"><div class="direction-title"><span>${direction.icon}</span><h3>${direction.name}</h3></div><div class="initiative-list">${options}</div></section>`;
  }).join('');

  document.querySelector('#budget-left').textContent = budget - spent;
  document.querySelector('#budget-caption').textContent = `${spent} из ${budget} млн ₸ распределено`;
  document.querySelector('#budget-progress').style.width = `${spent}%`;
  document.querySelector('#selection-count').textContent = choices.size;

  const allDirectionsSelected = choices.size === directions.length;
  confirmPanel.hidden = !allDirectionsSelected || resultConfirmed;
  resultPanel.hidden = !resultConfirmed;
  if (resultConfirmed) {
    const impact = selectedOptions().reduce((sum, item) => sum + item.impact, 0);
    document.querySelector('#score-value').textContent = 58 + impact;
    renderResultDetails(spent, impact);
  }
}

function renderResultDetails(spent, impact) {
  const cards = [
    { label: 'Бюджет', value: `${spent} из ${budget} млн ₸` },
    { label: 'Изменение Score', value: `+${impact} пунктов` },
    ...directions.map((direction) => {
      const choice = choices.get(direction.id);
      return { label: direction.name, value: `${choice.title} · ${choice.price} млн ₸ · ${choice.districts}` };
    }),
  ];
  document.querySelector('#result-details').innerHTML = cards.map((card) =>
    `<div class="result-detail"><strong>${card.label}</strong>${card.value}</div>`
  ).join('');
}

grid.addEventListener('click', (event) => {
  const button = event.target.closest('button[data-direction]');
  if (!button) return;
  const direction = directions.find((item) => item.id === button.dataset.direction);
  const option = direction.options.find((item) => item.id === button.dataset.option);
  choices.get(direction.id)?.id === option.id ? choices.delete(direction.id) : choices.set(direction.id, option);
  resultConfirmed = false;
  document.querySelector('#ai-analysis').textContent = '';
  render();
});
confirmButton.addEventListener('click', async () => {
  const selections = directions.map((direction) => ({ direction: direction.name, ...choices.get(direction.id) }));
  const spent = spentBudget();
  const impact = selectedOptions().reduce((sum, item) => sum + item.impact, 0);
  resultConfirmed = true;
  document.body.classList.add('results-mode');
  confirmButton.disabled = true;
  render();

  const resultText = document.querySelector('#result-text');
  const analysis = document.querySelector('#ai-analysis');
  resultText.textContent = 'AI анализирует выбранный сценарий…';
  analysis.textContent = '';
  resultPanel.scrollIntoView({ behavior: 'smooth', block: 'start' });
  try {
    const response = await fetch('/api/analyze', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ selections, budget, spent, impact, score: 58 + impact }),
    });
    const isJson = response.headers.get('content-type')?.includes('application/json');
    const data = isJson ? await response.json() : null;
    if (!response.ok) {
      const message = data?.error || 'Сервер не вернул JSON. Остановите старый сервер и запустите приложение через run.bat.';
      throw new Error(message);
    }
    if (!data?.analysis) throw new Error('AI не вернул текстовый анализ.');
    resultText.textContent = `Score рассчитан по выбранным инициативам. Использовано ${spent} млн ₸ из ${budget} млн ₸.`;
    analysis.textContent = data.analysis;
  } catch (error) {
    resultText.textContent = `Score рассчитан: использовано ${spent} млн ₸ из ${budget} млн ₸.`;
    analysis.textContent = `AI-анализ пока недоступен: ${error.message}`;
  } finally {
    confirmButton.disabled = false;
  }
});
document.querySelector('#reset-button').addEventListener('click', () => {
  choices.clear();
  resultConfirmed = false;
  document.body.classList.remove('results-mode');
  document.querySelector('#ai-analysis').textContent = '';
  render();
  window.scrollTo({ top: 0, behavior: 'smooth' });
});
homeButton.addEventListener('click', () => {
  window.location.href = window.location.pathname + '#top';
  window.location.reload();
});
render();
