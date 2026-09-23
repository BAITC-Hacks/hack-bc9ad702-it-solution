const BUDGET = 100;
const HORIZON = 8;
const CRITERIA = {
  T1: { weight: 0.10, label: 'Разгрузка дорог' },
  T2: { weight: 0.10, label: 'Доступность общественного транспорта' },
  E1: { weight: 0.09, label: 'Озеленение' },
  E2: { weight: 0.11, label: 'Качество воздуха' },
  S1: { weight: 0.11, label: 'Школы и детсады' },
  S2: { weight: 0.11, label: 'Поликлиники и медпомощь' },
  B1: { weight: 0.09, label: 'Безопасность улиц' },
  B2: { weight: 0.09, label: 'Безопасность дорожного движения' },
  C1: { weight: 0.10, label: 'Надёжность ЖКХ' },
  C2: { weight: 0.10, label: 'Скорость решения обращений' },
};
const DIRECTIONS = [
  { id: 'transport', name: 'Транспорт', icon: '↔', criteria: ['T1', 'T2'] },
  { id: 'ecology', name: 'Экология', icon: '✦', criteria: ['E1', 'E2'] },
  { id: 'social', name: 'Социальная сфера', icon: '⌂', criteria: ['S1', 'S2'] },
  { id: 'safety', name: 'Безопасность', icon: '◈', criteria: ['B1', 'B2'] },
  { id: 'services', name: 'Городские сервисы', icon: '◎', criteria: ['C1', 'C2'] },
];
const DISTRICTS = {
  Есиль: { population: 0.27, values: { T1: 45, T2: 62, E1: 68, E2: 72, S1: 48, S2: 55, B1: 78, B2: 60, C1: 75, C2: 70 } },
  Алматы: { population: 0.24, values: { T1: 40, T2: 75, E1: 50, E2: 55, S1: 60, S2: 65, B1: 62, B2: 52, C1: 50, C2: 60 } },
  Сарыарка: { population: 0.20, values: { T1: 50, T2: 70, E1: 42, E2: 40, S1: 62, S2: 68, B1: 58, B2: 55, C1: 45, C2: 55 } },
  Байконур: { population: 0.13, values: { T1: 52, T2: 68, E1: 55, E2: 50, S1: 58, S2: 60, B1: 52, B2: 58, C1: 55, C2: 58 } },
  Нура: { population: 0.16, values: { T1: 55, T2: 40, E1: 45, E2: 65, S1: 38, S2: 35, B1: 55, B2: 50, C1: 60, C2: 50 } },
};
const MEASURES = [
  { id: 'M1', direction: 'transport', name: 'Выделенные полосы для автобусов', type: 'district', price: 18, lag: 2, effects: { T1: 6, T2: 9 } },
  { id: 'M2', direction: 'transport', name: 'Умные светофоры', type: 'city', price: 22, lag: 2, effects: { T1: 4, B2: 3 } },
  { id: 'M3', direction: 'transport', name: 'Линия ЛРТ / расширение', type: 'district', price: 30, lag: 4, effects: { T1: 16, T2: 20, E2: 4 } },
  { id: 'M4', direction: 'ecology', name: 'Парк / сквер', type: 'district', price: 15, lag: 2, effects: { E1: 12, E2: 3, B1: 2 } },
  { id: 'M5', direction: 'ecology', name: 'Чистое топливо для частного сектора', type: 'district', price: 25, lag: 3, effects: { E2: 14, C1: 4 } },
  { id: 'M6', direction: 'ecology', name: 'Озеленение и ветрозащитные полосы', type: 'city', price: 20, lag: 4, effects: { E1: 5, E2: 3 } },
  { id: 'M7', direction: 'social', name: 'Школа + детсад', type: 'district', price: 24, lag: 3, effects: { S1: 16 } },
  { id: 'M8', direction: 'social', name: 'Центр семейного здоровья / поликлиника', type: 'district', price: 20, lag: 3, effects: { S2: 14 } },
  { id: 'M9', direction: 'social', name: 'Дворовые спорт-хабы', type: 'district', price: 10, lag: 1, effects: { S1: 3, S2: 3, B1: 3 } },
  { id: 'M10', direction: 'safety', name: 'Освещение и камеры Safe City', type: 'district', price: 12, lag: 1, effects: { B1: 12, B2: 2 } },
  { id: 'M11', direction: 'safety', name: 'Безопасные переходы и школьные зоны', type: 'district', price: 10, lag: 1, effects: { B2: 12, T1: -2 } },
  { id: 'M12', direction: 'services', name: 'Единая цифровая платформа обращений', type: 'city', price: 14, lag: 1, effects: { C2: 5 } },
  { id: 'M13', direction: 'services', name: 'Модернизация тепло- и водосетей', type: 'district', price: 28, lag: 4, effects: { C1: 18, E2: 2 } },
  { id: 'M14', direction: 'services', name: 'Аварийные бригады ЖКХ + оповещение', type: 'city', price: 16, lag: 1, effects: { C1: 5, C2: 2 } },
];

