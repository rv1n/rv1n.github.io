/**
 * Главный JavaScript файл для управления портфелем акций MOEX
 * Полное обновление - по кнопке "Обновить"
 * Колонка "Изменение" обновляется после записи цен (вручную или в 0:00)
 */

// Обновление колонки "Изменение" после записи цен
let previousPrices = {}; // Хранение предыдущих цен для отслеживания изменений
let tickerValidationTimeout = null; // Таймаут для валидации тикера
let lastValidatedTicker = ''; // Последний валидированный тикер
let isMainMenuOpen = false;   // Состояние выпадающего меню в шапке

// Настройки отображения колонок таблицы портфеля
// v2: по умолчанию скрываем колонку "Цена приобретения"
const COLUMN_VISIBILITY_STORAGE_KEY = 'portfolioColumnVisibility_v2';
const PORTFOLIO_COLUMNS = [
    { key: 'name',         index: 1 },
    { key: 'buy_price',    index: 2 },
    { key: 'quantity',     index: 3 },
    { key: 'invest_sum',   index: 4 },
    { key: 'current_value', index: 5 },
    { key: 'profit',       index: 6 },
    { key: 'change',       index: 7 },
    { key: 'sparkline',    index: 8 },
    { key: 'actions',      index: 9 },
];

function toggleMainMenu() {
    const menu = document.getElementById('main-menu');
    if (!menu) return;
    isMainMenuOpen = !isMainMenuOpen;
    menu.classList.toggle('open', isMainMenuOpen);
}

function closeMainMenu() {
    const menu = document.getElementById('main-menu');
    if (!menu) return;
    isMainMenuOpen = false;
    menu.classList.remove('open');
}
let categoriesChanged = false; // Флаг изменения категорий
let heightListenersAttached = false; // Флаг, чтобы не навешивать обработчики повторно
let currentPortfolioData = null; // Текущие данные портфеля
let currentChartType = localStorage.getItem('chartType') || 'pie'; // Текущий тип диаграммы (pie/bar)
let currentAssetTypeChartType = localStorage.getItem('assetTypeChartType') || 'pie'; // Текущий тип диаграммы видов активов (pie/bar)
// Режим сортировки для колонок "Прибыль" и "Изменение": 'rub' или 'pct'
let profitSortMode = localStorage.getItem('profitSortMode') || 'rub';
let changeSortMode = localStorage.getItem('changeSortMode') || 'rub';
let lastPriceLogCheck = null; // Последняя проверка записи цен
let priceLogCheckInterval = null; // Интервал проверки новых записей цен

// Режимы сортировки для колонок "Прибыль" и "Изменение"
// profitSortMetric: 'rub' | 'percent'
// changeSortMetric: 'rub' | 'percent'
let profitSortMetric = localStorage.getItem('profitSortMetric') || 'rub';
let changeSortMetric = localStorage.getItem('changeSortMetric') || 'rub';

// Состояние сортировки таблицы портфеля (восстанавливаем из localStorage)
let portfolioSortState = (() => {
    const savedColumn = localStorage.getItem('portfolioSortColumn');
    const savedDirection = localStorage.getItem('portfolioSortDirection');
    return {
        // buy_price, quantity, invest_sum, current_value, day_change, profit
        column: savedColumn || null,
        direction: savedDirection === 'desc' ? 'desc' : 'asc'
    };
})();

function getStoredColumnVisibility() {
    try {
        const raw = localStorage.getItem(COLUMN_VISIBILITY_STORAGE_KEY);
        if (!raw) {
            // Значения по умолчанию: скрываем колонку "Цена приобретения"
            return { buy_price: false };
        }
        const parsed = JSON.parse(raw);
        return parsed && typeof parsed === 'object' ? parsed : { buy_price: false };
    } catch {
        return { buy_price: false };
    }
}

function applyColumnVisibility() {
    const table = document.getElementById('portfolio-table');
    if (!table) return;

    const visibility = getStoredColumnVisibility();

    PORTFOLIO_COLUMNS.forEach(col => {
        const visible = visibility[col.key] !== false; // по умолчанию колонка видна
        const selector = `#portfolio-table thead th:nth-child(${col.index}), #portfolio-table tbody td:nth-child(${col.index})`;
        table.querySelectorAll(selector).forEach(el => {
            el.style.display = visible ? '' : 'none';
        });
    });
}

function initColumnVisibilityControls() {
    const visibility = getStoredColumnVisibility();
    document.querySelectorAll('.settings-column-toggle').forEach(input => {
        const key = input.dataset.colKey;
        if (!key) return;
        input.checked = visibility[key] !== false;

        input.addEventListener('change', () => {
            const current = getStoredColumnVisibility();
            current[key] = input.checked;
            localStorage.setItem(COLUMN_VISIBILITY_STORAGE_KEY, JSON.stringify(current));
            applyColumnVisibility();
        });
    });
}

function initSortModeControls() {
    // Устанавливаем активные состояния и обработчики для ₽ / %
    const profitRub = document.getElementById('profit-sort-rub');
    const profitPct = document.getElementById('profit-sort-percent');
    const changeRub = document.getElementById('change-sort-rub');
    const changePct = document.getElementById('change-sort-percent');

    function updateUI() {
        if (profitRub && profitPct) {
            profitRub.classList.toggle('active', profitSortMode === 'rub');
            profitPct.classList.toggle('active', profitSortMode === 'pct');
        }
        if (changeRub && changePct) {
            changeRub.classList.toggle('active', changeSortMode === 'rub');
            changePct.classList.toggle('active', changeSortMode === 'pct');
        }
    }

    if (profitRub && profitPct) {
        profitRub.addEventListener('click', () => {
            profitSortMode = 'rub';
            localStorage.setItem('profitSortMode', profitSortMode);
            updateUI();
            if (currentPortfolioData) {
                displayPortfolio(currentPortfolioData.portfolio, currentPortfolioData.summary);
                applyColumnVisibility();
            }
        });
        profitPct.addEventListener('click', () => {
            profitSortMode = 'pct';
            localStorage.setItem('profitSortMode', profitSortMode);
            updateUI();
            if (currentPortfolioData) {
                displayPortfolio(currentPortfolioData.portfolio, currentPortfolioData.summary);
                applyColumnVisibility();
            }
        });
    }

    if (changeRub && changePct) {
        changeRub.addEventListener('click', () => {
            changeSortMode = 'rub';
            localStorage.setItem('changeSortMode', changeSortMode);
            updateUI();
            if (currentPortfolioData) {
                displayPortfolio(currentPortfolioData.portfolio, currentPortfolioData.summary);
                applyColumnVisibility();
            }
        });
        changePct.addEventListener('click', () => {
            changeSortMode = 'pct';
            localStorage.setItem('changeSortMode', changeSortMode);
            updateUI();
            if (currentPortfolioData) {
                displayPortfolio(currentPortfolioData.portfolio, currentPortfolioData.summary);
                applyColumnVisibility();
            }
        });
    }

    updateUI();
}

function initSortMetricControls() {
    const profitRub = document.getElementById('profit-sort-rub');
    const profitPct = document.getElementById('profit-sort-percent');
    const changeRub = document.getElementById('change-sort-rub');
    const changePct = document.getElementById('change-sort-percent');

    const applyActiveState = () => {
        if (profitRub && profitPct) {
            profitRub.classList.toggle('active', profitSortMetric === 'rub');
            profitPct.classList.toggle('active', profitSortMetric === 'percent');
        }
        if (changeRub && changePct) {
            changeRub.classList.toggle('active', changeSortMetric === 'rub');
            changePct.classList.toggle('active', changeSortMetric === 'percent');
        }
    };

    applyActiveState();

    if (profitRub && profitPct) {
        profitRub.addEventListener('click', () => {
            profitSortMetric = 'rub';
            localStorage.setItem('profitSortMetric', profitSortMetric);
            applyActiveState();
            if (portfolioSortState.column === 'profit' && currentPortfolioData) {
                displayPortfolio(currentPortfolioData.portfolio, currentPortfolioData.summary);
                applyColumnVisibility();
            }
        });
        profitPct.addEventListener('click', () => {
            profitSortMetric = 'percent';
            localStorage.setItem('profitSortMetric', profitSortMetric);
            applyActiveState();
            if (portfolioSortState.column === 'profit' && currentPortfolioData) {
                displayPortfolio(currentPortfolioData.portfolio, currentPortfolioData.summary);
                applyColumnVisibility();
            }
        });
    }

    if (changeRub && changePct) {
        changeRub.addEventListener('click', () => {
            changeSortMetric = 'rub';
            localStorage.setItem('changeSortMetric', changeSortMetric);
            applyActiveState();
            if (portfolioSortState.column === 'day_change' && currentPortfolioData) {
                displayPortfolio(currentPortfolioData.portfolio, currentPortfolioData.summary);
                applyColumnVisibility();
            }
        });
        changePct.addEventListener('click', () => {
            changeSortMetric = 'percent';
            localStorage.setItem('changeSortMetric', changeSortMetric);
            applyActiveState();
            if (portfolioSortState.column === 'day_change' && currentPortfolioData) {
                displayPortfolio(currentPortfolioData.portfolio, currentPortfolioData.summary);
                applyColumnVisibility();
            }
        });
    }
}

/**
 * Текущий период изменения цен (в днях) для колонки "Изменение"
 * 1 — день, 7 — неделя, 30 — месяц, 182 — полгода, 365 — год
 */
let currentChangeDays = parseInt(localStorage.getItem('changeDays') || '1', 10) || 1;

/**
 * Безопасный парсинг JSON ответа с обработкой ошибок сервера
 * @param {Response} response - Объект Response от fetch
 * @returns {Promise<Object|null>} - Распарсенный JSON или null при ошибке
 */
async function safeJsonResponse(response) {
    // Проверяем статус ответа
    if (!response.ok) {
        const errorText = await response.text();
        console.error(`Ошибка сервера ${response.status}:`, errorText.substring(0, 200));
        return null;
    }
    
    // Проверяем Content-Type перед парсингом JSON
    const contentType = response.headers.get('content-type');
    if (!contentType || !contentType.includes('application/json')) {
        const text = await response.text();
        console.error('Сервер вернул не JSON:', contentType, text.substring(0, 200));
        return null;
    }
    
    try {
        return await response.json();
    } catch (error) {
        if (error instanceof SyntaxError) {
            const text = await response.text();
            console.error('Ошибка парсинга JSON:', error.message, text.substring(0, 200));
        } else {
            console.error('Ошибка при обработке ответа:', error);
        }
        return null;
    }
}

/**
 * Инициализация приложения при загрузке страницы
 */
document.addEventListener('DOMContentLoaded', async function() {
    initTodayDate(); // Сразу отображаем сегодняшнюю дату
    initSummaryVisibility(); // Восстанавливаем состояние скрытия полей сводки
    await loadCategoriesList(); // Загружаем список категорий из API
    await loadAssetTypesList(); // Загружаем список видов активов из API
    // При первом открытии страницы загружаем портфель БЕЗ обращения к API MOEX,
    // используя только сохранённые в БД данные (use_cached=1).
    loadPortfolio(false, true);
    setupEventListeners();
    startPriceLogMonitoring(); // Запускаем мониторинг новых записей цен
    loadCurrencyRates(); // Загружаем курсы валют для отображения
    setupStickyTableHeader(); // Настраиваем фиксацию шапки таблицы
    // На мобильных не ограничиваем высоту по viewport, даём странице скроллиться целиком
    if (!window.IS_MOBILE) {
        setupPortfolioTableHeight(); // Подгоняем высоту таблицы под нижнюю границу окна
    }
    initColumnVisibilityControls(); // Инициализация тумблеров колонок
    initSortModeControls(); // Инициализация переключателей ₽ / % для сортировки
    initSortMetricControls(); // Инициализация переключателей режима сортировки ₽ / %
});

/**
 * Динамическая высота прокручиваемых блоков (таблица портфеля, история, категории и т.д.)
 * Нижняя граница = нижняя граница окна браузера (минус небольшой отступ)
 */
function setupPortfolioTableHeight() {
    const updateHeight = () => {
        const wrappers = document.querySelectorAll('.transactions-content, .categories-content, .price-history-content, #chart-view, #server-view, #ticker-sber-view, #ticker-ru-view, #ticker-cnym-view, #ticker-lqdt-view');
        if (!wrappers.length) return;

        const viewportHeight = window.innerHeight || document.documentElement.clientHeight;
        const bottomPadding = 16; // небольшой запас снизу

        wrappers.forEach(wrapper => {
            const rect = wrapper.getBoundingClientRect();
            const availableHeight = viewportHeight - rect.top - bottomPadding;

            if (availableHeight > 100) {
                wrapper.style.maxHeight = `${availableHeight}px`;
            } else {
                wrapper.style.maxHeight = 'none';
            }
        });
    };

    updateHeight();

    if (!heightListenersAttached) {
        window.addEventListener('resize', updateHeight);
        window.addEventListener('orientationchange', updateHeight);
        heightListenersAttached = true;
    }
}

/**
 * Настройка обработчиков событий
 */
function setupEventListeners() {
    // Форма покупки акций
    const buyForm = document.getElementById('buy-form');
    if (buyForm) {
        buyForm.addEventListener('submit', handleBuy);
    }
    
    // Форма продажи акций
    const sellForm = document.getElementById('sell-form');
    if (sellForm) {
        sellForm.addEventListener('submit', handleSell);
    }
    
    // Форма редактирования позиции
    const editForm = document.getElementById('edit-form');
    if (editForm) {
        editForm.addEventListener('submit', handleEditPosition);
    }
    
    // Валидация тикера в форме покупки
    const buyTickerInput = document.getElementById('buy-ticker');
    if (buyTickerInput) {
        buyTickerInput.addEventListener('input', handleBuyTickerInput);
        buyTickerInput.addEventListener('blur', handleBuyTickerBlur);
    }
    
    // Автоматический расчет суммы покупки (по лотам)
    const buyLots = document.getElementById('buy-lots');
    const buyPrice = document.getElementById('buy-price');
    if (buyLots && buyPrice) {
        buyLots.addEventListener('input', calculateBuyTotal);
        buyPrice.addEventListener('input', calculateBuyTotal);
    }
    
    // Автоматический расчет суммы продажи
    const sellLots = document.getElementById('sell-lots');
    const sellPrice = document.getElementById('sell-price');
    if (sellLots && sellPrice) {
        sellLots.addEventListener('input', calculateSellTotal);
        sellPrice.addEventListener('input', calculateSellTotal);
    }

    // Сортировка таблицы портфеля по кнопкам в заголовках
    const portfolioTable = document.getElementById('portfolio-table');
    if (portfolioTable) {
        const sortableHeaders = portfolioTable.querySelectorAll('th[data-sort-key]');
        sortableHeaders.forEach(th => {
            const columnKey = th.getAttribute('data-sort-key');

            // Сортировка только по кнопке внутри заголовка
            const btn = th.querySelector('.sort-btn');
            if (btn) {
                btn.addEventListener('click', (e) => {
                    e.stopPropagation();
                    handlePortfolioSort(columnKey);
                });
            }
        });
    }

    // Смена периода для колонки "Изменение"
    const changePeriodSelect = document.getElementById('change-period-select');
    if (changePeriodSelect) {
        // Инициализация селекта из сохранённого периода
        if ([1, 7, 30, 182, 365].includes(currentChangeDays)) {
            changePeriodSelect.value = String(currentChangeDays);
        }
        updateSummaryChangePeriodLabel(changePeriodSelect.value);

        changePeriodSelect.addEventListener('change', () => {
            const days = parseInt(changePeriodSelect.value, 10);
            currentChangeDays = !isNaN(days) && days > 0 ? days : 1;
            localStorage.setItem('changeDays', String(currentChangeDays));
            loadPortfolio(true, true); // тихое обновление, только пересчёт периода — без запросов к MOEX
            updateSummaryChangePeriodLabel(changePeriodSelect.value);
        });
    }

    // Закрытие сэндвич-меню при клике вне его области
    document.addEventListener('click', function(e) {
        const menuWrapper = document.querySelector('.menu-wrapper');
        const menu = document.getElementById('main-menu');
        const menuToggle = document.getElementById('menu-toggle');
        
        if (isMainMenuOpen && menu && menuWrapper && menuToggle) {
            // Проверяем, был ли клик вне menu-wrapper
            if (!menuWrapper.contains(e.target)) {
                closeMainMenu();
            }
        }
    });

    // Закрытие модального окна информации о тикере при клике вне его
    // Обработчик клика вне модального окна удален - закрытие только по крестику и Esc
}

/**
 * Ручное обновление данных портфеля
 */
function manualRefresh() {
    const refreshBtn = document.getElementById('refresh-btn');
    if (refreshBtn) {
        refreshBtn.disabled = true;
        refreshBtn.classList.add('is-loading');
    }
    
    Promise.all([
        loadPortfolio(false),
        loadCurrencyRates()
    ]).finally(() => {
        if (refreshBtn) {
            refreshBtn.disabled = false;
            refreshBtn.classList.remove('is-loading');
        }
        updateLastUpdateTime();
    });
}

function updateSummaryChangePeriodLabel(value) {
    const labelSpan = document.getElementById('summary-change-period-label');
    if (!labelSpan) return;
    switch (value) {
        case '1':
            labelSpan.textContent = 'день';
            break;
        case '7':
            labelSpan.textContent = 'неделю';
            break;
        case '30':
            labelSpan.textContent = 'месяц';
            break;
        case '182':
            labelSpan.textContent = 'полгода';
            break;
        case '365':
            labelSpan.textContent = 'год';
            break;
        default:
            labelSpan.textContent = 'период';
            break;
    }
}

/**
 * Загрузка данных портфеля с сервера
 * @param {boolean} silent - Если true, не показывать индикатор загрузки
 * @param {boolean} useCachedPrices - Если true, не дергать MOEX API, использовать кэшированные цены
 */
async function loadPortfolio(silent = false, useCachedPrices = false) {
    const loading = document.getElementById('loading');
    const table = document.getElementById('portfolio-table');
    const errorMessage = document.getElementById('error-message');
    const tbody = document.getElementById('portfolio-tbody');
    
    try {
        if (!silent) {
            loading.style.display = 'block';
            table.style.display = 'none';
        }
        errorMessage.style.display = 'none';
        
        // Формируем URL с учетом выбранного периода изменения цен
        let url = '/api/portfolio';
        const params = [];
        if (currentChangeDays && currentChangeDays > 0) {
            params.push(`change_days=${currentChangeDays}`);
        }
        if (useCachedPrices) {
            params.push('use_cached=1');
        }
        if (params.length > 0) {
            url += `?${params.join('&')}`;
        }

        const response = await fetch(url);
        const data = await safeJsonResponse(response);
        
        if (!data) {
            // Ошибка уже залогирована в safeJsonResponse
            if (!silent) {
                showError('Ошибка соединения с сервером. Сервер временно недоступен.');
                if (loading) loading.style.display = 'none';
                if (table) table.style.display = 'table';
            }
            return;
        }
        
        if (data.success) {
            // Сохраняем данные портфеля и сводки для последующего использования
            currentPortfolioData = {
                portfolio: data.portfolio,
                summary: data.summary
            };
            
            // Отображаем данные
            displayPortfolio(currentPortfolioData.portfolio, currentPortfolioData.summary);
            if (!silent) {
                if (loading) loading.style.display = 'none';
                if (table) table.style.display = 'table';
            }
            // Настраиваем фиксацию шапки после отображения таблицы
            setTimeout(setupStickyTableHeader, 100);
            // Применяем настройки видимости колонок
            applyColumnVisibility();
        } else {
            if (!silent) {
                showError(data.error || 'Ошибка загрузки портфеля');
            }
        }
    } catch (error) {
        console.error('Ошибка загрузки портфеля:', error);
        if (!silent) {
            showError('Ошибка соединения с сервером');
            if (loading) loading.style.display = 'none';
            if (table) table.style.display = 'table';
        }
    }
}

/**
 * Точечное обновление одной позиции портфеля по тикеру
 * (не перерисовывает всю таблицу).
 * Использует свежие данные с сервера, но обновляет только нужную строку,
 * сводку и связанные графики.
 * @param {string} ticker
 */
/**
 * Показывает/скрывает индикатор загрузки на строке портфеля
 */
function setRowLoading(ticker, loading) {
    const tbody = document.getElementById('portfolio-tbody');
    if (!tbody || !ticker) return;
    const tickerUpper = String(ticker).toUpperCase();
    const row = tbody.querySelector(`tr[data-ticker="${tickerUpper}"]`) ||
                tbody.querySelector(`tr[data-ticker="${ticker}"]`);
    if (!row) return;
    if (loading) {
        row.classList.add('row-loading');
    } else {
        row.classList.remove('row-loading');
    }
}

async function refreshSinglePortfolioPosition(ticker) {
    if (!ticker) return;
    
    const tbody = document.getElementById('portfolio-tbody');
    const errorMessage = document.getElementById('error-message');
    if (!tbody) return;
    
    try {
        if (errorMessage) {
            errorMessage.style.display = 'none';
        }
        
        // Получаем актуальные данные портфеля с сервера
        let url = '/api/portfolio';
        const params = [];
        if (currentChangeDays && currentChangeDays > 0) {
            params.push(`change_days=${currentChangeDays}`);
        }
        if (params.length > 0) {
            url += `?${params.join('&')}`;
        }
        
        const response = await fetch(url);
        const data = await safeJsonResponse(response);
        if (!data || !data.success) {
            console.warn('Не удалось обновить позицию портфеля точечно, данные:', data);
            return;
        }
        
        // Обновляем глобальные данные портфеля
        currentPortfolioData = {
            portfolio: data.portfolio,
            summary: data.summary
        };
        
        // Учитываем текущие фильтры по виду актива и категории
        const { type: selectedType, category: selectedCategory } = getPortfolioFilters();
        let filteredPortfolio = applyPortfolioFilters(currentPortfolioData.portfolio);
        
        // Если после операции портфель (с учётом фильтров) пуст — показываем сообщение как раньше
        if (filteredPortfolio.length === 0) {
            const hasType = !!selectedType;
            const hasCategory = !!selectedCategory;
            let message;
            if (hasType && hasCategory) {
                message = `Нет активов вида "${selectedType}" в категории "${selectedCategory}"`;
            } else if (hasType) {
                message = `Нет активов вида "${selectedType}"`;
            } else if (hasCategory) {
                message = `Нет активов категории "${selectedCategory}"`;
            } else {
                message = 'Портфель пуст. Добавьте первую позицию.';
            }
            tbody.innerHTML = `<tr><td colspan="9" style="text-align: center; padding: 40px; color: #7f8c8d;">${message}</td></tr>`;
            previousPrices = {};
            
            const emptySummary = calculateSummaryFromPortfolio([]);
            if (data.summary && data.summary.cash_balance !== undefined) {
                emptySummary.cash_balance = data.summary.cash_balance;
            }
            updateSummary(emptySummary);
            updateCategoryChart(currentPortfolioData.portfolio);
            updatePortfolioSortIndicators();
            return;
        }
        
        // Пересчитываем сводку и обновляем верхнюю панель
        const filteredSummary = calculateSummaryFromPortfolio(filteredPortfolio);
        if (data.summary && data.summary.cash_balance !== undefined) {
            filteredSummary.cash_balance = data.summary.cash_balance;
        }
        const totalPortfolioValue = filteredSummary.total_value || 0;
        updateSummary(filteredSummary);
        
        // Обновляем диаграмму категорий
        updateCategoryChart(currentPortfolioData.portfolio);
        
        // Находим обновлённую позицию (с учётом фильтра) и соответствующую строку
        const tickerUpper = ticker.toUpperCase();
        const updatedItem = filteredPortfolio.find(
            item => (item.ticker || '').toUpperCase() === tickerUpper
        );
        const existingRow = tbody.querySelector(`tr[data-ticker="${tickerUpper}"]`) ||
                            tbody.querySelector(`tr[data-ticker="${ticker}"]`);
        
        if (updatedItem) {
            // Создаём новую строку для позиции
            const newRow = createPortfolioRow(updatedItem, totalPortfolioValue);
            
            if (existingRow) {
                tbody.replaceChild(newRow, existingRow);
            } else {
                // Удаляем строку-заглушку «Портфель пуст» перед добавлением первого реального ряда
                const emptyRow = tbody.querySelector('tr:not([data-ticker])');
                if (emptyRow) emptyRow.remove();
                tbody.appendChild(newRow);
            }
            
            // Обновляем спарклайн только для этого тикера
            const container = document.querySelector(`.sparkline-container[data-ticker="${updatedItem.ticker}"]`);
            if (container) {
                await renderSparkline(container, updatedItem.ticker, updatedItem.instrument_type === 'Облигация');
            }
            
            // Перепривязываем обработчики кнопок продажи (для новой строки)
            attachSellButtonHandlers();
        } else if (existingRow) {
            // Позиция исчезла из портфеля (например, полностью продана) — удаляем строку
            existingRow.remove();
        }
        
        // Обновляем индикаторы сортировки (колонка и направление не меняются)
        updatePortfolioSortIndicators();
        
    } catch (error) {
        console.error('Ошибка точечного обновления позиции портфеля:', error);
    }
}

/**
 * Запуск мониторинга новых записей цен
 * Проверяет каждые 60 секунд, были ли записаны новые цены (например, в 0:00)
 */
function startPriceLogMonitoring() {
    // Останавливаем предыдущий интервал, если он есть
    if (priceLogCheckInterval) {
        clearInterval(priceLogCheckInterval);
    }
    
    // Проверяем каждые 60 секунд
    priceLogCheckInterval = setInterval(() => {
        checkForNewPriceLogs();
    }, 60000); // 60 секунд
    
    console.log('Мониторинг новых записей цен запущен (каждые 60 сек)');
}

/**
 * Проверка наличия новых записей цен
 */
async function checkForNewPriceLogs() {
    try {
        const response = await fetch('/api/price-history?limit=1');
        if (!response.ok) return;
        
        const data = await response.json();
        
        if (data.history && data.history.length > 0) {
            const latestLog = data.history[0];
            const latestTimestamp = new Date(latestLog.timestamp).getTime();
            
            // Если это первая проверка, просто сохраняем timestamp
            if (lastPriceLogCheck === null) {
                lastPriceLogCheck = latestTimestamp;
                return;
            }
            
            // Если есть новая запись - обновляем портфель
            if (latestTimestamp > lastPriceLogCheck) {
                console.log('Обнаружена новая запись цен, обновляем портфель');
                lastPriceLogCheck = latestTimestamp;
                updateLastUpdateTime();
                
                // Обновляем портфель, если находимся на вкладке "Мой портфель"
                const tableView = document.getElementById('table-view');
                if (tableView && tableView.style.display !== 'none') {
                    loadPortfolio();
                }
            }
        }
    } catch (error) {
        console.error('Ошибка проверки новых записей цен:', error);
    }
}

/**
 * Проверка изменений цен в портфеле
 * @param {Array} portfolio - Текущий портфель
 * @returns {boolean} - true если хотя бы одна цена изменилась
 */
function checkPriceChanges(portfolio) {
    let hasChanges = false;
    
    portfolio.forEach(item => {
        const ticker = item.ticker;
        const currentPrice = item.current_price;
        const previousPrice = previousPrices[ticker];
        
        if (previousPrice !== undefined && previousPrice !== null && currentPrice !== null) {
            // Проверяем изменение цены (с учетом погрешности округления)
            if (Math.abs(previousPrice - currentPrice) > 0.01) {
                hasChanges = true;
                console.log(`Цена ${ticker} изменилась: ${previousPrice} -> ${currentPrice}`);
            }
        }
        
        // Сохраняем текущую цену
        previousPrices[ticker] = currentPrice;
    });
    
    return hasChanges;
}

/**
 * Возвращает текущие значения фильтров по виду и категории.
 */
function getPortfolioFilters() {
    const typeFilter = document.getElementById('portfolio-type-filter');
    const categoryFilter = document.getElementById('portfolio-category-filter');
    return {
        type: typeFilter ? typeFilter.value : '',
        category: categoryFilter ? categoryFilter.value : '',
    };
}

/**
 * Применяет фильтры по виду актива и категории к массиву позиций.
 * @param {Array} portfolio
 * @returns {Array}
 */
function applyPortfolioFilters(portfolio) {
    if (!portfolio || !Array.isArray(portfolio)) return [];
    const { type, category } = getPortfolioFilters();
    let filtered = portfolio;
    if (type) {
        filtered = filtered.filter(item => (item.asset_type || '') === type);
    }
    if (category) {
        filtered = filtered.filter(item => {
            const catName = item.category || 'Без категории';
            return catName === category;
        });
    }
    return filtered;
}

/**
 * Обновляет список категорий в фильтре по категориям на основе текущего портфеля.
 * @param {Array} portfolio
 */
function updatePortfolioCategoryFilter(portfolio) {
    const categoryFilter = document.getElementById('portfolio-category-filter');
    if (!categoryFilter || !portfolio || !Array.isArray(portfolio)) return;
    
    // Текущее значение берём из localStorage (если есть) либо из самого селекта
    const storedValue = localStorage.getItem('portfolioFilterCategory') || '';
    const currentValue = storedValue || categoryFilter.value;
    const categoriesSet = new Set();
    portfolio.forEach(item => {
        const name = (item && (item.category || 'Без категории')) || 'Без категории';
        categoriesSet.add(name);
    });
    
    categoryFilter.innerHTML = '<option value=\"\">Все категории</option>';
    Array.from(categoriesSet)
        .sort((a, b) => a.localeCompare(b, 'ru'))
        .forEach(cat => {
            const option = document.createElement('option');
            option.value = cat;
            option.textContent = cat;
            if (cat === currentValue) {
                option.selected = true;
            }
            categoryFilter.appendChild(option);
        });
}

