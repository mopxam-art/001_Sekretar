# Live Assistant Overlay

Real-time AI assistant для встреч и звонков с live транскрипцией и умными подсказками.

## 🎨 Дизайн

**Унифицированный минималистичный стиль** в соответствии с основным приложением:
- Светлая тема по умолчанию с автоматическим переключением на темную (prefers-color-scheme)
- Черно-белая цветовая схема без синих градиентов
- CSS Variables для консистентности с основным приложением
- Плавные анимации с Material Design easing
- Улучшенная типографика с letter-spacing
- Убран frosted glass blur для лучшей производительности

## Структура

```
live-assistant/
├── index.html      # Главный HTML файл
├── styles.scss     # Стили (SCSS)
├── styles.css      # Скомпилированные стили (автогенерируется)
├── script.js       # Логика приложения
└── README.md       # Этот файл
```

## Разработка

### Компиляция SCSS

```bash
# Однократная компиляция
npm run build:scss

# Автоматическая компиляция при изменениях
npm run watch:scss
```

### Запуск

```bash
# Dev режим с hot reload SCSS
npm run electron-dev
```

## Технологии

- **HTML5** - структура
- **SCSS** - стили с вложенностью и переменными
- **Vanilla JavaScript** - логика без фреймворков
- **WebSocket** - real-time соединения с backend
- **Web Audio API** - захват и обработка аудио

## Функции

### ✅ Реализовано

- Real-time транскрипция через Deepgram
- AI подсказки с контекстом разговора
- Чат-интерфейс (пользователь слева, AI справа)
- Таймер встречи
- Жидкое стекло (frosted glass) дизайн
- Автоскролл чата
- Детект вопросов для быстрых подсказок

### 🚧 В разработке

- Панель ключевых моментов (цифры, даты, решения)
- Детектор незавершенных тем
- Краткая сводка каждые 5 минут
- Автоматическое создание заметки после встречи

## API

### WebSocket Endpoints

**Транскрипция:**
- URL: `ws://localhost:4000/ws/transcription/stream?token={jwt}&language=ru`
- События: `session_start`, `interim_transcript`, `final_transcript`, `utterance_end`

**AI подсказки:**
- URL: `ws://localhost:4000/ws/ainotes/stream?token={jwt}`
- Запросы: `get_suggestion`, `get_key_moments`
- События: `live_suggestion`, `key_moments`

## Архитектура

```
User → Microphone
  ↓
AudioContext (16kHz PCM)
  ↓
WebSocket → Backend (Deepgram)
  ↓
Transcription Events
  ↓
Chat UI + AI Suggestions
```

## Производительность

- **Латентность транскрипции:** ~200-500ms
- **AI подсказки:** ~1-2 секунды
- **Rate limit подсказок:** 1 подсказка в 5 секунд
- **Размер overlay:** 400x600px (не блокирует основное окно)