const selections = new Map();
let resultConfirmed = false;
let simulation = null;
let isBudgetFloating = false;

const grid = document.querySelector('#decision-grid');
const metricGrid = document.querySelector('#metric-grid');
const budgetCard = document.querySelector('#budget-card');
const confirmPanel = document.querySelector('#confirm-panel');
const resultPanel = document.querySelector('#result-panel');
const confirmButton = document.querySelector('#confirm-button');
const homeButton = document.querySelector('#home-button');
const scenarioStatus = document.querySelector('#scenario-status');
const districtNames = Object.keys(DISTRICTS);

const round = (value) => Math.round(value * 100) / 100;
const spentBudget = () => Array.from(selections.values()).reduce((sum, item) => sum + item.measure.price, 0);
const effectiveEffects = (measure) => Object.fromEntries(Object.entries(measure.effects).map(([key, value]) => [key, value * (HORIZON - measure.lag) / HORIZON]));
const measurePriority = (measure) => round(Object.entries(effectiveEffects(measure)).reduce((sum, [criterion, value]) => sum + CRITERIA[criterion].weight * value, 0));
const cloneValues = () => Object.fromEntries(districtNames.map((name) => [name, structuredClone(DISTRICTS[name].values)]));

function districtScore(values) {
  return Object.entries(CRITERIA).reduce((total, [criterion, config]) => total + values[criterion] * config.weight, 0);
}

function summarize(values) {
  const districtScores = Object.fromEntries(districtNames.map((name) => [name, round(districtScore(values[name]))]));
  const average = districtNames.reduce((total, name) => total + DISTRICTS[name].population * districtScores[name], 0);
  const minimum = Math.min(...Object.values(districtScores));
  const critical = districtNames.reduce((total, name) => total + Object.values(values[name]).filter((value) => value < 40).length, 0);
  return { districtScores, average: round(average), minimum: round(minimum), critical, score: round(0.7 * average + 0.3 * minimum - critical) };
}

function validate(candidateSelections) {
  if (candidateSelections.length > 5) return 'Можно выбрать ровно 5 мероприятий.';
  const total = candidateSelections.reduce((sum, item) => sum + item.measure.price, 0);
  if (total > BUDGET) return 'Превышен бюджет 100 млн ₸.';
  const directionCounts = {};
  for (const item of candidateSelections) {
    if (item.measure.type === 'district' && !item.district) return 'Для районной меры нужно выбрать район.';
    directionCounts[item.measure.direction] = (directionCounts[item.measure.direction] || 0) + 1;
  }
  if (Object.values(directionCounts).some((count) => count > 2)) return 'В одном направлении допускается не более 2 мер.';
  const byId = Object.fromEntries(candidateSelections.map((item) => [item.measure.id, item]));
  if (byId.M1 && byId.M3) return 'M1 и M3 несовместимы: выберите BRT или ЛРТ.';
  if (byId.M4 && byId.M7 && byId.M4.district === byId.M7.district) return 'M4 и M7 нельзя разместить в одном районе.';
  if (byId.M5 && byId.M13 && byId.M5.district === byId.M13.district) return 'M5 и M13 нельзя выбрать для одного района.';
  return '';
}

