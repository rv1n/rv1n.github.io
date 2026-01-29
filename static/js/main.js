/**
 * Главный JavaScript файл для управления портфелем акций MOEX
 * Обеспечивает автообновление данных каждые 5 минут
 * Также обновляет данные при изменении цен (проверка каждые 5 секунд)
 */

const UPDATE_INTERVAL = 300000; // Обновление каждые 5 минут (300 секунд)
const PRICE_CHECK_INTERVAL = 5000; // Проверка изменений цен каждые 5 секунд
let updateTimer = null;
let previousPrices = {}; // Хранение предыдущих цен для отслеживания изменений
let priceCheckInterval = null; // Интервал для проверки изменений цен
let countdownTimer = null; // Таймер обратного отсчета
let lastUpdateTime = null; // Время последнего обновления
let tickerValidationTimeout = null; // Таймаут для валидации тикера
let lastValidatedTicker = ''; // Последний валидированный тикер

/**
 * Инициализация приложения при загрузке страницы
 */
document.addEventListener('DOMContentLoaded', function() {
    loadPortfolio();
    setupEventListeners();
    startAutoUpdate();
    startCountdownTimer();
});

/**
 * Настройка обработчиков событий
 */
function setupEventListeners() {
    // Форма добавления позиции
    const addForm = document.getElementById('add-form');
    if (addForm) {
        addForm.addEventListener('submit', handleAddPosition);
    }
    
    // Форма редактирования позиции
    const editForm = document.getElementById('edit-form');
    if (editForm) {
        editForm.addEventListener('submit', handleEditPosition);
    }
    
    // Закрытие модального окна
    const closeBtn = document.querySelector('.close');
    if (closeBtn) {
        closeBtn.addEventListener('click', closeEditModal);
    }
    
    // Закрытие модального окна при клике вне его
    const modal = document.getElementById('edit-modal');
    if (modal) {
        modal.addEventListener('click', function(e) {
            if (e.target === modal) {
                closeEditModal();
            }
        });
    }
    
    // Валидация тикера при вводе
    const tickerInput = document.getElementById('ticker');
    if (tickerInput) {
        tickerInput.addEventListener('input', handleTickerInput);
        tickerInput.addEventListener('blur', handleTickerBlur);
    }
}

/**
 * Ручное обновление данных портфеля
 */
function manualRefresh() {
    const refreshBtn = document.getElementById('refresh-btn');
    if (refreshBtn) {
        refreshBtn.disabled = true;
        refreshBtn.textContent = '🔄 Обновление...';
    }
    
    loadPortfolio().finally(() => {
        if (refreshBtn) {
            refreshBtn.disabled = false;
            refreshBtn.textContent = '🔄 Обновить';
        }
    });
}

/**
 * Загрузка данных портфеля с сервера
 * @param {boolean} silent - Если true, не показывать индикатор загрузки (для фоновых обновлений)
 * @param {boolean} checkPriceChanges - Если true, проверять изменения цен
 */