/**
 * Отображение портфеля в таблице
 */
function displayPortfolio(portfolio, summary) {
    const tbody = document.getElementById('portfolio-tbody');
    tbody.innerHTML = '';
    
    // Обновляем фильтр по категориям на основе текущего портфеля
    updatePortfolioCategoryFilter(portfolio);
    
    const { type: selectedType, category: selectedCategory } = getPortfolioFilters();
    
    // Фильтруем портфель по виду актива и категории
    let filteredPortfolio = applyPortfolioFilters(portfolio);
    
    if (filteredPortfolio.length === 0) {
        const hasType = !!selectedType;
        const hasCategory = !!selectedCategory;
        let message;
        if (hasType && hasCategory) {
            message = `Нет активов вида "${selectedType}" в категории "${selectedCategory}"`;
        } else if (hasType) {
            message = `Нет активов вида "${selectedType}"`;
        } else if (hasCategory) {
            message = `Нет активов категории "${selectedCategory}"`;
        } else {
            message = 'Портфель пуст. Добавьте первую позицию.';
        }
        tbody.innerHTML = `<tr><td colspan="9" style="text-align: center; padding: 40px; color: #7f8c8d;">${message}</td></tr>`;
        if (portfolio.length === 0) {
            previousPrices = {}; // Очищаем сохраненные цены только если портфель действительно пуст
        }
        // Обновляем сводку нулевыми значениями для отфильтрованного портфеля
        const emptySummary = calculateSummaryFromPortfolio([]);
        // Сохраняем cash_balance из оригинального summary (не зависит от фильтрации)
        if (summary && summary.cash_balance !== undefined) {
            emptySummary.cash_balance = summary.cash_balance;
        }
        updateSummary(emptySummary);
        // Быстрый взгляд: учитываем текущие фильтры — если после отбора ничего нет,
        // в блоке по видам тоже показываем "Нет данных".
        renderQuicklookTypeChanges(filteredPortfolio);
        return;
    }
    
    // Применяем сортировку, если выбрана колонка
    let sortedPortfolio = [...filteredPortfolio];
    if (portfolioSortState.column) {
        sortedPortfolio.sort((a, b) => comparePortfolioItems(a, b, portfolioSortState));
    }

    // Сохраняем текущие цены для отслеживания изменений
    portfolio.forEach(item => {
        previousPrices[item.ticker] = item.current_price;
    });
    
    // Пересчитываем сводку на основе отфильтрованного портфеля
    const filteredSummary = calculateSummaryFromPortfolio(filteredPortfolio);
    
    // Сохраняем cash_balance из оригинального summary (не зависит от фильтрации)
    if (summary && summary.cash_balance !== undefined) {
        filteredSummary.cash_balance = summary.cash_balance;
    }
    
    // Получаем общую стоимость отфильтрованного портфеля для расчета процентов
    const totalPortfolioValue = filteredSummary.total_value || 0;
    
    sortedPortfolio.forEach(item => {
        const row = createPortfolioRow(item, totalPortfolioValue);
        tbody.appendChild(row);
    });
    
    // Привязываем обработчики к кнопкам продажи
    attachSellButtonHandlers();
    
    // Загружаем и отрисовываем мини-графики для всех позиций
    loadSparklines(filteredPortfolio);
    
    // Обновление сводки и блока "по видам" на основе отфильтрованных данных
    updateSummary(filteredSummary);
    renderQuicklookTypeChanges(filteredPortfolio);
    
    // Обновление диаграммы категорий
    updateCategoryChart(portfolio);

    // Обновляем визуальные индикаторы сортировки в заголовках
    updatePortfolioSortIndicators();
}

/**
 * Быстрый взгляд: показать изменения по видам активов в правой колонке сводки.
 * Рассчитывается по полному портфелю (без фильтров), с учётом текущего периода change_days,
 * т.к. поля item.price_change / item.price_change_percent уже приходят пересчитанными сервером.
 */
function renderQuicklookTypeChanges(portfolio) {
    const host = document.getElementById('summary-type-changes');
    if (!host) return;

    if (!Array.isArray(portfolio) || portfolio.length === 0) {
        host.innerHTML = '<div class="summary-type-change-row"><span class="summary-type-change-name">Нет данных</span><span class="summary-type-change-value">—</span></div>';
        return;
    }

    // Группируем по виду актива (asset_type), иначе "Без вида"
    const groups = new Map();
    for (const item of portfolio) {
        const nameRaw = (item && item.asset_type) ? String(item.asset_type).trim() : '';
        const name = nameRaw || 'Без вида';
        if (!groups.has(name)) {
            groups.set(name, { name, changeRub: 0, valueRub: 0, weightedPctSum: 0 });
        }
        const g = groups.get(name);
        const qty = Number(item.quantity) || 0;
        const change = Number(item.price_change) || 0;
        const value = Number(item.total_cost) || 0;
        const pct = Number(item.price_change_percent) || 0;

        g.changeRub += change * qty;
        g.valueRub += value;
        g.weightedPctSum += pct * value;
    }

    const rows = Array.from(groups.values()).map(g => {
        const pct = g.valueRub > 0 ? (g.weightedPctSum / g.valueRub) : 0;
        return { name: g.name, changeRub: g.changeRub, pct };
    });

    // Приоритетный порядок видов для быстрого взгляда
    const TYPE_ORDER = ['Акции', 'Облигации', 'Фонды'];
    const orderIndex = (name) => {
        const idx = TYPE_ORDER.indexOf(name);
        return idx === -1 ? TYPE_ORDER.length : idx;
    };

    // Сортируем: сначала по заданному порядку, внутри группы — по абсолютному изменению
    rows.sort((a, b) => {
        const oa = orderIndex(a.name);
        const ob = orderIndex(b.name);
        if (oa !== ob) return oa - ob;
        const da = Math.abs(a.changeRub || 0);
        const db = Math.abs(b.changeRub || 0);
        return db - da;
    });

    // Чтобы блок оставался компактным — показываем топ-6, остальные объединяем
    const MAX_ROWS = 6;
    let visible = rows;
    if (rows.length > MAX_ROWS) {
        const head = rows.slice(0, MAX_ROWS - 1);
        const tail = rows.slice(MAX_ROWS - 1);
        const otherChange = tail.reduce((s, r) => s + (r.changeRub || 0), 0);
        // Процент для "прочих" считаем как взвешенное среднее по стоимости — но у нас нет сумм стоимостей в rows,
        // поэтому оставим только ₽, а % не показываем, чтобы не вводить в заблуждение.
        head.push({ name: `Прочие (${tail.length})`, changeRub: otherChange, pct: null });
        visible = head;
    }

    host.innerHTML = visible.map(r => {
        const isProfit = (r.changeRub || 0) >= 0;
        const cls = isProfit ? 'profit' : 'loss';
        const sign = isProfit ? '+' : '';
        const changeText = `${sign}${formatCurrency(r.changeRub, 2)}`;
        const pctText = (r.pct === null || r.pct === undefined)
            ? ''
            : ` (${r.pct >= 0 ? '+' : '- '}${formatPercent(Math.abs(r.pct), 2)})`;
        return `
            <div class="summary-type-change-row ${cls}">
                <span class="summary-type-change-name" title="${escapeHtml(r.name)}">${escapeHtml(r.name)}</span>
                <span class="summary-type-change-value">${changeText}${pctText}</span>
            </div>
        `;
    }).join('');
}

// Мини-экранирование для вставки строк в HTML (используем только для быстрых подписей)
function escapeHtml(str) {
    return String(str)
        .replaceAll('&', '&amp;')
        .replaceAll('<', '&lt;')
        .replaceAll('>', '&gt;')
        .replaceAll('"', '&quot;')
        .replaceAll("'", '&#039;');
}

/**
 * Загрузка и отрисовка мини-графиков для всех позиций портфеля
 */
async function loadSparklines(portfolio) {
    for (const item of portfolio) {
        const container = document.querySelector(`.sparkline-container[data-ticker="${item.ticker}"]`);
        if (container) {
            await renderSparkline(container, item.ticker, item.instrument_type === 'Облигация');
        }
    }
}

/**
 * Отрисовка мини-графика (спарклайна) для тикера
 */
async function renderSparkline(container, ticker, isBond = false) {
    try {
        // Получаем историю цен за последние 30 календарных дней
        // (чтобы собрать до 8 последних торговых дней с учетом выходных и праздников)
        const response = await fetch(`/api/price-history?ticker=${ticker}&days=30&limit=200`);
        const data = await response.json();
        
        if (!data.success || !data.history || data.history.length === 0) {
            container.innerHTML = '<span style="color: #95a5a6; font-size: 0.8em;">Нет данных</span>';
            return;
        }
        
        // Группируем данные по дням (одна точка = один день)
        const dailyData = {};
        data.history.forEach(h => {
            const date = new Date(h.logged_at);
            const dayKey = date.toISOString().split('T')[0]; // YYYY-MM-DD
            
            if (!dailyData[dayKey]) {
                dailyData[dayKey] = [];
            }
            
            let price = parseFloat(h.price) || 0;
            // Для облигаций переводим из процентов в рубли для отображения
            if (isBond && price < 1000) {
                price = (price * 1000) / 100;
            }
            
            dailyData[dayKey].push({
                price: price,
                timestamp: date.getTime()
            });
        });
        
        // Для каждого дня берем последнюю запись (самую свежую)
        const dailyPrices = [];
        const sortedDays = Object.keys(dailyData).sort();
        
        sortedDays.forEach(dayKey => {
            const dayRecords = dailyData[dayKey];
            // Сортируем по времени и берем последнюю запись за день
            dayRecords.sort((a, b) => b.timestamp - a.timestamp);
            dailyPrices.push(dayRecords[0].price);
        });
        
        if (dailyPrices.length === 0) {
            container.innerHTML = '<span style="color: #95a5a6; font-size: 0.8em;">Нет данных</span>';
            return;
        }
        
        // Ограничиваем до 15 дней (берем последние 15 дней)
        const prices = dailyPrices.slice(-15);
        
        // Параметры графика
        const width = 140;
        const height = 36;
        const padding = 2;
        const graphWidth = width - padding * 2;
        const graphHeight = height - padding * 2;
        
        // Находим min и max для масштабирования
        const minPrice = Math.min(...prices);
        const maxPrice = Math.max(...prices);
        const priceRange = maxPrice - minPrice || 1; // Избегаем деления на 0
        
        // Определяем цвет графика (зеленый если последняя цена выше первой, красный если ниже)
        const firstPrice = prices[0];
        const lastPrice = prices[prices.length - 1];
        const isPositive = lastPrice >= firstPrice;
        const lineColor = isPositive ? '#27ae60' : '#e74c3c';
        
        // Создаем SVG
        const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
        svg.setAttribute('width', width);
        svg.setAttribute('height', height);
        svg.setAttribute('viewBox', `0 0 ${width} ${height}`);
        svg.style.display = 'block';
        
        // Создаем путь для линии графика
        const pathData = prices.map((price, index) => {
            const x = padding + (index / (prices.length - 1 || 1)) * graphWidth;
            const y = padding + graphHeight - ((price - minPrice) / priceRange) * graphHeight;
            return `${index === 0 ? 'M' : 'L'} ${x} ${y}`;
        }).join(' ');
        
        const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
        path.setAttribute('d', pathData);
        path.setAttribute('fill', 'none');
        path.setAttribute('stroke', lineColor);
        path.setAttribute('stroke-width', '1.5');
        path.setAttribute('stroke-linecap', 'round');
        path.setAttribute('stroke-linejoin', 'round');
        svg.appendChild(path);
        
        // Добавляем точки для каждого дня
        prices.forEach((price, index) => {
            const x = padding + (index / (prices.length - 1 || 1)) * graphWidth;
            const y = padding + graphHeight - ((price - minPrice) / priceRange) * graphHeight;
            
            const circle = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
            circle.setAttribute('cx', x);
            circle.setAttribute('cy', y);
            circle.setAttribute('r', '2');
            circle.setAttribute('fill', lineColor);
            circle.setAttribute('stroke', '#ffffff');
            circle.setAttribute('stroke-width', '0.5');
            svg.appendChild(circle);
        });
        
        container.innerHTML = '';
        container.appendChild(svg);
        
    } catch (error) {
        console.error(`Ошибка загрузки графика для ${ticker}:`, error);
        container.innerHTML = '<span style="color: #95a5a6; font-size: 0.8em;">Ошибка</span>';
    }
}

/**
 * Привязка обработчиков событий к кнопкам продажи
 */
function attachSellButtonHandlers() {
    const sellButtons = document.querySelectorAll('.btn-sell');
    sellButtons.forEach(button => {
        button.addEventListener('click', function() {
            const portfolioId = parseInt(this.getAttribute('data-portfolio-id'));
            const ticker = this.getAttribute('data-ticker');
            const companyName = this.getAttribute('data-company-name');
            const quantity = parseFloat(this.getAttribute('data-quantity'));
            const lots = parseFloat(this.getAttribute('data-lots')) || (quantity / (parseFloat(this.getAttribute('data-lotsize')) || 1));
            const lotsize = parseFloat(this.getAttribute('data-lotsize')) || 1;
            const price = parseFloat(this.getAttribute('data-price'));
            
            openSellModal(portfolioId, ticker, companyName, quantity, lots, lotsize, price);
        });
    });
}

/**
 * Создание строки таблицы для позиции
 */
