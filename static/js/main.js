/**
 * Главный JavaScript файл для управления портфелем акций MOEX
 * Обновление данных только по кнопке "Обновить"
 */

// Автообновление отключено - только ручное обновление
let previousPrices = {}; // Хранение предыдущих цен для отслеживания изменений
let tickerValidationTimeout = null; // Таймаут для валидации тикера
let lastValidatedTicker = ''; // Последний валидированный тикер

/**
 * Инициализация приложения при загрузке страницы
 */
document.addEventListener('DOMContentLoaded', function() {
    loadPortfolio();
    setupEventListeners();
    // Автообновление отключено - только ручное обновление кнопкой
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
    
    loadPortfolio(false).finally(() => {
        if (refreshBtn) {
            refreshBtn.disabled = false;
            refreshBtn.textContent = '🔄 Обновить';
        }
    });
}

/**
 * Загрузка данных портфеля с сервера
 * @param {boolean} silent - Если true, не показывать индикатор загрузки
 */
async function loadPortfolio(silent = false) {
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
            // Просто отображаем данные
            displayPortfolio(data.portfolio, data.summary);
            updateLastUpdateTime();
            if (!silent) {
                if (loading) loading.style.display = 'none';
                if (table) table.style.display = 'table';
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
        <td>
            <button class="btn btn-sell" onclick="openSellModal(${item.id}, '${item.ticker}', '${item.company_name}', ${item.quantity}, ${item.current_price})" title="Продать">
                🛒
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
        quantity: parseFloat(document.getElementById('quantity').value),
        average_buy_price: parseFloat(document.getElementById('average_buy_price').value)
    };
    
    if (!formData.ticker || formData.quantity <= 0 || formData.average_buy_price <= 0) {
        alert('Заполните все обязательные поля корректно');
        return;
    }
    
    try {
        // 1. Создаём транзакцию покупки
        const transactionData = {
            ticker: formData.ticker,
            company_name: formData.company_name,
            operation_type: 'Покупка',
            price: formData.average_buy_price,
            quantity: formData.quantity,
            notes: 'Покупка через форму добавления'
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
            alert('Ошибка при создании транзакции: ' + transData.error);
            return;
        }
        
        // 2. Обновляем портфель
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
                alert(`✅ Покупка успешно оформлена!\n\nТикер: ${formData.ticker}\nКуплено: ${formData.quantity} шт. по ${formData.average_buy_price} ₽\n\nНовое количество в портфеле: ${data.new_quantity.toFixed(2)}\nСредняя цена: ${data.new_average_price.toFixed(2)} ₽`);
            } else {
                alert(`✅ Покупка успешно оформлена!\n\nТикер: ${formData.ticker}\nКуплено: ${formData.quantity} шт. по ${formData.average_buy_price} ₽\nСумма: ${(formData.quantity * formData.average_buy_price).toFixed(2)} ₽`);
            }
        } else {
            alert('Ошибка при обновлении портфеля: ' + data.error);
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
 * Обновление времени последнего обновления
 */
function updateLastUpdateTime() {
    const now = new Date();
    const timeString = now.toLocaleTimeString('ru-RU');
    const lastUpdateEl = document.getElementById('last-update-time');
    if (lastUpdateEl) {
        lastUpdateEl.textContent = timeString;
    }
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
    const transactionsView = document.getElementById('transactions-view');
    const categoriesView = document.getElementById('categories-view');
    const btnTable = document.getElementById('btn-table-view');
    const btnChart = document.getElementById('btn-chart-view');
    const btnHistory = document.getElementById('btn-history-view');
    const btnTransactions = document.getElementById('btn-transactions-view');
    const btnCategories = document.getElementById('btn-categories-view');
    
    if (viewType === 'table') {
        tableView.style.display = 'block';
        chartView.style.display = 'none';
        historyView.style.display = 'none';
        transactionsView.style.display = 'none';
        categoriesView.style.display = 'none';
        btnTable.classList.add('active');
        btnChart.classList.remove('active');
        btnHistory.classList.remove('active');
        btnTransactions.classList.remove('active');
        btnCategories.classList.remove('active');
    } else if (viewType === 'chart') {
        tableView.style.display = 'none';
        chartView.style.display = 'block';
        historyView.style.display = 'none';
        transactionsView.style.display = 'none';
        categoriesView.style.display = 'none';
        btnTable.classList.remove('active');
        btnChart.classList.add('active');
        btnHistory.classList.remove('active');
        btnTransactions.classList.remove('active');
        btnCategories.classList.remove('active');
    } else if (viewType === 'history') {
        tableView.style.display = 'none';
        chartView.style.display = 'none';
        historyView.style.display = 'block';
        transactionsView.style.display = 'none';
        categoriesView.style.display = 'none';
        btnTable.classList.remove('active');
        btnChart.classList.remove('active');
        btnHistory.classList.add('active');
        btnTransactions.classList.remove('active');
        btnCategories.classList.remove('active');
        // Загружаем историю цен при переключении
        loadPriceHistory();
    } else if (viewType === 'transactions') {
        tableView.style.display = 'none';
        chartView.style.display = 'none';
        historyView.style.display = 'none';
        transactionsView.style.display = 'block';
        categoriesView.style.display = 'none';
        btnTable.classList.remove('active');
        btnChart.classList.remove('active');
        btnHistory.classList.remove('active');
        btnTransactions.classList.add('active');
        btnCategories.classList.remove('active');
        // Загружаем транзакции при переключении
        loadTransactions();
    } else if (viewType === 'categories') {
        tableView.style.display = 'none';
        chartView.style.display = 'none';
        historyView.style.display = 'none';
        transactionsView.style.display = 'none';
        categoriesView.style.display = 'block';
        btnTable.classList.remove('active');
        btnChart.classList.remove('active');
        btnHistory.classList.remove('active');
        btnTransactions.classList.remove('active');
        btnCategories.classList.add('active');
        // Загружаем категории при переключении
        loadCategories();
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
        
        // Форматируем дату
        const date = new Date(transaction.date);
        const dateStr = date.toLocaleString('ru-RU', {
            year: 'numeric',
            month: '2-digit',
            day: '2-digit',
            hour: '2-digit',
            minute: '2-digit'
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
                    <button class="btn-edit" onclick="openEditTransactionModal(${transaction.id})" title="Редактировать">✏️</button>
                    <button class="btn-danger" onclick="deleteTransaction(${transaction.id})" title="Удалить">🗑️</button>
                </div>
            </td>
        `;
        
        tbody.appendChild(row);
    });
}

/**
 * Обновление фильтра тикеров для транзакций
 */
async function updateTransactionTickerFilter() {
    const tickerFilter = document.getElementById('trans-ticker-filter');
    if (!tickerFilter) return;
    
    try {
        const response = await fetch('/api/portfolio');
        const data = await response.json();
        
        if (data.success && data.portfolio) {
            const uniqueTickers = [...new Set(data.portfolio.map(item => item.ticker))];
            const currentValue = tickerFilter.value;
            
            tickerFilter.innerHTML = '<option value="">Все тикеры</option>';
            
            uniqueTickers.sort().forEach(ticker => {
                const option = document.createElement('option');
                option.value = ticker;
                option.textContent = ticker;
                tickerFilter.appendChild(option);
            });
            
            tickerFilter.value = currentValue;
        }
    } catch (error) {
        console.error('Ошибка обновления фильтра тикеров:', error);
    }
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
            alert('Транзакция успешно добавлена!');
        } else {
            alert('Ошибка: ' + data.error);
        }
    } catch (error) {
        console.error('Ошибка добавления транзакции:', error);
        alert('Не удалось добавить транзакцию');
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
                document.getElementById('trans-edit-notes').value = transaction.notes || '';
                
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
            alert('Транзакция успешно обновлена!');
        } else {
            alert('Ошибка: ' + data.error);
        }
    } catch (error) {
        console.error('Ошибка обновления транзакции:', error);
        alert('Не удалось обновить транзакцию');
    }
}

/**
 * Удаление транзакции
 */
async function deleteTransaction(transactionId) {
    if (!confirm('Вы уверены, что хотите удалить эту транзакцию?')) {
        return;
    }
    
    try {
        const response = await fetch(`/api/transactions/${transactionId}`, {
            method: 'DELETE'
        });
        
        const data = await response.json();
        
        if (data.success) {
            loadTransactions();
            alert('Транзакция успешно удалена!');
        } else {
            alert('Ошибка: ' + data.error);
        }
    } catch (error) {
        console.error('Ошибка удаления транзакции:', error);
        alert('Не удалось удалить транзакцию');
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
function openSellModal(portfolioId, ticker, companyName, availableQuantity, currentPrice) {
    const modal = document.getElementById('sell-modal');
    if (!modal) return;
    
    // Заполняем скрытые поля
    document.getElementById('sell-portfolio-id').value = portfolioId;
    document.getElementById('sell-ticker').value = ticker;
    document.getElementById('sell-company-name').value = companyName;
    
    // Заполняем видимые поля
    document.getElementById('sell-ticker-display').value = ticker;
    document.getElementById('sell-company-display').value = companyName || ticker;
    document.getElementById('sell-available-display').value = `${availableQuantity} шт.`;
    
    // Устанавливаем текущую цену как цену продажи по умолчанию
    document.getElementById('sell-price').value = currentPrice.toFixed(2);
    
    // Устанавливаем максимальное количество для продажи
    const quantityInput = document.getElementById('sell-quantity');
    quantityInput.max = availableQuantity;
    quantityInput.value = '';
    
    // Очищаем остальные поля
    document.getElementById('sell-total').value = '';
    document.getElementById('sell-notes').value = '';
    
    // Показываем модальное окно
    modal.style.display = 'flex';
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
    const quantity = parseFloat(document.getElementById('sell-quantity').value);
    const price = parseFloat(document.getElementById('sell-price').value);
    const notes = document.getElementById('sell-notes').value;
    const availableStr = document.getElementById('sell-available-display').value;
    const availableQuantity = parseFloat(availableStr.split(' ')[0]);
    
    // Валидация количества
    if (quantity <= 0) {
        alert('Количество должно быть больше 0');
        return;
    }
    
    if (quantity > availableQuantity) {
        alert(`Недостаточно акций для продажи!\nДоступно: ${availableQuantity}\nУказано: ${quantity}`);
        return;
    }
    
    if (!confirm(`Продать ${quantity} акций ${ticker} по ${price} ₽?\n\nСумма продажи: ${(quantity * price).toFixed(2)} ₽`)) {
        return;
    }
    
    try {
        // 1. Создаём транзакцию продажи
        const transactionData = {
            ticker: ticker,
            company_name: companyName,
            operation_type: 'Продажа',
            price: price,
            quantity: quantity,
            notes: notes || 'Продажа через кнопку портфеля'
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
            alert('Ошибка при создании транзакции продажи: ' + transData.error);
            return;
        }
        
        // 2. Обновляем портфель (уменьшаем количество или удаляем позицию)
        const remainingQuantity = availableQuantity - quantity;
        
        if (remainingQuantity <= 0.001) {
            // Удаляем позицию полностью, если продали всё
            const deleteResponse = await fetch(`/api/portfolio/${portfolioId}`, {
                method: 'DELETE'
            });
            
            const deleteData = await deleteResponse.json();
            
            if (!deleteData.success) {
                alert('Ошибка при удалении позиции: ' + deleteData.error);
                return;
            }
        } else {
            // Обновляем количество в портфеле
            const updateResponse = await fetch(`/api/portfolio/${portfolioId}`, {
                method: 'PUT',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    quantity: remainingQuantity
                })
            });
            
            const updateData = await updateResponse.json();
            
            if (!updateData.success) {
                alert('Ошибка при обновлении портфеля: ' + updateData.error);
                return;
            }
        }
        
        // Закрываем модальное окно и обновляем данные
        closeSellModal();
        loadPortfolio();
        
        // Показываем сообщение об успехе
        const totalSum = (quantity * price).toFixed(2);
        if (remainingQuantity <= 0.001) {
            alert(`✅ Продажа успешно оформлена!\n\nТикер: ${ticker}\nПродано: ${quantity} шт. по ${price} ₽\nСумма: ${totalSum} ₽\n\n⚠️ Позиция полностью закрыта и удалена из портфеля`);
        } else {
            alert(`✅ Продажа успешно оформлена!\n\nТикер: ${ticker}\nПродано: ${quantity} шт. по ${price} ₽\nСумма: ${totalSum} ₽\n\nОсталось в портфеле: ${remainingQuantity.toFixed(2)} шт.`);
        }
        
    } catch (error) {
        console.error('Ошибка продажи:', error);
        alert('Ошибка при выполнении операции продажи');
    }
}

/**
 * ==========================================
 * ФУНКЦИИ ДЛЯ УПРАВЛЕНИЯ КАТЕГОРИЯМИ
 * ==========================================
 */

// Список доступных категорий
const CATEGORIES = [
    'Нефть и газ',
    'Электроэнергетика',
    'Телекоммуникации',
    'Металлы и добыча',
    'Финансовый сектор',
    'Потребительский сектор',
    'Химия и нефтехимия',
    'Информационные технологии (IT)',
    'Строительные компании и недвижимость',
    'Транспорт'
];

/**
 * Загрузка категорий
 */
async function loadCategories() {
    const tbody = document.getElementById('categories-tbody');
    const noCategoriesMsg = document.getElementById('no-categories');
    const table = document.getElementById('categories-table');
    
    if (!tbody) return;
    
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
        
        // Создаем select с категориями
        let categorySelect = `<select class="category-select" id="cat-select-${item.ticker}" data-ticker="${item.ticker}">`;
        categorySelect += `<option value="">Не выбрано</option>`;
        
        CATEGORIES.forEach(cat => {
            const selected = item.category === cat ? 'selected' : '';
            categorySelect += `<option value="${cat}" ${selected}>${cat}</option>`;
        });
        
        categorySelect += '</select>';
        
        row.innerHTML = `
            <td><strong>${item.ticker}</strong></td>
            <td>${item.company_name || '-'}</td>
            <td>${categorySelect}</td>
            <td>
                <button class="category-save-btn" onclick="updateCategoryForTicker('${item.ticker}')" title="Сохранить">
                    💾 Сохранить
                </button>
            </td>
        `;
        
        tbody.appendChild(row);
    });
}

/**
 * Обновление категории для тикера
 */
async function updateCategoryForTicker(ticker) {
    const selectEl = document.getElementById(`cat-select-${ticker}`);
    if (!selectEl) return;
    
    const category = selectEl.value;
    
    try {
        const response = await fetch('/api/update-category', {
            method: 'PUT',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                ticker: ticker,
                category: category
            })
        });
        
        const data = await response.json();
        
        if (data.success) {
            alert(`✅ Категория для ${ticker} успешно обновлена!`);
            // Перезагружаем портфель, если он открыт
            if (document.getElementById('btn-table-view').classList.contains('active')) {
                loadPortfolio();
            }
        } else {
            alert('Ошибка: ' + data.error);
        }
    } catch (error) {
        console.error('Ошибка обновления категории:', error);
        alert('Ошибка при обновлении категории');
    }
}