async function loadPortfolio(silent = false, checkPriceChanges = false) {
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
        
        const response = await fetch('/api/portfolio');
        const data = await response.json();
        
        if (data.success) {
            // Проверка изменений цен
            if (checkPriceChanges && Object.keys(previousPrices).length > 0) {
                const priceChanged = checkPriceChanges(data.portfolio);
                if (priceChanged) {
                    // Если цена изменилась, обновляем интерфейс
                    displayPortfolio(data.portfolio, data.summary);
                    updateLastUpdateTime();
                    // Показываем таблицу если она была скрыта
                    if (table) {
                        table.style.display = 'table';
                    }
                    if (!silent && loading) {
                        loading.style.display = 'none';
                    }
                    return;
                }
                // Если цены не изменились, просто обновляем время (тихо)
                // Но убеждаемся, что таблица видна
                if (table && table.style.display === 'none') {
                    table.style.display = 'table';
                }
                if (!silent) {
                    updateLastUpdateTime();
                }
            } else {
                // Первая загрузка или обновление без проверки - просто отображаем
                displayPortfolio(data.portfolio, data.summary);
                updateLastUpdateTime();
                if (!silent) {
                    if (loading) loading.style.display = 'none';
                    if (table) table.style.display = 'table';
                }
            }
        } else {
            if (!silent) {
                showError(data.error || 'Ошибка загрузки портфеля');
            }
        }
    } catch (error) {
        console.error('Ошибка загрузки портфеля:', error);
        if (!silent) {
            showError('Ошибка соединения с сервером');
        }
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
 * Отображение портфеля в таблице
 */
function displayPortfolio(portfolio, summary) {
    const tbody = document.getElementById('portfolio-tbody');
    tbody.innerHTML = '';
    
    if (portfolio.length === 0) {
        tbody.innerHTML = '<tr><td colspan="10" style="text-align: center; padding: 40px; color: #7f8c8d;">Портфель пуст. Добавьте первую позицию.</td></tr>';
        previousPrices = {}; // Очищаем сохраненные цены
        return;
    }
    
    // Сохраняем текущие цены для отслеживания изменений
    portfolio.forEach(item => {
        previousPrices[item.ticker] = item.current_price;
    });
    
    portfolio.forEach(item => {
        const row = createPortfolioRow(item);
        tbody.appendChild(row);
    });
    
    // Обновление сводки
    updateSummary(summary);
    
    // Обновление диаграммы категорий
    updateCategoryChart(portfolio);
}

/**
 * Создание строки таблицы для позиции
 */
function createPortfolioRow(item) {
    const row = document.createElement('tr');
    
    // Определение классов для прибыли/убытка
    const pnlClass = item.profit_loss >= 0 ? 'profit' : 'loss';
    const pnlPercentClass = item.profit_loss_percent >= 0 ? 'profit' : 'loss';
    const changeClass = item.price_change >= 0 ? 'profit' : 'loss';
    
    row.innerHTML = `
        <td><strong>${item.ticker}</strong></td>
        <td>${item.company_name || item.ticker}</td>
        <td><span class="category-badge">${item.category || '-'}</span></td>
        <td>${formatNumber(item.quantity)}</td>
        <td><strong>${formatCurrency(item.current_price)}</strong></td>
        <td class="${changeClass}">
            ${item.price_change >= 0 ? '+' : ''}${formatCurrency(item.price_change)} 
            (${item.price_change_percent >= 0 ? '+' : ''}${item.price_change_percent.toFixed(2)}%)
        </td>
        <td>${formatCurrency(item.average_buy_price)}</td>
        <td class="${pnlClass}">
            ${item.profit_loss >= 0 ? '+' : ''}${formatCurrency(item.profit_loss)}
        </td>
        <td class="${pnlPercentClass}">
            ${item.profit_loss_percent >= 0 ? '+' : ''}${item.profit_loss_percent.toFixed(2)}%
        </td>
        <td>${formatNumber(item.volume)}</td>
        <td>
            <button class="btn btn-edit" onclick="openEditModal(${item.id}, '${item.company_name}', '${item.category || ''}', ${item.quantity}, ${item.average_buy_price})" title="Редактировать">
                ✏️
            </button>
            <button class="btn btn-danger" onclick="deletePosition(${item.id}, '${item.ticker}')" title="Удалить">
                🗑️
            </button>
        </td>
    `;
    
    return row;
}

/**
 * Обновление сводки портфеля
 */
function updateSummary(summary) {
    const totalValueEl = document.getElementById('total-value');
    const totalPnlEl = document.getElementById('total-pnl');
    const totalPnlPercentEl = document.getElementById('total-pnl-percent');
    
    if (totalValueEl) {
        totalValueEl.textContent = formatCurrency(summary.total_value);
    }
    
    if (totalPnlEl) {
        totalPnlEl.textContent = `${summary.total_pnl >= 0 ? '+' : ''}${formatCurrency(summary.total_pnl)}`;
        totalPnlEl.className = `summary-value ${summary.total_pnl >= 0 ? 'profit' : 'loss'}`;
    }
    
    if (totalPnlPercentEl) {
        totalPnlPercentEl.textContent = `${summary.total_pnl_percent >= 0 ? '+' : ''}${summary.total_pnl_percent.toFixed(2)}%`;
        totalPnlPercentEl.className = `summary-percent ${summary.total_pnl_percent >= 0 ? 'profit' : 'loss'}`;
    }
}

/**
 * Обработка ввода тикера с отложенной валидацией
 */
function handleTickerInput(e) {
    const ticker = e.target.value.trim().toUpperCase();
    const statusEl = document.getElementById('ticker-status');
    const hintEl = document.getElementById('ticker-hint');
    
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
            validateTicker(ticker);
        }, 500);
    } else {
        statusEl.textContent = '';
        statusEl.className = 'ticker-status';
        hintEl.textContent = '';
    }
}

