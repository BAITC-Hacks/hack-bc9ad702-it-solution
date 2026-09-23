// All editable parameters live in data/model-data.json. The app contains only
// the calculation and interaction logic, so another city can use the same UI.
let MODEL;
let BUDGET;
let BUDGET_UNIT;
let HORIZON;
let CRITERIA;
let DIRECTIONS;
let DISTRICTS;
let MEASURES;
let SYNERGIES;
let CONSTRAINTS;

const selections = new Map();
let resultConfirmed = false;
let simulation = null;
let isBudgetFloating = false;
let budgetDrag = null;
let isConfirming = false;

const grid = document.querySelector('#decision-grid');
const metricGrid = document.querySelector('#metric-grid');
const budgetCard = document.querySelector('#budget-card');
const confirmPanel = document.querySelector('#confirm-panel');
const resultPanel = document.querySelector('#result-panel');
const scenarioTransition = document.querySelector('#scenario-transition');
const confirmButton = document.querySelector('#confirm-button');
const homeButton = document.querySelector('#home-button');
const scenarioStatus = document.querySelector('#scenario-status');
let districtNames = [];

const round = (value) => Math.round(value * 100) / 100;
const spentBudget = () => Array.from(selections.values()).reduce((sum, item) => sum + item.measure.price, 0);
const effectiveEffects = (measure) => Object.fromEntries(Object.entries(measure.effects).map(([key, value]) => [key, value * (HORIZON - measure.lag) / HORIZON]));
const measurePriority = (measure) => round(Object.entries(effectiveEffects(measure)).reduce((sum, [criterion, value]) => sum + CRITERIA[criterion].weight * value, 0));
const cloneValues = () => Object.fromEntries(districtNames.map((name) => [name, structuredClone(DISTRICTS[name].values)]));

function districtScore(values) {
  return Object.entries(CRITERIA).reduce((total, [criterion, config]) => total + values[criterion] * config.weight, 0);
}

function summarize(values) {
  // Keep full precision until the final result. Rounding an individual district
  // before calculating the city average would slightly change the MАИ score.
  const districtScores = Object.fromEntries(districtNames.map((name) => [name, districtScore(values[name])]));
  const average = districtNames.reduce((total, name) => total + DISTRICTS[name].population * districtScores[name], 0);
  const minimum = Math.min(...Object.values(districtScores));
  const critical = districtNames.reduce((total, name) => total + Object.values(values[name]).filter((value) => value < MODEL.criticalThreshold).length, 0);
  const score = MODEL.scoreWeights.average * average + MODEL.scoreWeights.minimum * minimum - MODEL.scoreWeights.criticalPenalty * critical;
  return { districtScores, average: round(average), minimum: round(minimum), critical, score: round(score) };
}

function directionScore(values, direction) {
  const directionWeight = direction.criteria.reduce((total, criterion) => total + CRITERIA[criterion].weight, 0);
  return districtNames.reduce((cityTotal, district) => {
    const districtDirectionScore = direction.criteria.reduce((total, criterion) => total + values[district][criterion] * CRITERIA[criterion].weight, 0) / directionWeight;
    return cityTotal + DISTRICTS[district].population * districtDirectionScore;
  }, 0);
}

function validate(candidateSelections) {
  if (candidateSelections.length > MODEL.requiredDecisions) return 'Можно выбрать ровно ' + MODEL.requiredDecisions + ' мероприятий.';
  const total = candidateSelections.reduce((sum, item) => sum + item.measure.price, 0);
  if (total > BUDGET) return 'Превышен бюджет 100 ' + BUDGET_UNIT;
  const directionCounts = {};
  for (const item of candidateSelections) {
    if (item.measure.type === 'district' && !item.district) return 'Для районной меры нужно выбрать район.';
    directionCounts[item.measure.direction] = (directionCounts[item.measure.direction] || 0) + 1;
  }
  if (Object.values(directionCounts).some((count) => count > MODEL.maxMeasuresPerDirection)) return 'В одном направлении допускается не более ' + MODEL.maxMeasuresPerDirection + ' мер.';
  const byId = Object.fromEntries(candidateSelections.map((item) => [item.measure.id, item]));
  for (const constraint of CONSTRAINTS) {
    const [firstId, secondId] = constraint.measures;
    const first = byId[firstId];
    const second = byId[secondId];
    if (!first || !second) continue;
    if (constraint.scope === 'global' || first.district === second.district) return constraint.message;
  }
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
  const applySynergy = (rule) => {
    const [left, right] = rule.measures;
    if (!selected[left] || !selected[right]) return;
    const target = rule.target === 'firstMeasureDistrict' ? selected[left].district : districtNames[0];
    afterValues[target][rule.criterion] = Math.min(100, afterValues[target][rule.criterion] + rule.amount);
    synergies.push({ pair: left + ' + ' + right, district: target, criterion: rule.criterion, amount: rule.amount });
  };
  SYNERGIES.forEach(applySynergy);

  const before = summarize(beforeValues);
  const after = summarize(afterValues);
  const directionScores = Object.fromEntries(DIRECTIONS.map((direction) => [direction.id, round(directionScore(afterValues, direction))]));
  const districtDeltas = Object.fromEntries(districtNames.map((name) => [name, round(after.districtScores[name] - before.districtScores[name])]));
  const criterionDeltas = Object.fromEntries(districtNames.map((name) => [name, Object.fromEntries(Object.keys(CRITERIA).map((criterion) => [criterion, round(afterValues[name][criterion] - beforeValues[name][criterion])]))]));
  return { formula: MODEL.formula, horizonQuarters: HORIZON, before, after, delta: round(after.score - before.score), directionScores, districtDeltas, criterionDeltas, contributions, synergies };
}