function _escapeAttr(str) {
    return String(str).replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

function createPortfolioRow(item, totalPortfolioValue = 0) {
    const row = document.createElement('tr');
    // Сохраняем тикер и id позиции в data-атрибутах для точечного обновления строки
    if (item && item.ticker) {
        row.dataset.ticker = String(item.ticker).toUpperCase();
    }
    if (item && item.id !== undefined) {
        row.dataset.portfolioId = String(item.id);
    }
    
    // Определение классов для прибыли/убытка
    const pnlClass = item.profit_loss >= 0 ? 'profit' : 'loss';
    const changeClass = item.price_change >= 0 ? 'profit' : 'loss';
    
    // Определяем, является ли инструмент облигацией
    const isBond = item.instrument_type === 'Облигация';
    // Используем реальный номинал из данных, если есть, иначе 1000 по умолчанию
    const bondNominal = (isBond && item.bond_facevalue) ? item.bond_facevalue : 1000;
    const bondCurrency = (isBond && item.bond_currency) ? item.bond_currency : 'SUR';

    // Для облигаций проверяем и переводим цены из процентов в рубли, если нужно
    let effectivePrice = item.current_price;
    let effectiveAvgPrice = item.average_buy_price;
    
    if (isBond) {
        // Если цена меньше 1000, считаем что она в процентах и переводим в рубли
        if (effectivePrice < 1000) {
            effectivePrice = (effectivePrice * bondNominal) / 100;
        }
        if (effectiveAvgPrice < 1000) {
            effectiveAvgPrice = (effectiveAvgPrice * bondNominal) / 100;
        }
    }
    
    // Отладка для облигаций
    if (isBond) {
        console.log(`=== ОТЛАДКА ОБЛИГАЦИИ ${item.ticker} ===`);
        console.log('Данные с бэкенда:', {
            current_price: item.current_price,
            average_buy_price: item.average_buy_price,
            total_cost: item.total_cost,
            quantity: item.quantity,
            instrument_type: item.instrument_type,
            bond_facevalue: item.bond_facevalue,
            bond_currency: item.bond_currency
        });
        console.log('Вычисленные значения:', {
            effectivePrice,
            effectiveAvgPrice,
            assetTotal,
            currentPricePercent,
            bondNominal,
            bondCurrency
        });
        console.log('==========================================');
    }

    // Используем total_cost из бэкенда (уже правильно рассчитан)
    // Для облигаций это общая стоимость в рублях, для акций тоже
    const assetTotal = item.total_cost || (item.quantity * effectivePrice);
    
    // Рассчитываем процент от общего портфеля
    const portfolioPercent = totalPortfolioValue > 0 ? (assetTotal / totalPortfolioValue * 100) : 0;
    
    const investmentsTotal = item.quantity * effectiveAvgPrice;

    // Линии для объединённой колонки "Текущая стоимость"
    // Для облигаций: 1) цена в рублях, 2) процент от номинала, 3) процент от портфеля
    // Для акций: 1) общая стоимость, 2) цена за единицу, 3) процент от портфеля
    // Вычисляем процент от номинала для облигаций (цена в рублях / номинал * 100)
    const currentPricePercent = isBond 
        ? (effectivePrice / bondNominal) * 100 
        : null;
    const portfolioPercentLine = formatPercent(portfolioPercent, 2);
    
    const pnlValueText = `${item.profit_loss >= 0 ? '+' : ''}${formatCurrency(item.profit_loss, 2)}`;
    const pnlPercentText = `${item.profit_loss_percent >= 0 ? '+' : '-'}${formatPercent(Math.abs(item.profit_loss_percent), 2)}`;
    
    // Формируем три строки для колонки "Текущая стоимость"
    let currentValueLines = '';
    if (isBond && currentPricePercent !== null) {
        // Для облигаций: общая стоимость, процент от номинала, процент от портфеля
        // Добавляем информацию о валюте, если это не рубли
        const currencyText = bondCurrency && bondCurrency !== 'SUR' ? ` (${bondCurrency})` : '';
        currentValueLines = `
            <strong>${formatAssetTotal(assetTotal)}${currencyText}</strong>
            <span style="font-size: 0.9em; color: #2c3e50;">${formatCurrentPrice(effectivePrice, item.price_decimals)} (${formatPercent(currentPricePercent, 2)})</span>
            <span class="portfolio-share-badge">${portfolioPercentLine}</span>
        `;
    } else {
        // Для акций: общая стоимость, цена за единицу, процент от портфеля
        currentValueLines = `
            <strong>${formatAssetTotal(assetTotal)}</strong>
            <span style="font-size: 0.9em; color: #2c3e50;">${formatCurrentPrice(effectivePrice, item.price_decimals)}</span>
            <span class="portfolio-share-badge">${portfolioPercentLine}</span>
        `;
    }
    
    const assetTypeBadge = item.asset_type
        ? `<span class="asset-type-badge" data-type="${_escapeAttr(item.asset_type)}">${item.asset_type}</span>`
        : '';
    // Для колонки "Изменение за период" используем до 5 знаков после запятой для цен
    // (Intl.NumberFormat с minFractionDigits=0, maxFractionDigits=5 сам отбрасывает лишние нули справа)
    const changeDecimals = 5;

    row.innerHTML = `
        <td>
            <div class="ticker-company-cell">
                <span class="ticker-company-name">${item.company_name || item.ticker}</span>
                <span class="ticker-company-ticker" style="cursor: pointer; text-decoration: underline; color: #1e3a5f;" 
                      onclick="openTickerInfoModal('${item.ticker}', '${item.instrument_type || 'STOCK'}')" 
                      title="Нажмите для просмотра информации о тикере">${item.ticker}</span>
                ${assetTypeBadge}
            </div>
        </td>
        <td>${formatPrice(effectiveAvgPrice, item.price_decimals)}</td>
        <td>
            ${item.lotsize && item.lotsize > 1 
                ? `<strong>${formatNumber(item.lots || (item.quantity / item.lotsize))} лот${(item.lots || (item.quantity / item.lotsize)) === 1 ? '' : (item.lots || (item.quantity / item.lotsize)) % 10 >= 2 && (item.lots || (item.quantity / item.lotsize)) % 10 <= 4 && ((item.lots || (item.quantity / item.lotsize)) % 100 < 10 || (item.lots || (item.quantity / item.lotsize)) % 100 >= 20) ? 'а' : 'ов'}</strong><br><span style="font-size: 0.85em; color: #7f8c8d;">${formatNumber(item.quantity)} ${item.quantity === 1 ? 'бумага' : 'бумаг'}</span>`
                : `${formatNumber(item.quantity)} ${item.quantity === 1 ? 'бумага' : 'бумаг'}`}
        </td>
        <td>
            <strong>${formatAssetTotal(investmentsTotal)}</strong>
        </td>
        <td>
            <div style="display: flex; flex-direction: column; align-items: center; text-align: center;">
                ${currentValueLines}
            </div>
        </td>
        <td class="${pnlClass}" style="text-align: center;">
            <div style="display: flex; flex-direction: column; align-items: center;">
                <span>${pnlValueText}</span>
                <span style="font-size: 0.9em; color: #7f8c8d;">${pnlPercentText}</span>
            </div>
        </td>
        <td class="${changeClass}" style="text-align: center;">
            <div style="display: flex; flex-direction: column; align-items: center; gap: 2px;">
                <span>${item.price_change >= 0 ? '+' : ''}${formatCurrency(item.price_change * item.quantity, changeDecimals)} (${item.price_change_percent >= 0 ? '+' : '-'}${formatPercent(Math.abs(item.price_change_percent), 2)})</span>
                <span style="font-size: 0.9em; color: #7f8c8d; white-space: nowrap;">${formatPrice(effectivePrice - item.price_change, changeDecimals)} → ${formatPrice(effectivePrice, changeDecimals)}</span>
            </div>
        </td>
        <td class="sparkline-cell">
            <div class="sparkline-container" data-ticker="${item.ticker}"></div>
        </td>
        <td>
            <button class="btn btn-sell" 
                data-portfolio-id="${item.id}" 
                data-ticker="${item.ticker}" 
                data-company-name="${item.company_name || ''}" 
                data-quantity="${item.quantity}" 
                data-lots="${item.lots || (item.quantity / (item.lotsize || 1))}"
                data-lotsize="${item.lotsize || 1}"
                data-price="${item.current_price}" 
                title="Продать"></button>
        </td>
    `;
    
    return row;
}

/**
 * Расчет сводки портфеля на основе массива позиций
 */
function calculateSummaryFromPortfolio(portfolio) {
    if (!portfolio || portfolio.length === 0) {
        return {
            total_value: 0,
            total_cost: 0,
            total_pnl: 0,
            total_pnl_percent: 0,
            total_price_change: 0,
            total_price_change_percent: 0,
            total_count: 0
        };
    }
    
    // Общие расчеты портфеля
    const total_portfolio_value = portfolio.reduce((sum, item) => sum + (item.total_cost || 0), 0);
    const total_portfolio_cost = portfolio.reduce((sum, item) => sum + (item.total_buy_cost || 0), 0);
    const total_portfolio_pnl = total_portfolio_value - total_portfolio_cost;
    const total_portfolio_pnl_percent = total_portfolio_cost > 0 
        ? ((total_portfolio_value - total_portfolio_cost) / total_portfolio_cost * 100) 
        : 0;
    
    // Общее изменение цены за день (сумма изменений стоимости всех позиций)
    const total_price_change = portfolio.reduce((sum, item) => 
        sum + ((item.price_change || 0) * (item.quantity || 0)), 0);
    
    // Процентное изменение рассчитываем как средневзвешенное по стоимости позиций
    let total_price_change_percent = 0;
    const itemsWithChange = portfolio.filter(item => item.price_change != 0);
    const total_value_for_change = itemsWithChange.reduce((sum, item) => sum + (item.total_cost || 0), 0);
    
    if (total_value_for_change > 0) {
        const weighted_percent = itemsWithChange.reduce((sum, item) => 
            sum + ((item.price_change_percent || 0) * (item.total_cost || 0)), 0);
        total_price_change_percent = weighted_percent / total_value_for_change;
    }
    
    return {
        total_value: total_portfolio_value,
        total_cost: total_portfolio_cost,
        total_pnl: total_portfolio_pnl,
        total_pnl_percent: total_portfolio_pnl_percent,
        total_price_change: total_price_change,
        total_price_change_percent: total_price_change_percent,
        total_count: portfolio.length,
        cash_balance: 0 // Будет обновлено из summary с сервера
    };
}

/**
 * Обработчик клика по заголовку для сортировки портфеля
 * @param {string} columnKey
 */
function handlePortfolioSort(columnKey) {
    if (!currentPortfolioData || !currentPortfolioData.portfolio) {
        return;
    }

    if (portfolioSortState.column === columnKey) {
        // Переключаем направление
        portfolioSortState.direction = portfolioSortState.direction === 'asc' ? 'desc' : 'asc';
    } else {
        // Новая колонка — по умолчанию по возрастанию
        portfolioSortState.column = columnKey;
        portfolioSortState.direction = 'asc';
    }

    // Сохраняем состояние сортировки
    localStorage.setItem('portfolioSortColumn', portfolioSortState.column || '');
    localStorage.setItem('portfolioSortDirection', portfolioSortState.direction);

    // Перерисовываем портфель с учетом сортировки
    displayPortfolio(currentPortfolioData.portfolio, currentPortfolioData.summary);
    applyColumnVisibility();
}

/**
 * Сравнение двух позиций портфеля для сортировки
 * @param {Object} a
 * @param {Object} b
 * @param {{column: string, direction: string}} sortState
 */
function comparePortfolioItems(a, b, sortState) {
    const dir = sortState.direction === 'asc' ? 1 : -1;
    let aVal = 0;
    let bVal = 0;

    switch (sortState.column) {
        case 'company_name':
            // Сортировка по названию компании (алфавитная)
            const aName = (a.company_name || a.ticker || '').toLowerCase();
            const bName = (b.company_name || b.ticker || '').toLowerCase();
            const comparison = aName.localeCompare(bName, 'ru', { sensitivity: 'base' });
            return comparison * dir;
        case 'buy_price':
            aVal = parseFloat(a.average_buy_price) || 0;
            bVal = parseFloat(b.average_buy_price) || 0;
            break;
        case 'quantity':
            aVal = parseFloat(a.quantity) || 0;
            bVal = parseFloat(b.quantity) || 0;
            break;
        case 'invest_sum':
            // Сумма инвестиций = количество * цена приобретения
            aVal = (parseFloat(a.quantity) || 0) * (parseFloat(a.average_buy_price) || 0);
            bVal = (parseFloat(b.quantity) || 0) * (parseFloat(b.average_buy_price) || 0);
            break;
        case 'current_value':
            // Текущая стоимость — используем total_cost, если есть
            aVal = parseFloat(a.total_cost) || ((parseFloat(a.quantity) || 0) * (parseFloat(a.current_price) || 0));
            bVal = parseFloat(b.total_cost) || ((parseFloat(b.quantity) || 0) * (parseFloat(b.current_price) || 0));
            break;
        case 'day_change':
            // Изменение за период — сортировка по рублям или по % в зависимости от настройки
            if (changeSortMetric === 'rub') {
                aVal = (parseFloat(a.price_change) || 0) * (parseFloat(a.quantity) || 0);
                bVal = (parseFloat(b.price_change) || 0) * (parseFloat(b.quantity) || 0);
            } else {
                aVal = parseFloat(a.price_change_percent) || 0;
                bVal = parseFloat(b.price_change_percent) || 0;
            }
            break;
        case 'profit':
            // Прибыль — сортировка по рублям или по % в зависимости от настройки
            if (profitSortMetric === 'rub') {
                aVal = parseFloat(a.profit_loss) || 0;
                bVal = parseFloat(b.profit_loss) || 0;
            } else {
                aVal = parseFloat(a.profit_loss_percent) || 0;
                bVal = parseFloat(b.profit_loss_percent) || 0;
            }
            break;
        default:
            aVal = 0;
            bVal = 0;
    }

    if (aVal === bVal) return 0;
    return aVal > bVal ? dir : -dir;
}

/**
 * Обновление визуальных индикаторов сортировки в заголовках таблицы портфеля
 */
function updatePortfolioSortIndicators() {
    const portfolioTable = document.getElementById('portfolio-table');
    if (!portfolioTable) return;

    const headers = portfolioTable.querySelectorAll('th[data-sort-key]');
    headers.forEach(th => {
        const key = th.getAttribute('data-sort-key');
        const btn = th.querySelector('.sort-btn');

        // Удаляем старый индикатор
        th.classList.remove('sorted-asc', 'sorted-desc');
        if (btn) {
            btn.textContent = '⇅';
        }

        // Добавляем индикатор только для активной колонки
        if (portfolioSortState.column === key) {
            if (portfolioSortState.direction === 'asc') {
                th.classList.add('sorted-asc');
                if (btn) btn.textContent = '▲';
            } else {
                th.classList.add('sorted-desc');
                if (btn) btn.textContent = '▼';
            }
        }
    });
}

/**
 * Обновление сводки портфеля
 */
function updateSummary(summary) {
    const totalValueEl = document.getElementById('total-value');
    const totalCountEl = document.getElementById('total-count');
    const totalPnlEl = document.getElementById('total-pnl');
    const totalPnlPercentEl = document.getElementById('total-pnl-percent');
    const totalPriceChangeEl = document.getElementById('total-price-change');
    const totalPriceChangePercentEl = document.getElementById('total-price-change-percent');
    const cashBalanceEl = document.getElementById('cash-balance');
    
    if (totalValueEl) {
        // Для общей стоимости в верхней панели ограничиваемся двумя знаками после запятой
        totalValueEl.textContent = formatCurrency(summary.total_value, 2);
    }
    
    if (totalCountEl) {
        const count = summary.total_count || 0;
        const word = (n) => {
            const mod10 = n % 10, mod100 = n % 100;
            if (mod10 === 1 && mod100 !== 11) return 'актив';
            if (mod10 >= 2 && mod10 <= 4 && (mod100 < 10 || mod100 >= 20)) return 'актива';
            return 'активов';
        };
        totalCountEl.textContent = `${count} ${word(count)}`;
    }
    
    if (cashBalanceEl && summary.cash_balance !== undefined) {
        cashBalanceEl.textContent = formatCurrency(summary.cash_balance);
    }
    
    if (totalPnlEl) {
        // Для общей прибыли/убытка в верхней панели также используем максимум два знака
        totalPnlEl.textContent = `${summary.total_pnl >= 0 ? '+' : ''}${formatCurrency(summary.total_pnl, 2)}`;
        totalPnlEl.className = `summary-value ${summary.total_pnl >= 0 ? 'profit' : 'loss'}`;
    }
    
    if (totalPnlPercentEl) {
        const pnlPercent = summary.total_pnl_percent || 0;
        const pnlSign = pnlPercent >= 0 ? '+' : '- ';
        totalPnlPercentEl.textContent = `${pnlSign}${formatPercent(Math.abs(pnlPercent), 2)}`;
        totalPnlPercentEl.className = `summary-percent ${pnlPercent >= 0 ? 'profit' : 'loss'}`;
    }
    
    const priceChange = summary.total_price_change || 0;
    if (totalPriceChangeEl) {
        // В верхней панели "Изменение за день" тоже ограничиваемся двумя знаками
        totalPriceChangeEl.textContent = `${priceChange >= 0 ? '+' : ''}${formatCurrency(priceChange, 2)}`;
        totalPriceChangeEl.className = `summary-value ${priceChange >= 0 ? 'profit' : 'loss'}`;
    }
    
    if (totalPriceChangePercentEl) {
        const rawPercent = summary.total_price_change_percent || 0;
        const sign = priceChange >= 0 ? '+' : '- '; // Пробел после минуса при убытке
        totalPriceChangePercentEl.textContent = `${sign}${formatPercent(Math.abs(rawPercent), 2)}`;
        totalPriceChangePercentEl.className = `summary-percent ${priceChange >= 0 ? 'profit' : 'loss'}`;
    }
}

/**
 * Загрузка и отображение курсов валют (USD, EUR, CNY к RUB)
 */
async function loadCurrencyRates() {
    try {
        const response = await fetch('/api/currency-rates');
        if (!response.ok) {
            throw new Error('Ошибка ответа сервера');
        }
        const data = await response.json();
        if (!data.success || !data.rates) {
            return;
        }

        const usdEl = document.getElementById('rate-usd');
        const eurEl = document.getElementById('rate-eur');
        const cnyEl = document.getElementById('rate-cny');
        const imoexEl = document.getElementById('rate-imoex');
        const imoex2El = document.getElementById('rate-imoex2');

        const formatRate = (rate) => {
            if (rate === null || rate === undefined) return '-';
            return rate.toFixed(2);
        };

        const formatChangePercent = (changePercent) => {
            if (changePercent === null || changePercent === undefined) return '0.00';
            return changePercent.toFixed(2);
        };

        const updateEl = (el, code, info) => {
            if (!el || !info) return;
            const rate = info.rate;
            const change = info.change || 0;
            const changePercent = info.change_percent || 0;

            const sign = change >= 0 ? '+' : '';
            el.textContent = `${code}: ${formatRate(rate)} ₽ (${sign}${formatChangePercent(changePercent)}%)`;

            el.classList.remove('profit', 'loss');
            if (change > 0) {
                el.classList.add('profit');
            } else if (change < 0) {
                el.classList.add('loss');
            }
        };

        updateEl(usdEl, 'USD', data.rates.USD);
        updateEl(eurEl, 'EUR', data.rates.EUR);
        updateEl(cnyEl, 'CNY', data.rates.CNY);

        const updateIndexEl = (el, label, im) => {
            if (!el || !im) return;
            const sign = im.change >= 0 ? '+' : '';
            const val = im.value >= 1000
                ? im.value.toLocaleString('ru-RU', { maximumFractionDigits: 2 })
                : im.value.toFixed(2);
            el.textContent = `${label}: ${val} (${sign}${im.change_percent.toFixed(2)}%)`;
            el.classList.remove('profit', 'loss');
            if (im.change > 0) el.classList.add('profit');
            else if (im.change < 0) el.classList.add('loss');
        };
        updateIndexEl(imoexEl, 'IMOEX', data.imoex);
        updateIndexEl(imoex2El, 'IMOEX2', data.imoex2);
    } catch (err) {
        console.error('Ошибка загрузки курсов валют:', err);
    }
}

/**
 * Обновление категорий во всех связанных вкладках
 * Загружает данные один раз и обновляет обе вкладки: "Мой портфель" и "Аналитика"
 */
async function updateAllCategoryViews() {
    try {
        // Загружаем актуальные данные с сервера (один запрос для обеих вкладок)
        const response = await fetch('/api/portfolio');
        const data = await safeJsonResponse(response);
        
        if (!data) {
            // Ошибка уже залогирована в safeJsonResponse
            return;
        }
        
        if (data.success && data.portfolio) {
            // Обновляем сохраненные данные
            currentPortfolioData = {
                portfolio: data.portfolio,
                summary: data.summary || null
            };
            
            // Перерисовываем таблицу портфеля, чтобы гарантировать корректные данные
            displayPortfolio(currentPortfolioData.portfolio, currentPortfolioData.summary);
            applyColumnVisibility();
            
            // Обновляем диаграмму "Аналитика"
            updateCategoryChart(currentPortfolioData.portfolio);
            
            // Сбрасываем флаг изменений
            categoriesChanged = false;
        }
    } catch (error) {
        console.error('Ошибка обновления категорий:', error);
    }
}

/**
 * Обновление видов активов во всех связанных вкладках
 * Загружает данные и обновляет диаграмму "Распределение по видам активов"
 */
async function updateAllAssetTypeViews() {
    try {
        const response = await fetch('/api/portfolio');
        const data = await safeJsonResponse(response);
        
        if (!data) {
            // Ошибка уже залогирована в safeJsonResponse
            return;
        }
        
        if (data.success && data.portfolio) {
            // Обновляем сохраненные данные портфеля
            currentPortfolioData = {
                portfolio: data.portfolio,
                summary: data.summary || null
            };
            
            // Обновляем диаграмму распределения по видам активов
            updateAssetTypeChart(currentPortfolioData.portfolio);

            // Обновляем диаграмму активов и их долей
            renderAssetsShareChart(getAnalyticsPortfolio());
        }
    } catch (error) {
        console.error('Ошибка обновления видов активов:', error);
    }
}

/**
 * Обработка ввода тикера с отложенной валидацией (для модального окна покупки)
 */
function handleBuyTickerInput(e) {
    const ticker = e.target.value.trim().toUpperCase();
    const statusEl = document.getElementById('buy-ticker-status');
    const hintEl = document.getElementById('buy-ticker-hint');
    
    // Очищаем предыдущий таймаут
    if (tickerValidationTimeout) {
        clearTimeout(tickerValidationTimeout);
    }
    
    // Показываем статус ожидания
    if (ticker.length > 0) {
        statusEl.textContent = '⏳';
        statusEl.className = 'ticker-status validating';
        hintEl.textContent = 'Проверка...';
        hintEl.className = 'ticker-hint';
        
        // Задержка перед валидацией (500мс)
        tickerValidationTimeout = setTimeout(() => {
            validateBuyTicker(ticker);
        }, 500);
    } else {
        statusEl.textContent = '';
        statusEl.className = 'ticker-status';
        hintEl.textContent = '';
    }
}

/**
 * Обработка потери фокуса на поле тикера (для модального окна покупки)
 */
function handleBuyTickerBlur(e) {
    const ticker = e.target.value.trim().toUpperCase();
    if (ticker.length > 0 && ticker !== lastValidatedTicker) {
        validateBuyTicker(ticker);
    }
}

/**
 * Валидация тикера через API (для модального окна покупки)
 */
async function validateBuyTicker(ticker) {
    if (!ticker) return;
    
    const statusEl = document.getElementById('buy-ticker-status');
    const hintEl = document.getElementById('buy-ticker-hint');
    const companyNameInput = document.getElementById('buy-company-name');
    
    if (!statusEl || !hintEl || !companyNameInput) {
        console.error('Не найдены необходимые элементы формы покупки');
        return;
    }
    
    try {
        const response = await fetch(`/api/validate-ticker/${ticker}?instrument_type=STOCK`);
        const data = await response.json();
        
        if (data.success && data.exists) {
            // Тикер существует
            statusEl.textContent = '✓';
            statusEl.className = 'ticker-status valid';
            hintEl.textContent = data.company_name ? `${data.company_name}` : 'Тикер найден на MOEX';
            hintEl.className = 'ticker-hint success';
            
            // Автозаполнение названия компании (всегда заполняем при валидации)
            if (data.company_name) {
                companyNameInput.value = data.company_name;
            }
            
            // Сохраняем размер лота и показываем подсказку
            const lotsize = data.lotsize || 1;
            document.getElementById('buy-lotsize').value = lotsize;
            const lotsHint = document.getElementById('buy-lots-hint');
            if (lotsHint) {
                if (lotsize > 1) {
                    lotsHint.textContent = `1 лот = ${lotsize} ${lotsize === 1 ? 'бумага' : 'бумаг'}`;
                    lotsHint.style.display = 'block';
                } else {
                    lotsHint.style.display = 'none';
                }
            }
            
            lastValidatedTicker = ticker;
        } else {
            // Тикер не существует
            statusEl.textContent = '✗';
            statusEl.className = 'ticker-status invalid';
            hintEl.textContent = data.error || 'Тикер не найден на Московской бирже';
            hintEl.className = 'ticker-hint error';
            lastValidatedTicker = '';
            // Очищаем название компании при невалидном тикере
            companyNameInput.value = '';
        }
    } catch (error) {
        console.error('Ошибка валидации тикера:', error);
        statusEl.textContent = '⚠';
        statusEl.className = 'ticker-status warning';
        hintEl.textContent = 'Не удалось проверить тикер';
        hintEl.className = 'ticker-hint warning';
    }
}

/**
 * Расчет общей суммы покупки (с учетом лотов)
 */
function calculateBuyTotal() {
    const lots = parseFloat(document.getElementById('buy-lots').value) || 0;
    const price = parseFloat(document.getElementById('buy-price').value) || 0;
    const lotsize = parseFloat(document.getElementById('buy-lotsize').value) || 1;
    const quantity = lots * lotsize; // Количество бумаг = лоты * размер лота
    const total = quantity * price;
    
    document.getElementById('buy-total').value = total > 0 ? total.toFixed(2) : '';
}

/**
 * Расчет общей суммы продажи (с учетом лотов)
 */
function calculateSellTotal() {
    const lots = parseFloat(document.getElementById('sell-lots').value) || 0;
    const price = parseFloat(document.getElementById('sell-price').value) || 0;
    const lotsize = parseFloat(document.getElementById('sell-lotsize').value) || 1;
    const quantity = lots * lotsize; // Количество бумаг = лоты * размер лота
    const total = quantity * price;
    
    document.getElementById('sell-total').value = total > 0 ? total.toFixed(2) : '';
}

/**
 * Открытие модального окна для покупки акций
 */
function openBuyModal() {
    const modal = document.getElementById('buy-modal');
    if (!modal) return;
    
    // Очищаем форму
    document.getElementById('buy-form').reset();
    
    // Сброс валидации тикера
    const statusEl = document.getElementById('buy-ticker-status');
    const hintEl = document.getElementById('buy-ticker-hint');
    if (statusEl) {
        statusEl.textContent = '';
        statusEl.className = 'ticker-status';
    }
    if (hintEl) {
        hintEl.textContent = '';
    }
    
    // Сброс подсказки о лотах
    const lotsHint = document.getElementById('buy-lots-hint');
    if (lotsHint) {
        lotsHint.textContent = '';
        lotsHint.style.display = 'none';
    }
    
    // Сброс размера лота
    document.getElementById('buy-lotsize').value = '1';
    
    lastValidatedTicker = '';
    
    // Устанавливаем сегодняшнюю дату по умолчанию
    const dateInput = document.getElementById('buy-date');
    if (dateInput) {
        const today = new Date();
        const year = today.getFullYear();
        const month = String(today.getMonth() + 1).padStart(2, '0');
        const day = String(today.getDate()).padStart(2, '0');
        dateInput.value = `${year}-${month}-${day}`;
    }
    
    // Показываем модальное окно
    modal.style.display = 'flex';
    
    // Устанавливаем фокус на поле "Тикер" после открытия модального окна
    setTimeout(() => {
        const tickerInput = document.getElementById('buy-ticker');
        if (tickerInput) {
            tickerInput.focus();
        }
    }, 100);
}

/**
 * Закрытие модального окна покупки
 */
function closeBuyModal() {
    const modal = document.getElementById('buy-modal');
    if (modal) {
        modal.style.display = 'none';
        document.getElementById('buy-form').reset();
    }
}

/**
 * Обработка покупки акций
 */
// Флаг для предотвращения повторной отправки формы покупки
let isBuyProcessing = false;

async function handleBuy(e) {
    e.preventDefault();
    
    // Защита от повторной отправки
    if (isBuyProcessing) {
        console.warn('Покупка уже обрабатывается, пожалуйста, подождите...');
        return;
    }
    
    const ticker = document.getElementById('buy-ticker').value.trim().toUpperCase();
    
    // Проверяем, что тикер валидирован
    if (ticker !== lastValidatedTicker) {
        console.warn('Пожалуйста, дождитесь проверки тикера на Московской бирже');
        return;
    }
    
    const statusEl = document.getElementById('buy-ticker-status');
    if (statusEl.classList.contains('invalid')) {
        console.warn('Указан несуществующий тикер. Пожалуйста, проверьте правильность написания.');
        return;
    }
    
    const lots = parseFloat(document.getElementById('buy-lots').value);
    const price = parseFloat(document.getElementById('buy-price').value);
    const lotsize = parseFloat(document.getElementById('buy-lotsize').value) || 1;
    const companyName = document.getElementById('buy-company-name').value.trim();
    const buyDate = document.getElementById('buy-date').value;
    const instrumentType = 'STOCK';
    
    if (!ticker || lots <= 0 || price <= 0 || !buyDate) {
        console.warn('Заполните все обязательные поля корректно');
        return;
    }
    
    // Блокируем форму и кнопку
    isBuyProcessing = true;
    const buyForm = document.getElementById('buy-form');
    const submitButton = buyForm.querySelector('button[type="submit"]');
    if (submitButton) {
        submitButton.disabled = true;
        const originalText = submitButton.textContent;
        submitButton.textContent = 'Обработка...';
        
        // Восстанавливаем кнопку в случае ошибки
        const restoreButton = () => {
            submitButton.disabled = false;
            submitButton.textContent = originalText;
            isBuyProcessing = false;
        };
        
        try {
            // Рассчитываем количество бумаг: лоты * размер лота
            const quantity = lots * lotsize;
            
            // Форматируем дату/время для отправки на сервер.
            // Если пользователь не менял дату, в поле уже стоит сегодняшняя дата,
            // поэтому добавляем текущее время, а не 00:00:00.
            const now = new Date();
            const timePart = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}:${String(now.getSeconds()).padStart(2, '0')}`;
            const formattedDate = `${buyDate} ${timePart}`;
            
            // 1. Создаём транзакцию покупки
            const transactionData = {
                ticker: ticker,
                company_name: companyName,
                operation_type: 'Покупка',
                price: price,
                quantity: quantity, // Сохраняем количество бумаг (лоты * размер лота)
                instrument_type: instrumentType,
                date: formattedDate,
                notes: `Покупка через модальное окно: ${lots} ${lots === 1 ? 'лот' : 'лотов'} (${quantity} ${quantity === 1 ? 'бумага' : 'бумаг'})`
            };
            
            const transResponse = await fetch('/api/transactions', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify(transactionData)
            });
            
            const transData = await transResponse.json();
            
            if (!transData.success) {
                console.error('Ошибка при создании транзакции:', transData.error);
                restoreButton();
                return;
            }
        
            // Обновляем баланс из ответа сервера в сохранённой сводке.
            // Отдельные функции отображения (displayPortfolio / refreshSinglePortfolioPosition)
            // затем пересчитают и отрисуют сводку с учётом активных фильтров.
            if (transData.cash_balance !== undefined && currentPortfolioData) {
                currentPortfolioData.summary.cash_balance = transData.cash_balance;
            }
            
            // Портфель уже пересчитывается на сервере (recalculate_portfolio_for_ticker),
            // поэтому здесь достаточно точечно обновить строку портфеля.
            
            // Закрываем модальное окно
            closeBuyModal();

            // Если пользователь находится на вкладке истории покупок/продаж —
            // сразу (параллельно) обновляем таблицу транзакций, чтобы новая
            // покупка появилась без ожидания запросов к MOEX при обновлении портфеля.
            const transactionsView = document.getElementById('transactions-view');
            if (transactionsView && transactionsView.style.display !== 'none') {
                // Не ждём завершения, чтобы не блокировать остальную логику
                loadTransactions();
            }
            
            // Показываем загрузку на строке портфеля
            setRowLoading(ticker, true);
            // Обновляем только строку портфеля для данного тикера (может включать запросы к MOEX)
            await refreshSinglePortfolioPosition(ticker);
            
            // Логируем результат в консоль вместо всплывающего окна
            console.log(`Покупка оформлена. Тикер: ${ticker}, куплено: ${lots} ${lots === 1 ? 'лот' : 'лотов'} (${quantity} ${quantity === 1 ? 'бумага' : 'бумаг'}) по ${parseFloat(price).toFixed(5)} ₽, сумма: ${(quantity * price).toFixed(2)} ₽`);
        } catch (error) {
            console.error('Ошибка покупки:', error);
            restoreButton();
            return;
        }
        
        // Восстанавливаем кнопку после успешной обработки
        restoreButton();
    } else {
        // Если кнопка не найдена, просто сбрасываем флаг
        isBuyProcessing = false;
    }
}

/**
 * Открытие модального окна для редактирования
 */
function openEditModal(id, companyName, category, quantity, averageBuyPrice) {
    document.getElementById('edit-id').value = id;
    document.getElementById('edit-company_name').value = companyName;
    document.getElementById('edit-category').value = category || '';
    document.getElementById('edit-quantity').value = quantity;
    document.getElementById('edit-average_buy_price').value = averageBuyPrice;
    document.getElementById('edit-modal').style.display = 'flex';
}

/**
 * Закрытие модального окна
 */
function closeEditModal() {
    document.getElementById('edit-modal').style.display = 'none';
}

/**
 * Обработка редактирования позиции
 */
async function handleEditPosition(e) {
    e.preventDefault();
    
    const id = document.getElementById('edit-id').value;
    const formData = {
        company_name: document.getElementById('edit-company_name').value.trim(),
        category: document.getElementById('edit-category').value,
        quantity: parseFloat(document.getElementById('edit-quantity').value),
        average_buy_price: parseFloat(document.getElementById('edit-average_buy_price').value)
    };
    
    if (formData.quantity <= 0 || formData.average_buy_price <= 0) {
        console.warn('Количество и цена должны быть положительными');
        return;
    }
    
    try {
        const response = await fetch(`/api/portfolio/${id}`, {
            method: 'PUT',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify(formData)
        });
        
        const data = await response.json();
        
        if (data.success) {
            closeEditModal();
            loadPortfolio(true, true);
            console.log('Позиция успешно обновлена');
        } else {
            console.error('Ошибка обновления позиции:', data.error);
        }
    } catch (error) {
        console.error('Ошибка обновления позиции:', error);
    }
}

/**
 * Удаление позиции из портфеля
 */
async function deletePosition(id, ticker) {
    try {
        const response = await fetch(`/api/portfolio/${id}`, {
            method: 'DELETE'
        });
        
        const data = await response.json();
        
        if (data.success) {
            loadPortfolio(true, true);
            console.log(`Позиция ${ticker} успешно удалена`);
        } else {
            console.error('Ошибка удаления позиции:', data.error);
        }
    } catch (error) {
        console.error('Ошибка удаления позиции:', error);
    }
}

/**
 * Обновление даты и времени последнего обновления таблицы
 */
function updateLastUpdateTime() {
    const now = new Date();
    const dateTimeString = now.toLocaleString('ru-RU', {
        day: '2-digit',
        month: '2-digit',
        year: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit'
    });
    localStorage.setItem('lastUpdateDateTime', dateTimeString);
    localStorage.removeItem('lastUpdateTime'); // удаляем старый ключ
    const lastUpdateEl = document.getElementById('last-update-time');
    if (lastUpdateEl) {
        lastUpdateEl.textContent = dateTimeString;
    }
}

function initTodayDate() {
    const todayEl = document.getElementById('today-date');
    if (todayEl) {
        todayEl.textContent = new Date().toLocaleDateString('ru-RU');
    }
    // Восстанавливаем сохранённое значение (новый ключ с датой+временем)
    const saved = localStorage.getItem('lastUpdateDateTime');
    const lastUpdateEl = document.getElementById('last-update-time');
    if (lastUpdateEl) {
        lastUpdateEl.textContent = saved || '—';
    }
}


function _getSummaryTarget(field) {
    if (field === 'value') {
        // Карточка "Общая стоимость" — находим по #total-value
        const el = document.getElementById('total-value');
        return el ? el.closest('.summary-card') : null;
    }
    if (field === 'pnl') {
        // Карточка "Общая прибыль/убыток" — находим по #total-pnl
        const el = document.getElementById('total-pnl');
        return el ? el.closest('.summary-card') : null;
    }
    return null;
}

function initSummaryVisibility() {
    ['value', 'pnl'].forEach(field => {
        const hidden = localStorage.getItem(`summaryHidden_${field}`) === '1';
        if (hidden) _applySummaryHidden(field, true);
    });
}

// ======= SVG Icon Constants =======
const SVG_ATTR = `viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"`;

const SVG_REFRESH  = `<svg ${SVG_ATTR}><polyline points="1 4 1 10 7 10"/><path d="M3.51 15a9 9 0 1 0 .49-4.5"/></svg>`;
const SVG_KEY      = `<svg ${SVG_ATTR}><circle cx="7.5" cy="15.5" r="5.5"/><line x1="21" y1="2" x2="13.29" y2="9.71"/><line x1="16" y1="8" x2="21" y2="3"/><line x1="14" y1="10" x2="16" y2="8"/></svg>`;
const SVG_LOGOUT   = `<svg ${SVG_ATTR}><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><polyline points="16 17 21 12 16 7"/><line x1="21" y1="12" x2="9" y2="12"/></svg>`;
const SVG_PENCIL   = `<svg ${SVG_ATTR}><line x1="18" y1="2" x2="22" y2="6"/><path d="M7.5 20.5 19 9l-4-4L2.5 16.5 2 22z"/></svg>`;
const SVG_TRASH    = `<svg ${SVG_ATTR}><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/><path d="M10 11v6"/><path d="M14 11v6"/><path d="M9 6V4h6v2"/></svg>`;
const SVG_DOWNLOAD = `<svg ${SVG_ATTR}><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>`;
const SVG_ZAP      = `<svg ${SVG_ATTR}><polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/></svg>`;
const SVG_RESET_LAYOUT = `<svg ${SVG_ATTR}><polyline points="1 4 1 10 7 10"/><polyline points="23 20 23 14 17 14"/><path d="M20.49 9A9 9 0 0 0 5.64 5.64L1 10m22 4-4.64 4.36A9 9 0 0 1 3.51 15"/></svg>`;
const SVG_SETTINGS = `<svg ${SVG_ATTR}><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/></svg>`;

const SVG_EYE_OPEN = `<svg viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
  <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/>
  <circle cx="12" cy="12" r="3"/>
</svg>`;

const SVG_EYE_OFF = `<svg viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
  <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94"/>
  <path d="M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19"/>
  <line x1="1" y1="1" x2="23" y2="23"/>
</svg>`;

function _applySummaryHidden(field, hide) {
    const target = _getSummaryTarget(field);
    const btn = document.getElementById(field === 'value' ? 'toggle-value-btn' : 'toggle-pnl-btn');
    if (!target) return;
    if (hide) {
        target.classList.add('summary-hidden');
        if (btn) btn.innerHTML = SVG_EYE_OFF;
    } else {
        target.classList.remove('summary-hidden');
        if (btn) btn.innerHTML = SVG_EYE_OPEN;
    }
}

function toggleSummaryField(field) {
    const key = `summaryHidden_${field}`;
    const nowHidden = localStorage.getItem(key) === '1';
    const next = !nowHidden;
    localStorage.setItem(key, next ? '1' : '0');
    _applySummaryHidden(field, next);
}

/**
 * Обновление отображения текущего времени МСК
 */
function updateMoscowTime() {
    try {
        const now = new Date();
        // Используем Intl.DateTimeFormat для правильного отображения московского времени
        const moscowTimeString = new Intl.DateTimeFormat('ru-RU', {
            timeZone: 'Europe/Moscow',
            hour: '2-digit',
            minute: '2-digit',
            second: '2-digit',
            hour12: false
        }).format(now);
        
        const moscowTimeEl = document.getElementById('current-time-msk');
        if (moscowTimeEl) {
            moscowTimeEl.textContent = moscowTimeString;
        }
    } catch (error) {
        console.error('Ошибка обновления времени МСК:', error);
        // Fallback: просто добавляем 3 часа к UTC
        const now = new Date();
        const utcTime = now.getTime() + (now.getTimezoneOffset() * 60000);
        const moscowTime = new Date(utcTime + (3 * 3600000));
        const hours = String(moscowTime.getHours()).padStart(2, '0');
        const minutes = String(moscowTime.getMinutes()).padStart(2, '0');
        const seconds = String(moscowTime.getSeconds()).padStart(2, '0');
        const moscowTimeEl = document.getElementById('current-time-msk');
        if (moscowTimeEl) {
            moscowTimeEl.textContent = `${hours}:${minutes}:${seconds}`;
        }
    }
}

/**
 * Запуск отображения текущего времени МСК с обновлением каждую секунду
 */
function startMoscowTimeDisplay() {
    // Обновляем сразу при загрузке
    updateMoscowTime();
    
    // Обновляем каждую секунду
    setInterval(updateMoscowTime, 1000);
}

/**
 * Отображение ошибки
 */
function showError(message) {
    const errorMessage = document.getElementById('error-message');
    const loading = document.getElementById('loading');
    
    if (errorMessage) {
        errorMessage.textContent = message;
        errorMessage.style.display = 'block';
    }
    
    if (loading) {
        loading.style.display = 'none';
    }
}

/**
 * Форматирование валюты (до 5 знаков, без лишних нулей)
 */
function formatCurrency(value, decimals = null) {
    if (value === null || value === undefined) {
        return '0 ₽';
    }
    
    // Если указано количество знаков после запятой, используем его как максимум
    // Иначе используем до 5 знаков, но без лишних нулей
    const maxDecimals = decimals !== null ? decimals : 5;
    
    return new Intl.NumberFormat('ru-RU', {
        style: 'currency',
        currency: 'RUB',
        minimumFractionDigits: 0,  // Не показываем лишние нули
        maximumFractionDigits: maxDecimals
    }).format(value);
}

/**
 * Форматирование цены с учетом количества знаков после запятой из данных актива
 * Лишние нули после запятой не отображаются
 * По умолчанию показывает до 5 знаков после запятой (если они есть)
 */
function formatPrice(value, decimals = null) {
    if (value === null || value === undefined) {
        return '0 ₽';
    }
    
    // Если decimals не указан, используем до 5 знаков (как для FEES)
    // Если указан, используем его (но не больше 5)
    const maxDecimals = decimals !== null && decimals !== undefined ? Math.min(decimals, 5) : 5;
    
    return new Intl.NumberFormat('ru-RU', {
        style: 'currency',
        currency: 'RUB',
        minimumFractionDigits: 0,  // Не показываем лишние нули
        maximumFractionDigits: maxDecimals  // Но можем показать до maxDecimals знаков
    }).format(value);
}

/**
 * Форматирование цен в истории:
 * - для акций показываем в рублях (как и раньше)
 * - для облигаций показываем цену в рублях (конвертированную из валюты номинала)
 */
function formatHistoryPrice(item) {
    if (!item) return '-';

    const price = item.price;
    const instrumentType = item.instrument_type;

    // Используем price_rub если оно есть (сервер его добавляет для облигаций,
    // в том числе для старых записей с неверным instrument_type)
    if (item.price_rub !== null && item.price_rub !== undefined && item.price_rub > 0) {
        return formatCurrency(Number(item.price_rub));
    }

    if (instrumentType === 'Облигация') {
        // Fallback: конвертируем на клиенте если price_rub не пришёл
        if (price === null || price === undefined) return '-';
        const bondFacevalue = item.bond_facevalue || 1000.0;
        const bondCurrency = item.bond_currency || 'SUR';
        const priceInNominal = (Number(price) * bondFacevalue) / 100;
        if (bondCurrency === 'SUR' || bondCurrency === 'RUB') {
            return formatCurrency(priceInNominal);
        }
        return `${priceInNominal.toFixed(2)} ${bondCurrency}`;
    }

    // Акции и прочие инструменты
    return formatCurrency(price);
}

/**
 * Форматирование суммы актива:
 * до двух знаков после запятой, без лишних нулей
 */
function formatAssetTotal(value) {
    if (value === null || value === undefined) {
        return '0 ₽';
    }
    return new Intl.NumberFormat('ru-RU', {
        style: 'currency',
        currency: 'RUB',
        minimumFractionDigits: 0,
        maximumFractionDigits: 2
    }).format(value);
}

/**
 * Форматирование текущей цены (до 2 знаков, без лишних нулей)
 */
function formatCurrentPrice(value, decimals = null) {
    if (value === null || value === undefined) {
        return '0 ₽';
    }
    
    // Если указано количество знаков после запятой, используем его как максимум
    // Иначе используем до 5 знаков (как для FEES)
    // minimumFractionDigits: 0 - чтобы не показывать лишние нули
    const maxDecimals = decimals !== null && decimals !== undefined ? Math.min(decimals, 5) : 5;
    
    return new Intl.NumberFormat('ru-RU', {
        style: 'currency',
        currency: 'RUB',
        minimumFractionDigits: 0,  // Не показываем лишние нули
        maximumFractionDigits: maxDecimals
    }).format(value);
}

/**
 * Форматирование процентов (до decimals знаков, без лишних нулей)
 */
function formatPercent(value, decimals = 2) {
    if (value === null || value === undefined || isNaN(value)) {
        return '0%';
    }
    const formatted = new Intl.NumberFormat('ru-RU', {
        minimumFractionDigits: 0,
        maximumFractionDigits: decimals
    }).format(value);
    return `${formatted}%`;
}

/**
 * Форматирование числа
 */
function formatNumber(value) {
    if (value === null || value === undefined) {
        return '0';
    }
    return new Intl.NumberFormat('ru-RU', {
        minimumFractionDigits: 0,
        maximumFractionDigits: 2
    }).format(value);
}

/**
 * Переключение между представлениями (таблица/диаграмма)
 */
function switchView(viewType) {
    const tableView = document.getElementById('table-view');
    const chartView = document.getElementById('chart-view');
    const historyView = document.getElementById('history-view');
    const transactionsView = document.getElementById('transactions-view');
    const categoriesView = document.getElementById('categories-view');
    const serverView = document.getElementById('server-view');
    const tickerSberView = document.getElementById('ticker-sber-view');
    const tickerRuView = document.getElementById('ticker-ru-view');
    const tickerCnymView = document.getElementById('ticker-cnym-view');
    const tickerLqdtView = document.getElementById('ticker-lqdt-view');
    const settingsView = document.getElementById('settings-view');
    const btnTable = document.getElementById('btn-table-view');
    const btnChart = document.getElementById('btn-chart-view');
    const btnHistory = document.getElementById('btn-history-view');
    const btnTransactions = document.getElementById('btn-transactions-view');
    const btnCategories = document.getElementById('btn-categories-view');
    
    if (viewType === 'table') {
        tableView.style.display = 'flex';
        chartView.style.display = 'none';
        historyView.style.display = 'none';
        transactionsView.style.display = 'none';
        categoriesView.style.display = 'none';
        if (serverView) serverView.style.display = 'none';
        if (settingsView) settingsView.style.display = 'none';
        if (tickerSberView) tickerSberView.style.display = 'none';
        if (tickerRuView) tickerRuView.style.display = 'none';
        if (tickerCnymView) tickerCnymView.style.display = 'none';
        if (tickerLqdtView) tickerLqdtView.style.display = 'none';
        if (btnTable) btnTable.classList.add('active');
        if (btnChart) btnChart.classList.remove('active');
        if (btnHistory) btnHistory.classList.remove('active');
        if (btnTransactions) btnTransactions.classList.remove('active');
        if (btnCategories) btnCategories.classList.remove('active');
        
        // Обновляем обе вкладки, если категории были изменены
        if (categoriesChanged) {
            updateAllCategoryViews();
        }
    } else if (viewType === 'chart') {
        tableView.style.display = 'none';
        chartView.style.display = 'block';
        historyView.style.display = 'none';
        transactionsView.style.display = 'none';
        categoriesView.style.display = 'none';
        if (serverView) serverView.style.display = 'none';
        if (settingsView) settingsView.style.display = 'none';
        if (tickerSberView) tickerSberView.style.display = 'none';
        if (tickerRuView) tickerRuView.style.display = 'none';
        if (tickerCnymView) tickerCnymView.style.display = 'none';
        if (tickerLqdtView) tickerLqdtView.style.display = 'none';
        if (btnTable) btnTable.classList.remove('active');
        if (btnChart) btnChart.classList.add('active');
        if (btnHistory) btnHistory.classList.remove('active');
        if (btnTransactions) btnTransactions.classList.remove('active');
        if (btnCategories) btnCategories.classList.remove('active');
        
        // Обновляем обе вкладки, если категории были изменены
        if (categoriesChanged) {
            updateAllCategoryViews();
        } else if (currentPortfolioData) {
            const filtered = getAnalyticsPortfolio();
            updateCategoryChart(filtered);
            updateAssetTypeChart(filtered);
            renderAssetsShareChart(filtered);
        }

        // Применяем порядок и видимость секций аналитики
        applyAnalyticsLayout();

        // Применяем выбор типа диаграммы
        applyChartTypeSelection();

        // Восстанавливаем дату старта из localStorage в поле
        const pvcDateInput = document.getElementById('pvc-date-from');
        if (pvcDateInput && _pvcDateFrom) pvcDateInput.value = _pvcDateFrom;
        // Загружаем график стоимости портфеля (дата старта или период)
        loadPortfolioValueChart(_pvcDateFrom || _pvcActiveDays);

        // Обновляем лейбл фильтра
        _updateAnalyticsFilterLabel();
    } else if (viewType === 'history') {
        tableView.style.display = 'none';
        chartView.style.display = 'none';
        historyView.style.display = 'block';
        transactionsView.style.display = 'none';
        categoriesView.style.display = 'none';
        if (serverView) serverView.style.display = 'none';
        if (settingsView) settingsView.style.display = 'none';
        if (tickerSberView) tickerSberView.style.display = 'none';
        if (tickerRuView) tickerRuView.style.display = 'none';
        if (tickerCnymView) tickerCnymView.style.display = 'none';
        if (tickerLqdtView) tickerLqdtView.style.display = 'none';
        if (btnTable) btnTable.classList.remove('active');
        if (btnChart) btnChart.classList.remove('active');
        if (btnHistory) btnHistory.classList.add('active');
        if (btnTransactions) btnTransactions.classList.remove('active');
        if (btnCategories) btnCategories.classList.remove('active');
        // Мгновенно заполняем фильтр тикеров из уже загруженных данных портфеля
        updateHistoryTickerFilter();
        // Загружаем историю цен при переключении
        loadPriceHistory();
    } else if (viewType === 'transactions') {
        tableView.style.display = 'none';
        chartView.style.display = 'none';
        historyView.style.display = 'none';
        transactionsView.style.display = 'flex';
        categoriesView.style.display = 'none';
        if (serverView) serverView.style.display = 'none';
        if (settingsView) settingsView.style.display = 'none';
        if (tickerSberView) tickerSberView.style.display = 'none';
        if (tickerRuView) tickerRuView.style.display = 'none';
        if (tickerCnymView) tickerCnymView.style.display = 'none';
        if (tickerLqdtView) tickerLqdtView.style.display = 'none';
        if (btnTable) btnTable.classList.remove('active');
        if (btnChart) btnChart.classList.remove('active');
        if (btnHistory) btnHistory.classList.remove('active');
        if (btnTransactions) btnTransactions.classList.add('active');
        if (btnCategories) btnCategories.classList.remove('active');
        // Загружаем транзакции при переключении
        loadTransactions();
    } else if (viewType === 'categories') {
        tableView.style.display = 'none';
        chartView.style.display = 'none';
        historyView.style.display = 'none';
        transactionsView.style.display = 'none';
        categoriesView.style.display = 'flex';
        if (serverView) serverView.style.display = 'none';
        if (settingsView) settingsView.style.display = 'none';
        if (tickerSberView) tickerSberView.style.display = 'none';
        if (tickerRuView) tickerRuView.style.display = 'none';
        if (tickerCnymView) tickerCnymView.style.display = 'none';
        if (tickerLqdtView) tickerLqdtView.style.display = 'none';
        if (btnTable) btnTable.classList.remove('active');
        if (btnChart) btnChart.classList.remove('active');
        if (btnHistory) btnHistory.classList.remove('active');
        if (btnTransactions) btnTransactions.classList.remove('active');
        if (btnCategories) btnCategories.classList.add('active');
        // Загружаем категории при переключении
        // Сначала загружаем список категорий, затем используем уже загруженный портфель,
        // а к /api/portfolio обращаемся только если данных еще нет
        loadCategoriesList().then(() => {
            if (currentPortfolioData && currentPortfolioData.portfolio) {
                // Используем кэш портфеля для построения таблицы категорий
                const uniqueTickers = {};
                currentPortfolioData.portfolio.forEach(item => {
                    if (!uniqueTickers[item.ticker]) {
                        uniqueTickers[item.ticker] = item;
                    }
                });
                renderCategories(Object.values(uniqueTickers));
            } else {
                // Если по какой-то причине портфель еще не загружен, сделаем один запрос
                loadCategories();
            }
        });
    } else if (viewType === 'server') {
        tableView.style.display = 'none';
        chartView.style.display = 'none';
        historyView.style.display = 'none';
        transactionsView.style.display = 'none';
        if (categoriesView) categoriesView.style.display = 'none';
        if (serverView) serverView.style.display = 'flex';
        if (settingsView) settingsView.style.display = 'none';
        if (tickerSberView) tickerSberView.style.display = 'none';
        if (tickerRuView) tickerRuView.style.display = 'none';
        if (tickerCnymView) tickerCnymView.style.display = 'none';
        if (tickerLqdtView) tickerLqdtView.style.display = 'none';

        if (btnTable) btnTable.classList.remove('active');
        if (btnChart) btnChart.classList.remove('active');
        if (btnHistory) btnHistory.classList.remove('active');
        if (btnTransactions) btnTransactions.classList.remove('active');
        if (btnCategories) btnCategories.classList.remove('active');

        // Загружаем данные мониторинга сервера
        loadServerStatus();
        loadAccessLogs();
    } else if (viewType === 'ticker-sber') {
        tableView.style.display = 'none';
        chartView.style.display = 'none';
        historyView.style.display = 'none';
        transactionsView.style.display = 'none';
        if (categoriesView) categoriesView.style.display = 'none';
        if (serverView) serverView.style.display = 'none';
        if (settingsView) settingsView.style.display = 'none';
        if (tickerRuView) tickerRuView.style.display = 'none';
        if (tickerCnymView) tickerCnymView.style.display = 'none';
        if (tickerLqdtView) tickerLqdtView.style.display = 'none';
        if (tickerSberView) tickerSberView.style.display = 'block';

        if (btnTable) btnTable.classList.remove('active');
        if (btnChart) btnChart.classList.remove('active');
        if (btnHistory) btnHistory.classList.remove('active');
        if (btnTransactions) btnTransactions.classList.remove('active');
        if (btnCategories) btnCategories.classList.remove('active');

        loadTickerDebug('SBER', 'ticker-sber-content', 'STOCK');
    } else if (viewType === 'ticker-ru') {
        tableView.style.display = 'none';
        chartView.style.display = 'none';
        historyView.style.display = 'none';
        transactionsView.style.display = 'none';
        if (categoriesView) categoriesView.style.display = 'none';
        if (serverView) serverView.style.display = 'none';
        if (settingsView) settingsView.style.display = 'none';
        if (tickerSberView) tickerSberView.style.display = 'none';
        if (tickerCnymView) tickerCnymView.style.display = 'none';
        if (tickerLqdtView) tickerLqdtView.style.display = 'none';
        if (tickerRuView) tickerRuView.style.display = 'block';

        if (btnTable) btnTable.classList.remove('active');
        if (btnChart) btnChart.classList.remove('active');
        if (btnHistory) btnHistory.classList.remove('active');
        if (btnTransactions) btnTransactions.classList.remove('active');
        if (btnCategories) btnCategories.classList.remove('active');

        loadTickerDebug('RU000A105SG2', 'ticker-ru-content', 'BOND');
    } else if (viewType === 'ticker-cnym') {
        tableView.style.display = 'none';
        chartView.style.display = 'none';
        historyView.style.display = 'none';
        transactionsView.style.display = 'none';
        if (categoriesView) categoriesView.style.display = 'none';
        if (serverView) serverView.style.display = 'none';
        if (settingsView) settingsView.style.display = 'none';
        if (tickerSberView) tickerSberView.style.display = 'none';
        if (tickerRuView) tickerRuView.style.display = 'none';
        if (tickerLqdtView) tickerLqdtView.style.display = 'none';
        if (tickerCnymView) tickerCnymView.style.display = 'block';

        if (btnTable) btnTable.classList.remove('active');
        if (btnChart) btnChart.classList.remove('active');
        if (btnHistory) btnHistory.classList.remove('active');
        if (btnTransactions) btnTransactions.classList.remove('active');
        if (btnCategories) btnCategories.classList.remove('active');

        loadTickerDebug('CNYM', 'ticker-cnym-content', 'STOCK');
    } else if (viewType === 'ticker-lqdt') {
        tableView.style.display = 'none';
        chartView.style.display = 'none';
        historyView.style.display = 'none';
        transactionsView.style.display = 'none';
        if (categoriesView) categoriesView.style.display = 'none';
        if (serverView) serverView.style.display = 'none';
        if (tickerSberView) tickerSberView.style.display = 'none';
        if (tickerRuView) tickerRuView.style.display = 'none';
        if (tickerCnymView) tickerCnymView.style.display = 'none';
        if (tickerLqdtView) tickerLqdtView.style.display = 'block';

        if (btnTable) btnTable.classList.remove('active');
        if (btnChart) btnChart.classList.remove('active');
        if (btnHistory) btnHistory.classList.remove('active');
        if (btnTransactions) btnTransactions.classList.remove('active');
        if (btnCategories) btnCategories.classList.remove('active');

        loadTickerDebug('LQDT', 'ticker-lqdt-content', 'STOCK');
    } else if (viewType === 'settings') {
        tableView.style.display = 'none';
        chartView.style.display = 'none';
        historyView.style.display = 'none';
        transactionsView.style.display = 'none';
        if (categoriesView) categoriesView.style.display = 'none';
        if (serverView) serverView.style.display = 'none';
        if (tickerSberView) tickerSberView.style.display = 'none';
        if (tickerRuView) tickerRuView.style.display = 'none';
        if (tickerCnymView) tickerCnymView.style.display = 'none';
        if (tickerLqdtView) tickerLqdtView.style.display = 'none';
        if (settingsView) settingsView.style.display = 'block';

        if (btnTable) btnTable.classList.remove('active');
        if (btnChart) btnChart.classList.remove('active');
        if (btnHistory) btnHistory.classList.remove('active');
        if (btnTransactions) btnTransactions.classList.remove('active');
        if (btnCategories) btnCategories.classList.remove('active');

        // Загружаем текущее время логирования при открытии настроек
        loadLoggingSettings();
    }

    // После переключения представления пересчитываем высоту прокручиваемых блоков,
    // чтобы нижняя граница сразу соответствовала окну
    setupPortfolioTableHeight();
}

/**
 * Преобразовать массив объектов (MOEX securities/marketdata) в HTML-таблицу
 */
function renderRawTable(arr, title) {
    if (!arr || !Array.isArray(arr) || arr.length === 0) {
        return `<div class="ticker-raw-section"><h4>${title}</h4><p>Нет данных</p></div>`;
    }
    const first = arr[0];
    const keys = typeof first === 'object' && first !== null ? Object.keys(first) : [];
    let html = `<div class="ticker-raw-section"><h4>${title}</h4><div class="ticker-raw-table-wrap"><table class="ticker-raw-table"><thead><tr>`;
    keys.forEach(k => { html += `<th>${escapeHtml(String(k))}</th>`; });
    html += '</tr></thead><tbody>';
    arr.forEach(row => {
        html += '<tr>';
        keys.forEach(k => {
            const v = row && row[k];
            const str = v === null || v === undefined ? '' : String(v);
            html += `<td>${escapeHtml(str)}</td>`;
        });
        html += '</tr>';
    });
    html += '</tbody></table></div></div>';
    return html;
}

function escapeHtml(s) {
    const div = document.createElement('div');
    div.textContent = s;
    return div.innerHTML;
}

/**
 * Загрузка и отображение полных данных по конкретному тикеру.
 * Для CNYM и LQDT дополнительно запрашивает сырые MARKETDATA и SECURITIES и выводит их таблицами.
 */
async function loadTickerDebug(ticker, containerId, instrumentType) {
    const container = document.getElementById(containerId);
    if (!container) return;

    const isExtended = (containerId === 'ticker-cnym-content' || containerId === 'ticker-lqdt-content');
    container.textContent = `Загрузка данных по ${ticker}...`;

    try {
        const params = instrumentType ? `?instrument_type=${encodeURIComponent(instrumentType)}` : '';
        if (isExtended) {
            const [infoRes, rawRes] = await Promise.all([
                fetch(`/api/ticker-info/${encodeURIComponent(ticker)}${params}`),
                fetch(`/api/ticker-raw/${encodeURIComponent(ticker)}${params}`)
            ]);
            const info = await infoRes.json();
            const raw = await rawRes.json();

            if (!info || info.success === false) {
                container.textContent = `Ошибка: ${info && info.error ? info.error : 'нет данных'}`;
                return;
            }

            let html = '<div class="ticker-debug-extended">';
            html += '<div class="ticker-raw-section"><h4>Сводка (ticker-info)</h4>';
            html += '<pre class="ticker-raw-content">' + escapeHtml(JSON.stringify(info, null, 2)) + '</pre></div>';

            if (raw && raw.success) {
                html += renderRawTable(raw.securities, 'SECURITIES');
                html += renderRawTable(raw.marketdata, 'MARKETDATA');
                if (raw.marketdata_yields && raw.marketdata_yields.length) {
                    html += renderRawTable(raw.marketdata_yields, 'MARKETDATA_YIELDS');
                }
                if (raw.inav_marketdata && raw.inav_marketdata.length) {
                    html += renderRawTable(raw.inav_marketdata, 'iNAV (LQDTM) MARKETDATA');
                }
            } else {
                html += '<div class="ticker-raw-section"><h4>SECURITIES / MARKETDATA</h4><p>Не удалось загрузить сырые данные</p></div>';
            }
            html += '</div>';
            container.innerHTML = html;
        } else {
            const response = await fetch(`/api/ticker-info/${encodeURIComponent(ticker)}${params}`);
            const data = await response.json();

            if (!data || data.success === false) {
                container.textContent = `Ошибка загрузки данных по ${ticker}: ${data && data.error ? data.error : 'нет данных'}`;
                return;
            }

            const prettyJson = JSON.stringify(data, null, 2);
            container.innerHTML = `<pre class="ticker-raw-content">${escapeHtml(prettyJson)}</pre>`;
        }
    } catch (error) {
        console.error('Ошибка загрузки данных по тикеру:', error);
        container.textContent = `Ошибка загрузки данных по ${ticker}`;
    }
}

/**
 * Загрузка и отображение мониторинга сервера
 */
async function loadServerStatus() {
    const container = document.getElementById('server-status-content');
    if (!container) return;

    container.textContent = 'Загрузка данных о сервере...';

    try {
        const response = await fetch('/api/server-status');
        if (!response.ok) {
            throw new Error(`HTTP ${response.status}`);
        }
        const data = await response.json();
        if (!data.success) {
            throw new Error(data.error || 'Не удалось получить данные');
        }

        const disk = data.disk || {};
        const app = data.app || {};
        const system = data.system || {};
        const hosting = data.hosting || {};

        let html = '';
        html += '<div class="server-status-grid">';
        html += '<div class="server-status-section">';
        html += '<h4>Диск</h4>';
        html += '<p><strong>Всего:</strong> ' + (disk.total_gb ?? '-') + ' ГБ</p>';
        html += '<p><strong>Использовано:</strong> ' + (disk.used_gb ?? '-') + ' ГБ (' + (disk.used_percent ?? '-') + '%)</p>';
        html += '<p><strong>Свободно:</strong> ' + (disk.free_gb ?? '-') + ' ГБ</p>';
        html += '</div>';

        html += '<div class="server-status-section">';
        html += '<h4>Приложение</h4>';
        html += '<p><strong>Путь:</strong> ' + (app.path ?? '-') + '</p>';
        html += '<p><strong>База данных:</strong> ' + (app.db_path ?? '—') + '</p>';
        html += '<p><strong>Размер БД:</strong> ' + (app.db_size_mb != null ? app.db_size_mb + ' МБ' : '—') + '</p>';
        html += '</div>';

        html += '<div class="server-status-section">';
        html += '<h4>Система</h4>';
        html += '<p><strong>Загрузка CPU:</strong> ' + (system.cpu_percent != null ? system.cpu_percent + '%' : 'требуется psutil') + '</p>';
        html += '<p><strong>Использование RAM:</strong> ' + (system.memory_percent != null ? system.memory_percent + '%' : 'требуется psutil') + '</p>';
        html += '</div>';

        html += '<div class="server-status-section">';
        html += '<h4>Хостинг</h4>';
        if (hosting.date) {
            const d = new Date(hosting.date);
            const human = d.toLocaleDateString('ru-RU');
            const daysLeft = hosting.days_left;
            html += '<p><strong>Окончание аренды:</strong> ' + human + '</p>';
            if (typeof daysLeft === 'number') {
                html += '<p><strong>Осталось дней:</strong> ' + daysLeft + '</p>';
            }
        } else {
            html += '<p><strong>Окончание аренды:</strong> не задано</p>';
        }
        html += '<div style="margin-top:8px;">';
        html += '<label for="hosting-expiration-input" style="font-size:0.85em;color:#555;margin-right:6px;">Изменить дату:</label>';
        html += '<input type="date" id="hosting-expiration-input" style="padding:4px 6px;font-size:0.9em;border-radius:6px;border:1px solid #ccd;">';
        html += '<button type="button" class="btn btn-refresh" style="margin-left:6px;padding:4px 10px;font-size:0.85em;" onclick="saveHostingExpiration()">Сохранить</button>';
        html += '</div>';
        html += '</div>';

        html += '</div>';

        container.innerHTML = html;
        // Устанавливаем значение даты в инпут, если есть
        const hostingInput = document.getElementById('hosting-expiration-input');
        if (hostingInput && hosting.date) {
            hostingInput.value = hosting.date;
        }
    } catch (error) {
        console.error('Ошибка загрузки мониторинга сервера:', error);
        container.textContent = 'Ошибка загрузки данных о сервере';
    }
}

async function saveHostingExpiration() {
    const input = document.getElementById('hosting-expiration-input');
    if (!input) return;
    const value = input.value || null;
    try {
        const resp = await fetch('/api/settings/hosting-expiration', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ date: value }),
        });
        const data = await resp.json();
        if (!resp.ok || !data.success) {
            console.error('Ошибка сохранения даты хостинга:', data.error || resp.status);
            alert('Не удалось сохранить дату окончания хостинга: ' + (data.error || 'ошибка запроса'));
            return;
        }
        await loadServerStatus();
    } catch (error) {
        console.error('Ошибка сохранения даты хостинга:', error);
        alert('Ошибка подключения при сохранении даты хостинга');
    }
}