function simulateScenario() {
  const beforeValues = cloneValues();
  const afterValues = cloneValues();
  const contributions = [];
  for (const item of selections.values()) {
    const targets = item.measure.type === 'city' ? districtNames : [item.district];
    const effects = effectiveEffects(item.measure);
    for (const district of targets) {
      for (const [criterion, effect] of Object.entries(effects)) {
        afterValues[district][criterion] = Math.min(100, Math.max(0, afterValues[district][criterion] + effect));
      }
    }
    contributions.push({ id: item.measure.id, name: item.measure.name, district: item.measure.type === 'city' ? 'город' : item.district, lag: item.measure.lag, priority: measurePriority(item.measure), effects: Object.fromEntries(Object.entries(effects).map(([key, value]) => [key, round(value)])) });
  }

  const selected = Object.fromEntries(Array.from(selections.values()).map((item) => [item.measure.id, item]));
  const synergies = [];
  const applySynergy = (left, right, criterion, amount) => {
    if (!selected[left] || !selected[right]) return;
    const target = selected[left].measure.type === 'city' ? districtNames[0] : selected[left].district;
    afterValues[target][criterion] = Math.min(100, afterValues[target][criterion] + amount);
    synergies.push({ pair: left + ' + ' + right, district: target, criterion, amount });
  };
  applySynergy('M1', 'M2', 'T1', 2);
  applySynergy('M10', 'M12', 'B1', 2);
  applySynergy('M5', 'M6', 'E2', 2);

  const before = summarize(beforeValues);
  const after = summarize(afterValues);
  const directionScores = Object.fromEntries(DIRECTIONS.map((direction) => {
    const value = districtNames.reduce((total, district) => total + direction.criteria.reduce((sum, criterion) => sum + afterValues[district][criterion], 0) / direction.criteria.length * DISTRICTS[district].population, 0);
    return [direction.id, round(value)];
  }));
  const districtDeltas = Object.fromEntries(districtNames.map((name) => [name, round(after.districtScores[name] - before.districtScores[name])]));
  const criterionDeltas = Object.fromEntries(districtNames.map((name) => [name, Object.fromEntries(Object.keys(CRITERIA).map((criterion) => [criterion, round(afterValues[name][criterion] - beforeValues[name][criterion])]))]));
  return { formula: 'Score = 0.7 × D_avg + 0.3 × D_min − N_crit', horizonQuarters: HORIZON, before, after, delta: round(after.score - before.score), directionScores, districtDeltas, criterionDeltas, contributions, synergies };
}

function renderCityPulse() {
  const baseline = cloneValues();
  metricGrid.innerHTML = DIRECTIONS.map((direction) => {
    const value = districtNames.reduce((total, district) => total + direction.criteria.reduce((sum, criterion) => sum + baseline[district][criterion], 0) / direction.criteria.length * DISTRICTS[district].population, 0);
    return '<article><span>' + direction.name + '</span><strong>' + round(value) + '</strong><small>Стартовый уровень</small></article>';
  }).join('');
}