function renderCityPulse() {
  const baseline = cloneValues();
  metricGrid.innerHTML = DIRECTIONS.map((direction) => {
    return '<article><span>' + direction.name + '</span><strong>' + round(directionScore(baseline, direction)) + '</strong><small>Стартовый уровень</small></article>';
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
      return '<article class="initiative ' + (selected ? 'selected' : '') + ' ' + (reason ? 'disabled' : '') + '"><div class="initiative-heading"><h4>' + measure.id + ' — ' + measure.name + '</h4><span class="price-badge">Цена: ' + measure.price + ' ' + BUDGET_UNIT + '</span></div><p>Лаг: ' + measure.lag + ' кв. · МАИ-приоритет: ' + measurePriority(measure) + '</p>' + select + '<b>Эффект за 8 кв.: ' + Object.entries(effectiveEffects(measure)).map(([key, value]) => key + ' ' + (value >= 0 ? '+' : '') + round(value)).join(', ') + '</b>' + validationNote + '<button class="select-button" data-measure="' + measure.id + '"' + (reason ? ' disabled title="' + reason + '"' : '') + '>' + (selected ? 'Убрать' : 'Выбрать') + '</button></article>';
    }).join('');
    return '<section class="direction-card"><div class="direction-title"><span>' + direction.icon + '</span><h3>' + direction.name + '</h3></div><div class="initiative-list">' + cards + '</div></section>';
  }).join('');
  document.querySelector('#budget-left').textContent = BUDGET - spent;
  document.querySelector('#budget-caption').textContent = spent + ' из ' + BUDGET + ' ' + BUDGET_UNIT + ' распределено';
  document.querySelector('#budget-progress').style.width = spent + '%';
  document.querySelector('#selection-count').textContent = selections.size;
  const validationError = validate(current);
  const canConfirm = selections.size === MODEL.requiredDecisions && !validationError && !resultConfirmed;
  confirmPanel.hidden = !canConfirm;
  confirmButton.disabled = isConfirming;
  budgetCard.classList.toggle('ready-to-confirm', canConfirm);
  resultPanel.hidden = !resultConfirmed;
  if (resultConfirmed && simulation) {
    document.querySelector('#score-value').textContent = simulation.after.score.toFixed(2);
    renderResultDetails(spent);
  }
}

function renderResultDetails(spent) {
  const cards = [
    ['Бюджет', spent + ' из ' + BUDGET + ' ' + BUDGET_UNIT],
    ['Astana QoL Score', simulation.before.score.toFixed(2) + ' → ' + simulation.after.score.toFixed(2) + ' (' + (simulation.delta >= 0 ? '+' : '') + simulation.delta + ')'],
    ['Критические показатели', simulation.before.critical + ' → ' + simulation.after.critical],
    ['Синергии', simulation.synergies.length ? simulation.synergies.map((item) => item.pair + ': ' + item.criterion + ' +' + item.amount).join('; ') : 'Нет'],
    ...Array.from(selections.values()).map((item) => [item.measure.id, item.measure.name + ' · ' + (item.district || 'город')]),
  ];
  document.querySelector('#result-details').innerHTML = cards.map((card) => '<div class="result-detail"><strong>' + card[0] + '</strong>' + card[1] + '</div>').join('');
  document.querySelector('#direction-scores').innerHTML = DIRECTIONS.map((direction) => '<div class="dashboard-item"><span>' + direction.name + '</span><b>' + simulation.directionScores[direction.id] + '/100</b></div>').join('');
  document.querySelector('#district-effects').innerHTML = districtNames.map((district) => '<div class="dashboard-item"><span>' + district + '</span><b>' + round(simulation.after.districtScores[district]) + '/100</b><small>' + (simulation.districtDeltas[district] >= 0 ? '+' : '') + simulation.districtDeltas[district] + '</small></div>').join('');
  renderDistrictMap();
}

