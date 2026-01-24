/**
 * Главный JavaScript файл для управления портфелем акций MOEX
 * Обеспечивает автообновление данных каждые 3 минуты
 * Также обновляет данные при изменении цен
 */

const UPDATE_INTERVAL = 60000; // Обновление каждые 1 минуту
let updateTimer = null;
let previousPrices = {}; // Хранение предыдущих цен для отслеживания изменений
let priceCheckInterval = 5000; // Интервал для проверки изменений цен (5 секунд)
let countdownTimer = null; // Таймер обратного отсчета
let lastUpdateTime = null; // Время последнего обновления

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
            <button class="btn btn-edit" onclick="openEditModal(${item.id}, '${item.company_name}', ${item.quantity}, ${item.average_buy_price})">
                Редактировать
            </button>
            <button class="btn btn-danger" onclick="deletePosition(${item.id}, '${item.ticker}')">
                Удалить
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
 * Обработка добавления новой позиции
 */
async function handleAddPosition(e) {
    e.preventDefault();
    
    const formData = {
        ticker: document.getElementById('ticker').value.trim(),
        company_name: document.getElementById('company_name').value.trim(),
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
            // Перезагрузка портфеля
            loadPortfolio();
            alert('Позиция успешно добавлена!');
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
function openEditModal(id, companyName, quantity, averageBuyPrice) {
    document.getElementById('edit-id').value = id;
    document.getElementById('edit-company_name').value = companyName;
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
    
    // Автообновление каждые 600 секунд (10 минут)
    updateTimer = setInterval(() => {
        loadPortfolio(false, false); // Полное обновление с индикатором загрузки
    }, UPDATE_INTERVAL);
    
    // Проверка изменений цен каждые 30 секунд (для быстрого реагирования на изменения)
    priceCheckInterval = setInterval(() => {
        loadPortfolio(true, true); // Тихая проверка с отслеживанием изменений
    }, 30000); // 30 секунд
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