/**
 * Обработка потери фокуса на поле тикера
 */
function handleTickerBlur(e) {
    const ticker = e.target.value.trim().toUpperCase();
    if (ticker.length > 0 && ticker !== lastValidatedTicker) {
        validateTicker(ticker);
    }
}

/**
 * Валидация тикера через API
 */
async function validateTicker(ticker) {
    if (!ticker) return;
    
    const statusEl = document.getElementById('ticker-status');
    const hintEl = document.getElementById('ticker-hint');
    const companyNameInput = document.getElementById('company_name');
    
    if (!statusEl || !hintEl || !companyNameInput) {
        console.error('Не найдены необходимые элементы формы');
        return;
    }
    
    try {
        const response = await fetch(`/api/validate-ticker/${ticker}`);
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
 * Обработка добавления новой позиции
 */
async function handleAddPosition(e) {
    e.preventDefault();
    
    const ticker = document.getElementById('ticker').value.trim().toUpperCase();
    
    // Проверяем, что тикер валидирован
    if (ticker !== lastValidatedTicker) {
        alert('Пожалуйста, дождитесь проверки тикера на Московской бирже');
        return;
    }
    
    const statusEl = document.getElementById('ticker-status');
    if (statusEl.classList.contains('invalid')) {
        alert('Указан несуществующий тикер. Пожалуйста, проверьте правильность написания.');
        return;
    }
    
    const formData = {
        ticker: ticker,
        company_name: document.getElementById('company_name').value.trim(),
        category: document.getElementById('category').value,
        quantity: parseFloat(document.getElementById('quantity').value),
        average_buy_price: parseFloat(document.getElementById('average_buy_price').value)
    };
    
    if (!formData.ticker || formData.quantity <= 0 || formData.average_buy_price <= 0) {
        alert('Заполните все обязательные поля корректно');
        return;
    }
    
    try {
        const response = await fetch('/api/portfolio', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify(formData)
        });
        
        const data = await response.json();
        
        if (data.success) {
            // Очистка формы
            document.getElementById('add-form').reset();
            // Сброс валидации тикера
            const statusEl = document.getElementById('ticker-status');
            const hintEl = document.getElementById('ticker-hint');
            if (statusEl) {
                statusEl.textContent = '';
                statusEl.className = 'ticker-status';
            }
            if (hintEl) {
                hintEl.textContent = '';
            }
            lastValidatedTicker = '';
            // Перезагрузка портфеля
            loadPortfolio();
            
            // Показываем сообщение в зависимости от того, была ли позиция обновлена
            if (data.updated) {
                alert(`Позиция ${formData.ticker} обновлена!\n\nНовое количество: ${data.new_quantity.toFixed(2)}\nСредняя цена покупки: ${data.new_average_price.toFixed(2)} ₽`);
            } else {
                alert('Позиция успешно добавлена!');
            }
        } else {
            alert('Ошибка: ' + data.error);
        }
    } catch (error) {
        console.error('Ошибка добавления позиции:', error);
        alert('Ошибка соединения с сервером');
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
        alert('Количество и цена должны быть положительными');
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
            loadPortfolio();
            alert('Позиция успешно обновлена!');
        } else {
            alert('Ошибка: ' + data.error);
        }
    } catch (error) {
        console.error('Ошибка обновления позиции:', error);
        alert('Ошибка соединения с сервером');
    }
}

