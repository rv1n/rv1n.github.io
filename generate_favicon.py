#!/usr/bin/env python3
"""
Скрипт для генерации favicon файлов из SVG
Требует: pip install cairosvg pillow
"""

try:
    import cairosvg
    from PIL import Image
    import io
    import os
except ImportError:
    print("Установите зависимости:")
    print("pip install cairosvg pillow")
    exit(1)

def generate_favicon(svg_path, output_dir='static'):
    """Генерирует все размеры favicon из SVG"""
    
    if not os.path.exists(svg_path):
        print(f"Ошибка: файл {svg_path} не найден")
        return
    
    # Создаем директорию если её нет
    os.makedirs(output_dir, exist_ok=True)
    
    sizes = {
        'favicon-16x16.png': 16,
        'favicon-32x32.png': 32,
        'favicon-64x64.png': 64,
        'apple-touch-icon.png': 180
    }
    
    print("Генерация favicon файлов...")
    
    for filename, size in sizes.items():
        # Конвертируем SVG в PNG
        png_data = cairosvg.svg2png(url=svg_path, output_width=size, output_height=size)
        
        # Сохраняем файл
        output_path = os.path.join(output_dir, filename)
        with open(output_path, 'wb') as f:
            f.write(png_data)
        print(f"✓ Создан: {output_path}")
    
    # Создаем favicon.ico из 32x32 PNG
    print("\nСоздание favicon.ico...")
    ico_path = os.path.join(output_dir, 'favicon-32x32.png')
    if os.path.exists(ico_path):
        img = Image.open(ico_path)
        ico_output = os.path.join(output_dir, 'favicon.ico')
        img.save(ico_output, format='ICO', sizes=[(32, 32), (16, 16)])
        print(f"✓ Создан: {ico_output}")
    
    print("\n✅ Все favicon файлы созданы!")
    print(f"Файлы находятся в директории: {output_dir}/")

if __name__ == '__main__':
    svg_file = 'static/favicon.svg'
    generate_favicon(svg_file)