function render() {
  const spent = spentBudget();
  const current = Array.from(selections.values());
  grid.innerHTML = DIRECTIONS.map((direction) => {
    const cards = MEASURES.filter((measure) => measure.direction === direction.id).map((measure) => {
      const selected = selections.get(measure.id);
      const district = selected ? selected.district : districtNames[0];
      const candidate = selected ? current : current.concat({ measure, district: measure.type === 'district' ? district : null });
      const reason = selected ? '' : validate(candidate);
      const select = measure.type === 'district'
        ? '<select class="district-select" data-measure="' + measure.id + '" aria-label="Район для ' + measure.id + '">' + districtNames.map((name) => '<option value="' + name + '"' + (name === district ? ' selected' : '') + '>' + name + '</option>').join('') + '</select>'
        : '<small>Тип: весь город</small>';
      const validationNote = reason ? '<small class="validation-note">' + reason + '</small>' : '';
      return '<article class="initiative ' + (selected ? 'selected' : '') + ' ' + (reason ? 'disabled' : '') + '"><div class="initiative-heading"><h4>' + measure.id + ' — ' + measure.name + '</h4><span class="price-badge">Цена: ' + measure.price + ' млн ₸</span></div><p>Лаг: ' + measure.lag + ' кв. · МАИ-приоритет: ' + measurePriority(measure) + '</p>' + select + '<b>Эффект за 8 кв.: ' + Object.entries(effectiveEffects(measure)).map(([key, value]) => key + ' ' + (value >= 0 ? '+' : '') + round(value)).join(', ') + '</b>' + validationNote + '<button class="select-button" data-measure="' + measure.id + '"' + (reason ? ' disabled title="' + reason + '"' : '') + '>' + (selected ? 'Убрать' : 'Выбрать') + '</button></article>';
    }).join('');
    return '<section class="direction-card"><div class="direction-title"><span>' + direction.icon + '</span><h3>' + direction.name + '</h3></div><div class="initiative-list">' + cards + '</div></section>';
  }).join('');
  document.querySelector('#budget-left').textContent = BUDGET - spent;
  document.querySelector('#budget-caption').textContent = spent + ' из ' + BUDGET + ' млн ₸ распределено';
  document.querySelector('#budget-progress').style.width = spent + '%';
  document.querySelector('#selection-count').textContent = selections.size;
  const validationError = validate(current);
  confirmPanel.hidden = selections.size !== 5 || Boolean(validationError) || resultConfirmed;
  resultPanel.hidden = !resultConfirmed;
  if (resultConfirmed && simulation) {
    document.querySelector('#score-value').textContent = simulation.after.score.toFixed(2);
    renderResultDetails(spent);
  }
}

function renderResultDetails(spent) {
  const cards = [
    ['Бюджет', spent + ' из ' + BUDGET + ' млн ₸'],
    ['Astana QoL Score', simulation.before.score.toFixed(2) + ' → ' + simulation.after.score.toFixed(2) + ' (' + (simulation.delta >= 0 ? '+' : '') + simulation.delta + ')'],
    ['Критические показатели', simulation.before.critical + ' → ' + simulation.after.critical],
    ['Синергии', simulation.synergies.length ? simulation.synergies.map((item) => item.pair + ': ' + item.criterion + ' +' + item.amount).join('; ') : 'Нет'],
    ...Array.from(selections.values()).map((item) => [item.measure.id, item.measure.name + ' · ' + (item.district || 'город')]),
  ];
  document.querySelector('#result-details').innerHTML = cards.map((card) => '<div class="result-detail"><strong>' + card[0] + '</strong>' + card[1] + '</div>').join('');
  document.querySelector('#direction-scores').innerHTML = DIRECTIONS.map((direction) => '<div class="dashboard-item"><span>' + direction.name + '</span><b>' + simulation.directionScores[direction.id] + '/100</b></div>').join('');
  document.querySelector('#district-effects').innerHTML = districtNames.map((district) => '<div class="dashboard-item"><span>' + district + '</span><b>' + simulation.after.districtScores[district] + '/100</b><small>' + (simulation.districtDeltas[district] >= 0 ? '+' : '') + simulation.districtDeltas[district] + '</small></div>').join('');
}

grid.addEventListener('change', (event) => {
  const select = event.target.closest('select[data-measure]');
  if (!select || !selections.has(select.dataset.measure)) return;
  const item = selections.get(select.dataset.measure);
  const candidate = Array.from(selections.values()).map((entry) => entry.measure.id === item.measure.id ? { measure: item.measure, district: select.value } : entry);
  const error = validate(candidate);
  if (error) { alert(error); render(); return; }
  item.district = select.value;
  simulation = null;
  render();
});