/**
 * Удаление позиции из портфеля
 */
async function deletePosition(id, ticker) {
    if (!confirm(`Вы уверены, что хотите удалить позицию ${ticker}?`)) {
        return;
    }
    
    try {
        const response = await fetch(`/api/portfolio/${id}`, {
            method: 'DELETE'
        });
        
        const data = await response.json();
        
        if (data.success) {
            loadPortfolio();
            alert('Позиция успешно удалена!');
        } else {
            alert('Ошибка: ' + data.error);
        }
    } catch (error) {
        console.error('Ошибка удаления позиции:', error);
        alert('Ошибка соединения с сервером');
    }
}

/**
 * Запуск автоматического обновления
 */
function startAutoUpdate() {
    // Очищаем предыдущие таймеры
    if (updateTimer) {
        clearInterval(updateTimer);
    }
    if (priceCheckInterval) {
        clearInterval(priceCheckInterval);
    }
    
    // Автообновление каждые 300 секунд (5 минут)
    updateTimer = setInterval(() => {
        loadPortfolio(false, false); // Полное обновление с индикатором загрузки
    }, UPDATE_INTERVAL);
    
    // Проверка изменений цен каждые 5 секунд (для быстрого реагирования на изменения)
    priceCheckInterval = setInterval(() => {
        loadPortfolio(true, true); // Тихая проверка с отслеживанием изменений
    }, PRICE_CHECK_INTERVAL);
}

/**
 * Остановка автоматического обновления
 */
function stopAutoUpdate() {
    if (updateTimer) {
        clearInterval(updateTimer);
        updateTimer = null;
    }
    if (priceCheckInterval) {
        clearInterval(priceCheckInterval);
        priceCheckInterval = null;
    }
    if (countdownTimer) {
        clearInterval(countdownTimer);
        countdownTimer = null;
    }
}

/**
 * Обновление времени последнего обновления
 */
function updateLastUpdateTime() {
    const now = new Date();
    lastUpdateTime = now; // Сохраняем время последнего обновления
    const timeString = now.toLocaleTimeString('ru-RU');
    const lastUpdateEl = document.getElementById('last-update-time');
    if (lastUpdateEl) {
        lastUpdateEl.textContent = timeString;
    }
    // Перезапускаем таймер обратного отсчета
    startCountdownTimer();
}

/**
 * Запуск таймера обратного отсчета до следующего обновления
 */
function startCountdownTimer() {
    // Останавливаем предыдущий таймер если есть
    if (countdownTimer) {
        clearInterval(countdownTimer);
    }
    
    // Если время последнего обновления не установлено, устанавливаем текущее
    if (!lastUpdateTime) {
        lastUpdateTime = new Date();
    }
    
    // Обновляем таймер сразу
    updateCountdownTimer();
    
    // Обновляем таймер каждую секунду
    countdownTimer = setInterval(() => {
        updateCountdownTimer();
    }, 1000);
}

/**
 * Обновление отображения таймера обратного отсчета
 */
