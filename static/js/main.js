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
let currentPortfolioData = null; // Текущие данные портфеля
let currentChartType = localStorage.getItem('chartType') || 'pie'; // Текущий тип диаграммы (pie/bar)
let currentAssetTypeChartType = localStorage.getItem('assetTypeChartType') || 'pie'; // Текущий тип диаграммы видов активов (pie/bar)
let lastPriceLogCheck = null; // Последняя проверка записи цен
let priceLogCheckInterval = null; // Интервал проверки новых записей цен

/**
 * Инициализация приложения при загрузке страницы
 */
document.addEventListener('DOMContentLoaded', async function() {
    await loadCategoriesList(); // Загружаем список категорий из API
    await loadAssetTypesList(); // Загружаем список видов активов из API
    loadPortfolio();
    setupEventListeners();
    startPriceLogMonitoring(); // Запускаем мониторинг новых записей цен
});

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
    
    // Автоматический расчет суммы покупки
    const buyQuantity = document.getElementById('buy-quantity');
    const buyPrice = document.getElementById('buy-price');
    if (buyQuantity && buyPrice) {
        buyQuantity.addEventListener('input', calculateBuyTotal);
        buyPrice.addEventListener('input', calculateBuyTotal);
    }
    
    // Автоматический расчет суммы продажи
    const sellQuantity = document.getElementById('sell-quantity');
    const sellPrice = document.getElementById('sell-price');
    if (sellQuantity && sellPrice) {
        sellQuantity.addEventListener('input', calculateSellTotal);
        sellPrice.addEventListener('input', calculateSellTotal);
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
            // Сохраняем данные портфеля для последующего обновления категорий
            currentPortfolioData = data.portfolio;
            
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
 * Отображение портфеля в таблице
 */
function displayPortfolio(portfolio, summary) {
    const tbody = document.getElementById('portfolio-tbody');
    tbody.innerHTML = '';
    
    // Получаем выбранный фильтр типа инструмента
    const typeFilter = document.getElementById('portfolio-type-filter');
    const selectedType = typeFilter ? typeFilter.value : '';
    
    // Фильтруем портфель по типу инструмента
    let filteredPortfolio = portfolio;
    if (selectedType) {
        filteredPortfolio = portfolio.filter(item => item.instrument_type === selectedType);
    }
    
    if (filteredPortfolio.length === 0) {
        const message = selectedType ? 
            `Нет инструментов типа "${selectedType}"` : 
            'Портфель пуст. Добавьте первую позицию.';
        tbody.innerHTML = `<tr><td colspan="9" style="text-align: center; padding: 40px; color: #7f8c8d;">${message}</td></tr>`;
        if (portfolio.length === 0) {
            previousPrices = {}; // Очищаем сохраненные цены только если портфель действительно пуст
        }
        return;
    }
    
    // Сохраняем текущие цены для отслеживания изменений
    portfolio.forEach(item => {
        previousPrices[item.ticker] = item.current_price;
    });
    
    // Получаем общую стоимость портфеля для расчета процентов
    const totalPortfolioValue = summary.total_value || 0;
    
    filteredPortfolio.forEach(item => {
        const row = createPortfolioRow(item, totalPortfolioValue);
        tbody.appendChild(row);
    });
    
    // Привязываем обработчики к кнопкам продажи
    attachSellButtonHandlers();
    
    // Обновление сводки
    updateSummary(summary);
    
    // Обновление диаграммы категорий
    updateCategoryChart(portfolio);
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
            const price = parseFloat(this.getAttribute('data-price'));
            
            openSellModal(portfolioId, ticker, companyName, quantity, price);
        });
    });
}

/**
 * Создание строки таблицы для позиции
 */