/**
 * Загрузка и отображение журнала подключений
 */
function toggleTrustedIps() {
    const popup = document.getElementById('trusted-ip-popup');
    if (!popup) return;
    popup.style.display = popup.style.display === 'none' ? 'block' : 'none';
}

document.addEventListener('click', function(e) {
    const wrapper = document.querySelector('.trusted-ip-wrapper');
    const popup = document.getElementById('trusted-ip-popup');
    if (popup && popup.style.display !== 'none' && wrapper && !wrapper.contains(e.target)) {
        popup.style.display = 'none';
    }
});

async function loadAccessLogs() {
    const container = document.getElementById('access-logs-content');
    if (!container) return;

    container.innerHTML = '<p style="color:#7f8c8d;">Загрузка журнала...</p>';

    try {
        const response = await fetch('/api/access-logs?limit=100');
        const data = await response.json();
        if (!data.success) throw new Error(data.error || 'Ошибка');

        const logs = data.logs || [];
        if (logs.length === 0) {
            container.innerHTML = '<p style="color:#7f8c8d;">Журнал пуст</p>';
            return;
        }

        const eventLabels = {
            login_ok:   { text: 'Вход',           cls: 'log-event-ok'    },
            login_fail: { text: 'Неверный пароль', cls: 'log-event-fail'  },
            logout:     { text: 'Выход',           cls: 'log-event-out'   },
            page_open:  { text: 'Открытие',        cls: 'log-event-info'  },
            hard_reset: { text: '💥 Hard Reset',   cls: 'log-event-reset' },
        };

        const fmtMsk = ts => {
            if (!ts) return '—';
            try {
                return new Date(ts).toLocaleString('ru-RU', {
                    timeZone: 'Europe/Moscow',
                    day: '2-digit', month: '2-digit', year: 'numeric',
                    hour: '2-digit', minute: '2-digit', second: '2-digit'
                });
            } catch { return ts; }
        };

        let html = `<p style="color:#7f8c8d;font-size:0.85em;margin-bottom:8px;">Последние ${logs.length} из ${data.total} записей</p>`;
        html += '<div class="access-log-table-wrap"><table class="access-log-table">';
        html += '<thead><tr>'
              + '<th>Дата и время (МСК)</th>'
              + '<th>Пользователь</th>'
              + '<th>Событие</th>'
              + '<th>IP-адрес</th>'
              + '<th>ОС</th>'
              + '<th>Браузер</th>'
              + '</tr></thead><tbody>';

        for (const log of logs) {
            const ev = eventLabels[log.event] || { text: log.event, cls: '' };
            const rowCls = log.event === 'hard_reset' ? ' class="log-row-reset"' : '';
            html += `<tr${rowCls}>`
                  + `<td style="white-space:nowrap">${fmtMsk(log.timestamp)}</td>`
                  + `<td>${log.username || '—'}</td>`
                  + `<td><span class="access-log-badge ${ev.cls}">${ev.text}</span></td>`
                  + `<td style="font-family:monospace">${log.ip_address || '—'}</td>`
                  + `<td>${log.os_info || '—'}</td>`
                  + `<td>${log.browser_info || '—'}</td>`
                  + '</tr>';
        }
        html += '</tbody></table></div>';
        container.innerHTML = html;
        // Растягиваем враппер таблицы на всю доступную высоту
        const wrap = container.querySelector('.access-log-table-wrap');
        if (wrap) wrap.style.flex = '1';
    } catch (err) {
        container.innerHTML = '<p style="color:#e74c3c;">Ошибка загрузки журнала</p>';
        console.error('loadAccessLogs error:', err);
    }
}

/**
 * Обновление диаграммы распределения по категориям
 */
function updateCategoryChart(portfolio) {
    const chartContainer = document.getElementById('category-chart');
    
    if (!chartContainer || portfolio.length === 0) {
        if (chartContainer) {
            chartContainer.innerHTML = '<p style="text-align: center; color: #7f8c8d; padding: 40px;">Нет данных для отображения</p>';
        }
        return;
    }
    
    // Подсчет стоимости по категориям
    const categoryData = {};
    let totalValue = 0;
    
    portfolio.forEach(item => {
        const category = item.category || 'Без категории';
        const value = item.total_cost || 0;
        
        if (!categoryData[category]) {
            categoryData[category] = 0;
        }
        categoryData[category] += value;
        totalValue += value;
    });
    
    // Сортировка категорий по стоимости (по убыванию)
    const sortedCategories = Object.entries(categoryData)
        .sort((a, b) => b[1] - a[1])
        .map(([category, value]) => ({
            category,
            value,
            percentage: totalValue > 0 ? (value / totalValue * 100) : 0
        }));
    
    // Яркая расширенная палитра цветов для категорий
    const colors = [
        '#3498db', '#2ecc71', '#e74c3c', '#f39c12', '#9b59b6',
        '#1abc9c', '#e67e22', '#34495e', '#16a085', '#c0392b',
        '#d35400', '#8e44ad', '#27ae60', '#2980b9', '#f1c40f',
        '#e91e63', '#00bcd4', '#4caf50', '#ff9800', '#9c27b0',
        '#2196f3', '#ff5722', '#009688', '#795548', '#607d8b',
        '#ffc107', '#ff4081', '#3f51b5', '#00acc1', '#8bc34a'
    ];
    
    // Создание HTML для диаграммы
    let chartHTML = '<div class="category-list">';
    
    sortedCategories.forEach((item, index) => {
        const color = colors[index % colors.length];
        chartHTML += `
            <div class="category-item">
                <div class="category-info">
                    <div class="category-color" style="background: ${color};"></div>
                    <div class="category-details">
                        <div class="category-name">${item.category}</div>
                        <div class="category-value">${formatCurrency(item.value)}</div>
                    </div>
                </div>
                <div class="category-bar-container">
                    <div class="category-bar" style="width: ${item.percentage}%; background: ${color};"></div>
                </div>
                <div class="category-percentage">${formatPercent(item.percentage, 2)}</div>
            </div>
        `;
    });
    
    chartHTML += '</div>';
    
    chartContainer.innerHTML = chartHTML;
    
    // Отрисовываем круговую диаграмму для раздела распределения
    renderCategoriesPieChart(portfolio, 'distribution-pie-chart', 'distribution-pie-chart-container');
    
    // Применяем текущий выбор типа диаграммы
    applyChartTypeSelection();
    
    // Обновляем диаграмму видов активов
    updateAssetTypeChart(portfolio);
}

/**
 * Переключение типа диаграммы
 */
function switchChartType(type) {
    currentChartType = type;
    localStorage.setItem('chartType', type);
    
    applyChartTypeSelection();
}

/**
 * Применение выбора типа диаграммы
 */