function updateCountdownTimer() {
    const timerEl = document.getElementById('next-update-timer');
    if (!timerEl || !lastUpdateTime) {
        return;
    }
    
    const now = new Date();
    const elapsed = now - lastUpdateTime; // Прошедшее время в миллисекундах
    const remaining = UPDATE_INTERVAL - elapsed; // Оставшееся время в миллисекундах
    
    if (remaining <= 0) {
        timerEl.textContent = '0:00';
        return;
    }
    
    // Конвертируем миллисекунды в минуты и секунды
    const totalSeconds = Math.floor(remaining / 1000);
    const minutes = Math.floor(totalSeconds / 60);
    const seconds = totalSeconds % 60;
    
    // Форматируем время (MM:SS)
    const formattedTime = `${minutes}:${seconds.toString().padStart(2, '0')}`;
    timerEl.textContent = formattedTime;
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
 * Форматирование валюты
 */
function formatCurrency(value) {
    if (value === null || value === undefined) {
        return '0.00 ₽';
    }
    return new Intl.NumberFormat('ru-RU', {
        style: 'currency',
        currency: 'RUB',
        minimumFractionDigits: 2,
        maximumFractionDigits: 2
    }).format(value);
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
    const btnTable = document.getElementById('btn-table-view');
    const btnChart = document.getElementById('btn-chart-view');
    const btnHistory = document.getElementById('btn-history-view');
    
    if (viewType === 'table') {
        tableView.style.display = 'block';
        chartView.style.display = 'none';
        historyView.style.display = 'none';
        btnTable.classList.add('active');
        btnChart.classList.remove('active');
        btnHistory.classList.remove('active');
    } else if (viewType === 'chart') {
        tableView.style.display = 'none';
        chartView.style.display = 'block';
        historyView.style.display = 'none';
        btnTable.classList.remove('active');
        btnChart.classList.add('active');
        btnHistory.classList.remove('active');
    } else if (viewType === 'history') {
        tableView.style.display = 'none';
        chartView.style.display = 'none';
        historyView.style.display = 'block';
        btnTable.classList.remove('active');
        btnChart.classList.remove('active');
        btnHistory.classList.add('active');
        // Загружаем историю цен при переключении
        loadPriceHistory();
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
    
    // Цвета для категорий
    const colors = [
        '#667eea', '#764ba2', '#f093fb', '#4facfe',
        '#43e97b', '#fa709a', '#fee140', '#30cfd0',
        '#a8edea', '#fbc2eb'
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
                <div class="category-percentage">${item.percentage.toFixed(2)}%</div>
            </div>
        `;
    });
    
    chartHTML += '</div>';
    
    chartContainer.innerHTML = chartHTML;
}

/**
 * Загрузка истории цен
 */
async function loadPriceHistory() {
    const tickerFilter = document.getElementById('history-ticker-filter');
    const daysFilter = document.getElementById('history-days-filter');
    const contentContainer = document.getElementById('price-history-content');
    
    if (!contentContainer) return;
    
    const ticker = tickerFilter ? tickerFilter.value : '';
    const days = daysFilter ? daysFilter.value : 30;
    
    try {
        contentContainer.innerHTML = '<p style="text-align: center; padding: 40px;">Загрузка истории...</p>';
        
        const url = `/api/price-history?${ticker ? `ticker=${ticker}&` : ''}days=${days}`;
        const response = await fetch(url);
        const data = await response.json();
        
        if (data.success) {
            renderPriceHistory(data.history, ticker);
            // Обновляем список тикеров в фильтре
            updateTickerFilter();
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
                <th>Изменение</th>
                <th>Изменение %</th>
                <th>Объём торгов</th>
            </tr>
        </thead>
        <tbody>`;
    
    history.forEach(item => {
        const changeClass = item.change >= 0 ? 'positive' : 'negative';
        html += `
            <tr>
                <td>${item.logged_at}</td>
                <td class="price-cell">${formatCurrency(item.price)}</td>
                <td class="${changeClass}">${item.change >= 0 ? '+' : ''}${item.change.toFixed(2)} ₽</td>
                <td class="${changeClass}">${item.change_percent >= 0 ? '+' : ''}${item.change_percent.toFixed(2)}%</td>
                <td>${formatNumber(item.volume)}</td>
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
    
    let html = '';
    
    // Сортируем даты (от новых к старым)
    const sortedDates = Object.keys(groupedHistory).sort((a, b) => new Date(b) - new Date(a));
    
    sortedDates.forEach(date => {
        const items = groupedHistory[date];
        
        html += `
            <div class="history-date-group">
                <div class="history-date-header">${formatDate(date)}</div>
                <div class="history-items">`;
        
        items.forEach(item => {
            const changeClass = item.change >= 0 ? 'positive' : 'negative';
            html += `
                <div class="history-item">
                    <div class="history-item-header">
                        <span class="history-ticker">${item.ticker}</span>
                        <span class="history-time">${item.logged_at.split(' ')[1]}</span>
                    </div>
                    <div class="history-company">${item.company_name || ''}</div>
                    <div class="history-price">${formatCurrency(item.price)}</div>
                    <div class="history-change ${changeClass}">
                        <span>${item.change >= 0 ? '↑' : '↓'} ${item.change.toFixed(2)} ₽</span>
                        <span>${item.change_percent >= 0 ? '+' : ''}${item.change_percent.toFixed(2)}%</span>
                    </div>
                    <div class="history-volume">Объём: ${formatNumber(item.volume)}</div>
                </div>
            `;
        });
        
        html += '</div></div>';
    });
    
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
 * Обновление фильтра тикеров
 */
async function updateTickerFilter() {
    const tickerFilter = document.getElementById('history-ticker-filter');
    if (!tickerFilter) return;
    
    try {
        const response = await fetch('/api/portfolio');
        const data = await response.json();
        
        if (data.success && data.portfolio) {
            // Получаем уникальные тикеры
            const uniqueTickers = [...new Set(data.portfolio.map(item => item.ticker))];
            
            // Сохраняем текущий выбор
            const currentValue = tickerFilter.value;
            
            // Очищаем и заполняем заново
            tickerFilter.innerHTML = '<option value="">Все тикеры</option>';
            
            uniqueTickers.sort().forEach(ticker => {
                const option = document.createElement('option');
                option.value = ticker;
                option.textContent = ticker;
                tickerFilter.appendChild(option);
            });
            
            // Восстанавливаем выбор
            tickerFilter.value = currentValue;
        }
    } catch (error) {
        console.error('Ошибка обновления фильтра тикеров:', error);
    }
}

/**
 * Ручное логирование цен
 */
async function logPricesNow() {
    const btn = document.getElementById('manual-log-btn');
    if (!btn) return;
    
    const originalText = btn.textContent;
    btn.disabled = true;
    btn.textContent = '⏳ Логирование...';
    
    try {
        const response = await fetch('/api/log-prices-now', {
            method: 'POST'
        });
        const data = await response.json();
        
        if (data.success) {
            btn.textContent = '✅ Готово!';
            // Перезагружаем историю
            setTimeout(() => {
                loadPriceHistory();
                btn.textContent = originalText;
                btn.disabled = false;
            }, 1000);
        } else {
            btn.textContent = '❌ Ошибка';
            alert('Ошибка: ' + data.error);
            setTimeout(() => {
                btn.textContent = originalText;
                btn.disabled = false;
            }, 2000);
        }
    } catch (error) {
        console.error('Ошибка логирования:', error);
        btn.textContent = '❌ Ошибка';
        setTimeout(() => {
            btn.textContent = originalText;
            btn.disabled = false;
        }, 2000);
    }
}

// Добавляем обработчики событий для фильтров истории
document.addEventListener('DOMContentLoaded', function() {
    const tickerFilter = document.getElementById('history-ticker-filter');
    const daysFilter = document.getElementById('history-days-filter');
    const manualLogBtn = document.getElementById('manual-log-btn');
    
    if (tickerFilter) {
        tickerFilter.addEventListener('change', loadPriceHistory);
    }
    
    if (daysFilter) {
        daysFilter.addEventListener('change', loadPriceHistory);
    }
    
    if (manualLogBtn) {
        manualLogBtn.addEventListener('click', logPricesNow);
    }
});