grid.addEventListener('click', (event) => {
  const button = event.target.closest('button[data-measure]');
  if (!button) return;
  const measure = MEASURES.find((item) => item.id === button.dataset.measure);
  if (selections.has(measure.id)) selections.delete(measure.id);
  else {
    const select = grid.querySelector('select[data-measure="' + measure.id + '"]');
    const district = measure.type === 'district' ? select.value : null;
    const candidate = Array.from(selections.values()).concat({ measure, district });
    const error = validate(candidate);
    if (error) { alert(error); return; }
    selections.set(measure.id, { measure, district });
  }
  resultConfirmed = false;
  simulation = null;
  document.querySelector('#ai-analysis').textContent = '';
  render();
});

confirmButton.addEventListener('click', async () => {
  simulation = simulateScenario();
  resultConfirmed = true;
  scenarioStatus.classList.add('completed');
  scenarioStatus.innerHTML = '<i></i> Сценарий завершён';
  document.body.classList.add('results-mode');
  render();
  const spent = spentBudget();
  const payloadSelections = Array.from(selections.values()).map((item) => ({ id: item.measure.id, direction: DIRECTIONS.find((direction) => direction.id === item.measure.direction).name, title: item.measure.name, price: item.measure.price, districts: item.district || 'город', lag: item.measure.lag, ahpPriority: measurePriority(item.measure) }));
  const resultText = document.querySelector('#result-text');
  const analysis = document.querySelector('#ai-analysis');
  resultText.textContent = 'AI объясняет расчёт МАИ…';
  analysis.textContent = '';
  resultPanel.scrollIntoView({ behavior: 'smooth', block: 'start' });
  try {
    const response = await fetch('/api/analyze', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ selections: payloadSelections, budget: BUDGET, spent, simulation }) });
    const data = response.headers.get('content-type') && response.headers.get('content-type').includes('application/json') ? await response.json() : null;
    if (!response.ok || !data || !data.analysis) throw new Error((data && data.error) || 'Сервер не вернул AI-анализ.');
    resultText.textContent = 'МАИ-модель: ' + simulation.formula + '. Использовано ' + spent + ' из ' + BUDGET + ' млн ₸.';
    analysis.textContent = data.analysis;
  } catch (error) {
    resultText.textContent = 'МАИ-модель рассчитана: ' + simulation.formula + '. Использовано ' + spent + ' из ' + BUDGET + ' млн ₸.';
    analysis.textContent = 'AI-анализ пока недоступен: ' + error.message;
  }
});

document.querySelector('#reset-button').addEventListener('click', () => { selections.clear(); resultConfirmed = false; simulation = null; scenarioStatus.classList.remove('completed'); scenarioStatus.innerHTML = '<i></i> Сценарий активен'; document.body.classList.remove('results-mode'); document.querySelector('#ai-analysis').textContent = ''; render(); window.scrollTo({ top: 0, behavior: 'smooth' }); });
homeButton.addEventListener('click', () => { window.location.href = window.location.pathname + '#top'; window.location.reload(); });
function updateBudgetPosition() {
  const shouldFloat = window.scrollY > 180;
  if (shouldFloat === isBudgetFloating) return;
  const from = budgetCard.getBoundingClientRect();
  budgetCard.classList.toggle('floating', shouldFloat);
  const to = budgetCard.getBoundingClientRect();
  budgetCard.animate([{ transform: 'translate(' + (from.left - to.left) + 'px, ' + (from.top - to.top) + 'px)' }, { transform: 'translate(0, 0)' }], { duration: 430, easing: 'cubic-bezier(.2,.8,.2,1)' });
  isBudgetFloating = shouldFloat;
}
window.addEventListener('scroll', updateBudgetPosition, { passive: true });
renderCityPulse();
render();
