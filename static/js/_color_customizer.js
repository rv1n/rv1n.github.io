
// ======= Настройка цветов интерфейса =======

const COLOR_DEFAULTS = {
    panels:      '#1e3a5f',
    'header-text': '#ffffff',
    subtext:     '#e6c200',
};

const COLOR_TITLES = {
    panels:        'Цвет панелей и шапки',
    'header-text': 'Цвет заголовков столбцов',
    subtext:       'Цвет подтекста в шапке',
};

// Вычислить более светлую версию цвета для hover (осветлить на ~15%)
function _lightenHex(hex, amount) {
    const num = parseInt(hex.replace('#', ''), 16);
    const r = Math.min(255, (num >> 16) + amount);
    const g = Math.min(255, ((num >> 8) & 0xff) + amount);
    const b = Math.min(255, (num & 0xff) + amount);
    return '#' + [r, g, b].map(v => v.toString(16).padStart(2, '0')).join('');
}

function _applyColor(key, value) {
    const root = document.documentElement;
    if (key === 'panels') {
        root.style.setProperty('--color-panels', value);
        root.style.setProperty('--color-panels-hover', _lightenHex(value, 40));
    } else if (key === 'header-text') {
        root.style.setProperty('--color-header-text', value);
    } else if (key === 'subtext') {
        root.style.setProperty('--color-subtext', value);
    }
    // Обновить цвет кнопки в панели
    _updateBtnSwatch(key, value);
}

function _updateBtnSwatch(key, value) {
    const btn = document.getElementById(`cc-btn-${key}`);
    if (!btn) return;
    if (key === 'panels') {
        btn.style.background = value;
        btn.style.color = '#fff';
        btn.style.borderRadius = '7px';
    } else if (key === 'header-text') {
        btn.style.background = value === '#ffffff' ? '#e8edf2' : value;
        btn.style.color = value === '#ffffff' ? '#333' : '#fff';
        btn.style.borderRadius = '7px';
    } else if (key === 'subtext') {
        btn.style.background = value;
        btn.style.color = '#333';
        btn.style.borderRadius = '7px';
    }
}

let CURRENT_THEME_COLORS = { ...COLOR_DEFAULTS };

async function loadUserTheme() {
    try {
        const resp = await fetch('/api/user-theme', { credentials: 'same-origin' });
        if (!resp.ok) throw new Error('Failed to load theme');
        const data = await resp.json();
        const colors = (data && data.colors) || {};
        CURRENT_THEME_COLORS = {
            panels: colors.panels || COLOR_DEFAULTS.panels,
            'header-text': colors.header_text || COLOR_DEFAULTS['header-text'],
            subtext: colors.subtext || COLOR_DEFAULTS.subtext,
        };
    } catch (e) {
        CURRENT_THEME_COLORS = { ...COLOR_DEFAULTS };
    }

    Object.keys(CURRENT_THEME_COLORS).forEach(key => {
        _applyColor(key, CURRENT_THEME_COLORS[key]);
    });
}

async function saveUserTheme() {
    try {
        await fetch('/api/user-theme', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            credentials: 'same-origin',
            body: JSON.stringify({
                panels: CURRENT_THEME_COLORS.panels,
                header_text: CURRENT_THEME_COLORS['header-text'],
                subtext: CURRENT_THEME_COLORS.subtext,
            }),
        });
    } catch (e) {
        // тихо игнорируем ошибки сохранения
    }
}

let _currentPickerKey = null;

function openColorPicker(key) {
    const popup = document.getElementById('color-picker-popup');
    const input = document.getElementById('color-picker-input');
    const title = document.getElementById('color-picker-title');
    if (!popup || !input) return;

    // Снять active с других кнопок
    document.querySelectorAll('.color-btn').forEach(b => b.classList.remove('active'));
    const activeBtn = document.getElementById(`cc-btn-${key}`);
    if (activeBtn) activeBtn.classList.add('active');

    // Если тот же пикер — закрыть
    if (_currentPickerKey === key && popup.style.display !== 'none') {
        closeColorPicker();
        return;
    }

    _currentPickerKey = key;
    title.textContent = COLOR_TITLES[key] || 'Цвет';

    const saved = localStorage.getItem(`uiColor_${key}`);
    input.value = saved || COLOR_DEFAULTS[key];

    popup.style.display = 'block';
}

function closeColorPicker() {
    const popup = document.getElementById('color-picker-popup');
    if (popup) popup.style.display = 'none';
    document.querySelectorAll('.color-btn').forEach(b => b.classList.remove('active'));
    _currentPickerKey = null;
}

function applyColorPicker() {
    if (!_currentPickerKey) return;
    const input = document.getElementById('color-picker-input');
    if (!input) return;
    const value = input.value;
    CURRENT_THEME_COLORS[_currentPickerKey] = value;
    _applyColor(_currentPickerKey, value);
    saveUserTheme();
    closeColorPicker();
}

function resetColorPicker() {
    if (!_currentPickerKey) return;
    const def = COLOR_DEFAULTS[_currentPickerKey];
    CURRENT_THEME_COLORS[_currentPickerKey] = def;
    _applyColor(_currentPickerKey, def);
    saveUserTheme();
    const input = document.getElementById('color-picker-input');
    if (input) input.value = def;
    closeColorPicker();
}

function resetAllColors() {
    Object.keys(COLOR_DEFAULTS).forEach(key => {
        CURRENT_THEME_COLORS[key] = COLOR_DEFAULTS[key];
        _applyColor(key, COLOR_DEFAULTS[key]);
    });
    saveUserTheme();
    closeColorPicker();

    // Анимация кнопки
    const btn = document.querySelector('.color-btn-reset');
    if (btn) {
        btn.classList.add('spinning');
        setTimeout(() => btn.classList.remove('spinning'), 500);
    }
}

// Закрытие попапа при клике вне него
document.addEventListener('click', function(e) {
    const popup = document.getElementById('color-picker-popup');
    const customizer = document.getElementById('color-customizer');
    if (popup && popup.style.display !== 'none' && customizer && !customizer.contains(e.target)) {
        closeColorPicker();
    }
});

document.addEventListener('DOMContentLoaded', function() {
    loadUserTheme();
});