function applyChartTypeSelection() {
    const pieContainer = document.getElementById('distribution-pie-chart-container');
    const barContainer = document.getElementById('category-chart-container');
    const pieBtn = document.getElementById('chart-toggle-pie');
    const barBtn = document.getElementById('chart-toggle-bar');
    
    if (!pieContainer || !barContainer) return;
    
    if (currentChartType === 'pie') {
        // Показываем круговую диаграмму
        pieContainer.style.display = 'block';
        barContainer.style.display = 'none';
        
        if (pieBtn) pieBtn.classList.add('active');
        if (barBtn) barBtn.classList.remove('active');
    } else {
        // Показываем столбчатую диаграмму
        pieContainer.style.display = 'none';
        barContainer.style.display = 'block';
        
        if (pieBtn) pieBtn.classList.remove('active');
        if (barBtn) barBtn.classList.add('active');
    }
}

/**
 * Обновление диаграммы распределения по видам активов
 */
function updateAssetTypeChart(portfolio) {
    const chartContainer = document.getElementById('asset-type-chart');
    
    if (!chartContainer || portfolio.length === 0) {
        if (chartContainer) {
            chartContainer.innerHTML = '<p style="text-align: center; color: #7f8c8d; padding: 40px;">Нет данных для отображения</p>';
        }
        return;
    }
    
    // Подсчет стоимости по видам активов
    const assetTypeData = {};
    let totalValue = 0;
    
    portfolio.forEach(item => {
        const assetType = item.asset_type || 'Без вида';
        const value = item.total_cost || 0;
        
        if (!assetTypeData[assetType]) {
            assetTypeData[assetType] = 0;
        }
        assetTypeData[assetType] += value;
        totalValue += value;
    });
    
    // Сортировка видов активов по стоимости (по убыванию)
    const sortedAssetTypes = Object.entries(assetTypeData)
        .sort((a, b) => b[1] - a[1])
        .map(([assetType, value]) => ({
            assetType,
            value,
            percentage: totalValue > 0 ? (value / totalValue * 100) : 0
        }));
    
    // Яркая расширенная палитра цветов для видов активов
    const colors = [
        '#3498db', '#2ecc71', '#e74c3c', '#f39c12', '#9b59b6',
        '#1abc9c', '#e67e22', '#34495e', '#16a085', '#c0392b',
        '#d35400', '#8e44ad', '#27ae60', '#2980b9', '#f1c40f',
        '#e91e63', '#00bcd4', '#4caf50', '#ff9800', '#9c27b0',
        '#2196f3', '#ff5722', '#009688', '#795548', '#607d8b',
        '#ffc107', '#ff4081', '#3f51b5', '#00acc1', '#8bc34a'
    ];
    
    // Создание HTML для диаграммы
    let chartHTML = '<div class="category-list">';
    
    sortedAssetTypes.forEach((item, index) => {
        const color = colors[index % colors.length];
        chartHTML += `
            <div class="category-item">
                <div class="category-info">
                    <div class="category-color" style="background: ${color};"></div>
                    <div class="category-details">
                        <div class="category-name">${item.assetType}</div>
                        <div class="category-value">${formatCurrency(item.value)}</div>
                    </div>
                </div>
                <div class="category-bar-container">
                    <div class="category-bar" style="width: ${item.percentage}%; background: ${color};"></div>
                </div>
                <div class="category-percentage">${formatPercent(item.percentage, 2)}</div>
            </div>
        `;
    });
    
    chartHTML += '</div>';
    
    chartContainer.innerHTML = chartHTML;
    
    // Отрисовываем круговую диаграмму для раздела распределения по видам активов
    renderAssetTypesPieChart(portfolio, 'asset-type-pie-chart', 'asset-type-pie-chart-container');
    
    // Применяем текущий выбор типа диаграммы
    applyAssetTypeChartTypeSelection();
}

/**
 * Переключение типа диаграммы видов активов
 */
function switchAssetTypeChartType(type) {
    currentAssetTypeChartType = type;
    localStorage.setItem('assetTypeChartType', type);
    
    applyAssetTypeChartTypeSelection();
}

/**
 * Применение выбора типа диаграммы видов активов
 */
function applyAssetTypeChartTypeSelection() {
    const pieContainer = document.getElementById('asset-type-pie-chart-container');
    const barContainer = document.getElementById('asset-type-chart-container');
    const pieBtn = document.getElementById('asset-type-chart-toggle-pie');
    const barBtn = document.getElementById('asset-type-chart-toggle-bar');
    
    if (!pieContainer || !barContainer) return;
    
    if (currentAssetTypeChartType === 'pie') {
        // Показываем круговую диаграмму
        pieContainer.style.display = 'block';
        barContainer.style.display = 'none';
        
        if (pieBtn) pieBtn.classList.add('active');
        if (barBtn) barBtn.classList.remove('active');
    } else {
        // Показываем столбчатую диаграмму
        pieContainer.style.display = 'none';
        barContainer.style.display = 'block';
        
        if (pieBtn) pieBtn.classList.remove('active');
        if (barBtn) barBtn.classList.add('active');
    }
}

/**
 * Отрисовка круговой диаграммы видов активов
 */
function renderAssetTypesPieChart(portfolio, containerId = 'asset-type-pie-chart', wrapperContainerId = 'asset-type-pie-chart-container') {
    const chartContainer = document.getElementById(containerId);
    const chartContainerWrapper = document.getElementById(wrapperContainerId);
    
    if (!chartContainer || !portfolio || portfolio.length === 0) {
        if (chartContainerWrapper) {
            chartContainerWrapper.style.display = 'none';
        }
        return;
    }
    
    // Подсчет стоимости по видам активов
    const assetTypeData = {};
    let totalValue = 0;
    
    portfolio.forEach(item => {
        const assetType = item.asset_type || 'Без вида';
        // Используем total_cost из бэкенда (уже правильно рассчитан)
        const value = item.total_cost || 0;
        
        if (!assetTypeData[assetType]) {
            assetTypeData[assetType] = 0;
        }
        assetTypeData[assetType] += value;
        totalValue += value;
    });
    
    // Фильтруем пустые виды и сортируем
    const sortedAssetTypes = Object.entries(assetTypeData)
        .filter(([_, value]) => value > 0)
        .sort((a, b) => b[1] - a[1])
        .map(([assetType, value]) => ({
            assetType,
            value,
            percentage: totalValue > 0 ? (value / totalValue * 100) : 0
        }));
    
    if (sortedAssetTypes.length === 0) {
        chartContainerWrapper.style.display = 'none';
        return;
    }
    
    chartContainerWrapper.style.display = 'block';
    
    // Яркая расширенная палитра цветов для видов активов
    const colors = [
        '#3498db', '#2ecc71', '#e74c3c', '#f39c12', '#9b59b6',
        '#1abc9c', '#e67e22', '#34495e', '#16a085', '#c0392b',
        '#d35400', '#8e44ad', '#27ae60', '#2980b9', '#f1c40f',
        '#e91e63', '#00bcd4', '#4caf50', '#ff9800', '#9c27b0',
        '#2196f3', '#ff5722', '#009688', '#795548', '#607d8b',
        '#ffc107', '#ff4081', '#3f51b5', '#00acc1', '#8bc34a'
    ];
    
    // Создание SVG круговой диаграммы
    const size = 300;
    const center = size / 2;
    const radius = size / 2 - 20;
    
    let currentAngle = -90; // Начинаем сверху
    let svgPaths = '';
    
    // Специальная обработка для одного вида (100%)
    if (sortedAssetTypes.length === 1) {
        const color = colors[0];
        // Рисуем полный круг через элемент circle
        const it = sortedAssetTypes[0];
        svgPaths = `<circle cx="${center}" cy="${center}" r="${radius}" fill="${color}" stroke="white" stroke-width="2" class="pie-slice" data-asset-type="${_escapeAttr(it.assetType)}" data-value="${it.value}" data-pct="${it.percentage}"/>`;
    } else {
        sortedAssetTypes.forEach((item, index) => {
            const angle = (item.percentage / 100) * 360;
            const endAngle = currentAngle + angle;
            
            // Преобразование углов в радианы
            const startRad = (currentAngle * Math.PI) / 180;
            const endRad = (endAngle * Math.PI) / 180;
            
            // Вычисление координат дуги
            const x1 = center + radius * Math.cos(startRad);
            const y1 = center + radius * Math.sin(startRad);
            const x2 = center + radius * Math.cos(endRad);
            const y2 = center + radius * Math.sin(endRad);
            
            // Флаг большой дуги (если сектор больше 180 градусов)
            const largeArcFlag = angle > 180 ? 1 : 0;
            
            const color = colors[index % colors.length];
            
            // Создание пути для сектора
            const pathD = [
                `M ${center} ${center}`,  // Перемещение в центр
                `L ${x1} ${y1}`,          // Линия к началу дуги
                `A ${radius} ${radius} 0 ${largeArcFlag} 1 ${x2} ${y2}`, // Дуга
                'Z'                        // Закрытие пути
            ].join(' ');
            
            svgPaths += `<path d="${pathD}" fill="${color}" stroke="white" stroke-width="2" class="pie-slice" data-asset-type="${_escapeAttr(item.assetType)}" data-value="${item.value}" data-pct="${item.percentage}"/>`;
            
            currentAngle = endAngle;
        });
    }
    
    // Создание легенды
    let legendHTML = '<div class="pie-legend">';
    sortedAssetTypes.forEach((item, index) => {
        const color = colors[index % colors.length];
        legendHTML += `
            <div class="pie-legend-item">
                <div class="pie-legend-color" style="background: ${color};"></div>
                <div class="pie-legend-info">
                    <div class="pie-legend-name">${item.assetType}</div>
                    <div class="pie-legend-value">${formatCurrency(item.value)}</div>
                </div>
                <div class="pie-legend-percentage">${formatPercent(item.percentage, 1)}</div>
            </div>
        `;
    });
    legendHTML += '</div>';
    
    // Объединение SVG и легенды
    chartContainer.innerHTML = `
        <div style="display: flex; gap: 30px; align-items: center; justify-content: center; flex-wrap: wrap;">
            <svg width="${size}" height="${size}" viewBox="0 0 ${size} ${size}" style="flex-shrink: 0;">
                ${svgPaths}
            </svg>
            ${legendHTML}
        </div>
    `;
}

/**
 * Отрисовка круговой диаграммы категорий
 * @param {Array} portfolio - данные портфеля
 * @param {string} containerId - ID контейнера для диаграммы (по умолчанию 'categories-pie-chart')
 * @param {string} wrapperContainerId - ID обертки контейнера (по умолчанию 'categories-pie-chart-container')
 */
function renderCategoriesPieChart(portfolio, containerId = 'categories-pie-chart', wrapperContainerId = 'categories-pie-chart-container') {
    const chartContainer = document.getElementById(containerId);
    const chartContainerWrapper = document.getElementById(wrapperContainerId);
    
    if (!chartContainer || !portfolio || portfolio.length === 0) {
        if (chartContainerWrapper) {
            chartContainerWrapper.style.display = 'none';
        }
        return;
    }
    
    // Подсчет стоимости по категориям
    const categoryData = {};
    let totalValue = 0;
    
    portfolio.forEach(item => {
        const category = item.category || 'Без категории';
        // Используем total_cost из бэкенда (уже правильно рассчитан)
        const value = item.total_cost || 0;
        
        if (!categoryData[category]) {
            categoryData[category] = 0;
        }
        categoryData[category] += value;
        totalValue += value;
    });
    
    // Фильтруем пустые категории и сортируем
    const sortedCategories = Object.entries(categoryData)
        .filter(([_, value]) => value > 0)
        .sort((a, b) => b[1] - a[1])
        .map(([category, value]) => ({
            category,
            value,
            percentage: totalValue > 0 ? (value / totalValue * 100) : 0
        }));
    
    if (sortedCategories.length === 0) {
        chartContainerWrapper.style.display = 'none';
        return;
    }
    
    chartContainerWrapper.style.display = 'block';
    
    // Яркая расширенная палитра цветов для категорий
    const colors = [
        '#3498db', '#2ecc71', '#e74c3c', '#f39c12', '#9b59b6',
        '#1abc9c', '#e67e22', '#34495e', '#16a085', '#c0392b',
        '#d35400', '#8e44ad', '#27ae60', '#2980b9', '#f1c40f',
        '#e91e63', '#00bcd4', '#4caf50', '#ff9800', '#9c27b0',
        '#2196f3', '#ff5722', '#009688', '#795548', '#607d8b',
        '#ffc107', '#ff4081', '#3f51b5', '#00acc1', '#8bc34a'
    ];
    
    // Создание SVG круговой диаграммы
    const size = 300;
    const center = size / 2;
    const radius = size / 2 - 20;
    
    let currentAngle = -90; // Начинаем сверху
    let svgPaths = '';
    
    // Специальная обработка для одной категории (100%)
    if (sortedCategories.length === 1) {
        const color = colors[0];
        // Рисуем полный круг через элемент circle
        const it = sortedCategories[0];
        svgPaths = `<circle cx="${center}" cy="${center}" r="${radius}" fill="${color}" stroke="white" stroke-width="2" class="pie-slice" data-category="${_escapeAttr(it.category)}" data-value="${it.value}" data-pct="${it.percentage}"/>`;
    } else {
        sortedCategories.forEach((item, index) => {
            const angle = (item.percentage / 100) * 360;
            const endAngle = currentAngle + angle;
            
            // Преобразование углов в радианы
            const startRad = (currentAngle * Math.PI) / 180;
            const endRad = (endAngle * Math.PI) / 180;
            
            // Вычисление координат дуги
            const x1 = center + radius * Math.cos(startRad);
            const y1 = center + radius * Math.sin(startRad);
            const x2 = center + radius * Math.cos(endRad);
            const y2 = center + radius * Math.sin(endRad);
            
            // Флаг большой дуги (если сектор больше 180 градусов)
            const largeArcFlag = angle > 180 ? 1 : 0;
            
            const color = colors[index % colors.length];
            
            // Создание пути для сектора
            const pathD = [
                `M ${center} ${center}`,  // Перемещение в центр
                `L ${x1} ${y1}`,          // Линия к началу дуги
                `A ${radius} ${radius} 0 ${largeArcFlag} 1 ${x2} ${y2}`, // Дуга
                'Z'                        // Закрытие пути
            ].join(' ');
            
            svgPaths += `<path d="${pathD}" fill="${color}" stroke="white" stroke-width="2" class="pie-slice" data-category="${_escapeAttr(item.category)}" data-value="${item.value}" data-pct="${item.percentage}"/>`;
            
            currentAngle = endAngle;
        });
    }
    
    // Создание легенды
    let legendHTML = '<div class="pie-chart-legend">';
    sortedCategories.forEach((item, index) => {
        const color = colors[index % colors.length];
        legendHTML += `
            <div class="pie-legend-item">
                <div class="pie-legend-color" style="background: ${color};"></div>
                <div class="pie-legend-details">
                    <div class="pie-legend-name">${item.category}</div>
                    <div class="pie-legend-value">${formatCurrency(item.value)}</div>
                </div>
                <div class="pie-legend-percentage">${formatPercent(item.percentage, 1)}</div>
            </div>
        `;
    });
    legendHTML += '</div>';
    
    // Собираем итоговый HTML
    const chartHTML = `
        <svg class="pie-chart-svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">
            ${svgPaths}
        </svg>
        ${legendHTML}
    `;
    
    chartContainer.innerHTML = chartHTML;
}

/**
 * Загрузка истории цен
 */
async function loadPriceHistory() {
    const tickerFilter = document.getElementById('history-ticker-filter');
    const dateFromFilter = document.getElementById('history-date-from');
    const dateToFilter = document.getElementById('history-date-to');
    const contentContainer = document.getElementById('price-history-content');
    
    if (!contentContainer) return;
    
    const ticker = tickerFilter ? tickerFilter.value : '';
    const dateFrom = dateFromFilter ? dateFromFilter.value : '';
    const dateTo = dateToFilter ? dateToFilter.value : '';
    
    try {
        contentContainer.innerHTML = '<p style="text-align: center; padding: 40px;">Загрузка истории...</p>';
        
        // Строим URL с параметрами
        let url = '/api/price-history?';
        if (ticker) url += `ticker=${ticker}&`;
        if (dateFrom) url += `date_from=${dateFrom}&`;
        if (dateTo) url += `date_to=${dateTo}&`;
        
        // Если даты не указаны, показываем последние 30 дней
        if (!dateFrom && !dateTo) {
            url += 'days=30';
        }
        
        const response = await fetch(url);
        const data = await response.json();
        
        if (data.success) {
            renderPriceHistory(data.history, ticker);
        } else {
            contentContainer.innerHTML = `<p style="text-align: center; color: #e74c3c; padding: 40px;">Ошибка: ${data.error}</p>`;
        }
    } catch (error) {
        console.error('Ошибка загрузки истории:', error);
        contentContainer.innerHTML = '<p style="text-align: center; color: #e74c3c; padding: 40px;">Не удалось загрузить историю цен</p>';
    }
}

/**
 * Отрисовка истории цен
 */
function renderPriceHistory(history, ticker) {
    const contentContainer = document.getElementById('price-history-content');
    
    if (!contentContainer) return;
    
    if (ticker) {
        // Показываем историю для конкретного тикера
        renderTickerHistory(history, ticker);
    } else {
        // Показываем историю всех тикеров, сгруппированную по датам
        renderGroupedHistory(history);
    }
}

/**
 * Отрисовка истории для конкретного тикера
 */
function renderTickerHistory(history, ticker) {
    const contentContainer = document.getElementById('price-history-content');
    
    if (!history || history.length === 0) {
        contentContainer.innerHTML = `
            <div class="no-history-message">
                <p>📊 История цен для ${ticker} пока не записана</p>
                <p>Цены будут автоматически логироваться каждый день в 00:00 МСК</p>
                <p>Вы также можете нажать кнопку "📝 Записать цены сейчас"</p>
            </div>
        `;
        return;
    }
    
    let html = `<table class="history-table">
        <thead>
            <tr>
                <th>Дата и время</th>
                <th>Цена</th>
            </tr>
        </thead>
        <tbody>`;
    
    history.forEach(item => {
        html += `
            <tr>
                <td>${item.logged_at}</td>
                <td class="price-cell">${formatHistoryPrice(item)}</td>
            </tr>
        `;
    });
    
    html += '</tbody></table>';
    contentContainer.innerHTML = html;
}

/**
 * Отрисовка сгруппированной истории (все тикеры по датам)
 */
function renderGroupedHistory(groupedHistory) {
    const contentContainer = document.getElementById('price-history-content');
    
    if (!groupedHistory || Object.keys(groupedHistory).length === 0) {
        contentContainer.innerHTML = `
            <div class="no-history-message">
                <p>📊 История цен пока не записана</p>
                <p>Цены будут автоматически логироваться каждый день в 00:00 МСК</p>
                <p>Вы также можете нажать кнопку "📝 Записать цены сейчас"</p>
            </div>
        `;
        return;
    }
    
    // Создаем массив всех записей для сортировки
    let allItems = [];
    Object.keys(groupedHistory).forEach(date => {
        groupedHistory[date].forEach(item => {
            allItems.push(item);
        });
    });
    
    // Сортируем по дате (от новых к старым)
    allItems.sort((a, b) => new Date(b.logged_at) - new Date(a.logged_at));
    
    // Создаем таблицу
    let html = `
        <table class="history-table">
            <thead>
                <tr>
                    <th>Дата и время</th>
                    <th>Тикер</th>
                    <th>Компания</th>
                    <th>Цена</th>
                </tr>
            </thead>
            <tbody>`;
    
    allItems.forEach(item => {
        html += `
            <tr>
                <td>${item.logged_at}</td>
                <td><strong>${item.ticker}</strong></td>
                <td>${item.company_name || '-'}</td>
                <td class="price-cell"><strong>${formatHistoryPrice(item)}</strong></td>
            </tr>
        `;
    });
    
    html += '</tbody></table>';
    
    contentContainer.innerHTML = html;
}

/**
 * Форматирование даты
 */
function formatDate(dateString) {
    const date = new Date(dateString);
    const today = new Date();
    const yesterday = new Date(today);
    yesterday.setDate(yesterday.getDate() - 1);
    
    if (date.toDateString() === today.toDateString()) {
        return '📅 Сегодня, ' + date.toLocaleDateString('ru-RU', { day: 'numeric', month: 'long', year: 'numeric' });
    } else if (date.toDateString() === yesterday.toDateString()) {
        return '📅 Вчера, ' + date.toLocaleDateString('ru-RU', { day: 'numeric', month: 'long', year: 'numeric' });
    } else {
        return '📅 ' + date.toLocaleDateString('ru-RU', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
    }
}

/**
 * Обновление фильтра тикеров — использует уже загруженные данные портфеля
 */
function updateHistoryTickerFilter() {
    const tickerFilter = document.getElementById('history-ticker-filter');
    if (!tickerFilter) return;

    const portfolio = currentPortfolioData && currentPortfolioData.portfolio;
    if (!portfolio || portfolio.length === 0) return;

    const uniqueTickers = [...new Set(portfolio.map(item => item.ticker))].sort();
    const currentValue = tickerFilter.value;

    tickerFilter.innerHTML = '<option value="">Все тикеры</option>';
    uniqueTickers.forEach(ticker => {
        const option = document.createElement('option');
        option.value = ticker;
        option.textContent = ticker;
        tickerFilter.appendChild(option);
    });

    tickerFilter.value = currentValue;
}

/**
 * Ручное логирование цен
 */
async function logPricesNow() {
    const btn = document.getElementById('manual-log-btn');
    if (!btn) return;
    
    const originalHTML = btn.innerHTML;
    btn.disabled = true;
    btn.innerHTML = `${SVG_PENCIL} Логирование...`;

    try {
        const response = await fetch('/api/log-prices-now', {
            method: 'POST'
        });
        const data = await response.json();

        if (data.success) {
            btn.innerHTML = `${SVG_PENCIL} Готово!`;
            setTimeout(() => {
                loadPriceHistory();
                loadPortfolio();
                btn.innerHTML = originalHTML;
                btn.disabled = false;
            }, 1000);
        } else {
            btn.innerHTML = `${SVG_PENCIL} Ошибка`;
            console.error('Ошибка логирования цен:', data.error);
            setTimeout(() => {
                btn.innerHTML = originalHTML;
                btn.disabled = false;
            }, 2000);
        }
    } catch (error) {
        console.error('Ошибка логирования:', error);
        btn.innerHTML = `${SVG_PENCIL} Ошибка`;
        setTimeout(() => {
            btn.innerHTML = originalHTML;
            btn.disabled = false;
        }, 2000);
    }
}

/**
 * Сброс фильтров истории цен
 */
function resetHistoryFilters() {
    const tickerFilter = document.getElementById('history-ticker-filter');
    const dateFromFilter = document.getElementById('history-date-from');
    const dateToFilter = document.getElementById('history-date-to');
    
    if (tickerFilter) tickerFilter.value = '';
    if (dateFromFilter) dateFromFilter.value = '';
    if (dateToFilter) dateToFilter.value = '';
    
    loadPriceHistory();
}

// Добавляем обработчики событий для фильтров истории
document.addEventListener('DOMContentLoaded', function() {
    const tickerFilter = document.getElementById('history-ticker-filter');
    const dateFromFilter = document.getElementById('history-date-from');
    const dateToFilter = document.getElementById('history-date-to');
    const resetFiltersBtn = document.getElementById('history-reset-filters');
    const manualLogBtn = document.getElementById('manual-log-btn');
    
    if (tickerFilter) {
        tickerFilter.addEventListener('change', loadPriceHistory);
    }
    
    if (dateFromFilter) {
        dateFromFilter.addEventListener('change', loadPriceHistory);
    }
    
    if (dateToFilter) {
        dateToFilter.addEventListener('change', loadPriceHistory);
    }
    
    if (resetFiltersBtn) {
        resetFiltersBtn.addEventListener('click', resetHistoryFilters);
    }
    
    if (manualLogBtn) {
        manualLogBtn.addEventListener('click', logPricesNow);
    }
    
    // Обработчики для формы продажи
    const sellForm = document.getElementById('sell-form');
    if (sellForm) {
        sellForm.addEventListener('submit', handleSell);
        // Автоматический расчет суммы продажи
        const priceInput = document.getElementById('sell-price');
        const quantityInput = document.getElementById('sell-quantity');
        const totalInput = document.getElementById('sell-total');
        
        if (priceInput && quantityInput && totalInput) {
            const calculateTotal = () => {
                const price = parseFloat(priceInput.value) || 0;
                const quantity = parseFloat(quantityInput.value) || 0;
                totalInput.value = (price * quantity).toFixed(2);
            };
            priceInput.addEventListener('input', calculateTotal);
            quantityInput.addEventListener('input', calculateTotal);
        }
    }
    
    const editTransactionForm = document.getElementById('edit-transaction-form');
    if (editTransactionForm) {
        editTransactionForm.addEventListener('submit', handleEditTransaction);
        // Автоматический расчет суммы
        const priceInput = document.getElementById('trans-edit-price');
        const quantityInput = document.getElementById('trans-edit-quantity');
        const totalInput = document.getElementById('trans-edit-total');
        
        if (priceInput && quantityInput && totalInput) {
            const calculateTotal = () => {
                const price = parseFloat(priceInput.value) || 0;
                const quantity = parseFloat(quantityInput.value) || 0;
                totalInput.value = (price * quantity).toFixed(2);
            };
            priceInput.addEventListener('input', calculateTotal);
            quantityInput.addEventListener('input', calculateTotal);
        }
    }
    
    // Фильтры транзакций
    const transTickerFilter = document.getElementById('trans-ticker-filter');
    const transTypeFilter = document.getElementById('trans-type-filter');
    const transDateFrom = document.getElementById('trans-date-from');
    const transDateTo = document.getElementById('trans-date-to');
    const transResetBtn = document.getElementById('trans-reset-filters');
    
    if (transTickerFilter) {
        transTickerFilter.addEventListener('change', loadTransactions);
    }
    if (transTypeFilter) {
        transTypeFilter.addEventListener('change', loadTransactions);
    }
    if (transDateFrom) {
        transDateFrom.addEventListener('change', loadTransactions);
    }
    if (transDateTo) {
        transDateTo.addEventListener('change', loadTransactions);
    }
    if (transResetBtn) {
        transResetBtn.addEventListener('click', resetTransactionFilters);
    }
    
    // Установка текущей даты и времени по умолчанию
    const transAddDate = document.getElementById('trans-add-date');
    if (transAddDate) {
        const now = new Date();
        now.setMinutes(now.getMinutes() - now.getTimezoneOffset());
        transAddDate.value = now.toISOString().slice(0, 16);
    }
    
    // Обработчик фильтра по типу инструмента в портфеле
    const portfolioTypeFilter = document.getElementById('portfolio-type-filter');
    if (portfolioTypeFilter) {
        // Восстанавливаем сохранённое значение типа, если есть
        const savedType = localStorage.getItem('portfolioFilterType') || '';
        if (savedType) {
            portfolioTypeFilter.value = savedType;
        }
        portfolioTypeFilter.addEventListener('change', function() {
            localStorage.setItem('portfolioFilterType', portfolioTypeFilter.value || '');
            // Перерисовываем портфель с учетом фильтра
            if (currentPortfolioData) {
                displayPortfolio(currentPortfolioData.portfolio, currentPortfolioData.summary);
                applyColumnVisibility();
            }
            // Перерисовываем аналитику, если она открыта
            refreshAnalyticsCharts();
        });
    }
    const portfolioCategoryFilter = document.getElementById('portfolio-category-filter');
    if (portfolioCategoryFilter) {
        // Восстанавливаем сохранённое значение категории, если есть
        const savedCategory = localStorage.getItem('portfolioFilterCategory') || '';
        if (savedCategory) {
            portfolioCategoryFilter.value = savedCategory;
        }
        portfolioCategoryFilter.addEventListener('change', function() {
            localStorage.setItem('portfolioFilterCategory', portfolioCategoryFilter.value || '');
            if (currentPortfolioData) {
                displayPortfolio(currentPortfolioData.portfolio, currentPortfolioData.summary);
                applyColumnVisibility();
            }
            refreshAnalyticsCharts();
        });
    }
    _setupPieChartTooltip();
});

/**
 * ==========================================
 * ФУНКЦИИ ДЛЯ РАБОТЫ С ТРАНЗАКЦИЯМИ
 * ==========================================
 */

/**
 * Загрузка транзакций с фильтрацией
 */
async function loadTransactions() {
    const tbody = document.getElementById('transactions-tbody');
    const noTransactionsMsg = document.getElementById('no-transactions');
    const table = document.getElementById('transactions-table');
    
    if (!tbody) return;
    
    try {
        // Получаем значения фильтров
        const ticker = document.getElementById('trans-ticker-filter')?.value || '';
        const operationType = document.getElementById('trans-type-filter')?.value || '';
        const dateFrom = document.getElementById('trans-date-from')?.value || '';
        const dateTo = document.getElementById('trans-date-to')?.value || '';
        
        // Формируем URL с параметрами
        let url = '/api/transactions?';
        if (ticker) url += `ticker=${ticker}&`;
        if (operationType) url += `operation_type=${operationType}&`;
        if (dateFrom) url += `date_from=${dateFrom}&`;
        if (dateTo) url += `date_to=${dateTo}&`;
        
        const response = await fetch(url);
        const data = await response.json();
        
        if (data.success) {
            if (data.transactions.length === 0) {
                table.style.display = 'none';
                noTransactionsMsg.style.display = 'block';
            } else {
                table.style.display = 'table';
                noTransactionsMsg.style.display = 'none';
                renderTransactions(data.transactions);
            }
            
            // Обновляем фильтр тикеров
            updateTransactionTickerFilter();
        } else {
            console.error('Ошибка загрузки транзакций:', data.error);
        }
    } catch (error) {
        console.error('Ошибка загрузки транзакций:', error);
    }
}

/**
 * Отрисовка транзакций в таблице
 */
function renderTransactions(transactions) {
    const tbody = document.getElementById('transactions-tbody');
    if (!tbody) return;
    
    tbody.innerHTML = '';
    
    transactions.forEach(transaction => {
        const row = document.createElement('tr');
        
        // Форматируем дату (без времени)
        const date = new Date(transaction.date);
        const dateStr = date.toLocaleDateString('ru-RU', {
            year: 'numeric',
            month: '2-digit',
            day: '2-digit'
        });
        
        // Определяем класс для типа операции
        const typeClass = transaction.operation_type === 'Покупка' ? 'transaction-type-buy' : 'transaction-type-sell';
        
        row.innerHTML = `
            <td>${dateStr}</td>
            <td><strong>${transaction.ticker}</strong></td>
            <td>${transaction.company_name || '-'}</td>
            <td><span class="${typeClass}">${transaction.operation_type}</span></td>
            <td>${formatCurrency(transaction.price)}</td>
            <td>${formatNumber(transaction.quantity)}</td>
            <td><strong>${formatCurrency(transaction.total)}</strong></td>
            <td>
                <div class="transaction-actions">
                    <button class="btn-edit" onclick="openEditTransactionModal(${transaction.id})" title="Редактировать">${SVG_PENCIL}</button>
                    <button class="btn-danger" onclick="deleteTransaction(${transaction.id})" title="Удалить">${SVG_TRASH}</button>
                </div>
            </td>
        `;
        
        tbody.appendChild(row);
    });
}

/**
 * Обновление фильтра тикеров для транзакций.
 * Использует уже загруженный портфель (currentPortfolioData),
 * чтобы не делать лишний запрос к API — как в истории цен.
 */
function updateTransactionTickerFilter() {
    const tickerFilter = document.getElementById('trans-ticker-filter');
    if (!tickerFilter) return;

    const portfolio = currentPortfolioData && currentPortfolioData.portfolio;
    if (!portfolio || portfolio.length === 0) return;

    const currentValue = tickerFilter.value;
    const uniqueTickers = [...new Set(portfolio.map(item => item.ticker))].sort();

    tickerFilter.innerHTML = '<option value="">Все тикеры</option>';
    uniqueTickers.forEach(ticker => {
        const option = document.createElement('option');
        option.value = ticker;
        option.textContent = ticker;
        tickerFilter.appendChild(option);
    });

    tickerFilter.value = currentValue;
}

/**
 * Сброс фильтров транзакций
 */
function resetTransactionFilters() {
    document.getElementById('trans-ticker-filter').value = '';
    document.getElementById('trans-type-filter').value = '';
    document.getElementById('trans-date-from').value = '';
    document.getElementById('trans-date-to').value = '';
    loadTransactions();
}

/**
 * Открытие модального окна добавления транзакции
 */
function openAddTransactionModal() {
    const modal = document.getElementById('add-transaction-modal');
    if (modal) {
        // Сброс формы
        document.getElementById('add-transaction-form').reset();
        
        // Установка текущей даты и времени
        const now = new Date();
        now.setMinutes(now.getMinutes() - now.getTimezoneOffset());
        document.getElementById('trans-add-date').value = now.toISOString().slice(0, 16);
        
        modal.style.display = 'flex';
    }
}

/**
 * Закрытие модального окна добавления транзакции
 */
function closeAddTransactionModal() {
    const modal = document.getElementById('add-transaction-modal');
    if (modal) {
        modal.style.display = 'none';
    }
}

/**
 * Обработка добавления транзакции
 */
async function handleAddTransaction(event) {
    event.preventDefault();
    
    const formData = {
        date: document.getElementById('trans-add-date').value,
        ticker: document.getElementById('trans-add-ticker').value.toUpperCase(),
        company_name: document.getElementById('trans-add-company').value,
        operation_type: document.getElementById('trans-add-type').value,
        price: parseFloat(document.getElementById('trans-add-price').value),
        quantity: parseFloat(document.getElementById('trans-add-quantity').value),
        instrument_type: document.getElementById('trans-add-instrument-type').value,
        notes: document.getElementById('trans-add-notes').value
    };
    
    try {
        const response = await fetch('/api/transactions', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify(formData)
        });
        
        const data = await response.json();
        
        if (data.success) {
            closeAddTransactionModal();
            loadTransactions();
            console.log('Транзакция успешно добавлена');
        } else {
            console.error('Ошибка добавления транзакции:', data.error);
        }
    } catch (error) {
        console.error('Ошибка добавления транзакции:', error);
    }
}