function createPortfolioRow(item, totalPortfolioValue = 0) {
    const row = document.createElement('tr');
    
    // Определение классов для прибыли/убытка
    const pnlClass = item.profit_loss >= 0 ? 'profit' : 'loss';
    const pnlPercentClass = item.profit_loss_percent >= 0 ? 'profit' : 'loss';
    const changeClass = item.price_change >= 0 ? 'profit' : 'loss';
    
    // Определяем, является ли инструмент облигацией
    const isBond = item.instrument_type === 'Облигация';
    const bondNominal = 1000; // Номинал большинства облигаций MOEX

    // Эффективная цена в рублях:
    // Для акций: как есть
    // Для облигаций: цена на MOEX указывается в % от номинала, поэтому переводим в рубли
    const effectivePrice = isBond
        ? (item.current_price * bondNominal) / 100
        : item.current_price;

    // Рассчитываем процент от общего портфеля, используя цену в рублях
    const totalValue = item.quantity * effectivePrice;
    const portfolioPercent = totalPortfolioValue > 0 ? (totalValue / totalPortfolioValue * 100).toFixed(2) : 0;
    
    // Разметка для колонки "Цена сейчас"
    // Для акций отображаем только цену в рублях
    // Для облигаций – в рублях и в процентах (как в колонке "Общая стоимость")
    const priceCellHtml = isBond
        ? `
            <div style="display: flex; flex-direction: column; align-items: flex-start;">
                <strong>${formatCurrentPrice(effectivePrice)}</strong>
                <span style="font-size: 0.85em; color: #7f8c8d;">${item.current_price.toFixed(2)}%</span>
            </div>
        `
        : `<strong>${formatCurrentPrice(effectivePrice)}</strong>`;
    
    row.innerHTML = `
        <td>
            <div class="ticker-company-cell">
                <span class="ticker-company-name">${item.company_name || item.ticker}</span>
                <span class="ticker-company-ticker">${item.ticker}</span>
            </div>
        </td>
        <td>${formatCurrency(item.average_buy_price)}</td>
        <td>${formatNumber(item.quantity)}</td>
        <td>
            <div style="display: flex; flex-direction: column; align-items: flex-start;">
                <strong>${formatCurrency(totalValue)}</strong>
                <span style="font-size: 0.85em; color: #7f8c8d;">${portfolioPercent}%</span>
            </div>
        </td>
        <td>${priceCellHtml}</td>
        <td class="${changeClass}">
            ${item.price_change >= 0 ? '+' : ''}${formatCurrency(item.price_change)} 
            (${item.price_change_percent >= 0 ? '+' : ''}${item.price_change_percent.toFixed(2)}%)
        </td>
        <td class="${pnlClass}">
            ${item.profit_loss >= 0 ? '+' : ''}${formatCurrency(item.profit_loss)}
        </td>
        <td class="${pnlPercentClass}">
            ${item.profit_loss_percent >= 0 ? '+' : ''}${item.profit_loss_percent.toFixed(2)}%
        </td>
        <td>
            <button class="btn btn-sell" 
                data-portfolio-id="${item.id}" 
                data-ticker="${item.ticker}" 
                data-company-name="${item.company_name || ''}" 
                data-quantity="${item.quantity}" 
                data-price="${item.current_price}" 
                title="Продать"></button>
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
 * Обновление категорий во всех связанных вкладках
 * Загружает данные один раз и обновляет обе вкладки: "Мой портфель" и "Распределение по категориям"
 */
async function updateAllCategoryViews() {
    try {
        // Загружаем актуальные данные с сервера (один запрос для обеих вкладок)
        const response = await fetch('/api/portfolio');
        const data = await response.json();
        
        if (data.success && data.portfolio) {
            // Обновляем сохраненные данные
            currentPortfolioData = data.portfolio;
            
            // 1. Обновляем столбец категорий в таблице "Мой портфель" (если она существует)
            const tbody = document.getElementById('portfolio-tbody');
            if (tbody) {
                const rows = tbody.getElementsByTagName('tr');
                
                data.portfolio.forEach((item, index) => {
                    if (rows[index]) {
                        // Находим ячейку категории (3-я колонка, индекс 2)
                        const categoryCell = rows[index].cells[2];
                        if (categoryCell) {
                            categoryCell.innerHTML = `<span class="category-badge">${item.category || '-'}</span>`;
                        }
                    }
                });
            }
            
            // 2. Обновляем диаграмму "Распределение по категориям"
            updateCategoryChart(data.portfolio);
            
            // Сбрасываем флаг изменений
            categoriesChanged = false;
        }
    } catch (error) {
        console.error('Ошибка обновления категорий:', error);
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
    const instrumentTypeSelect = document.getElementById('buy-instrument-type');
    
    if (!statusEl || !hintEl || !companyNameInput) {
        console.error('Не найдены необходимые элементы формы покупки');
        return;
    }
    
    try {
        const instrumentType = instrumentTypeSelect ? instrumentTypeSelect.value : 'STOCK';
        const response = await fetch(`/api/validate-ticker/${ticker}?instrument_type=${instrumentType}`);
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
 * Расчет общей суммы покупки
 */
function calculateBuyTotal() {
    const quantity = parseFloat(document.getElementById('buy-quantity').value) || 0;
    const price = parseFloat(document.getElementById('buy-price').value) || 0;
    const total = quantity * price;
    
    document.getElementById('buy-total').value = total > 0 ? total.toFixed(2) : '';
}

/**
 * Расчет общей суммы продажи
 */
function calculateSellTotal() {
    const quantity = parseFloat(document.getElementById('sell-quantity').value) || 0;
    const price = parseFloat(document.getElementById('sell-price').value) || 0;
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
    lastValidatedTicker = '';
    
    // Показываем модальное окно
    modal.style.display = 'flex';
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
async function handleBuy(e) {
    e.preventDefault();
    
    const ticker = document.getElementById('buy-ticker').value.trim().toUpperCase();
    
    // Проверяем, что тикер валидирован
    if (ticker !== lastValidatedTicker) {
        alert('Пожалуйста, дождитесь проверки тикера на Московской бирже');
        return;
    }
    
    const statusEl = document.getElementById('buy-ticker-status');
    if (statusEl.classList.contains('invalid')) {
        alert('Указан несуществующий тикер. Пожалуйста, проверьте правильность написания.');
        return;
    }
    
    const quantity = parseFloat(document.getElementById('buy-quantity').value);
    const price = parseFloat(document.getElementById('buy-price').value);
    const companyName = document.getElementById('buy-company-name').value.trim();
    const instrumentType = document.getElementById('buy-instrument-type').value;
    
    if (!ticker || quantity <= 0 || price <= 0) {
        alert('Заполните все обязательные поля корректно');
        return;
    }
    
    try {
        // 1. Создаём транзакцию покупки
        const transactionData = {
            ticker: ticker,
            company_name: companyName,
            operation_type: 'Покупка',
            price: price,
            quantity: quantity,
            instrument_type: instrumentType,
            notes: 'Покупка через модальное окно'
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
        const formData = {
            ticker: ticker,
            company_name: companyName,
            quantity: quantity,
            average_buy_price: price,
            instrument_type: instrumentType
        };
        
        const response = await fetch('/api/portfolio', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify(formData)
        });
        
        const data = await response.json();
        
        if (data.success) {
            // Закрываем модальное окно
            closeBuyModal();
            
            // Перезагрузка портфеля
            loadPortfolio();
            
            // Показываем сообщение в зависимости от того, была ли позиция обновлена
            if (data.updated) {
                alert(`✅ Покупка успешно оформлена!\n\nТикер: ${ticker}\nКуплено: ${quantity} шт. по ${parseFloat(price).toFixed(5)} ₽\n\nНовое количество в портфеле: ${data.new_quantity.toFixed(2)}\nСредняя цена: ${parseFloat(data.new_average_price).toFixed(5)} ₽`);
            } else {
                alert(`✅ Покупка успешно оформлена!\n\nТикер: ${ticker}\nКуплено: ${quantity} шт. по ${parseFloat(price).toFixed(5)} ₽\nСумма: ${(quantity * price).toFixed(2)} ₽`);
            }
        } else {
            alert('Ошибка при обновлении портфеля: ' + data.error);
        }
    } catch (error) {
        console.error('Ошибка покупки:', error);
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
        return '0.00000 ₽';
    }
    return new Intl.NumberFormat('ru-RU', {
        style: 'currency',
        currency: 'RUB',
        minimumFractionDigits: 5,
        maximumFractionDigits: 5
    }).format(value);
}

/**
 * Форматирование текущей цены (2 знака после запятой)
 */
function formatCurrentPrice(value) {
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
        if (btnTable) btnTable.classList.remove('active');
        if (btnChart) btnChart.classList.add('active');
        if (btnHistory) btnHistory.classList.remove('active');
        if (btnTransactions) btnTransactions.classList.remove('active');
        if (btnCategories) btnCategories.classList.remove('active');
        
        // Обновляем обе вкладки, если категории были изменены
        if (categoriesChanged) {
            updateAllCategoryViews();
        } else if (currentPortfolioData) {
            // Используем уже загруженные данные
            updateCategoryChart(currentPortfolioData);
        }
        
        // Применяем выбор типа диаграммы
        applyChartTypeSelection();
    } else if (viewType === 'history') {
        tableView.style.display = 'none';
        chartView.style.display = 'none';
        historyView.style.display = 'block';
        transactionsView.style.display = 'none';
        categoriesView.style.display = 'none';
        if (btnTable) btnTable.classList.remove('active');
        if (btnChart) btnChart.classList.remove('active');
        if (btnHistory) btnHistory.classList.add('active');
        if (btnTransactions) btnTransactions.classList.remove('active');
        if (btnCategories) btnCategories.classList.remove('active');
        // Загружаем историю цен при переключении
        loadPriceHistory();
    } else if (viewType === 'transactions') {
        tableView.style.display = 'none';
        chartView.style.display = 'none';
        historyView.style.display = 'none';
        transactionsView.style.display = 'block';
        categoriesView.style.display = 'none';
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
        categoriesView.style.display = 'block';
        if (btnTable) btnTable.classList.remove('active');
        if (btnChart) btnChart.classList.remove('active');
        if (btnHistory) btnHistory.classList.remove('active');
        if (btnTransactions) btnTransactions.classList.remove('active');
        if (btnCategories) btnCategories.classList.add('active');
        // Загружаем категории при переключении
        // Сначала загружаем список категорий, затем данные портфеля
        loadCategoriesList().then(() => {
            loadCategories();
        });
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
    
    // Цвета для категорий (строгая официальная палитра)
    const colors = [
        '#1e3a5f', '#2c5282', '#4a5568', '#2d3748',
        '#22543d', '#1a3d2e', '#718096', '#4a5568',
        '#2c3e50', '#34495e'
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
    
    // Цвета для видов активов (строгая официальная палитра)
    const colors = [
        '#1e3a5f', '#2c5282', '#4a5568', '#2d3748',
        '#22543d', '#1a3d2e', '#718096', '#4a5568',
        '#2c3e50', '#34495e'
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
                <div class="category-percentage">${item.percentage.toFixed(2)}%</div>
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
        const value = item.quantity * item.current_price || 0;
        
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
    
    // Цвета для видов активов (строгая официальная палитра)
    const colors = [
        '#1e3a5f', '#2c5282', '#4a5568', '#2d3748',
        '#22543d', '#1a3d2e', '#718096', '#4a5568',
        '#2c3e50', '#34495e'
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
        svgPaths = `<circle cx="${center}" cy="${center}" r="${radius}" fill="${color}" stroke="white" stroke-width="2" class="pie-slice" data-asset-type="${sortedAssetTypes[0].assetType}"/>`;
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
            
            svgPaths += `<path d="${pathD}" fill="${color}" stroke="white" stroke-width="2" class="pie-slice" data-asset-type="${item.assetType}"/>`;
            
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
                <div class="pie-legend-percentage">${item.percentage.toFixed(1)}%</div>
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
        const value = item.quantity * item.current_price || 0;
        
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
    
    // Цвета для категорий (строгая официальная палитра)
    const colors = [
        '#1e3a5f', '#2c5282', '#4a5568', '#2d3748',
        '#22543d', '#1a3d2e', '#718096', '#4a5568',
        '#2c3e50', '#34495e'
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
        svgPaths = `<circle cx="${center}" cy="${center}" r="${radius}" fill="${color}" stroke="white" stroke-width="2" class="pie-slice" data-category="${sortedCategories[0].category}"/>`;
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
            
            svgPaths += `<path d="${pathD}" fill="${color}" stroke="white" stroke-width="2" class="pie-slice" data-category="${item.category}"/>`;
            
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
                <div class="pie-legend-percentage">${item.percentage.toFixed(1)}%</div>
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
            // Обновляем список тикеров в фильтре
            updateHistoryTickerFilter();
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
                <td class="price-cell">${formatCurrency(item.price)}</td>
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
                <td class="price-cell"><strong>${formatCurrency(item.price)}</strong></td>
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
 * Обновление фильтра тикеров
 */
async function updateHistoryTickerFilter() {
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
            // Перезагружаем историю и портфель (колонка "Изменение")
            setTimeout(() => {
                loadPriceHistory();
                loadPortfolio(); // Обновляем портфель для актуализации колонки "Изменение"
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
    
    // Обработчик изменения типа инструмента для повторной валидации тикера
    const buyInstrumentType = document.getElementById('buy-instrument-type');
    if (buyInstrumentType) {
        buyInstrumentType.addEventListener('change', function() {
            const ticker = document.getElementById('buy-ticker').value.trim().toUpperCase();
            if (ticker) {
                lastValidatedTicker = ''; // Сбрасываем валидацию
                validateBuyTicker(ticker);
            }
        });
    }
    
    // Обработчик фильтра по типу инструмента в портфеле
    const portfolioTypeFilter = document.getElementById('portfolio-type-filter');
    if (portfolioTypeFilter) {
        portfolioTypeFilter.addEventListener('change', function() {
            // Перерисовываем портфель с учетом фильтра
            if (currentPortfolioData) {
                displayPortfolio(currentPortfolioData.portfolio, currentPortfolioData.summary);
            }
        });
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
    document.getElementById('sell-price').value = currentPrice.toFixed(5);
    
    // Устанавливаем максимальное количество для продажи
    const quantityInput = document.getElementById('sell-quantity');
    quantityInput.max = availableQuantity;
    quantityInput.value = '';
    
    // Очищаем остальные поля
    document.getElementById('sell-total').value = '';
    
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
    
    if (!confirm(`Продать ${quantity} акций ${ticker} по ${parseFloat(price).toFixed(5)} ₽?\n\nСумма продажи: ${(quantity * price).toFixed(2)} ₽`)) {
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
            notes: 'Продажа через кнопку портфеля'
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
        const formattedPrice = parseFloat(price).toFixed(5);
        if (remainingQuantity <= 0.001) {
            alert(`✅ Продажа успешно оформлена!\n\nТикер: ${ticker}\nПродано: ${quantity} шт. по ${formattedPrice} ₽\nСумма: ${totalSum} ₽\n\n⚠️ Позиция полностью закрыта и удалена из портфеля`);
        } else {
            alert(`✅ Продажа успешно оформлена!\n\nТикер: ${ticker}\nПродано: ${quantity} шт. по ${formattedPrice} ₽\nСумма: ${totalSum} ₽\n\nОсталось в портфеле: ${remainingQuantity.toFixed(2)} шт.`);
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
    
    // Показываем индикатор загрузки
    if (indicatorEl) {
        indicatorEl.textContent = '⏳';
        indicatorEl.style.color = '#3498db';
    }
    
    // Блокируем select на время сохранения
    selectEl.disabled = true;
    
    try {
        const response = await fetch('/api/portfolio', {
            method: 'GET'
        });
        const data = await response.json();
        
        if (data.success) {
            const portfolioItem = data.portfolio.find(item => item.ticker === ticker);
            if (portfolioItem) {
                const updateResponse = await fetch(`/api/portfolio/${portfolioItem.id}`, {
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
                    // Показываем индикатор успеха
                    if (indicatorEl) {
                        indicatorEl.textContent = '✓';
                        indicatorEl.style.color = '#27ae60';
                        setTimeout(() => {
                            indicatorEl.textContent = '';
                        }, 2000);
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
                    alert('Ошибка обновления вида актива: ' + updateData.error);
                }
            }
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
        alert('Ошибка соединения с сервером');
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
    
    // Показываем индикатор загрузки
    if (indicatorEl) {
        indicatorEl.textContent = '⏳';
        indicatorEl.style.color = '#3498db';
    }
    
    // Блокируем select на время сохранения
    selectEl.disabled = true;
    
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
            // Показываем галочку успеха
            if (indicatorEl) {
                indicatorEl.textContent = '✓';
                indicatorEl.style.color = '#27ae60';
                indicatorEl.style.fontWeight = 'bold';
                indicatorEl.style.fontSize = '1.2em';
            }
            
            // Обновляем обе вкладки одновременно (портфель и диаграмму)
            await updateAllCategoryViews();
            
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
            console.error('Ошибка обновления категории:', data.error);
            
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

// Закрытие модальных окон при клике вне их
window.onclick = function(event) {
    const buyModal = document.getElementById('buy-modal');
    const sellModal = document.getElementById('sell-modal');
    const editTransactionModal = document.getElementById('edit-transaction-modal');
    
    if (event.target === buyModal) {
        closeBuyModal();
    } else if (event.target === sellModal) {
        closeSellModal();
    } else if (event.target === editTransactionModal) {
        closeEditTransactionModal();
    }
}

// Закрытие модальных окон при нажатии ESC
document.addEventListener('keydown', function(event) {
    if (event.key === 'Escape') {
        const buyModal = document.getElementById('buy-modal');
        const sellModal = document.getElementById('sell-modal');
        const editTransactionModal = document.getElementById('edit-transaction-modal');
        const manageCategoriesModal = document.getElementById('manage-categories-modal');
        const categoryEditModal = document.getElementById('category-edit-modal');
        
        if (buyModal && buyModal.style.display === 'flex') {
            closeBuyModal();
        } else if (sellModal && sellModal.style.display === 'flex') {
            closeSellModal();
        } else if (editTransactionModal && editTransactionModal.style.display === 'flex') {
            closeEditTransactionModal();
        } else if (categoryEditModal && categoryEditModal.style.display === 'flex') {
            closeCategoryEditModal();
        } else if (manageCategoriesModal && manageCategoriesModal.style.display === 'flex') {
            closeManageCategoriesModal();
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
                            ✏️
                        </button>
                        <button class="btn btn-danger" onclick="deleteCategory(${category.id}, '${category.name.replace(/'/g, "\\'")}')" title="Удалить">
                            🗑️
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
        alert('Ошибка загрузки категорий: ' + error.message);
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
    if (!confirm(`Вы уверены, что хотите удалить категорию "${categoryName}"?\n\nВсе позиции портфеля с этой категорией будут обновлены (категория будет удалена).`)) {
        return;
    }
    
    try {
        const response = await fetch(`/api/categories/${categoryId}`, {
            method: 'DELETE'
        });
        
        const data = await response.json();
        
        if (data.success) {
            alert(`✅ ${data.message}`);
            await loadManageCategories();
            await loadCategoriesList(); // Обновляем список категорий (внутри вызывается updateCategorySelects)
            // Обновляем селекты категорий в таблице
            if (document.getElementById('categories-tbody')) {
                const items = Array.from(document.querySelectorAll('#categories-tbody tr')).map(row => {
                    const ticker = row.querySelector('.category-select')?.dataset.ticker;
                    const category = row.querySelector('.category-select')?.value || '';
                    return { ticker, category };
                });
                renderCategories(items);
            }
        } else {
            alert('Ошибка удаления категории: ' + data.error);
        }
    } catch (error) {
        console.error('Ошибка удаления категории:', error);
        alert('Ошибка удаления категории: ' + error.message);
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
                alert('Название категории не может быть пустым');
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
                    alert(`✅ ${data.message}`);
                    closeCategoryEditModal();
                    await loadManageCategories();
                    await loadCategoriesList(); // Обновляем список категорий
                    // Обновляем селекты категорий в таблице
                    if (document.getElementById('categories-tbody')) {
                        const items = Array.from(document.querySelectorAll('#categories-tbody tr')).map(row => {
                            const ticker = row.querySelector('.category-select')?.dataset.ticker;
                            const category = row.querySelector('.category-select')?.value || '';
                            return { ticker, category };
                        });
                        renderCategories(items);
                    }
                } else {
                    alert('Ошибка: ' + data.error);
                }
            } catch (error) {
                console.error('Ошибка сохранения категории:', error);
                alert('Ошибка сохранения категории: ' + error.message);
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
    
    if (manageCategoriesModal) {
        manageCategoriesModal.addEventListener('click', function(e) {
            if (e.target === manageCategoriesModal) {
                closeManageCategoriesModal();
            }
        });
    }
    
    if (categoryEditModal) {
        categoryEditModal.addEventListener('click', function(e) {
            if (e.target === categoryEditModal) {
                closeCategoryEditModal();
            }
        });
    }
    
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
}

/**
 * Переключение вкладок в модальном окне управления
 */
function switchManageTab(tab) {
    const categoriesTab = document.getElementById('tab-categories');
    const assetTypesTab = document.getElementById('tab-asset-types');
    const categoriesContent = document.getElementById('categories-tab-content');
    const assetTypesContent = document.getElementById('asset-types-tab-content');
    
    if (tab === 'categories') {
        if (categoriesTab) categoriesTab.classList.add('active');
        if (assetTypesTab) assetTypesTab.classList.remove('active');
        if (categoriesContent) categoriesContent.style.display = 'block';
        if (assetTypesContent) assetTypesContent.style.display = 'none';
    } else if (tab === 'asset-types') {
        if (categoriesTab) categoriesTab.classList.remove('active');
        if (assetTypesTab) assetTypesTab.classList.add('active');
        if (categoriesContent) categoriesContent.style.display = 'none';
        if (assetTypesContent) assetTypesContent.style.display = 'block';
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
                            ✏️
                        </button>
                        <button class="btn btn-danger" onclick="deleteAssetType(${assetType.id}, '${assetType.name.replace(/'/g, "\\'")}')" title="Удалить">
                            🗑️
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
        alert('Ошибка загрузки видов активов: ' + error.message);
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
    if (!confirm(`Вы уверены, что хотите удалить вид актива "${assetTypeName}"?\n\nВсе позиции портфеля с этим видом актива будут обновлены (вид актива будет удален).`)) {
        return;
    }
    
    try {
        const response = await fetch(`/api/asset-types/${assetTypeId}`, {
            method: 'DELETE'
        });
        
        const data = await response.json();
        
        if (data.success) {
            alert(`✅ ${data.message}`);
            await loadManageAssetTypes();
            await loadAssetTypesList(); // Обновляем список видов активов
            // Обновляем селекты видов активов в таблице
            if (document.getElementById('categories-tbody')) {
                const items = Array.from(document.querySelectorAll('#categories-tbody tr')).map(row => {
                    const ticker = row.querySelector('.category-select')?.dataset.ticker;
                    const category = row.querySelector('.category-select')?.value || '';
                    const assetType = row.querySelector('.asset-type-select')?.value || '';
                    return { ticker, category, asset_type: assetType };
                });
                renderCategories(items);
            }
        } else {
            alert('Ошибка удаления вида актива: ' + data.error);
        }
    } catch (error) {
        console.error('Ошибка удаления вида актива:', error);
        alert('Ошибка удаления вида актива: ' + error.message);
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
                alert('Название вида актива не может быть пустым');
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
                    alert(`✅ ${data.message}`);
                    closeAssetTypeEditModal();
                    await loadManageAssetTypes();
                    await loadAssetTypesList(); // Обновляем список видов активов
                    // Обновляем селекты видов активов в таблице
                    if (document.getElementById('categories-tbody')) {
                        const items = Array.from(document.querySelectorAll('#categories-tbody tr')).map(row => {
                            const ticker = row.querySelector('.category-select')?.dataset.ticker;
                            const category = row.querySelector('.category-select')?.value || '';
                            const assetType = row.querySelector('.asset-type-select')?.value || '';
                            return { ticker, category, asset_type: assetType };
                        });
                        renderCategories(items);
                    }
                } else {
                    alert('Ошибка: ' + data.error);
                }
            } catch (error) {
                console.error('Ошибка сохранения вида актива:', error);
                alert('Ошибка сохранения вида актива: ' + error.message);
            }
        });
    }
    
    // Закрытие модального окна редактирования вида актива при клике вне его
    const assetTypeEditModal = document.getElementById('asset-type-edit-modal');
    if (assetTypeEditModal) {
        assetTypeEditModal.addEventListener('click', function(e) {
            if (e.target === assetTypeEditModal) {
                closeAssetTypeEditModal();
            }
        });
    }
});