function districtMapColor(score) {
  if (score < 50) return '#d96d4b';
  if (score < 55) return '#dca85b';
  if (score < 60) return '#67a783';
  return '#2f765d';
}

function renderDistrictMap() {
  // This is a deliberately schematic layout. Districts in the model are
  // synthetic, so it must not be mistaken for real administrative borders.
  const shapes = {
    'Алматы': { points: '42,46 207,24 254,119 208,190 70,171', label: [137, 105] },
    'Есиль': { points: '207,24 415,43 450,154 330,205 254,119', label: [326, 106] },
    'Байконур': { points: '450,60 558,130 524,265 395,260 330,205 450,154', label: [456, 175] },
    'Сарыарка': { points: '70,171 208,190 330,205 300,340 135,325 45,260', label: [187, 257] },
    'Нура': { points: '330,205 395,260 430,350 300,340', label: [358, 293] },
  };
  const map = districtNames.map((district) => {
    const shape = shapes[district];
    if (!shape) return '';
    const score = round(simulation.after.districtScores[district]);
    const delta = simulation.districtDeltas[district];
    const direction = delta >= 0 ? '+' : '';
    const active = Math.abs(delta) > 0.001;
    return '<g class="map-district' + (active ? ' is-affected' : '') + '" tabindex="0" role="img" aria-label="' + district + ': ' + score + ' из 100, изменение ' + direction + delta + '"><title>' + district + ': ' + score + '/100, изменение ' + direction + delta + '</title><polygon points="' + shape.points + '" fill="' + districtMapColor(score) + '"></polygon><text x="' + shape.label[0] + '" y="' + (shape.label[1] - 7) + '">' + district + '</text><text class="map-score" x="' + shape.label[0] + '" y="' + (shape.label[1] + 15) + '">' + score + ' <tspan>/100</tspan></text><g class="map-change" transform="translate(' + (shape.label[0] - 25) + ' ' + (shape.label[1] + 26) + ')"><rect width="50" height="17" rx="8.5"></rect><text x="25" y="12">' + direction + delta + '</text></g></g>';
  }).join('');
  document.querySelector('#district-map').innerHTML = '<svg viewBox="0 0 600 380" role="img" aria-label="Схема пяти районов и их итоговых индексов"><path class="map-river" d="M15 210 C110 165 175 230 255 188 S415 142 585 190"></path>' + map + '<text class="map-caption" x="300" y="372">Синтетическая карта сценария</text></svg>';
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
  if (isConfirming) return;
  isConfirming = true;
  confirmButton.disabled = true;
  scenarioTransition.hidden = false;
  document.body.classList.add('is-transitioning');
  await new Promise((resolve) => setTimeout(resolve, 1050));
  simulation = simulateScenario();
  resultConfirmed = true;
  scenarioStatus.classList.add('completed');
  scenarioStatus.innerHTML = '<i></i> Сценарий завершён';
  document.body.classList.add('results-mode');
  render();
  scenarioTransition.hidden = true;
  document.body.classList.remove('is-transitioning');
  isConfirming = false;
  const spent = spentBudget();
  const payloadSelections = Array.from(selections.values()).map((item) => ({ id: item.measure.id, direction: DIRECTIONS.find((direction) => direction.id === item.measure.direction).name, title: item.measure.name, price: item.measure.price, districts: item.district || 'город', lag: item.measure.lag, ahpPriority: measurePriority(item.measure) }));
  const resultText = document.querySelector('#result-text');
  const analysis = document.querySelector('#ai-analysis');
  const loader = document.querySelector('#ai-loader');
  resultText.textContent = 'AI объясняет расчёт МАИ…';
  analysis.textContent = '';
  loader.hidden = false;
  resultPanel.scrollIntoView({ behavior: 'smooth', block: 'start' });
  try {
    const response = await fetch('/api/analyze', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ selections: payloadSelections, budget: BUDGET, spent, simulation }) });
    const data = response.headers.get('content-type') && response.headers.get('content-type').includes('application/json') ? await response.json() : null;
    if (!response.ok || !data || !data.analysis) throw new Error((data && data.error) || 'Сервер не вернул AI-анализ.');
    resultText.textContent = data.fallback
      ? 'МАИ-модель рассчитана. Показано объяснение по правилам модели: использовано ' + spent + ' из ' + BUDGET + ' ' + BUDGET_UNIT
      : 'МАИ-модель: ' + simulation.formula + '. Использовано ' + spent + ' из ' + BUDGET + ' ' + BUDGET_UNIT;
    analysis.textContent = data.analysis;
  } catch (error) {
    resultText.textContent = 'МАИ-модель рассчитана: ' + simulation.formula + '. Использовано ' + spent + ' из ' + BUDGET + ' ' + BUDGET_UNIT;
    analysis.textContent = 'AI-анализ пока недоступен: ' + error.message;
  } finally {
    loader.hidden = true;
  }
});

