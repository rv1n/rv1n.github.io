
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

function initColorCustomizer() {
    Object.keys(COLOR_DEFAULTS).forEach(key => {
        const saved = localStorage.getItem(`uiColor_${key}`);
        const value = saved || COLOR_DEFAULTS[key];
        _applyColor(key, value);
    });
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
    localStorage.setItem(`uiColor_${_currentPickerKey}`, value);
    _applyColor(_currentPickerKey, value);
    closeColorPicker();
}

function resetColorPicker() {
    if (!_currentPickerKey) return;
    const def = COLOR_DEFAULTS[_currentPickerKey];
    localStorage.removeItem(`uiColor_${_currentPickerKey}`);
    _applyColor(_currentPickerKey, def);
    const input = document.getElementById('color-picker-input');
    if (input) input.value = def;
    closeColorPicker();
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
    initColorCustomizer();
});