/**
 * Открытие модального окна редактирования транзакции
 */
async function openEditTransactionModal(transactionId) {
    try {
        const response = await fetch(`/api/transactions?`);
        const data = await response.json();
        
        if (data.success) {
            const transaction = data.transactions.find(t => t.id === transactionId);
            
            if (transaction) {
                document.getElementById('trans-edit-id').value = transaction.id;
                
                // Конвертируем дату в формат datetime-local
                const date = new Date(transaction.date);
                date.setMinutes(date.getMinutes() - date.getTimezoneOffset());
                document.getElementById('trans-edit-date').value = date.toISOString().slice(0, 16);
                
                document.getElementById('trans-edit-ticker').value = transaction.ticker;
                document.getElementById('trans-edit-company').value = transaction.company_name || '';
                document.getElementById('trans-edit-type').value = transaction.operation_type;
                document.getElementById('trans-edit-price').value = transaction.price;
                document.getElementById('trans-edit-quantity').value = transaction.quantity;
                document.getElementById('trans-edit-total').value = transaction.total;
                document.getElementById('trans-edit-notes').value = '';
                
                document.getElementById('edit-transaction-modal').style.display = 'flex';
            }
        }
    } catch (error) {
        console.error('Ошибка открытия формы редактирования:', error);
    }
}

/**
 * Закрытие модального окна редактирования транзакции
 */
function closeEditTransactionModal() {
    const modal = document.getElementById('edit-transaction-modal');
    if (modal) {
        modal.style.display = 'none';
    }
}

/**
 * Обработка редактирования транзакции
 */
async function handleEditTransaction(event) {
    event.preventDefault();
    
    const transactionId = document.getElementById('trans-edit-id').value;
    
    const formData = {
        date: document.getElementById('trans-edit-date').value,
        ticker: document.getElementById('trans-edit-ticker').value.toUpperCase(),
        company_name: document.getElementById('trans-edit-company').value,
        operation_type: document.getElementById('trans-edit-type').value,
        price: parseFloat(document.getElementById('trans-edit-price').value),
        quantity: parseFloat(document.getElementById('trans-edit-quantity').value),
        notes: document.getElementById('trans-edit-notes').value
    };
    
    try {
        const response = await fetch(`/api/transactions/${transactionId}`, {
            method: 'PUT',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify(formData)
        });
        
        const data = await response.json();
        
        if (data.success) {
            closeEditTransactionModal();
            loadTransactions();
            console.log('Транзакция успешно обновлена');
            
            // Обновляем портфель, так как редактирование транзакции влияет на количество и среднюю цену
            const tableView = document.getElementById('table-view');
            if (tableView && tableView.style.display !== 'none') {
                await loadPortfolio(true, true);
            }
        } else {
            console.error('Ошибка обновления транзакции:', data.error);
        }
    } catch (error) {
        console.error('Ошибка обновления транзакции:', error);
    }
}

/**
 * Удаление транзакции
 */
async function deleteTransaction(transactionId) {
    if (!confirm('Удалить эту операцию? Действие нельзя отменить.')) return;

    try {
        const response = await fetch(`/api/transactions/${transactionId}`, {
            method: 'DELETE'
        });
        
        const data = await response.json();
        
        if (data.success) {
            // Обновляем список транзакций
            loadTransactions();
            console.log('Транзакция успешно удалена');

            // Перезагружаем портфель (тихо, с кэшированными ценами) —
            // это обновит currentPortfolioData и сводку независимо от активной вкладки
            await loadPortfolio(true, true);

            // Если открыта вкладка портфеля — показываем актуальную таблицу
            const tableView = document.getElementById('table-view');
            if (tableView && tableView.style.display !== 'none') {
                await loadPortfolio(false, false);
            }
        } else {
            console.error('Ошибка удаления транзакции:', data.error);
        }
    } catch (error) {
        console.error('Ошибка удаления транзакции:', error);
    }
}

/**
 * ==========================================
 * ФУНКЦИИ ДЛЯ ПРОДАЖИ АКЦИЙ
 * ==========================================
 */

/**
 * Открытие модального окна продажи
 */
function openSellModal(portfolioId, ticker, companyName, availableQuantity, availableLots, lotsize, currentPrice) {
    const modal = document.getElementById('sell-modal');
    if (!modal) return;
    
    // Заполняем скрытые поля
    document.getElementById('sell-portfolio-id').value = portfolioId;
    document.getElementById('sell-ticker').value = ticker;
    document.getElementById('sell-company-name').value = companyName;
    document.getElementById('sell-lotsize').value = lotsize;
    document.getElementById('sell-available-quantity').value = availableQuantity;
    
    // Заполняем видимые поля
    document.getElementById('sell-ticker-display').value = ticker;
    document.getElementById('sell-company-display').value = companyName || ticker;
    
    // Показываем доступное количество в лотах и бумагах
    const availableDisplay = document.getElementById('sell-available-display');
    if (lotsize > 1) {
        availableDisplay.value = `${formatNumber(availableLots)} ${availableLots === 1 ? 'лот' : 'лотов'} (${formatNumber(availableQuantity)} ${availableQuantity === 1 ? 'бумага' : 'бумаг'})`;
    } else {
        availableDisplay.value = `${formatNumber(availableQuantity)} ${availableQuantity === 1 ? 'бумага' : 'бумаг'}`;
    }
    
    // Показываем подсказку о размере лота
    const lotsHint = document.getElementById('sell-lots-hint');
    if (lotsHint) {
        if (lotsize > 1) {
            const hasFullLotHint = availableLots >= 1;
            if (hasFullLotHint) {
                lotsHint.textContent = `1 лот = ${lotsize} бумаг · продажа только целыми лотами`;
            } else {
                lotsHint.textContent = `1 лот = ${lotsize} бумаг · остаток менее лота, доступна продажа всего остатка`;
            }
            lotsHint.style.display = 'block';
        } else {
            lotsHint.style.display = 'none';
        }
    }
    
    // Устанавливаем сегодняшнюю дату по умолчанию
    const sellDateInput = document.getElementById('sell-date');
    if (sellDateInput) {
        const today = new Date();
        const year = today.getFullYear();
        const month = String(today.getMonth() + 1).padStart(2, '0');
        const day = String(today.getDate()).padStart(2, '0');
        sellDateInput.value = `${year}-${month}-${day}`;
    }
    
    // Устанавливаем текущую цену как цену продажи по умолчанию
    document.getElementById('sell-price').value = currentPrice.toFixed(5);
    
    // Устанавливаем максимальное количество лотов для продажи
    const lotsInput = document.getElementById('sell-lots');
    lotsInput.max = availableLots;
    lotsInput.value = '';

    // Для инструментов с лотами > 1 — только целые лоты (если хватает на целый лот).
    // Если у позиции остался хвост < 1 лота — разрешаем продать его целиком (дробные лоты).
    const hasFullLot = availableLots >= 1;
    if (lotsize > 1 && hasFullLot) {
        lotsInput.min = '1';
        lotsInput.step = '1';
        lotsInput.max = Math.floor(availableLots);
    } else {
        lotsInput.min = '0.01';
        lotsInput.step = '0.01';
        lotsInput.max = availableLots;
    }
    
    // Очищаем остальные поля
    document.getElementById('sell-total').value = '';
    
    // Показываем модальное окно
    modal.style.display = 'flex';
    
    // Рассчитываем сумму продажи при открытии (если цена уже установлена)
    // Это нужно для случая, когда цена установлена, но пользователь еще не ввел количество
    setTimeout(() => {
        calculateSellTotal();
    }, 100);
}

/**
 * Закрытие модального окна продажи
 */
function closeSellModal() {
    const modal = document.getElementById('sell-modal');
    if (modal) {
        modal.style.display = 'none';
        document.getElementById('sell-form').reset();
    }
}

/**
 * Обработка продажи акций
 */