document.querySelector('#reset-button').addEventListener('click', () => { selections.clear(); resultConfirmed = false; simulation = null; scenarioStatus.classList.remove('completed'); scenarioStatus.innerHTML = '<i></i> Сценарий активен'; document.body.classList.remove('results-mode'); document.querySelector('#ai-analysis').textContent = ''; render(); window.scrollTo({ top: 0, behavior: 'smooth' }); });
homeButton.addEventListener('click', () => { window.location.href = window.location.pathname + '#top'; window.location.reload(); });
function updateBudgetPosition() {
  const shouldFloat = window.scrollY > 180;
  if (shouldFloat === isBudgetFloating) return;
  const from = budgetCard.getBoundingClientRect();
  if (!shouldFloat) {
    budgetCard.style.left = '';
    budgetCard.style.top = '';
    budgetCard.style.right = '';
    budgetCard.style.bottom = '';
  }
  budgetCard.classList.toggle('floating', shouldFloat);
  const to = budgetCard.getBoundingClientRect();
  budgetCard.animate([{ transform: 'translate(' + (from.left - to.left) + 'px, ' + (from.top - to.top) + 'px)' }, { transform: 'translate(0, 0)' }], { duration: 430, easing: 'cubic-bezier(.2,.8,.2,1)' });
  isBudgetFloating = shouldFloat;
}
window.addEventListener('scroll', updateBudgetPosition, { passive: true });

budgetCard.addEventListener('pointerdown', (event) => {
  if (!isBudgetFloating || event.button !== 0 || event.target.closest('button, select')) return;
  const rect = budgetCard.getBoundingClientRect();
  budgetDrag = { pointerId: event.pointerId, offsetX: event.clientX - rect.left, offsetY: event.clientY - rect.top };
  budgetCard.setPointerCapture(event.pointerId);
  budgetCard.classList.add('dragging');
  event.preventDefault();
});

budgetCard.addEventListener('pointermove', (event) => {
  if (!budgetDrag || event.pointerId !== budgetDrag.pointerId) return;
  const rect = budgetCard.getBoundingClientRect();
  const left = Math.min(Math.max(12, event.clientX - budgetDrag.offsetX), window.innerWidth - rect.width - 12);
  const top = Math.min(Math.max(12, event.clientY - budgetDrag.offsetY), window.innerHeight - rect.height - 12);
  budgetCard.style.left = left + 'px';
  budgetCard.style.top = top + 'px';
  budgetCard.style.right = 'auto';
  budgetCard.style.bottom = 'auto';
});

function finishBudgetDrag(event) {
  if (!budgetDrag || event.pointerId !== budgetDrag.pointerId) return;
  budgetCard.releasePointerCapture(event.pointerId);
  budgetCard.classList.remove('dragging');
  budgetDrag = null;
}

budgetCard.addEventListener('pointerup', finishBudgetDrag);
budgetCard.addEventListener('pointercancel', finishBudgetDrag);

function configureModel(data) {
  if (!data.model || !data.criteria || !data.directions || !data.districts || !data.measures || !data.synergies || !data.constraints) {
    throw new Error('Файл модели неполный. Проверьте data/model-data.json.');
  }
  const criteriaWeight = Object.values(data.criteria).reduce((total, criterion) => total + criterion.weight, 0);
  const populationWeight = Object.values(data.districts).reduce((total, district) => total + district.population, 0);
  if (Math.abs(criteriaWeight - 1) > 0.000001 || Math.abs(populationWeight - 1) > 0.000001) {
    throw new Error('Веса критериев и доли населения в JSON должны в сумме давать 1.');
  }

  MODEL = data.model;
  BUDGET = MODEL.budget;
  BUDGET_UNIT = MODEL.budgetUnit;
  HORIZON = MODEL.horizonQuarters;
  CRITERIA = data.criteria;
  DIRECTIONS = data.directions;
  DISTRICTS = data.districts;
  MEASURES = data.measures;
  SYNERGIES = data.synergies;
  CONSTRAINTS = data.constraints;
  districtNames = Object.keys(DISTRICTS);
}

function showDataLoadError(error) {
  const message = 'Не удалось загрузить конфигурацию модели. Запустите сайт через run.bat и проверьте data/model-data.json.';
  console.error(error);
  metricGrid.innerHTML = '<p class="data-load-error">' + message + '</p>';
  grid.innerHTML = '<p class="data-load-error">' + message + '</p>';
}

async function initialize() {
  try {
    const response = await fetch('data/model-data.json', { cache: 'no-store' });
    if (!response.ok) throw new Error('HTTP ' + response.status);
    configureModel(await response.json());
    renderCityPulse();
    render();
  } catch (error) {
    showDataLoadError(error);
  }
}

initialize();