async function handleSell(e) {
    e.preventDefault();
    
    const portfolioId = parseInt(document.getElementById('sell-portfolio-id').value);
    const ticker = document.getElementById('sell-ticker').value;
    const companyName = document.getElementById('sell-company-name').value;
    const lots = parseFloat(document.getElementById('sell-lots').value);
    const price = parseFloat(document.getElementById('sell-price').value);
    const lotsize = parseFloat(document.getElementById('sell-lotsize').value) || 1;
    const availableQuantity = parseFloat(document.getElementById('sell-available-quantity').value);
    const availableLots = availableQuantity / lotsize;
    const sellDate = document.getElementById('sell-date').value;
    
    // Рассчитываем количество бумаг: лоты * размер лота
    const quantity = lots * lotsize;
    
    // Валидация количества
    if (lots <= 0) {
        alert('Количество лотов должно быть больше 0');
        return;
    }

    // Для инструментов с несколькими бумагами в лоте — только целые лоты.
    // Исключение: если в позиции остался хвост < 1 лота, позволяем продать его целиком.
    if (lotsize > 1 && availableLots >= 1 && !Number.isInteger(lots)) {
        alert(`Для этого инструмента продажа возможна только целым числом лотов.\n1 лот = ${lotsize} бумаг`);
        return;
    }
    
    if (quantity > availableQuantity) {
        alert(`Недостаточно бумаг для продажи. Доступно: ${formatNumber(availableLots)} ${availableLots === 1 ? 'лот' : 'лотов'} (${formatNumber(availableQuantity)} бумаг)`);
        return;
    }
    
    try {
        // 1. Создаём транзакцию продажи
        const now = new Date();
        const timePart = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}:${String(now.getSeconds()).padStart(2, '0')}`;
        const formattedSellDate = `${sellDate} ${timePart}`;
        
        const transactionData = {
            ticker: ticker,
            company_name: companyName,
            operation_type: 'Продажа',
            price: price,
            quantity: quantity, // Сохраняем количество бумаг (лоты * размер лота)
            date: formattedSellDate,
            notes: `Продажа через кнопку портфеля: ${lots} ${lots === 1 ? 'лот' : 'лотов'} (${quantity} ${quantity === 1 ? 'бумага' : 'бумаг'})`
        };
        
        const transResponse = await fetch('/api/transactions', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify(transactionData)
        });
        
        const transData = await transResponse.json();
        
        if (!transData.success) {
            console.error('Ошибка при создании транзакции продажи:', transData.error);
            return;
        }
        
        // Обновляем баланс из ответа сервера
        if (transData.cash_balance !== undefined && currentPortfolioData) {
            currentPortfolioData.summary.cash_balance = transData.cash_balance;
            updateSummary(currentPortfolioData.summary);
        }
        
        // Портфель автоматически пересчитывается при добавлении транзакции.
        // Обновляем только строку в портфеле (или удаляем её, если позиция закрыта).
        
        // Закрываем модальное окно и обновляем данные
        closeSellModal();
        
        // Показываем загрузку на строке портфеля
        setRowLoading(ticker, true);
        await refreshSinglePortfolioPosition(ticker);
        
        // Логируем результат в консоль
        const totalSum = (quantity * price).toFixed(2);
        const formattedPrice = parseFloat(price).toFixed(5);
        const remainingQuantity = availableQuantity - quantity;
        if (remainingQuantity <= 0.001) {
            console.log(`Продажа оформлена. Тикер: ${ticker}, продано: ${quantity} шт. по ${formattedPrice} ₽, сумма: ${totalSum} ₽. Позиция полностью закрыта.`);
        } else {
            console.log(`Продажа оформлена. Тикер: ${ticker}, продано: ${quantity} шт. по ${formattedPrice} ₽, сумма: ${totalSum} ₽. Осталось: ${remainingQuantity.toFixed(2)} шт.`);
        }
        
    } catch (error) {
        console.error('Ошибка продажи:', error);
    }
}

/**
 * ==========================================
 * ФУНКЦИИ ДЛЯ УПРАВЛЕНИЯ КАТЕГОРИЯМИ
 * ==========================================
 */

// Список доступных категорий (загружается из API при инициализации)
let ASSET_TYPES = []; // Список видов активов (загружается из API)

/**
 * Загрузка категорий (данных портфеля для таблицы категорий)
 */
async function loadCategories() {
    const tbody = document.getElementById('categories-tbody');
    const noCategoriesMsg = document.getElementById('no-categories');
    const table = document.getElementById('categories-table');
    
    if (!tbody) return;
    
    // Убеждаемся, что список категорий и видов активов загружены
    if (CATEGORIES.length === 0) {
        await loadCategoriesList();
    }
    if (ASSET_TYPES.length === 0) {
        await loadAssetTypesList();
    }
    
    try {
        const response = await fetch('/api/portfolio');
        const data = await response.json();
        
        if (data.success && data.portfolio) {
            if (data.portfolio.length === 0) {
                table.style.display = 'none';
                noCategoriesMsg.style.display = 'block';
            } else {
                table.style.display = 'table';
                noCategoriesMsg.style.display = 'none';
                
                // Группируем по тикерам (берем первую встретившуюся запись для каждого тикера)
                const uniqueTickers = {};
                data.portfolio.forEach(item => {
                    if (!uniqueTickers[item.ticker]) {
                        uniqueTickers[item.ticker] = item;
                    }
                });
                
                renderCategories(Object.values(uniqueTickers));
            }
        } else {
            console.error('Ошибка загрузки категорий:', data.error);
        }
    } catch (error) {
        console.error('Ошибка загрузки категорий:', error);
    }
}

/**
 * Отрисовка таблицы категорий
 */
function renderCategories(items) {
    const tbody = document.getElementById('categories-tbody');
    if (!tbody) return;
    
    tbody.innerHTML = '';
    
    items.forEach(item => {
        const row = document.createElement('tr');
        
        // Создаем ячейку с select и индикатором сохранения
        const categoryCell = document.createElement('td');
        categoryCell.style.position = 'relative';
        
        // Создаем select с категориями
        const select = document.createElement('select');
        select.className = 'category-select';
        select.id = `cat-select-${item.ticker}`;
        select.dataset.ticker = item.ticker;
        select.dataset.portfolioId = item.id; // Сохраняем ID для быстрого доступа
        
        // Добавляем опцию "Не выбрано"
        const emptyOption = document.createElement('option');
        emptyOption.value = '';
        emptyOption.textContent = 'Не выбрано';
        select.appendChild(emptyOption);
        
        // Добавляем остальные категории
        CATEGORIES.forEach(cat => {
            const option = document.createElement('option');
            option.value = cat;
            option.textContent = cat;
            if (item.category === cat) {
                option.selected = true;
            }
            select.appendChild(option);
        });
        
        // Добавляем обработчик изменения
        select.addEventListener('change', function() {
            updateCategoryForTicker(item.ticker);
        });
        
        // Создаем индикатор сохранения
        const saveIndicator = document.createElement('span');
        saveIndicator.id = `save-indicator-${item.ticker}`;
        saveIndicator.className = 'save-indicator';
        saveIndicator.style.marginLeft = '10px';
        
        categoryCell.appendChild(select);
        categoryCell.appendChild(saveIndicator);
        
        // Создаем ячейку с select для вида актива
        const assetTypeCell = document.createElement('td');
        assetTypeCell.style.position = 'relative';
        
        // Создаем select с видами активов
        const assetTypeSelect = document.createElement('select');
        assetTypeSelect.className = 'asset-type-select';
        assetTypeSelect.id = `asset-type-select-${item.ticker}`;
        assetTypeSelect.dataset.ticker = item.ticker;
        assetTypeSelect.dataset.portfolioId = item.id; // Сохраняем ID для быстрого доступа
        
        // Добавляем опцию "Не выбрано"
        const emptyAssetTypeOption = document.createElement('option');
        emptyAssetTypeOption.value = '';
        emptyAssetTypeOption.textContent = 'Не выбрано';
        assetTypeSelect.appendChild(emptyAssetTypeOption);
        
        // Добавляем остальные виды активов
        ASSET_TYPES.forEach(at => {
            const option = document.createElement('option');
            option.value = at;
            option.textContent = at;
            if (item.asset_type === at) {
                option.selected = true;
            }
            assetTypeSelect.appendChild(option);
        });
        
        // Добавляем обработчик изменения
        assetTypeSelect.addEventListener('change', function() {
            updateAssetTypeForTicker(item.ticker);
        });
        
        // Создаем индикатор сохранения
        const assetTypeSaveIndicator = document.createElement('span');
        assetTypeSaveIndicator.id = `asset-type-save-indicator-${item.ticker}`;
        assetTypeSaveIndicator.className = 'save-indicator';
        assetTypeSaveIndicator.style.marginLeft = '10px';
        
        assetTypeCell.appendChild(assetTypeSelect);
        assetTypeCell.appendChild(assetTypeSaveIndicator);
        
        row.innerHTML = `
            <td><strong>${item.ticker}</strong></td>
            <td>${item.company_name || '-'}</td>
        `;
        row.appendChild(categoryCell);
        row.appendChild(assetTypeCell);
        
        tbody.appendChild(row);
    });
}

/**
 * Обновление вида актива для тикера
 */
async function updateAssetTypeForTicker(ticker) {
    const selectEl = document.getElementById(`asset-type-select-${ticker}`);
    const indicatorEl = document.getElementById(`asset-type-save-indicator-${ticker}`);
    
    if (!selectEl) return;
    
    const assetType = selectEl.value;
    const portfolioId = selectEl.dataset.portfolioId;
    
    // Если ID не найден в data-атрибуте, пытаемся найти в текущих данных портфеля
    let itemId = portfolioId;
    if (!itemId && currentPortfolioData && currentPortfolioData.portfolio) {
        const portfolioItem = currentPortfolioData.portfolio.find(item => item.ticker === ticker);
        if (portfolioItem) {
            itemId = portfolioItem.id;
            // Сохраняем ID в data-атрибут для будущих обновлений
            selectEl.dataset.portfolioId = itemId;
        }
    }
    
    if (!itemId) {
        console.error('Не удалось найти ID позиции портфеля для тикера:', ticker);
        if (indicatorEl) {
            indicatorEl.textContent = '✗';
            indicatorEl.style.color = '#e74c3c';
            setTimeout(() => {
                indicatorEl.textContent = '';
            }, 2000);
        }
        return;
    }
    
    // Показываем индикатор загрузки
    if (indicatorEl) {
        indicatorEl.textContent = '⏳';
        indicatorEl.style.color = '#3498db';
    }
    
    // Блокируем select на время сохранения
    selectEl.disabled = true;
    
    try {
        const updateResponse = await fetch(`/api/portfolio/${itemId}`, {
            method: 'PUT',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                asset_type: assetType
            })
        });
        
        const updateData = await updateResponse.json();
        
        if (updateData.success) {
            // Обновляем локальные данные портфеля без полной перезагрузки
            if (currentPortfolioData && currentPortfolioData.portfolio) {
                const portfolioItem = currentPortfolioData.portfolio.find(item => item.id == itemId);
                if (portfolioItem) {
                    portfolioItem.asset_type = assetType;
                }
            }
            
            // Показываем индикатор успеха
            if (indicatorEl) {
                indicatorEl.textContent = '✓';
                indicatorEl.style.color = '#27ae60';
                setTimeout(() => {
                    indicatorEl.textContent = '';
                }, 2000);
            }
            
            // Обновляем только диаграмму видов активов (без полной перезагрузки портфеля)
            if (currentPortfolioData && currentPortfolioData.portfolio) {
                updateAssetTypeChart(currentPortfolioData.portfolio);
            } else {
                // Если данных нет, делаем легкую загрузку только для диаграммы
                await updateAllAssetTypeViews();
            }
        } else {
            // Показываем индикатор ошибки
            if (indicatorEl) {
                indicatorEl.textContent = '✗';
                indicatorEl.style.color = '#e74c3c';
                setTimeout(() => {
                    indicatorEl.textContent = '';
                }, 2000);
            }
            console.error('Ошибка обновления вида актива:', updateData.error);
        }
    } catch (error) {
        console.error('Ошибка обновления вида актива:', error);
        if (indicatorEl) {
            indicatorEl.textContent = '✗';
            indicatorEl.style.color = '#e74c3c';
            setTimeout(() => {
                indicatorEl.textContent = '';
            }, 2000);
        }
        console.error('Ошибка соединения с сервером при обновлении вида актива');
    } finally {
        selectEl.disabled = false;
    }
}

/**
 * Обновление категории для тикера
 */
async function updateCategoryForTicker(ticker) {
    const selectEl = document.getElementById(`cat-select-${ticker}`);
    const indicatorEl = document.getElementById(`save-indicator-${ticker}`);
    
    if (!selectEl) return;
    
    const category = selectEl.value;
    const portfolioId = selectEl.dataset.portfolioId;
    
    // Если ID не найден в data-атрибуте, пытаемся найти в текущих данных портфеля
    let itemId = portfolioId;
    if (!itemId && currentPortfolioData && currentPortfolioData.portfolio) {
        const portfolioItem = currentPortfolioData.portfolio.find(item => item.ticker === ticker);
        if (portfolioItem) {
            itemId = portfolioItem.id;
            // Сохраняем ID в data-атрибут для будущих обновлений
            selectEl.dataset.portfolioId = itemId;
        }
    }
    
    if (!itemId) {
        console.error('Не удалось найти ID позиции портфеля для тикера:', ticker);
        if (indicatorEl) {
            indicatorEl.textContent = '✗';
            indicatorEl.style.color = '#e74c3c';
            indicatorEl.style.fontWeight = 'bold';
            indicatorEl.style.fontSize = '1.2em';
            setTimeout(() => {
                indicatorEl.textContent = '';
            }, 3000);
        }
        return;
    }
    
    // Показываем индикатор загрузки
    if (indicatorEl) {
        indicatorEl.textContent = '⏳';
        indicatorEl.style.color = '#3498db';
    }
    
    // Блокируем select на время сохранения
    selectEl.disabled = true;
    
    try {
        const updateResponse = await fetch(`/api/portfolio/${itemId}`, {
            method: 'PUT',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                category: category
            })
        });
        
        const updateData = await updateResponse.json();
        
        if (updateData.success) {
            // Обновляем локальные данные портфеля без полной перезагрузки
            if (currentPortfolioData && currentPortfolioData.portfolio) {
                const portfolioItem = currentPortfolioData.portfolio.find(item => item.id == itemId);
                if (portfolioItem) {
                    portfolioItem.category = category;
                }
            }
            
            // Показываем галочку успеха
            if (indicatorEl) {
                indicatorEl.textContent = '✓';
                indicatorEl.style.color = '#27ae60';
                indicatorEl.style.fontWeight = 'bold';
                indicatorEl.style.fontSize = '1.2em';
            }
            
            // Обновляем только диаграмму категорий (без полной перезагрузки портфеля)
            if (currentPortfolioData && currentPortfolioData.portfolio) {
                updateCategoryChart(currentPortfolioData.portfolio);
            } else {
                // Если данных нет, делаем легкую загрузку только для диаграммы
                await updateAllCategoryViews();
            }
            
            // Убираем индикатор через 2 секунды
            setTimeout(() => {
                if (indicatorEl) {
                    indicatorEl.textContent = '';
                }
            }, 2000);
        } else {
            // Показываем ошибку
            if (indicatorEl) {
                indicatorEl.textContent = '✗';
                indicatorEl.style.color = '#e74c3c';
                indicatorEl.style.fontWeight = 'bold';
                indicatorEl.style.fontSize = '1.2em';
            }
            console.error('Ошибка обновления категории:', updateData.error);
            
            // Убираем индикатор ошибки через 3 секунды
            setTimeout(() => {
                if (indicatorEl) {
                    indicatorEl.textContent = '';
                }
            }, 3000);
        }
    } catch (error) {
        console.error('Ошибка обновления категории:', error);
        
        // Показываем ошибку
        if (indicatorEl) {
            indicatorEl.textContent = '⚠';
            indicatorEl.style.color = '#f39c12';
            indicatorEl.style.fontWeight = 'bold';
            indicatorEl.style.fontSize = '1.2em';
        }
        
        // Убираем индикатор через 3 секунды
        setTimeout(() => {
            if (indicatorEl) {
                indicatorEl.textContent = '';
            }
        }, 3000);
    } finally {
        // Разблокируем select
        selectEl.disabled = false;
    }
}

// Закрытие модальных окон только при нажатии ESC (клик вне окна отключен)
document.addEventListener('keydown', function(event) {
    if (event.key === 'Escape') {
        const buyModal = document.getElementById('buy-modal');
        const sellModal = document.getElementById('sell-modal');
        const editModal = document.getElementById('edit-modal');
        const addTransactionModal = document.getElementById('add-transaction-modal');
        const editTransactionModal = document.getElementById('edit-transaction-modal');
        const manageCategoriesModal = document.getElementById('manage-categories-modal');
        const categoryEditModal = document.getElementById('category-edit-modal');
        const assetTypeEditModal = document.getElementById('asset-type-edit-modal');
        const tickerInfoModal = document.getElementById('ticker-info-modal');
        const loggingTimeModal = document.getElementById('logging-time-modal');
        
        if (buyModal && buyModal.style.display === 'flex') {
            closeBuyModal();
        } else if (sellModal && sellModal.style.display === 'flex') {
            closeSellModal();
        } else if (editModal && editModal.style.display === 'flex') {
            closeEditModal();
        } else if (addTransactionModal && addTransactionModal.style.display === 'flex') {
            closeAddTransactionModal();
        } else if (editTransactionModal && editTransactionModal.style.display === 'flex') {
            closeEditTransactionModal();
        } else if (categoryEditModal && categoryEditModal.style.display === 'flex') {
            closeCategoryEditModal();
        } else if (manageCategoriesModal && manageCategoriesModal.style.display === 'flex') {
            closeManageCategoriesModal();
        } else if (assetTypeEditModal && assetTypeEditModal.style.display === 'flex') {
            closeAssetTypeEditModal();
        } else if (tickerInfoModal && tickerInfoModal.style.display === 'flex') {
            closeTickerInfoModal();
        } else if (loggingTimeModal && loggingTimeModal.style.display === 'flex') {
            closeLoggingTimeModal();
        }
    }
});

// ==================== УПРАВЛЕНИЕ КАТЕГОРИЯМИ ====================

/**
 * Загрузка списка категорий из API
 */
async function loadCategoriesList() {
    try {
        const response = await fetch('/api/categories');
        const data = await response.json();
        
        if (data.success) {
            CATEGORIES = data.categories.map(cat => cat.name);
            updateCategorySelects(); // Обновляем все селекты категорий
            return data.categories;
        } else {
            console.error('Ошибка загрузки категорий:', data.error);
            return [];
        }
    } catch (error) {
        console.error('Ошибка загрузки категорий:', error);
        return [];
    }
}

/**
 * Обновление всех селектов категорий на странице
 */
function updateCategorySelects() {
    // Обновляем селект в модальном окне редактирования
    const editCategorySelect = document.getElementById('edit-category');
    if (editCategorySelect) {
        const currentValue = editCategorySelect.value;
        editCategorySelect.innerHTML = '<option value="">Не выбрано</option>';
        CATEGORIES.forEach(cat => {
            const option = document.createElement('option');
            option.value = cat;
            option.textContent = cat;
            if (cat === currentValue) {
                option.selected = true;
            }
            editCategorySelect.appendChild(option);
        });
    }
    
    // Обновляем селекты в таблице категорий
    const categorySelects = document.querySelectorAll('.category-select');
    categorySelects.forEach(select => {
        const currentValue = select.value;
        const ticker = select.dataset.ticker;
        select.innerHTML = '<option value="">Не выбрано</option>';
        CATEGORIES.forEach(cat => {
            const option = document.createElement('option');
            option.value = cat;
            option.textContent = cat;
            if (cat === currentValue) {
                option.selected = true;
            }
            select.appendChild(option);
        });
        select.dataset.ticker = ticker; // Восстанавливаем ticker
    });
}

/**
 * Открытие модального окна управления категориями
 */
async function openManageCategoriesModal() {
    const modal = document.getElementById('manage-categories-modal');
    if (!modal) return;
    
    modal.style.display = 'flex';
    await loadManageCategories();
}

/**
 * Закрытие модального окна управления категориями
 */
function closeManageCategoriesModal() {
    const modal = document.getElementById('manage-categories-modal');
    if (modal) {
        modal.style.display = 'none';
    }
}

/**
 * Загрузка списка категорий в модальное окно
 */
async function loadManageCategories() {
    try {
        const response = await fetch('/api/categories');
        const data = await response.json();
        
        const tbody = document.getElementById('manage-categories-tbody');
        const noDataMessage = document.getElementById('no-categories-manage');
        
        if (!tbody) return;
        
        tbody.innerHTML = '';
        
        if (data.success && data.categories.length > 0) {
            if (noDataMessage) noDataMessage.style.display = 'none';
            
            data.categories.forEach(category => {
                const row = document.createElement('tr');
                row.innerHTML = `
                    <td>${category.name}</td>
                    <td style="white-space: nowrap;">
                        <button class="btn btn-edit" onclick="editCategory(${category.id}, '${category.name.replace(/'/g, "\\'")}')" title="Редактировать" style="margin-right: 5px;">
                            ${SVG_PENCIL}
                        </button>
                        <button class="btn btn-danger" onclick="deleteCategory(${category.id}, '${category.name.replace(/'/g, "\\'")}')" title="Удалить">
                            ${SVG_TRASH}
                        </button>
                    </td>
                `;
                tbody.appendChild(row);
            });
        } else {
            if (noDataMessage) noDataMessage.style.display = 'block';
        }
    } catch (error) {
        console.error('Ошибка загрузки категорий:', error);
    }
}

/**
 * Открытие модального окна для добавления/редактирования категории
 */
function openCategoryEditModal(categoryId = null, categoryName = '') {
    const modal = document.getElementById('category-edit-modal');
    const title = document.getElementById('category-edit-title');
    const form = document.getElementById('category-edit-form');
    const idInput = document.getElementById('category-edit-id');
    const nameInput = document.getElementById('category-edit-name');
    
    if (!modal || !title || !form || !idInput || !nameInput) return;
    
    if (categoryId) {
        title.textContent = '✏️ Редактировать категорию';
        idInput.value = categoryId;
        nameInput.value = categoryName;
    } else {
        title.textContent = '➕ Добавить категорию';
        idInput.value = '';
        nameInput.value = '';
    }
    
    modal.style.display = 'flex';
    nameInput.focus();
}

/**
 * Закрытие модального окна редактирования категории
 */
function closeCategoryEditModal() {
    const modal = document.getElementById('category-edit-modal');
    if (modal) {
        modal.style.display = 'none';
    }
}

/**
 * Редактирование категории
 */
function editCategory(categoryId, categoryName) {
    openCategoryEditModal(categoryId, categoryName);
}

/**
 * Удаление категории
 */
async function deleteCategory(categoryId, categoryName) {
    if (!confirm(`Удалить категорию «${categoryName}»?`)) return;
    try {
        const response = await fetch(`/api/categories/${categoryId}`, {
            method: 'DELETE'
        });
        
        const data = await response.json();
        
        if (data.success) {
            console.log(data.message);
            await loadManageCategories();
            await loadCategoriesList(); // Обновляем список категорий (внутри вызывается updateCategorySelects)
            // Перезагружаем данные категорий из API, чтобы сохранить все установленные значения
            await loadCategories();
        } else {
            console.error('Ошибка удаления категории:', data.error);
        }
    } catch (error) {
        console.error('Ошибка удаления категории:', error);
    }
}

/**
 * Обработка формы добавления/редактирования категории
 */
document.addEventListener('DOMContentLoaded', function() {
    const categoryEditForm = document.getElementById('category-edit-form');
    if (categoryEditForm) {
        categoryEditForm.addEventListener('submit', async function(e) {
            e.preventDefault();
            
            const idInput = document.getElementById('category-edit-id');
            const nameInput = document.getElementById('category-edit-name');
            
            if (!idInput || !nameInput) return;
            
            const categoryId = idInput.value;
            const categoryName = nameInput.value.trim();
            
            if (!categoryName) {
                console.warn('Название категории не может быть пустым');
                return;
            }
            
            try {
                let response;
                if (categoryId) {
                    // Редактирование
                    response = await fetch(`/api/categories/${categoryId}`, {
                        method: 'PUT',
                        headers: {
                            'Content-Type': 'application/json'
                        },
                        body: JSON.stringify({ name: categoryName })
                    });
                } else {
                    // Добавление
                    response = await fetch('/api/categories', {
                        method: 'POST',
                        headers: {
                            'Content-Type': 'application/json'
                        },
                        body: JSON.stringify({ name: categoryName })
                    });
                }
                
                const data = await response.json();
                
                if (data.success) {
                    console.log(data.message);
                    closeCategoryEditModal();
                    await loadManageCategories();
                    await loadCategoriesList(); // Обновляем список категорий
                    // Перезагружаем данные категорий из API, чтобы сохранить все установленные значения
                    await loadCategories();
                } else {
                    console.error('Ошибка сохранения категории:', data.error);
                }
            } catch (error) {
                console.error('Ошибка сохранения категории:', error);
            }
        });
    }
    
    // Кнопка "Управление категориями"
    const manageCategoriesBtn = document.getElementById('manage-categories-btn');
    if (manageCategoriesBtn) {
        manageCategoriesBtn.addEventListener('click', openManageCategoriesModal);
    }
    
    // Кнопка "Добавить категорию"
    const addCategoryBtn = document.getElementById('add-category-btn');
    if (addCategoryBtn) {
        addCategoryBtn.addEventListener('click', function() {
            openCategoryEditModal();
        });
    }
    
    // Закрытие модальных окон при клике вне их
    const manageCategoriesModal = document.getElementById('manage-categories-modal');
    const categoryEditModal = document.getElementById('category-edit-modal');
    
    // Обработчики клика вне модальных окон удалены - закрытие только по крестику и Esc
    
    // Загружаем список категорий при инициализации
    loadCategoriesList();
    
    // Загружаем список видов активов при инициализации
    loadAssetTypesList();
    
    // Кнопка "Добавить вид актива"
    const addAssetTypeBtn = document.getElementById('add-asset-type-btn');
    if (addAssetTypeBtn) {
        addAssetTypeBtn.addEventListener('click', function() {
            openAssetTypeEditModal();
        });
    }
});

// ==================== ФУНКЦИИ ДЛЯ РАБОТЫ С ВИДАМИ АКТИВОВ ====================

/**
 * Загрузка списка видов активов из API
 */
async function loadAssetTypesList() {
    try {
        const response = await fetch('/api/asset-types');
        const data = await response.json();
        
        if (data.success) {
            ASSET_TYPES = data.asset_types.map(at => at.name);
            updateAssetTypeSelects(); // Обновляем все селекты видов активов
            return data.asset_types;
        } else {
            console.error('Ошибка загрузки видов активов:', data.error);
            return [];
        }
    } catch (error) {
        console.error('Ошибка загрузки видов активов:', error);
        return [];
    }
}

/**
 * Обновление всех селектов видов активов на странице
 */
function updateAssetTypeSelects() {
    // Обновляем селекты в таблице категорий
    const assetTypeSelects = document.querySelectorAll('.asset-type-select');
    assetTypeSelects.forEach(select => {
        const currentValue = select.value;
        const ticker = select.dataset.ticker;
        select.innerHTML = '<option value="">Не выбрано</option>';
        ASSET_TYPES.forEach(at => {
            const option = document.createElement('option');
            option.value = at;
            option.textContent = at;
            if (at === currentValue) {
                option.selected = true;
            }
            select.appendChild(option);
        });
        select.dataset.ticker = ticker; // Восстанавливаем ticker
    });

    // Обновляем фильтр "Типы" в разделе "Мой портфель" на основе видов активов
    const portfolioTypeFilter = document.getElementById('portfolio-type-filter');
    if (portfolioTypeFilter) {
        const storedType = localStorage.getItem('portfolioFilterType') || '';
        const currentValue = storedType || portfolioTypeFilter.value;
        portfolioTypeFilter.innerHTML = '<option value=\"\">Все виды</option>';
        ASSET_TYPES.forEach(at => {
            const option = document.createElement('option');
            option.value = at;
            option.textContent = at;
            if (at === currentValue) {
                option.selected = true;
            }
            portfolioTypeFilter.appendChild(option);
        });
    }
}

/**
 * Переключение вкладок в модальном окне управления
 */
function switchManageTab(tab) {
    const categoriesTab = document.getElementById('tab-categories');
    const assetTypesTab = document.getElementById('tab-asset-types');
    const categoriesContent = document.getElementById('categories-tab-content');
    const assetTypesContent = document.getElementById('asset-types-tab-content');
    const addCategoryBtn = document.getElementById('add-category-btn');
    const addAssetTypeBtn = document.getElementById('add-asset-type-btn');
    
    if (tab === 'categories') {
        if (categoriesTab) categoriesTab.classList.add('active');
        if (assetTypesTab) assetTypesTab.classList.remove('active');
        if (categoriesContent) categoriesContent.style.display = 'block';
        if (assetTypesContent) assetTypesContent.style.display = 'none';
        if (addCategoryBtn) addCategoryBtn.style.display = '';
        if (addAssetTypeBtn) addAssetTypeBtn.style.display = 'none';
    } else if (tab === 'asset-types') {
        if (categoriesTab) categoriesTab.classList.remove('active');
        if (assetTypesTab) assetTypesTab.classList.add('active');
        if (categoriesContent) categoriesContent.style.display = 'none';
        if (assetTypesContent) assetTypesContent.style.display = 'block';
        if (addCategoryBtn) addCategoryBtn.style.display = 'none';
        if (addAssetTypeBtn) addAssetTypeBtn.style.display = '';
        loadManageAssetTypes();
    }
}

/**
 * Загрузка списка видов активов в модальное окно
 */
async function loadManageAssetTypes() {
    try {
        const response = await fetch('/api/asset-types');
        const data = await response.json();
        
        const tbody = document.getElementById('manage-asset-types-tbody');
        const noDataMessage = document.getElementById('no-asset-types-manage');
        
        if (!tbody) return;
        
        tbody.innerHTML = '';
        
        if (data.success && data.asset_types.length > 0) {
            if (noDataMessage) noDataMessage.style.display = 'none';
            
            data.asset_types.forEach(assetType => {
                const row = document.createElement('tr');
                row.innerHTML = `
                    <td>${assetType.name}</td>
                    <td style="white-space: nowrap;">
                        <button class="btn btn-edit" onclick="editAssetType(${assetType.id}, '${assetType.name.replace(/'/g, "\\'")}')" title="Редактировать" style="margin-right: 5px;">
                            ${SVG_PENCIL}
                        </button>
                        <button class="btn btn-danger" onclick="deleteAssetType(${assetType.id}, '${assetType.name.replace(/'/g, "\\'")}')" title="Удалить">
                            ${SVG_TRASH}
                        </button>
                    </td>
                `;
                tbody.appendChild(row);
            });
        } else {
            if (noDataMessage) noDataMessage.style.display = 'block';
        }
    } catch (error) {
        console.error('Ошибка загрузки видов активов:', error);
    }
}

/**
 * Открытие модального окна для добавления/редактирования вида актива
 */
function openAssetTypeEditModal(assetTypeId = null, assetTypeName = '') {
    const modal = document.getElementById('asset-type-edit-modal');
    const title = document.getElementById('asset-type-edit-title');
    const form = document.getElementById('asset-type-edit-form');
    const idInput = document.getElementById('asset-type-edit-id');
    const nameInput = document.getElementById('asset-type-edit-name');
    
    if (!modal || !title || !form || !idInput || !nameInput) return;
    
    if (assetTypeId) {
        title.textContent = '✏️ Редактировать вид актива';
        idInput.value = assetTypeId;
        nameInput.value = assetTypeName;
    } else {
        title.textContent = '➕ Добавить вид актива';
        idInput.value = '';
        nameInput.value = '';
    }
    
    modal.style.display = 'flex';
    nameInput.focus();
}

/**
 * Закрытие модального окна редактирования вида актива
 */
function closeAssetTypeEditModal() {
    const modal = document.getElementById('asset-type-edit-modal');
    if (modal) {
        modal.style.display = 'none';
    }
}

/**
 * Редактирование вида актива
 */
function editAssetType(assetTypeId, assetTypeName) {
    openAssetTypeEditModal(assetTypeId, assetTypeName);
}

/**
 * Удаление вида актива
 */
async function deleteAssetType(assetTypeId, assetTypeName) {
    if (!confirm(`Удалить вид актива «${assetTypeName}»?`)) return;
    try {
        const response = await fetch(`/api/asset-types/${assetTypeId}`, {
            method: 'DELETE'
        });
        
        const data = await response.json();
        
        if (data.success) {
            console.log(data.message);
            await loadManageAssetTypes();
            await loadAssetTypesList(); // Обновляем список видов активов
            // Перезагружаем данные категорий из API, чтобы сохранить все установленные значения
            await loadCategories();
        } else {
            console.error('Ошибка удаления вида актива:', data.error);
        }
    } catch (error) {
        console.error('Ошибка удаления вида актива:', error);
    }
}

// Обработка формы добавления/редактирования вида актива
document.addEventListener('DOMContentLoaded', function() {
    const assetTypeEditForm = document.getElementById('asset-type-edit-form');
    if (assetTypeEditForm) {
        assetTypeEditForm.addEventListener('submit', async function(e) {
            e.preventDefault();
            
            const idInput = document.getElementById('asset-type-edit-id');
            const nameInput = document.getElementById('asset-type-edit-name');
            
            if (!idInput || !nameInput) return;
            
            const assetTypeId = idInput.value;
            const assetTypeName = nameInput.value.trim();
            
            if (!assetTypeName) {
                console.warn('Название вида актива не может быть пустым');
                return;
            }
            
            try {
                let response;
                if (assetTypeId) {
                    // Редактирование
                    response = await fetch(`/api/asset-types/${assetTypeId}`, {
                        method: 'PUT',
                        headers: {
                            'Content-Type': 'application/json'
                        },
                        body: JSON.stringify({ name: assetTypeName })
                    });
                } else {
                    // Добавление
                    response = await fetch('/api/asset-types', {
                        method: 'POST',
                        headers: {
                            'Content-Type': 'application/json'
                        },
                        body: JSON.stringify({ name: assetTypeName })
                    });
                }
                
                const data = await response.json();
                
                if (data.success) {
                    console.log(data.message);
                    closeAssetTypeEditModal();
                    await loadManageAssetTypes();
                    await loadAssetTypesList(); // Обновляем список видов активов
                    // Перезагружаем данные категорий из API, чтобы сохранить все установленные значения
                    await loadCategories();
                } else {
                    console.error('Ошибка сохранения вида актива:', data.error);
                }
            } catch (error) {
                console.error('Ошибка сохранения вида актива:', error);
            }
        });
    }
    
    // Закрытие модального окна редактирования вида актива при клике вне его
    // Обработчик клика вне модального окна удален - закрытие только по крестику и Esc
});

/**
 * Открытие модального окна с информацией о тикере
 */
async function openTickerInfoModal(ticker, instrumentType = 'STOCK') {
    const modal = document.getElementById('ticker-info-modal');
    const content = document.getElementById('ticker-info-content');
    const title = document.getElementById('ticker-info-title');
    
    if (!modal || !content || !title) return;
    
    title.textContent = `Информация о тикере: ${ticker}`;
    content.innerHTML = '<div class="loading">Загрузка данных...</div>';
    modal.style.display = 'flex';
    
    try {
        const response = await fetch(`/api/ticker-info/${ticker}?instrument_type=${instrumentType}`);
        const data = await response.json();
        
        if (data.success) {
            displayTickerInfo(data, ticker, instrumentType);
        } else {
            content.innerHTML = `<div class="error-message">Ошибка загрузки данных: ${data.error || 'Неизвестная ошибка'}</div>`;
        }
    } catch (error) {
        console.error('Ошибка загрузки информации о тикере:', error);
        content.innerHTML = `<div class="error-message">Ошибка загрузки данных: ${error.message}</div>`;
    }
}

/**
 * Закрытие модального окна с информацией о тикере
 */
function closeTickerInfoModal() {
    const modal = document.getElementById('ticker-info-modal');
    if (modal) {
        modal.style.display = 'none';
    }
}

/**
 * Отображение информации о тикере в модальном окне
 */
function displayTickerInfo(data, ticker, instrumentType) {
    const content = document.getElementById('ticker-info-content');
    if (!content) return;
    
    let html = '<div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(300px, 1fr)); gap: 20px;">';
    
    // Основная информация
    html += '<div style="background: #f8f9fa; padding: 20px; border-radius: 8px;">';
    html += '<h3 style="margin-top: 0; color: #1e3a5f;">Основная информация</h3>';
    html += `<p><strong>Тикер:</strong> ${data.ticker || ticker}</p>`;

    const instrumentLabel = data.instrument_label
        ? data.instrument_label
        : (data.instrument_type === 'BOND' ? 'Облигация' : 'Акция');
    html += `<p><strong>Тип инструмента:</strong> ${instrumentLabel}</p>`;
    
    if (data.security) {
        if (data.security.name) {
            html += `<p><strong>Название:</strong> ${data.security.name}</p>`;
        }
        if (data.security.short_name && data.security.short_name !== data.security.name) {
            html += `<p><strong>Краткое название:</strong> ${data.security.short_name}</p>`;
        }
    }
    
    // Параметры торговли (лоты)
    if (data.security && data.security.trading_params) {
        const tp = data.security.trading_params;
        if (tp.lotsize) {
            html += `<p><strong>Размер лота:</strong> ${formatNumber(tp.lotsize)} ${tp.lotsize == 1 ? 'бумага' : 'бумаг'}</p>`;
        }
        if (tp.minstep !== undefined && tp.minstep !== null) {
            html += `<p><strong>Минимальный шаг цены:</strong> ${formatCurrency(tp.minstep)}</p>`;
        }
        if (tp.stepprice !== undefined && tp.stepprice !== null) {
            html += `<p><strong>Цена шага:</strong> ${formatCurrency(tp.stepprice)}</p>`;
        }
    }
    
    html += '</div>';

    // Дополнительные поля бумаги из MOEX (description.fields)
    if (data.security && data.security.fields) {
        // Словарь основных полей с русскими названиями
        const fieldNames = {
            'GROUPNAME': 'Группа инструментов',
            'ISIN': 'ISIN код',
            'CURRENCYID': 'Валюта обращения',
            'FACEVALUE': 'Номинал',
            'FACEUNIT': 'Валюта номинала',
            'MATDATE': 'Дата погашения',
            'COUPONVALUE': 'Размер купона',
            'COUPONPERIOD': 'Период выплаты купона',
            'ISSUEDATE': 'Дата выпуска',
            'ISSUESIZE': 'Размер выпуска',
            'SECTYPE': 'Тип ценной бумаги',
            'LISTLEVEL': 'Уровень листинга',
            'LOTSIZE': 'Размер лота',
            'DECIMALS': 'Количество знаков после запятой',
            'PREVPRICE': 'Цена закрытия предыдущего дня',
            'YIELD': 'Доходность',
            'ACCRUEDINT': 'Накопленный купонный доход'
        };
        
        const entries = Object.entries(data.security.fields)
            .filter(([key, value]) =>
                value !== null &&
                value !== '' &&
                !['SECID', 'NAME', 'SHORTNAME'].includes(key)
            );
        
        if (entries.length > 0) {
            html += '<div style="background: #f8f9fa; padding: 20px; border-radius: 8px;">';
            html += '<h3 style="margin-top: 0; color: #1e3a5f;">Параметры бумаги (MOEX)</h3>';
            html += '<ul style="list-style: none; padding-left: 0; margin: 0;">';
            
            entries.forEach(([key, value]) => {
                const displayName = fieldNames[key] || key;
                html += `<li style="margin: 4px 0;"><strong>${displayName}:</strong> ${value}</li>`;
            });
            
            html += '</ul>';
            html += '</div>';
        }
    }
    
    // Котировки
    if (data.quote) {
        html += '<div style="background: #f8f9fa; padding: 20px; border-radius: 8px;">';
        html += '<h3 style="margin-top: 0; color: #1e3a5f;">Текущие котировки</h3>';
        html += `<p><strong>Текущая цена:</strong> <span style="font-size: 1.2em; font-weight: bold; color: #1e3a5f;">${formatCurrentPrice(data.quote.price)}</span></p>`;
        
        const changeColor = data.quote.change >= 0 ? '#27ae60' : '#e74c3c';
        const changeSign = data.quote.change >= 0 ? '+' : '';
        html += `<p><strong>Изменение:</strong> <span style="color: ${changeColor}; font-weight: bold;">${changeSign}${formatCurrency(data.quote.change)} (${changeSign}${formatPercent(Math.abs(data.quote.change_percent), 2)})</span></p>`;
        
        if (data.quote.volume) {
            html += `<p><strong>Объем торгов:</strong> ${formatNumber(data.quote.volume)}</p>`;
        }
        
        if (data.quote.last_update) {
            html += `<p><strong>Последнее обновление:</strong> ${data.quote.last_update}</p>`;
        }
        
        // Для облигаций
        if (data.quote.facevalue) {
            html += `<p><strong>Номинал:</strong> ${formatNumber(data.quote.facevalue)} ${data.quote.currency_id || 'RUB'}</p>`;
        }
        
        html += '</div>';
    }
    
    // Информация из портфеля
    if (data.portfolio) {
        html += '<div style="background: #f8f9fa; padding: 20px; border-radius: 8px;">';
        html += '<h3 style="margin-top: 0; color: #1e3a5f;">Информация из портфеля</h3>';
        html += `<p><strong>Количество:</strong> ${formatNumber(data.portfolio.quantity)}</p>`;
        if (data.portfolio.average_buy_price) {
            html += `<p><strong>Средняя цена покупки:</strong> ${formatCurrency(data.portfolio.average_buy_price)}</p>`;
        }
        if (data.portfolio.company_name) {
            html += `<p><strong>Название компании:</strong> ${data.portfolio.company_name}</p>`;
        }
        if (data.portfolio.category) {
            html += `<p><strong>Категория:</strong> ${data.portfolio.category}</p>`;
        }
        if (data.portfolio.asset_type) {
            html += `<p><strong>Вид актива:</strong> ${data.portfolio.asset_type}</p>`;
        }
        html += '</div>';
    }
    
    html += '</div>';
    
    content.innerHTML = html;
}

/**
 * Загрузка текущего времени логирования в форму общих настроек
 */
async function loadLoggingSettings() {
    // Загружаем текущее время логирования
    try {
        const response = await fetch('/api/settings/logging-time');
        const data = await response.json();
        
        if (data.success) {
            document.getElementById('logging-hour').value = data.hour;
            document.getElementById('logging-minute').value = data.minute;
            document.getElementById('current-logging-time').textContent = data.time;
        } else {
            console.error('Ошибка загрузки настроек времени:', data.error);
        }
    } catch (error) {
        console.error('Ошибка загрузки настроек времени:', error);
    }
}

/**
 * Сохранение времени логирования
 */
async function saveLoggingTime() {
    const hourInput = document.getElementById('logging-hour');
    const minuteInput = document.getElementById('logging-minute');
    
    if (!hourInput || !minuteInput) return;
    
    const hour = parseInt(hourInput.value);
    const minute = parseInt(minuteInput.value);
    
    // Валидация
    if (isNaN(hour) || hour < 0 || hour > 23) {
        alert('Час должен быть от 0 до 23');
        return;
    }
    
    if (isNaN(minute) || minute < 0 || minute > 59) {
        alert('Минута должна быть от 0 до 59');
        return;
    }
    
    try {
        const response = await fetch('/api/settings/logging-time', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                hour: hour,
                minute: minute
            })
        });
        
        const data = await response.json();
        
        if (data.success) {
            alert(`Время логирования установлено: ${data.time} МСК\n\nПланировщик обновлен. Следующее логирование произойдет в ${data.time} МСК.`);
            document.getElementById('current-logging-time').textContent = data.time;
        } else {
            alert('Ошибка сохранения: ' + (data.error || 'Неизвестная ошибка'));
        }
    } catch (error) {
        console.error('Ошибка сохранения времени логирования:', error);
        alert('Ошибка соединения с сервером');
    }
}

/**
 * Настройка фиксированной шапки таблицы, которая
 * - закреплена по вертикали (при прокрутке страницы)
 * - и скроллится по горизонтали вместе с таблицей
 *
 * Реализовано через CSS (position: sticky у thead),
 * здесь только подчистка от старой реализации.
 */
function setupStickyTableHeader() {
    // Удаляем возможный старый клон шапки, если он ещё существует
    const host = document.getElementById('portfolio-table-sticky-host');
    if (host && host.parentNode) {
        host.parentNode.removeChild(host);
    }
}

// Обработчик клика вне модального окна удален - закрытие только по крестику и Esc

/**
 * РЎРјРµРЅР° РїР°СЂРѕР»СЏ
 */
function openChangePasswordModal() {
    const modal = document.getElementById('change-password-modal');
    if (!modal) return;
    document.getElementById('change-password-form').reset();
    document.getElementById('cp-error').style.display = 'none';
    document.getElementById('cp-success').style.display = 'none';
    modal.style.display = 'flex';
}

function closeChangePasswordModal() {
    const modal = document.getElementById('change-password-modal');
    if (modal) modal.style.display = 'none';
}

document.addEventListener('DOMContentLoaded', () => {
    const form = document.getElementById('change-password-form');
    if (!form) return;
    form.addEventListener('submit', async (e) => {
        e.preventDefault();
        const current = document.getElementById('cp-current').value;
        const newPwd = document.getElementById('cp-new').value;
        const confirm = document.getElementById('cp-confirm').value;
        const errorEl = document.getElementById('cp-error');
        const successEl = document.getElementById('cp-success');

        errorEl.style.display = 'none';
        successEl.style.display = 'none';

        if (newPwd !== confirm) {
            errorEl.textContent = 'РќРѕРІС‹Рµ РїР°СЂРѕР»Рё РЅРµ СЃРѕРІРїР°РґР°СЋС‚';
            errorEl.style.display = 'block';
            return;
        }

        try {
            const resp = await fetch('/api/change-password', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ current_password: current, new_password: newPwd })
            });
            const data = await resp.json();
            if (data.success) {
                successEl.style.display = 'block';
                form.reset();
            } else {
                errorEl.textContent = data.error || 'РћС€РёР±РєР° СЃРјРµРЅС‹ РїР°СЂРѕР»СЯ';
                errorEl.style.display = 'block';
            }
        } catch (err) {
            errorEl.textContent = 'РћС€РёР±РєР° СЃРѕРµРґРёРЅРµРЅРёСЯ';
            errorEl.style.display = 'block';
        }
    });
});

function openHardResetModal() {
    const modal = document.getElementById('hard-reset-modal');
    const pwdInput = document.getElementById('hard-reset-password');
    const errorEl = document.getElementById('hard-reset-error');
    const btn = document.getElementById('hard-reset-confirm-btn');
    pwdInput.value = '';
    errorEl.style.display = 'none';
    errorEl.textContent = '';
    btn.disabled = false;
    btn.innerHTML = `${SVG_ZAP} Удалить всё`;
    modal.style.display = 'flex';
    setTimeout(() => pwdInput.focus(), 100);
}

function closeHardResetModal() {
    document.getElementById('hard-reset-modal').style.display = 'none';
}

async function confirmHardReset() {
    const pwdInput = document.getElementById('hard-reset-password');
    const errorEl = document.getElementById('hard-reset-error');
    const btn = document.getElementById('hard-reset-confirm-btn');
    const password = pwdInput.value.trim();

    errorEl.style.display = 'none';

    if (!password) {
        errorEl.textContent = 'Введите пароль для подтверждения';
        errorEl.style.display = 'block';
        pwdInput.focus();
        return;
    }

    btn.disabled = true;
    btn.innerHTML = `${SVG_ZAP} Выполняется...`;

    try {
        const resp = await fetch('/api/hard-reset-portfolio', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ password })
        });
        const data = await resp.json();

        if (data.success) {
            closeHardResetModal();
            alert(data.message);
            loadPortfolio();
        } else {
            errorEl.textContent = data.error || 'Неизвестная ошибка';
            errorEl.style.display = 'block';
            btn.disabled = false;
            btn.innerHTML = `${SVG_ZAP} Удалить всё`;
            pwdInput.value = '';
            pwdInput.focus();
        }
    } catch (err) {
        errorEl.textContent = 'Ошибка соединения: ' + err.message;
        errorEl.style.display = 'block';
        btn.disabled = false;
        btn.innerHTML = `${SVG_ZAP} Удалить всё`;
    }
}

document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
        closeHardResetModal();
        closeDeleteHistoryModal();
    }
});

document.addEventListener('click', (e) => {
    const modal = document.getElementById('hard-reset-modal');
    if (modal && e.target === modal) closeHardResetModal();
    const dModal = document.getElementById('delete-history-modal');
    if (dModal && e.target === dModal) closeDeleteHistoryModal();
});

// ======= Кастомизация аналитики =======

const ANALYTICS_LAYOUT_KEY = 'analyticsLayout';
/**
 * Возвращает портфель, отфильтрованный по выбранному виду актива (из дропдауна портфеля).
 * Используется для всех диаграмм аналитики.
 */
function getAnalyticsPortfolio() {
    if (!currentPortfolioData || !currentPortfolioData.portfolio) return [];
    // Используем те же фильтры, что и в таблице портфеля (вид + категория)
    return applyPortfolioFilters(currentPortfolioData.portfolio);
}

/**
 * Перерисовать все диаграммы аналитики с текущим фильтром.
 */
function refreshAnalyticsCharts() {
    const chartView = document.getElementById('chart-view');
    if (!chartView || chartView.style.display === 'none') return;
    const filtered = getAnalyticsPortfolio();
    updateCategoryChart(filtered);
    updateAssetTypeChart(filtered);
    renderAssetsShareChart(filtered);
    _updateAnalyticsFilterLabel();
}

/**
 * Обновляет лейбл активного фильтра в шапке аналитики.
 */
function _updateAnalyticsFilterLabel() {
    const { type: selectedType, category: selectedCategory } = getPortfolioFilters();
    const labelTextParts = [];
    if (selectedType) labelTextParts.push(selectedType);
    if (selectedCategory) labelTextParts.push(selectedCategory);
    const labelText = labelTextParts.join(' / ');
    const ids = [
        'analytics-filter-label-asset-type',
        'analytics-filter-label-category',
        'analytics-filter-label-assets-share',
    ];
    ids.forEach(id => {
        const label = document.getElementById(id);
        if (!label) return;
        if (labelText) {
            label.textContent = labelText;
            label.setAttribute('data-type', selectedType);
            label.style.display = 'inline-block';
        } else {
            label.style.display = 'none';
            label.removeAttribute('data-type');
        }
    });
}

function _setupPieChartTooltip() {
    const chartView = document.getElementById('chart-view');
    const tooltip = document.getElementById('pie-chart-tooltip');
    if (!chartView || !tooltip) return;

    chartView.addEventListener('mouseover', function(e) {
        const slice = e.target.closest('.pie-slice');
        if (!slice) return;
        const label = slice.getAttribute('data-label') || slice.getAttribute('data-asset-type') || slice.getAttribute('data-category') || '';
        const value = slice.getAttribute('data-value');
        const pct = slice.getAttribute('data-pct');
        if (label || value != null || pct != null) {
            const valueStr = value != null && value !== '' ? formatCurrency(parseFloat(value), 2) : '';
            const pctNum = pct != null && pct !== '' ? parseFloat(pct) : NaN;
            const pctStr = !isNaN(pctNum) ? parseFloat(pct).toFixed(2) + '%' : '';
            const detailParts = [pctStr, valueStr].filter(Boolean);
            tooltip.innerHTML = `<strong>${label}</strong><br>${detailParts.join(' · ')}`;
            tooltip.setAttribute('aria-hidden', 'false');
            tooltip.style.left = (e.pageX + 12) + 'px';
            tooltip.style.top = (e.pageY + 12) + 'px';
            tooltip.classList.add('pie-chart-tooltip-visible');
        }
    }, true);

    chartView.addEventListener('mouseleave', function(e) {
        const fromSlice = e.target.closest('.pie-slice');
        const toSlice = e.relatedTarget && e.relatedTarget.closest && e.relatedTarget.closest('.pie-slice');
        if (fromSlice && !toSlice) {
            tooltip.classList.remove('pie-chart-tooltip-visible');
            tooltip.setAttribute('aria-hidden', 'true');
        }
    }, true);

    chartView.addEventListener('mousemove', function(e) {
        const slice = e.target.closest('.pie-slice');
        if (!slice) {
            tooltip.classList.remove('pie-chart-tooltip-visible');
            return;
        }
        tooltip.style.left = (e.pageX + 12) + 'px';
        tooltip.style.top = (e.pageY + 12) + 'px';
    });
}

const ANALYTICS_SECTIONS_META = [
    { id: 'portfolio-value', label: '📈 Изменение стоимости портфеля' },
    { id: 'asset-type',      label: '🥧 Распределение по видам активов' },
    { id: 'category',        label: '🏷️ Распределение по категориям' },
    { id: 'assets-share',    label: '📊 Доля активов в портфеле' },
];

function getAnalyticsLayout() {
    try {
        const saved = localStorage.getItem(ANALYTICS_LAYOUT_KEY);
        if (saved) {
            const parsed = JSON.parse(saved);
            // Добавляем новые секции, которых ещё нет в сохранённом layout
            const existingIds = parsed.map(x => x.id);
            ANALYTICS_SECTIONS_META.forEach(m => {
                if (!existingIds.includes(m.id)) parsed.push({ id: m.id, visible: true });
            });
            return parsed;
        }
    } catch (_) {}
    return ANALYTICS_SECTIONS_META.map(m => ({ id: m.id, visible: true }));
}

function saveAnalyticsLayout(layout) {
    localStorage.setItem(ANALYTICS_LAYOUT_KEY, JSON.stringify(layout));
}

function applyAnalyticsLayout() {
    const layout = getAnalyticsLayout();
    const container = document.getElementById('chart-view');
    const toolbar = container.querySelector('.analytics-toolbar');

    layout.forEach(item => {
        const section = document.getElementById(`analytics-section-${item.id}`);
        if (!section) return;
        section.style.display = item.visible ? '' : 'none';
        // Перемещаем в конец контейнера (сохраняет порядок)
        container.appendChild(section);
    });
    // Тулбар всегда первым
    container.insertBefore(toolbar, container.firstChild);
}

let _custDragSrcEl = null;

function openAnalyticsCustomizer() {
    const layout = getAnalyticsLayout();
    const list = document.getElementById('analytics-customizer-list');
    list.innerHTML = '';

    layout.forEach(item => {
        const meta = ANALYTICS_SECTIONS_META.find(m => m.id === item.id);
        if (!meta) return;

        const li = document.createElement('li');
        li.className = 'analytics-customizer-item';
        li.dataset.id = item.id;
        li.draggable = true;

        li.innerHTML = `
            <span class="acl-drag-handle" title="Перетащить">⠿</span>
            <span class="acl-label">${meta.label}</span>
            <button class="acl-toggle ${item.visible ? 'acl-visible' : 'acl-hidden'}"
                    onclick="toggleAnalyticsItem(this, '${item.id}')"
                    title="${item.visible ? 'Скрыть' : 'Показать'}">
                ${item.visible ? SVG_EYE_OPEN : SVG_EYE_OFF}
            </button>`;

        // Drag & Drop events
        li.addEventListener('dragstart', e => {
            _custDragSrcEl = li;
            e.dataTransfer.effectAllowed = 'move';
            li.classList.add('acl-dragging');
        });
        li.addEventListener('dragend', () => {
            li.classList.remove('acl-dragging');
            document.querySelectorAll('.analytics-customizer-item').forEach(el => el.classList.remove('acl-drag-over'));
            _saveCustomizerOrder();
        });
        li.addEventListener('dragover', e => {
            e.preventDefault();
            e.dataTransfer.dropEffect = 'move';
            if (_custDragSrcEl !== li) li.classList.add('acl-drag-over');
        });
        li.addEventListener('dragleave', () => li.classList.remove('acl-drag-over'));
        li.addEventListener('drop', e => {
            e.preventDefault();
            li.classList.remove('acl-drag-over');
            if (_custDragSrcEl && _custDragSrcEl !== li) {
                const items = [...list.children];
                const srcIdx = items.indexOf(_custDragSrcEl);
                const dstIdx = items.indexOf(li);
                if (srcIdx < dstIdx) list.insertBefore(_custDragSrcEl, li.nextSibling);
                else list.insertBefore(_custDragSrcEl, li);
            }
        });

        list.appendChild(li);
    });

    document.getElementById('analytics-customizer').style.display = 'flex';
}

function toggleAnalyticsItem(btn, id) {
    const layout = getAnalyticsLayout();
    const item = layout.find(x => x.id === id);
    if (!item) return;
    item.visible = !item.visible;
    saveAnalyticsLayout(layout);
    applyAnalyticsLayout();
    btn.innerHTML = item.visible ? SVG_EYE_OPEN : SVG_EYE_OFF;
    btn.className = `acl-toggle ${item.visible ? 'acl-visible' : 'acl-hidden'}`;
    btn.title = item.visible ? 'Скрыть' : 'Показать';
}

function _saveCustomizerOrder() {
    const list = document.getElementById('analytics-customizer-list');
    const currentLayout = getAnalyticsLayout();
    const newOrder = [...list.children].map(li => {
        const id = li.dataset.id;
        const existing = currentLayout.find(x => x.id === id);
        return { id, visible: existing ? existing.visible : true };
    });
    saveAnalyticsLayout(newOrder);
    applyAnalyticsLayout();
}

function closeAnalyticsCustomizer() {
    document.getElementById('analytics-customizer').style.display = 'none';
}

function closeAnalyticsCustomizerOutside(e) {
    if (e.target === document.getElementById('analytics-customizer')) closeAnalyticsCustomizer();
}

function resetAnalyticsLayout() {
    localStorage.removeItem(ANALYTICS_LAYOUT_KEY);
    applyAnalyticsLayout();
    openAnalyticsCustomizer(); // Перерисовать список
}

// ======= График стоимости портфеля vs IMOEX =======

let _portfolioValueChart = null;
let _pvcActiveDays = 365;
const PVC_STORAGE_KEY = 'pvc_date_from';
let _pvcDateFrom = (function() {
    const s = localStorage.getItem(PVC_STORAGE_KEY);
    return (s && /^\d{4}-\d{2}-\d{2}$/.test(s)) ? s : null;
})();

async function loadPortfolioValueChart(daysOrDate) {
    const isDate = typeof daysOrDate === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(daysOrDate);
    const dateInput = document.getElementById('pvc-date-from');

    if (isDate) {
        // Пользователь выбрал конкретную дату старта
        _pvcDateFrom = daysOrDate;
        _pvcActiveDays = null;
        if (dateInput) dateInput.value = daysOrDate;
        document.querySelectorAll('.period-btn').forEach(btn => btn.classList.remove('active'));
    } else {
        // Пользователь выбрал период кнопкой (1М, 3М, 6М, 1Г, Всё) — дату старта не меняем
        const days = daysOrDate == null ? _pvcActiveDays : Number(daysOrDate);
        _pvcActiveDays = days;

        document.querySelectorAll('.period-btn').forEach(btn => btn.classList.remove('active'));
        const allBtns = document.querySelectorAll('.period-btn');
        const labels = [30, 90, 180, 365, 0];
        labels.forEach((d, i) => { if (d === days && allBtns[i]) allBtns[i].classList.add('active'); });
    }

    const statusEl = document.getElementById('portfolio-value-chart-status');
    const perfLabel = document.getElementById('pvc-perf-label');
    statusEl.textContent = 'Загрузка...';
    if (perfLabel) perfLabel.textContent = '';

    // Если в поле даты что-то выбрано — всегда используем его как точку старта
    const effectiveDateFrom = (dateInput && dateInput.value && dateInput.value.trim()) || _pvcDateFrom;
    if (effectiveDateFrom) localStorage.setItem(PVC_STORAGE_KEY, effectiveDateFrom);
    else localStorage.removeItem(PVC_STORAGE_KEY);

    try {
        const url = effectiveDateFrom
            ? `/api/portfolio-value-history?date_from=${encodeURIComponent(effectiveDateFrom)}`
            : (_pvcActiveDays > 0 ? `/api/portfolio-value-history?days=${_pvcActiveDays}` : '/api/portfolio-value-history?days=3650');
        const resp = await fetch(url);
        const data = await resp.json();

        if (!data.success) { statusEl.textContent = 'Ошибка загрузки данных'; return; }
        if (!data.portfolio || data.portfolio.length === 0) {
            statusEl.textContent = 'Недостаточно данных истории цен. Дождитесь записи цен планировщиком.';
            if (_portfolioValueChart) { _portfolioValueChart.destroy(); _portfolioValueChart = null; }
            return;
        }
        statusEl.textContent = '';

        const portfolioDates = data.portfolio.map(d => d.date);
        const portfolioValues = data.portfolio.map(d => d.value);

        // Процент изменения от точки старта (первая точка = 0%, возможен отрицательный рост)
        const pBase = portfolioValues[0];
        const portfolioNorm = portfolioValues.map(v => +((v / pBase - 1) * 100).toFixed(2));

        // Выровняем IMOEX по датам портфеля — тоже % изменения от старта
        const imoexMap = {};
        (data.imoex || []).forEach(d => { imoexMap[d.date] = d.value; });
        const imoexNorm = [];
        let imoexBase = null;
        portfolioDates.forEach(date => {
            const v = imoexMap[date];
            if (v !== undefined && imoexBase === null) imoexBase = v;
            imoexNorm.push(imoexBase && v !== undefined ? +((v / imoexBase - 1) * 100).toFixed(2) : null);
        });

        // Читаем CSS-переменную цвета панелей для портфеля
        const panelColor = getComputedStyle(document.documentElement)
            .getPropertyValue('--color-panels').trim() || '#1e3a5f';

        const canvas = document.getElementById('portfolioValueChart');
        if (_portfolioValueChart) _portfolioValueChart.destroy();

        _portfolioValueChart = new Chart(canvas, {
            type: 'line',
            data: {
                labels: portfolioDates,
                datasets: [
                    {
                        label: 'Портфель',
                        data: portfolioNorm,
                        borderColor: panelColor,
                        backgroundColor: panelColor + '22',
                        borderWidth: 2,
                        pointRadius: portfolioNorm.length > 100 ? 0 : 3,
                        pointHoverRadius: 5,
                        fill: true,
                        tension: 0.3,
                        yAxisID: 'y',
                    },
                    {
                        label: 'IMOEX',
                        data: imoexNorm,
                        borderColor: '#e6a817',
                        backgroundColor: 'transparent',
                        borderWidth: 2,
                        borderDash: [5, 4],
                        pointRadius: 0,
                        pointHoverRadius: 5,
                        fill: false,
                        tension: 0.3,
                        yAxisID: 'y',
                        spanGaps: true,
                    }
                ]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                interaction: { mode: 'index', intersect: false },
                plugins: {
                    legend: { display: false },
                    tooltip: {
                        callbacks: {
                            title: ctx => ctx[0]?.label || '',
                            label: ctx => {
                                const sign = ctx.parsed.y >= 0 ? '+' : '';
                                if (ctx.datasetIndex === 0) {
                                    const absVal = portfolioValues[ctx.dataIndex];
                                    return ` Портфель: ${absVal ? absVal.toLocaleString('ru-RU') + ' ₽' : '—'} (${sign}${ctx.parsed.y}%)`;
                                }
                                return ctx.parsed.y !== null ? ` IMOEX: ${sign}${ctx.parsed.y}%` : ' IMOEX: нет данных';
                            }
                        }
                    }
                },
                scales: {
                    x: {
                        ticks: {
                            maxTicksLimit: 8,
                            color: '#888',
                            font: { size: 11 }
                        },
                        grid: { color: '#e5e9f0' }
                    },
                    y: {
                        beginAtZero: true,
                        min: (function() {
                            const all = [...portfolioNorm, ...imoexNorm.filter(v => v != null)];
                            const mn = all.length ? Math.min(...all) : 0;
                            return mn < 0 ? Math.min(mn - 2, 0) : 0;
                        })(),
                        ticks: {
                            color: '#888',
                            font: { size: 11 },
                            callback: v => (v >= 0 ? '+' : '') + v + '%'
                        },
                        grid: { color: '#e5e9f0' }
                    }
                }
            }
        });

        // Показываем доходность портфеля vs IMOEX (% изменения от старта)
        if (perfLabel && portfolioNorm.length > 1) {
            const pVal = portfolioNorm[portfolioNorm.length - 1];
            const pPerf = pVal.toFixed(1);
            const lastImoex = [...imoexNorm].reverse().find(v => v !== null);
            const iPerf = lastImoex !== undefined ? lastImoex.toFixed(1) : null;
            const pColor = pVal >= 0 ? '#16a34a' : '#b91c1c';
            const iColor = iPerf !== null ? (lastImoex >= 0 ? '#d97706' : '#b91c1c') : '#888';
            perfLabel.innerHTML =
                `Портфель: <strong style="color:${pColor}">${pVal >= 0 ? '+' : ''}${pPerf}%</strong>` +
                (iPerf !== null ? `&nbsp;&nbsp;IMOEX: <strong style="color:${iColor}">${lastImoex >= 0 ? '+' : ''}${iPerf}%</strong>` : '');
        }

    } catch (err) {
        statusEl.textContent = 'Ошибка: ' + err.message;
    }
}

// ======= Диаграмма: Активы и их доля в портфеле =======

let _assetsShareChart = null;
let _assetsShareSort = 'value'; // 'value' | 'pct'
let _assetsShareType = 'pie';   // 'bar' | 'pie'

function switchAssetsShareType(type) {
    _assetsShareType = type;
    document.getElementById('assets-share-type-bar').classList.toggle('active', type === 'bar');
    document.getElementById('assets-share-type-pie').classList.toggle('active', type === 'pie');
    // Скрываем/показываем сортировку (только для bar)
    const sortGroup = document.getElementById('assets-share-sort-group');
    if (sortGroup) sortGroup.style.display = type === 'bar' ? '' : 'none';
    if (currentPortfolioData && currentPortfolioData.portfolio) {
        renderAssetsShareChart(getAnalyticsPortfolio());
    }
}

function switchAssetsShareSort(mode) {
    _assetsShareSort = mode;
    document.getElementById('assets-share-sort-value').classList.toggle('active', mode === 'value');
    document.getElementById('assets-share-sort-pct').classList.toggle('active', mode === 'pct');
    if (currentPortfolioData && currentPortfolioData.portfolio) {
        renderAssetsShareChart(getAnalyticsPortfolio());
    }
}
// _assetsShareSort теперь означает: 'value' = ось X в рублях, 'pct' = ось X в %

function renderAssetsShareChart(portfolio) {
    const totalValue = portfolio.reduce((s, item) => s + (item.total_cost || 0), 0);
    if (totalValue === 0) return;

    // Цветовая палитра
    const palette = [
        '#3b82f6','#10b981','#f59e0b','#ef4444','#8b5cf6',
        '#06b6d4','#f97316','#84cc16','#ec4899','#14b8a6',
        '#6366f1','#a855f7','#22c55e','#eab308','#64748b',
    ];

    // Подготавливаем данные
    let items = portfolio.map(item => ({
        label: item.company_name ? `${item.ticker} — ${item.company_name}` : item.ticker,
        ticker: item.ticker,
        value: item.total_cost || 0,
        pct: totalValue > 0 ? (item.total_cost || 0) / totalValue * 100 : 0,
    }));
    items.sort((a, b) => _assetsShareSort === 'pct' ? b.pct - a.pct : b.value - a.value);

    const barWrap = document.getElementById('assets-share-bar-wrap');
    const pieWrap = document.getElementById('assets-share-pie-wrap');

    if (_assetsShareType === 'pie') {
        if (barWrap) barWrap.style.display = 'none';
        if (pieWrap) pieWrap.style.display = 'block';
        if (_assetsShareChart) { _assetsShareChart.destroy(); _assetsShareChart = null; }
        _renderAssetsSharePie(items, palette);
        return;
    }

    // Bar chart
    if (barWrap) barWrap.style.display = 'block';
    if (pieWrap) pieWrap.style.display = 'none';

    const canvas = document.getElementById('assetsShareChart');
    if (!canvas) return;

    const colors = items.map((_, i) => palette[i % palette.length]);
    const showValue = _assetsShareSort === 'value';

    // Высота: минимум 300px, по 36px на строку
    const barHeight = 36;
    const minHeight = 300;
    barWrap.style.height = Math.max(minHeight, items.length * barHeight + 60) + 'px';

    if (_assetsShareChart) { _assetsShareChart.destroy(); _assetsShareChart = null; }

    _assetsShareChart = new Chart(canvas, {
        type: 'bar',
        data: {
            labels: items.map(i => i.label),
            datasets: [{
                label: showValue ? 'Стоимость (₽)' : 'Доля в портфеле (%)',
                data: items.map(i => showValue ? i.value : i.pct),
                backgroundColor: colors,
                borderWidth: 0,
                borderRadius: 4,
            }]
        },
        options: {
            indexAxis: 'y',
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
                legend: { display: false },
                tooltip: {
                    callbacks: {
                        label: (ctx) => {
                            const item = items[ctx.dataIndex];
                            return [
                                ` Стоимость: ${formatCurrency(item.value)}`,
                                ` Доля: ${item.pct.toFixed(2)}%`,
                            ];
                        }
                    }
                }
            },
            scales: {
                x: {
                    beginAtZero: true,
                    ticks: {
                        callback: v => showValue ? formatCurrency(v) : v + '%',
                        color: '#64748b',
                    },
                    grid: { color: 'rgba(0,0,0,0.06)' },
                },
                y: {
                    ticks: { color: '#34495e', font: { size: 12 }, autoSkip: false },
                    grid: { display: false },
                }
            }
        }
    });
}

function _renderAssetsSharePie(items, palette) {
    const container = document.getElementById('assets-share-pie-chart');
    if (!container) return;

    // Строим HTML по той же логике что и другие круговые диаграммы
    const total = items.reduce((s, i) => s + i.value, 0);
    const segments = items.map((item, idx) => ({
        ...item,
        color: palette[idx % palette.length],
        pct: total > 0 ? item.value / total * 100 : 0,
    }));

    // SVG pie
    let cumulativePct = 0;
    const cx = 50, cy = 50, r = 45;
    let pathsHTML = '';

    segments.forEach(seg => {
        if (seg.pct <= 0) return;
        const startAngle = (cumulativePct / 100) * 2 * Math.PI - Math.PI / 2;
        const endAngle   = ((cumulativePct + seg.pct) / 100) * 2 * Math.PI - Math.PI / 2;
        const x1 = cx + r * Math.cos(startAngle);
        const y1 = cy + r * Math.sin(startAngle);
        const x2 = cx + r * Math.cos(endAngle);
        const y2 = cy + r * Math.sin(endAngle);
        const largeArc = seg.pct > 50 ? 1 : 0;
        const labelEsc = (seg.label || '').replace(/"/g, '&quot;');
        pathsHTML += `<path class="pie-slice" d="M${cx},${cy} L${x1.toFixed(2)},${y1.toFixed(2)} A${r},${r} 0 ${largeArc},1 ${x2.toFixed(2)},${y2.toFixed(2)} Z"
            fill="${seg.color}" stroke="#fff" stroke-width="0.5" opacity="0.9"
            data-label="${labelEsc}" data-value="${seg.value}" data-pct="${seg.pct.toFixed(2)}"></path>`;
        cumulativePct += seg.pct;
    });

    // Легенда в 3 колонки
    let legendItems = '';
    segments.forEach(seg => {
        legendItems += `
        <div style="display:flex;align-items:center;gap:6px;padding:4px 0;font-size:0.85em;min-width:0;">
            <span style="width:12px;height:12px;border-radius:3px;background:${seg.color};flex-shrink:0;display:inline-block;"></span>
            <span style="flex:1;color:#34495e;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;" title="${seg.label}">${seg.label}</span>
            <span style="color:#2c3e50;font-weight:600;white-space:nowrap;margin-left:4px;">${seg.pct.toFixed(2)}%</span>
        </div>`;
    });
    const legendHTML = `
        <div style="flex:1;min-width:0;display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:0 16px;align-content:start;max-height:500px;overflow-y:auto;overflow-x:hidden;">
            ${legendItems}
        </div>`;

    container.innerHTML = `
        <div style="display:flex;gap:32px;align-items:flex-start;flex-wrap:wrap;overflow:hidden;">
            <svg viewBox="0 0 100 100" style="width:500px;height:500px;max-width:100%;flex-shrink:0;filter:drop-shadow(0 4px 8px rgba(0,0,0,0.15));">
                ${pathsHTML}
            </svg>
            ${legendHTML}
        </div>`;
}

// ======= Удаление истории цен за период =======

function openDeleteHistoryModal() {
    const modal = document.getElementById('delete-history-modal');
    const pwdInput = document.getElementById('delete-history-password');
    const errorEl = document.getElementById('delete-history-error');
    const btn = document.getElementById('delete-history-confirm-btn');
    const preview = document.getElementById('delete-history-preview');

    pwdInput.value = '';
    errorEl.style.display = 'none';
    errorEl.textContent = '';
    preview.textContent = '';
    btn.disabled = false;
    btn.innerHTML = `${SVG_TRASH} Удалить`;

    // Заполняем тикеры из текущего фильтра истории
    const tickerSel = document.getElementById('delete-history-ticker');
    const srcSel = document.getElementById('history-ticker-filter');
    tickerSel.innerHTML = '<option value="">Все тикеры</option>';
    if (srcSel) {
        Array.from(srcSel.options).forEach(opt => {
            if (opt.value) {
                const o = document.createElement('option');
                o.value = opt.value;
                o.textContent = opt.textContent;
                tickerSel.appendChild(o);
            }
        });
    }

    // Дефолтные даты — текущий месяц
    const today = new Date();
    const firstDay = new Date(today.getFullYear(), today.getMonth(), 1);
    document.getElementById('delete-history-from').value = firstDay.toISOString().slice(0, 10);
    document.getElementById('delete-history-to').value = today.toISOString().slice(0, 10);

    modal.style.display = 'flex';
    setTimeout(() => pwdInput.focus(), 100);
}

function closeDeleteHistoryModal() {
    document.getElementById('delete-history-modal').style.display = 'none';
}

async function confirmDeleteHistory() {
    const pwdInput = document.getElementById('delete-history-password');
    const errorEl = document.getElementById('delete-history-error');
    const btn = document.getElementById('delete-history-confirm-btn');
    const password = pwdInput.value.trim();
    const dateFrom = document.getElementById('delete-history-from').value;
    const dateTo = document.getElementById('delete-history-to').value;
    const ticker = document.getElementById('delete-history-ticker').value;

    errorEl.style.display = 'none';

    if (!dateFrom || !dateTo) {
        errorEl.textContent = 'Укажите период (обе даты)';
        errorEl.style.display = 'block';
        return;
    }
    if (dateFrom > dateTo) {
        errorEl.textContent = 'Дата "от" не может быть позже даты "до"';
        errorEl.style.display = 'block';
        return;
    }
    if (!password) {
        errorEl.textContent = 'Введите пароль для подтверждения';
        errorEl.style.display = 'block';
        pwdInput.focus();
        return;
    }

    btn.disabled = true;
    btn.innerHTML = `${SVG_TRASH} Удаление...`;

    try {
        const resp = await fetch('/api/delete-price-history', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ password, date_from: dateFrom, date_to: dateTo, ticker: ticker || null })
        });
        const data = await resp.json();

        if (data.success) {
            closeDeleteHistoryModal();
            alert(data.message);
            loadPriceHistory();
        } else {
            errorEl.textContent = data.error || 'Неизвестная ошибка';
            errorEl.style.display = 'block';
            btn.disabled = false;
            btn.innerHTML = `${SVG_TRASH} Удалить`;
            pwdInput.value = '';
            pwdInput.focus();
        }
    } catch (err) {
        errorEl.textContent = 'Ошибка соединения: ' + err.message;
        errorEl.style.display = 'block';
        btn.disabled = false;
        btn.innerHTML = `${SVG_TRASH} Удалить`;
    }
}
